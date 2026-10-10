<?php

namespace App\Console\Commands;

use App\Jobs\PurgeDeletedVoiceAnnotation;
use App\Jobs\PurgeSpeechMedia;
use App\Jobs\PurgeVoiceAsset;
use App\Models\Annotation;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\Captions\CaptionAttemptTracker;
use App\Services\QuotaService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * §9.1's fourth release path, and per the plan "the highest-value ops job
 * in the system": a client that vanished mid-upload (closed tab, dead
 * phone) leaves a `speech_assets` row stuck in `uploading` forever. Without
 * this sweep, `uploads_in_flight` never comes back down, and a user with a
 * cap of two abandoned uploads can never upload again (STEP-03 acceptance).
 *
 * Releases the counter, not just the row — that distinction is the entire
 * point (§9.1's release-paths table).
 *
 * PLAN-ADMIN-DASHBOARD.md §5.6 added a sixth sweep with a different owner:
 * the taken-down-speech media purge. It is here rather than on a 30-day
 * `->delay()` at the takedown site because `speeches.deleted_at` is a durable
 * fact and a month-old delayed job in Redis is not — the same argument the
 * voice-tombstone sweep below already makes for itself. See
 * App\Jobs\PurgeSpeechMedia for the window, the deletion scope, and why
 * reviewer voice notes survive a takedown.
 *
 * Scheduled nightly; see routes/console.php.
 */
class MediaReconcileCommand extends Command
{
    protected $signature = 'media:reconcile
        {--upload-hours=2 : age threshold for a stuck upload}
        {--transcode-hours=2 : age threshold for a hung transcode, per §9.2}
        {--caption-queue-wait-seconds= : seconds a captions job may sit dispatched with no worker before failing (default: config(captions.queue_wait_seconds), STEP-09 §4.1)}
        {--caption-heartbeat-stale-seconds= : seconds since the last WhisperTranscriber heartbeat before a started captions attempt is considered lost (default: config(captions.heartbeat_stale_seconds), >=4200 per STEP-09 §4.1)}
        {--source-retention-hours=24 : hours a ready source (original upload) is kept after its video rendition is ready and captions have settled, before the original is deleted (R10, MODERNIZATION_PLAN §13/§21)}
        {--takedown-quarantine-days= : days a taken-down (soft-deleted) speech keeps its media before the bytes are purged (default: config(media.takedown_quarantine_days), PLAN-ADMIN-DASHBOARD §5.6/§11.2)}';

    protected $description = 'Release quota held by abandoned uploads, surface hung transcodes, recover stale caption attempts, prune retained originals, and purge media for speeches taken down beyond the quarantine window (§9.1, §9.2, STEP-09 §4.1, R10, PLAN-ADMIN-DASHBOARD §5.6).';

    public function handle(QuotaService $quota): int
    {
        $staleUploads = SpeechAsset::query()
            ->where('status', 'uploading')
            ->where('created_at', '<', now()->subHours((int) $this->option('upload-hours')))
            ->get();

        foreach ($staleUploads as $asset) {
            $quota->releaseOnReconcile($asset);
            $asset->update([
                'status' => 'failed',
                'failure_code' => 'upload_abandoned',
                'failure_detail' => 'No completion within the reconcile window; quota released.',
            ]);
        }

        // §9.2: "sweeps ... rows stuck in processing beyond two hours" — a
        // transcode that crashed or lost its job (e.g. a worker restart)
        // without ever reaching ready/failed. Quota is already correct for
        // these (releaseOnComplete already ran when the SOURCE finished
        // uploading); this only gives the speaker a visible Failed+Retry
        // instead of a silent, permanent "processing".
        //
        // STEP-09-VERIFICATION-PLAN.md §4.1: "restrict transcode
        // reconciliation to transcode kinds" — without the `whereIn` below
        // this same immutable-`created_at` sweep would also catch
        // `kind=captions` rows (they share the same `status=processing`
        // value), racing App\Jobs\GenerateCaptions/EnsureCaptionJob with a
        // cruder rule than the attempt-token-aware reconcileCaptions()
        // below. `video`/`poster`/`sprite` are every kind
        // App\Jobs\TranscodeSpeechAsset / App\Services\Transcoding\
        // FfmpegTranscoder ever write; `source`/`captions` are deliberately
        // excluded (source never sits at `processing`, captions has its
        // own dedicated sweep).
        $hungTranscodes = SpeechAsset::query()
            ->whereIn('kind', ['video', 'poster', 'sprite'])
            ->where('status', 'processing')
            ->where('created_at', '<', now()->subHours((int) $this->option('transcode-hours')))
            ->get();

        foreach ($hungTranscodes as $asset) {
            $asset->update([
                'status' => 'failed',
                'failure_code' => 'transcode_timed_out',
                'failure_detail' => 'No transcode result within the reconcile window.',
            ]);
        }

        $staleVoice = SpeechAsset::query()
            ->where('kind', 'voice_note')->whereNull('purge_claim_id')->whereNotNull('temporary_path')
            ->where('updated_at', '<', now()->subHours((int) $this->option('transcode-hours')))->get();
        foreach ($staleVoice as $asset) {
            $temporaryPath = $asset->temporary_path;
            // STEP-14-deploy-hardening.md phpstan level 8: `temporary_path`
            // is nullable at the schema level, but the query above already
            // filters `whereNotNull('temporary_path')` — PHPStan can't see
            // through a query-builder condition into the hydrated model's
            // attribute type, so this re-states the same guarantee as a
            // real, checked guard rather than a cast.
            if ($temporaryPath === null) {
                continue;
            }
            $candidatePath = $asset->normalization_candidate_path;
            $reserved = (int) ($asset->temporary_byte_size ?? 0);
            if ($asset->status === 'ready') {
                if (Storage::disk($asset->disk)->exists($temporaryPath) && ! Storage::disk($asset->disk)->delete($temporaryPath)) {
                    continue;
                }
                DB::transaction(function () use ($asset, $temporaryPath, $reserved, $quota): void {
                    $fresh = SpeechAsset::query()->whereKey($asset->id)->where('status', 'ready')->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
                    if ($fresh === null || $fresh->temporary_byte_size === null) {
                        return;
                    }
                    // Resolved under this same lock, not the batch-fetch
                    // snapshot from the top of this loop — this command
                    // can run over a long list and iterate for a while
                    // before reaching a given asset, and the annotation/
                    // review it belongs to can be concurrently hard-deleted
                    // in that window (ReviewService::clearAnnotations/
                    // revokeAndPurge). See FfmpegVoiceNoteProcessor::fail's
                    // identical comment for why a stale reviewer silently
                    // drops the quota release/reconcile.
                    $reviewer = $fresh->voiceAnnotation()->first()?->review()->first()?->reviewer()->first();
                    if ($reviewer !== null) {
                        $quota->reconcileDirect($reviewer, $reserved, (int) $fresh->byte_size);
                    }
                    $fresh->update(['temporary_path' => null, 'temporary_byte_size' => null]);
                });
            } elseif ($asset->status === 'processing') {
                $won = DB::transaction(function () use ($asset, $temporaryPath, $reserved, $quota): bool {
                    $fresh = SpeechAsset::query()->whereKey($asset->id)->where('status', 'processing')->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
                    if ($fresh === null || $fresh->temporary_byte_size === null) {
                        return false;
                    }
                    $fresh->update(['status' => 'failed', 'failure_code' => 'voice_normalization_failed', 'failure_detail' => 'Voice normalization did not complete.', 'temporary_byte_size' => null, 'byte_size' => 0]);
                    $fresh->voiceAnnotation()->whereIn('transcript_status', ['pending', 'processing'])->update(['transcript_status' => 'failed']);
                    // See the 'ready' branch above for why this must be
                    // resolved under the lock, not the batch-fetch snapshot.
                    $reviewer = $fresh->voiceAnnotation()->first()?->review()->first()?->reviewer()->first();
                    if ($reviewer !== null) {
                        $quota->releaseDirect($reviewer, $reserved);
                    }

                    return true;
                });
                $clean = $won;
                if ($won) {
                    foreach (SpeechAsset::voiceAssetCandidatePaths($temporaryPath, $candidatePath) as $path) {
                        $clean = (! Storage::disk($asset->disk)->exists($path) || Storage::disk($asset->disk)->delete($path)) && $clean;
                    }
                }
                if ($clean) {
                    SpeechAsset::query()->whereKey($asset->id)->where('temporary_path', $temporaryPath)->update(['temporary_path' => null, 'normalization_candidate_path' => null]);
                }
            } elseif ($asset->status === 'failed') {
                $clean = true;
                foreach (SpeechAsset::voiceAssetCandidatePaths($temporaryPath, $candidatePath) as $path) {
                    $clean = (! Storage::disk($asset->disk)->exists($path) || Storage::disk($asset->disk)->delete($path)) && $clean;
                }
                if ($clean) {
                    SpeechAsset::query()->whereKey($asset->id)->where('status', 'failed')->where('temporary_path', $temporaryPath)->whereNull('temporary_byte_size')->update(['temporary_path' => null, 'normalization_candidate_path' => null]);
                }
            }
        }

        $reconciledCaptions = $this->reconcileCaptions();

        // Queue publication after a successful DB commit can still fail.
        // Soft-deleted annotations and hard-delete orphan assets are durable
        // facts, so sweep them directly rather than trusting Redis to have
        // received the original delayed purge job.
        $purgedTombstones = 0;
        $tombstones = Annotation::withTrashed()
            ->whereNotNull('deleted_at')
            ->whereNotNull('audio_asset_id')
            ->where('deleted_at', '<=', now()->subSeconds(10))
            ->get(['id']);
        foreach ($tombstones as $annotation) {
            try {
                (new PurgeDeletedVoiceAnnotation($annotation->id))->handle($quota);
                $purgedTombstones++;
            } catch (\Throwable $exception) {
                report($exception);
                $this->warn("Voice annotation {$annotation->id} purge remains pending: {$exception->getMessage()}");
            }
        }

        $purgedOrphans = 0;
        $orphanAssets = SpeechAsset::query()
            ->where('kind', 'voice_note')
            ->whereNotNull('purge_reviewer_id')
            ->whereNotExists(fn ($query) => $query->selectRaw('1')->from('annotations')->whereColumn('annotations.audio_asset_id', 'speech_assets.id'))
            ->get(['id', 'purge_reviewer_id']);
        foreach ($orphanAssets as $asset) {
            try {
                (new PurgeVoiceAsset($asset->id, $asset->purge_reviewer_id))->handle($quota);
                $purgedOrphans++;
            } catch (\Throwable $exception) {
                report($exception);
                $this->warn("Voice asset {$asset->id} purge remains pending: {$exception->getMessage()}");
            }
        }

        $purgedTakedowns = $this->purgeQuarantinedTakedowns($quota);

        $prunedOriginals = $this->pruneRetainedOriginals((int) $this->option('source-retention-hours'));

        $this->info("Reconciled {$staleUploads->count()} abandoned upload(s), {$hungTranscodes->count()} hung transcode(s), {$staleVoice->count()} stale voice note(s), {$reconciledCaptions} stale caption attempt(s), {$purgedTombstones} voice tombstone(s), {$purgedOrphans} orphan voice asset(s), {$purgedTakedowns} taken-down speech(es) purged, and {$prunedOriginals} retained original(s) pruned.");

        return self::SUCCESS;
    }

    /**
     * PLAN-ADMIN-DASHBOARD.md §5.6/§11.2: purge the media of speeches whose
     * takedown quarantine has run out. Before this, `media:reconcile` had
     * ZERO speech soft-delete awareness — §1.3's finding — so every byte of
     * every taken-down speech survived forever (see PurgeSpeechMedia's
     * docblock for why no other sweep reclaims them either, including the
     * retained-originals prune directly below, which cannot see a trashed
     * speech at all).
     *
     * Modelled on the voice-tombstone loop in handle() rather than on a new
     * pattern, down to the per-item try/catch: a `deleted_at` old enough to
     * purge is a durable DB fact, so this re-derives the work from the
     * database every night instead of trusting a delayed job dispatched 30
     * days earlier to still exist in Redis. One speech's failure (a storage
     * delete that returns false, which PurgeSpeechMedia turns into a throw
     * precisely so the rows survive for the retry) must not abandon the rest
     * of the sweep or fail the command.
     *
     * Selection is on ROW EXISTENCE of a purgeable kind, not on a byte
     * count: `byte_size` is nullable and only set at completion, so a
     * `byte_size`-based filter would silently skip rows whose objects are
     * very much still there. A row whose object is already gone is still
     * worth selecting — the purge deletes the stranded row and its
     * `exists()`-guarded storage delete is simply a no-op. Once purged, a
     * speech has no rows of these kinds left and drops out of this query, so
     * the sweep does not re-visit it nightly.
     *
     * The window is passed down explicitly: the job re-checks it (no
     * dispatch site is trusted to have honoured it), and if it re-read the
     * config while this query used a `--takedown-quarantine-days` override,
     * the override would select speeches the job then silently refused.
     */
    private function purgeQuarantinedTakedowns(QuotaService $quota): int
    {
        $quarantineDays = (int) ($this->option('takedown-quarantine-days') ?? config('media.takedown_quarantine_days'));

        $purged = 0;

        $quarantined = Speech::onlyTrashed()
            ->where('deleted_at', '<', now()->subDays($quarantineDays))
            ->whereExists(fn ($query) => $query->selectRaw('1')->from('speech_assets')
                ->whereColumn('speech_assets.speech_id', 'speeches.id')
                ->whereIn('speech_assets.kind', PurgeSpeechMedia::PURGED_KINDS))
            ->get();

        foreach ($quarantined as $speech) {
            try {
                // Counted on the job's own answer, not on having called it:
                // `handle()` returns false for a run that removed nothing
                // (another runner holds the `purge_claim_id`, or the rows
                // went away between this SELECT and the row lock), and a
                // summary line that counted those would over-report every
                // night a sweep raced an eager dispatch.
                if ((new PurgeSpeechMedia($speech, $quarantineDays))->handle($quota)) {
                    $purged++;
                }
            } catch (\Throwable $exception) {
                report($exception);
                $this->warn("Speech {$speech->id} media purge remains pending: {$exception->getMessage()}");
            }
        }

        return $purged;
    }

    /**
     * MODERNIZATION_PLAN §13 R10 ("most likely production outage") and §21:
     * "stop retaining originals once a rendition is ready ... loses nothing"
     * for a coaching product. Before this method, `kind='source'` rows were
     * never deleted anywhere in the codebase (confirmed by reading
     * FfmpegTranscoder, GenerateCaptions, and every purge job) — a ready
     * video plus its never-reclaimed source is 2x the accounted storage per
     * speech, exactly the gap the plan's quota section calls out.
     *
     * A source is only ever deleted once ALL of the following hold, each
     * re-checked here rather than trusted from whatever triggered the
     * original upload:
     *
     *  - `kind=video` is `ready` for the same speech — there is a durable
     *    rendition to serve; deleting the source before this exists would
     *    destroy the only playable copy.
     *  - Captions have settled: either the speech has captions disabled, or
     *    no `kind=captions` row is currently `uploading`/`processing`. Both
     *    GenerateCaptions (STEP-09) and a user re-enabling captions later
     *    via EnsureCaptionJob::enable() read `kind=source` directly — a
     *    delete racing a dispatched-but-not-yet-started captions job would
     *    fail that job outright. This check does NOT prevent captions being
     *    turned on again much later and finding no source (EnsureCaptionJob
     *    handles that as "no ready source yet", a safe no-op, not an
     *    error) — the plan explicitly accepts that trade-off.
     *  - `updated_at` is older than `--source-retention-hours` (default 24)
     *    — a grace window past the two checks above, not relied on alone,
     *    so a slow-to-dispatch captions job has room to start before its
     *    source can vanish out from under it.
     *
     * Storage is deleted BEFORE the row, mirroring every other
     * delete-then-clear sequence in this command (see the voice-note
     * branches above): a storage delete that fails (returns false while the
     * file still exists) leaves the row in place so the NEXT sweep retries
     * it, rather than deleting the row and orphaning an unreachable but
     * still-billed file.
     */
    private function pruneRetainedOriginals(int $retentionHours): int
    {
        $pruned = 0;

        $eligibleSources = SpeechAsset::query()
            ->where('kind', 'source')
            ->where('status', 'ready')
            ->where('updated_at', '<', now()->subHours($retentionHours))
            ->get(['id', 'speech_id', 'disk', 'path']);

        $speechIds = $eligibleSources->pluck('speech_id');

        // Batched once per sweep, not once per row: the loop below only
        // ever does array lookups against these three, instead of 3N+1
        // queries for N eligible sources.
        $captionsEnabledBySpeech = Speech::query()
            ->whereIn('id', $speechIds)
            ->pluck('captions_enabled', 'id');

        $speechIdsWithReadyVideo = SpeechAsset::query()
            ->whereIn('speech_id', $speechIds)
            ->where('kind', 'video')
            ->where('status', 'ready')
            ->pluck('speech_id')
            ->flip();

        $speechIdsWithCaptionsMidFlight = SpeechAsset::query()
            ->whereIn('speech_id', $speechIds)
            ->where('kind', 'captions')
            ->whereIn('status', ['uploading', 'processing'])
            ->pluck('speech_id')
            ->flip();

        foreach ($eligibleSources as $source) {
            // No speech row visible for this source. Two distinct cases, and
            // naming them matters because PLAN-ADMIN-DASHBOARD §13 records
            // rev 1 of that plan getting this exact line backwards:
            //
            //  - hard-deleted speech: the CASCADE owns the row's fate.
            //  - SOFT-deleted (taken down) speech: `Speech::query()` above
            //    carries the SoftDeletes global scope, so a trashed speech
            //    is simply absent here and its source falls through this
            //    `continue` — retained, not pruned. That is deliberate;
            //    purging a taken-down speech's media is
            //    purgeQuarantinedTakedowns()'s job, under the §11.2
            //    quarantine window this sweep's retention hours know nothing
            //    about. Do NOT "fix" this by switching to `withTrashed()`:
            //    it would delete the source hours after a takedown and break
            //    the restore window.
            if (! $captionsEnabledBySpeech->has($source->speech_id)) {
                continue;
            }

            if (! $speechIdsWithReadyVideo->has($source->speech_id)) {
                continue;
            }

            $captionsMidFlight = $captionsEnabledBySpeech[$source->speech_id]
                && $speechIdsWithCaptionsMidFlight->has($source->speech_id);

            if ($captionsMidFlight) {
                continue;
            }

            $disk = Storage::disk($source->disk);

            if ($disk->exists($source->path) && ! $disk->delete($source->path)) {
                continue;
            }

            $removed = SpeechAsset::query()
                ->whereKey($source->id)
                ->where('status', 'ready')
                ->delete();

            if ($removed) {
                $pruned++;
            }
        }

        return $pruned;
    }

    /**
     * STEP-09-VERIFICATION-PLAN.md §4.1 "Recovery has two explicit clocks":
     * a hard worker loss (kill, OOM, host loss) bypasses every application
     * catch and App\Jobs\GenerateCaptions::failed() backstop alike — the
     * row is simply left at `processing` forever with no other process
     * ever revisiting it. This sweep is that other process.
     *
     * Both branches below are compare-and-set on the row's OWN current
     * `caption_attempt_id` via CaptionAttemptTracker::compareAndSet() —
     * never a bare `status = 'processing'` write — so a row already
     * superseded by a disable, a manual edit, or a fresh re-enable (all of
     * which either invalidate the token or rotate a new one before this
     * sweep runs) is left alone even if it happens to match the age/
     * staleness filter below by coincidence.
     */
    private function reconcileCaptions(): int
    {
        $queueWaitSeconds = (int) ($this->option('caption-queue-wait-seconds') ?? config('captions.queue_wait_seconds'));
        $heartbeatStaleSeconds = (int) ($this->option('caption-heartbeat-stale-seconds') ?? config('captions.heartbeat_stale_seconds'));

        $reconciled = 0;

        // Clock 1: dispatched, never claimed. `caption_started_at` is only
        // ever set by CaptionAttemptTracker::claim() inside
        // GenerateCaptions::handle() — still null means no worker ever
        // picked this job up at all (lost dispatch, dead queue, a worker
        // that was down the whole time).
        $neverStarted = SpeechAsset::query()
            ->where('kind', 'captions')
            ->where('status', 'processing')
            ->whereNotNull('caption_attempt_id')
            ->whereNull('caption_started_at')
            ->where('caption_queued_at', '<', now()->subSeconds($queueWaitSeconds))
            ->get(['id', 'caption_attempt_id']);

        foreach ($neverStarted as $asset) {
            /** @var string $attemptId */
            $attemptId = $asset->caption_attempt_id;

            if (CaptionAttemptTracker::compareAndSet($asset->id, $attemptId, [
                'status' => 'failed',
                'failure_code' => 'caption_queue_timeout',
                'failure_detail' => 'No worker picked up this caption job within the reconcile window.',
            ])) {
                $reconciled++;
            }
        }

        // Clock 2: claimed, then went silent. A started row's heartbeat is
        // advanced at each WhisperTranscriber stage boundary; a heartbeat
        // this old (>=4200s: the 3600s effective job timeout plus retry/
        // storage/DB margin, independent of how often this command itself
        // runs) means the worker that claimed it is gone, not just slow.
        $stalledStarted = SpeechAsset::query()
            ->where('kind', 'captions')
            ->where('status', 'processing')
            ->whereNotNull('caption_attempt_id')
            ->whereNotNull('caption_started_at')
            ->where('caption_heartbeat_at', '<', now()->subSeconds($heartbeatStaleSeconds))
            ->get(['id', 'caption_attempt_id']);

        foreach ($stalledStarted as $asset) {
            /** @var string $attemptId */
            $attemptId = $asset->caption_attempt_id;

            if (CaptionAttemptTracker::compareAndSet($asset->id, $attemptId, [
                'status' => 'failed',
                'failure_code' => 'caption_worker_lost',
                'failure_detail' => 'The captioning process stopped responding; please retry.',
            ])) {
                $reconciled++;
            }
        }

        return $reconciled;
    }
}
