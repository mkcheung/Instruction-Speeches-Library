<?php

namespace App\Console\Commands;

use App\Models\SpeechAsset;
use App\Services\Captions\CaptionAttemptTracker;
use App\Services\QuotaService;
use Illuminate\Console\Command;

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
 * Scheduled nightly; see routes/console.php.
 */
class MediaReconcileCommand extends Command
{
    protected $signature = 'media:reconcile
        {--upload-hours=2 : age threshold for a stuck upload}
        {--transcode-hours=2 : age threshold for a hung transcode, per §9.2}
        {--caption-queue-wait-seconds= : seconds a captions job may sit dispatched with no worker before failing (default: config(captions.queue_wait_seconds), STEP-09 §4.1)}
        {--caption-heartbeat-stale-seconds= : seconds since the last WhisperTranscriber heartbeat before a started captions attempt is considered lost (default: config(captions.heartbeat_stale_seconds), >=4200 per STEP-09 §4.1)}';

    protected $description = 'Release quota held by abandoned uploads, surface hung transcodes, and recover stale caption attempts (§9.1, §9.2, STEP-09 §4.1).';

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

        $reconciledCaptions = $this->reconcileCaptions();

        $this->info("Reconciled {$staleUploads->count()} abandoned upload(s), {$hungTranscodes->count()} hung transcode(s), and {$reconciledCaptions} stale caption attempt(s).");

        return self::SUCCESS;
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
