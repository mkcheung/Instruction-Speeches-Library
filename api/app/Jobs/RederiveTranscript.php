<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\CaptionRevision;
use App\Services\Captions\CaptionRevisionMismatchException;
use App\Services\Captions\CaptionStorageReadException;
use App\Services\Captions\InvalidVttException;
use App\Services\Captions\TranscriptDeriver;
use App\Services\Captions\Vtt;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * STEP-09-VERIFICATION-PLAN.md §4.1 "Projection convergence token" (the
 * final paragraph) rewrites this job around an explicit
 * `content_revision`/`caption_revision` pair rather than the old
 * `WithoutOverlapping`-on-a-lock shape: `CaptionService::update` "computes
 * the revision, checks the storage write, persists it, and dispatches
 * RederiveTranscript(asset_id, expected_revision)" — this job's whole
 * point is to derive a `speech_transcripts` row for EXACTLY that revision,
 * or cleanly no-op once a newer revision has already superseded it.
 *
 * Deliberately reads the VTT back from storage rather than being handed
 * the string directly: the SAME "the file is canonical, the row is
 * derived FROM the file" shape App\Jobs\GenerateCaptions/
 * WhisperTranscriber use for a fresh whisper run, so there is exactly one
 * code path (Vtt::parse + TranscriptDeriver::derive) that ever produces a
 * speech_transcripts row, regardless of which of the two ways the VTT got
 * there.
 */
class RederiveTranscript implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * A parse-and-derive pass over one speaker-sized VTT file — nowhere
     * near GenerateCaptions'/TranscodeSpeechAsset's multi-thousand-second
     * budgets, but still bounded.
     */
    public int $timeout = 60;

    public bool $failOnTimeout = true;

    /**
     * §4.1 point 1: "has its own tries/backoff budget for transient
     * storage failures ... so revision-safe concurrent jobs cannot consume
     * attempts merely waiting for a lock" — this budget exists purely to
     * ride out a flaky disk/network read (CaptionStorageReadException) or
     * a genuine storage-integrity failure
     * (CaptionRevisionMismatchException), not to wait out a lock, which is
     * why no `WithoutOverlapping` middleware exists on this job at all
     * (see the removed `middleware()` method this class used to have).
     */
    public int $tries = 5;

    public function __construct(public int $captionsAssetId, public string $expectedRevision)
    {
        $this->afterCommit = true;

        // §4.1 point 1: routed onto the `redis`/`default` connection and
        // queue, NOT `redis-long`/`captions` — this is a fast
        // parse-and-write projection, not a CPU-heavy whisper.cpp
        // transcription, and must never queue behind one.
        $this->connection = 'redis';
        $this->queue = 'default';
    }

    /**
     * Linear-ish backoff for the transient-failure cases above: enough
     * spacing for a momentarily-unavailable disk/object-store backend to
     * recover, short enough that a real edit's transcript still converges
     * within the PUT UI's bounded condition-poll (§4.1's closing
     * paragraph).
     *
     * @return array<int, int>
     */
    public function backoff(): array
    {
        return [2, 5, 10, 20, 40];
    }

    public function handle(TranscriptDeriver $deriver): void
    {
        $captionsAsset = SpeechAsset::query()->find($this->captionsAssetId);

        if ($captionsAsset === null || $captionsAsset->status !== 'ready') {
            return;
        }

        // §4.1 point 2: compare the CURRENT asset revision against this
        // job's expected revision and exit successfully when superseded —
        // BEFORE inspecting any newer canonical bytes. A later edit (or a
        // whisper run landing after this job was queued) already
        // dispatched its own RederiveTranscript for the newer revision;
        // this one has nothing useful left to do.
        if ($captionsAsset->content_revision !== $this->expectedRevision) {
            Log::info('RederiveTranscript: asset revision has moved on, no-op.', [
                'caption_asset_id' => $captionsAsset->id,
                'expected_revision' => $this->expectedRevision,
                'current_revision' => $captionsAsset->content_revision,
            ]);

            return;
        }

        // §4.1 point 3: only reached for a still-current job. Storage/
        // network absence is retryable — thrown, not caught-and-succeeded,
        // so the job's own tries/backoff budget above decides whether this
        // resolves or eventually fails.
        $vtt = Storage::disk($captionsAsset->disk)->get($captionsAsset->path);

        if ($vtt === null) {
            throw new CaptionStorageReadException(
                "RederiveTranscript: no VTT content in storage for caption asset {$captionsAsset->id}."
            );
        }

        if (CaptionRevision::compute($vtt) !== $this->expectedRevision) {
            // The bytes just read don't match what this job was told to
            // expect. Lock/re-read the asset before deciding what that
            // means: if a concurrently-committing newer edit has already
            // moved `content_revision` on, this job is simply superseded
            // (clean no-op) — the mismatch was just this job losing a race
            // against a write-in-progress, not corruption. Only a
            // STILL-current mismatch under the lock is a real
            // storage-integrity problem.
            $fresh = SpeechAsset::query()->whereKey($captionsAsset->id)->lockForUpdate()->first();

            if ($fresh === null || $fresh->content_revision !== $this->expectedRevision) {
                Log::info('RederiveTranscript: revision moved on while re-reading storage, no-op.', [
                    'caption_asset_id' => $captionsAsset->id,
                    'expected_revision' => $this->expectedRevision,
                ]);

                return;
            }

            Log::error('RederiveTranscript: stored VTT bytes do not hash to the still-current expected revision.', [
                'caption_asset_id' => $captionsAsset->id,
                'expected_revision' => $this->expectedRevision,
            ]);

            throw new CaptionRevisionMismatchException(
                "RederiveTranscript: stored VTT for caption asset {$captionsAsset->id} does not match expected revision {$this->expectedRevision}."
            );
        }

        try {
            $cues = Vtt::parse($vtt);
        } catch (InvalidVttException $e) {
            // Cannot happen through the normal write path (
            // UpdateCaptionsRequest already validated this exact string
            // before CaptionService persisted it) — guarded anyway rather
            // than letting a job exception surface as a queue failure for
            // what would be a data problem, not a retryable one. Do NOT
            // touch speech_transcripts here — writing nothing is the safe
            // outcome, not writing bad data.
            Log::warning('RederiveTranscript: stored VTT failed to re-parse.', [
                'caption_asset_id' => $captionsAsset->id,
                'exception' => $e->getMessage(),
            ]);

            return;
        }

        $derived = $deriver->derive($cues);

        // §4.1 point 4: lock the asset immediately before writing and
        // RECHECK its revision inside the transaction — parsing above ran
        // unlocked, so a concurrent edit could have committed a newer
        // revision while this job was mid-parse. Re-verifying here, right
        // before the transcript upsert, is what makes that edit win rather
        // than this stale derivation.
        DB::transaction(function () use ($captionsAsset, $derived): void {
            /** @var SpeechAsset|null $fresh */
            $fresh = SpeechAsset::query()->whereKey($captionsAsset->id)->lockForUpdate()->first();

            if ($fresh === null || $fresh->content_revision !== $this->expectedRevision) {
                Log::info('RederiveTranscript: revision moved on during derivation, no-op.', [
                    'caption_asset_id' => $captionsAsset->id,
                    'expected_revision' => $this->expectedRevision,
                ]);

                return;
            }

            // The model/language a transcript was ORIGINALLY produced by
            // are preserved across an edit (§ acceptance: "a filler count
            // is only comparable against another from the same model" — a
            // manual edit doesn't change which model transcribed the
            // speech). Only a row that never existed before (edited before
            // any whisper run ever completed) falls back to the
            // configured defaults.
            $existing = SpeechTranscript::query()->where('speech_id', $fresh->speech_id)->first();

            $attributes = [
                ...$derived,
                // Explicit null check, not `?->`: `$existing` is
                // legitimately null the first time a speaker hand-edits
                // captions before any whisper run has ever completed for
                // this speech (CaptionService's own documented case) — a
                // plain `$existing->language` would fatal on every such
                // first edit.
                'language' => $existing !== null ? $existing->language : (string) config('captions.language'),
                'model' => $existing !== null ? $existing->model : (string) config('captions.model_name'),
                'source' => 'edited',
                // §4.1 point 5: the transcript stores the revision it was
                // actually derived from — always $this->expectedRevision,
                // never $fresh's, though the two are guaranteed equal by
                // the guard above.
                'caption_revision' => $this->expectedRevision,
            ];

            if ($existing !== null) {
                $existing->update($attributes);
            } else {
                SpeechTranscript::query()->create([...$attributes, 'speech_id' => $fresh->speech_id]);
            }
        });
    }

    /**
     * Backstop once the tries/backoff budget above is exhausted (a
     * persistent CaptionStorageReadException/CaptionRevisionMismatchException,
     * or any other unhandled exception). Logged only — deliberately does
     * NOT touch `speech_transcripts`: a projection job that can't safely
     * derive is a no-op, not a writer of bad data, matching §4.1 point 3's
     * "explicit safe storage-integrity failure rather than success."
     */
    public function failed(Throwable $e): void
    {
        Log::error('RederiveTranscript: job failed after exhausting its retry budget.', [
            'caption_asset_id' => $this->captionsAssetId,
            'expected_revision' => $this->expectedRevision,
            'exception' => $e->getMessage(),
        ]);
    }
}
