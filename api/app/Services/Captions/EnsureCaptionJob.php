<?php

namespace App\Services\Captions;

use App\Exceptions\CaptionsDisabledException;
use App\Jobs\GenerateCaptions;
use App\Models\Speech;
use App\Models\SpeechAsset;
use Illuminate\Support\Facades\DB;

/**
 * captions-settings gap fix (post-STEP-09 code review): the single place a
 * `captions` asset row / GenerateCaptions job gets created or retried, for
 * every caller — upload completion, the new `PATCH .../caption-settings`
 * endpoint, and the existing retry endpoint. Before this class existed
 * those three call sites each open-coded their own "create or reuse a
 * captions row and dispatch" logic (or, for the settings endpoint, didn't
 * exist at all), which is exactly the kind of divergence that produced the
 * whisper/edit clobber race fixed earlier in STEP-09.
 *
 * Every public method here locks the `speeches` row AND the `speech_assets`
 * captions row (when one exists) with `lockForUpdate()` inside one
 * transaction before deciding anything — same row-locking convention
 * CaptionService::update already uses for the edit path. That's what makes
 * a concurrent enable/upload-complete/retry converge safely: whichever
 * caller's transaction commits first is the one whose decision sticks,
 * and the next caller re-reads fresh state under the same lock rather than
 * acting on a stale in-memory `Speech`/`SpeechAsset` instance.
 *
 * Implements the frozen state table from the captions-settings task brief
 * exactly — each method's doc comment below cites the row(s) it covers.
 */
class EnsureCaptionJob
{
    private const CAPTIONS_DISABLED_DETAIL = 'Captions were turned off while generation was in progress.';

    /**
     * `PATCH .../caption-settings` with `captions_enabled: true`.
     *
     * Table rows:
     *  - No ready source, no caption asset -> persist true; create nothing.
     *  - No ready source, existing `failed` asset -> persist true, retain
     *    the failed row untouched, create no job.
     *  - Ready source, no asset or a `failed` asset -> create/reuse exactly
     *    one row as `processing`, dispatch exactly one job (also covers
     *    "failed/captions_disabled with ready source -> re-enable": reusing
     *    the row clears its failure fields as part of the same update).
     *  - `processing`/`ready` -> idempotent no-op, never duplicates a
     *    row/job.
     */
    public function enable(Speech $speech): void
    {
        DB::transaction(function () use ($speech) {
            $locked = $this->lockSpeech($speech);
            $asset = $this->lockCaptionsAsset($locked);

            $locked->update(['captions_enabled' => true]);
            $speech->setAttribute('captions_enabled', true);

            if ($asset !== null && in_array($asset->status, ['processing', 'ready'], true)) {
                return; // idempotent no-op — never duplicate row/job
            }

            $hasReadySource = $locked->assets()->where('kind', 'source')->where('status', 'ready')->exists();

            if (! $hasReadySource) {
                // No ready source yet: the flag is on, but there is nothing
                // to transcribe. Any existing failed row is left exactly as
                // it is — "retain" per the table, not "clear".
                return;
            }

            $this->startProcessing($locked, $asset);
        });
    }

    /**
     * `PATCH .../caption-settings` with `captions_enabled: false`.
     *
     * Table rows:
     *  - No asset or `failed` -> persist false; retain failure history;
     *    dispatch nothing.
     *  - `processing` -> atomically persist false AND move that attempt to
     *    `failed`/`captions_disabled`, under the SAME row lock
     *    WhisperTranscriber's own guarded write takes
     *    (`SpeechAsset::whereKey(...)->lockForUpdate()` before checking
     *    `status === 'processing'`). Whichever transaction — this one, or
     *    the worker's final write — gets the lock first wins; the loser's
     *    guard (`status !== 'processing'`) then correctly no-ops, so an
     *    in-flight worker can never publish a `ready` result after this
     *    method has run, and this method can never stomp a write that
     *    already landed. No separate flag check needed in
     *    WhisperTranscriber — the status transition IS the guard.
     *  - `ready` -> persist false only; keep serving the ready VTT/
     *    transcript; manual owner edits (CaptionService::update, which
     *    never consults this flag) remain allowed.
     */
    public function disable(Speech $speech): void
    {
        DB::transaction(function () use ($speech) {
            $locked = $this->lockSpeech($speech);
            $asset = $this->lockCaptionsAsset($locked);

            $locked->update(['captions_enabled' => false]);
            $speech->setAttribute('captions_enabled', false);

            if ($asset !== null && $asset->status === 'processing') {
                $asset->update([
                    'status' => 'failed',
                    'failure_code' => 'captions_disabled',
                    'failure_detail' => self::CAPTIONS_DISABLED_DETAIL,
                ]);

                // §4.1 "disable ... invalidates it": retires whatever
                // attempt token this row had. Belt-and-suspenders next to
                // the status flip above — GenerateCaptions/WhisperTranscriber
                // already compare-and-set on `status = 'processing'` AND the
                // token together, so the status write alone already stops a
                // stale attempt from publishing, but nulling the token here
                // means a LATER re-enable's freshly rotated id can never
                // collide with whatever this attempt happened to hold.
                CaptionAttemptTracker::invalidate($asset);
            }
        });
    }

    /**
     * SpeechUploadController::complete's captions creation, centralized
     * here. Called from inside that controller's OWN `DB::transaction`
     * (the source asset is marked `ready` moments before, in the same
     * transaction) — deliberately does NOT open a second nested
     * transaction/lock of its own, since a fresh upload's speech row is
     * already effectively exclusive to that request. `GenerateCaptions`
     * sets `$this->afterCommit = true` in its own constructor, so
     * dispatching here still waits for the OUTER transaction to commit,
     * matching the original inline behavior exactly.
     */
    public function ensureForUpload(Speech $speech): ?SpeechAsset
    {
        if (! $speech->captions_enabled) {
            return null;
        }

        $asset = SpeechAsset::query()
            ->where('speech_id', $speech->id)
            ->where('kind', 'captions')
            ->lockForUpdate()
            ->first();

        if ($asset !== null && in_array($asset->status, ['processing', 'ready'], true)) {
            return $asset; // idempotent — a fresh upload should never hit this, but never duplicate
        }

        return $this->startProcessing($speech, $asset);
    }

    /**
     * SpeechUploadController::retry's `kind === 'captions'` branch.
     *
     * Table row: "Any disabled state | Retry automatic generation | 409
     * `captions_disabled`; retry must never silently enable automation."
     * The caller (SpeechUploadController::retry) already enforced the
     * asset itself is `failed` before calling this; the ONLY new check here
     * is the speech-level flag.
     *
     * @throws CaptionsDisabledException when captions are currently off.
     */
    public function retryAutomatic(Speech $speech, SpeechAsset $asset): SpeechAsset
    {
        return DB::transaction(function () use ($speech, $asset) {
            $locked = $this->lockSpeech($speech);

            if (! $locked->captions_enabled) {
                throw new CaptionsDisabledException;
            }

            /** @var SpeechAsset $fresh */
            $fresh = SpeechAsset::query()->whereKey($asset->id)->lockForUpdate()->first();

            $fresh->update(['status' => 'processing', 'failure_code' => null, 'failure_detail' => null]);

            $attemptId = CaptionAttemptTracker::rotate($fresh);

            GenerateCaptions::dispatch($fresh->id, $attemptId);

            return $fresh;
        });
    }

    private function lockSpeech(Speech $speech): Speech
    {
        /** @var Speech $locked */
        $locked = Speech::query()->whereKey($speech->id)->lockForUpdate()->first();

        return $locked;
    }

    private function lockCaptionsAsset(Speech $speech): ?SpeechAsset
    {
        return SpeechAsset::query()
            ->where('speech_id', $speech->id)
            ->where('kind', 'captions')
            ->lockForUpdate()
            ->first();
    }

    /**
     * Shared by `enable()` and `ensureForUpload()`: create-or-reuse the one
     * captions row as `processing` and dispatch exactly one
     * `GenerateCaptions` job. Callers hold the necessary locks already.
     */
    private function startProcessing(Speech $speech, ?SpeechAsset $asset): SpeechAsset
    {
        if ($asset === null) {
            $asset = $speech->assets()->create([
                'kind' => 'captions',
                'format' => 'vtt',
                'disk' => 'media',
                'path' => "speeches/{$speech->ulid}/{$speech->ulid}/captions.vtt",
                'status' => 'processing',
            ]);
        } else {
            $asset->update(['status' => 'processing', 'failure_code' => null, 'failure_detail' => null]);
        }

        $attemptId = CaptionAttemptTracker::rotate($asset);

        GenerateCaptions::dispatch($asset->id, $attemptId);

        return $asset;
    }
}
