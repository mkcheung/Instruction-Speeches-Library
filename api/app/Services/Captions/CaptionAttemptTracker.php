<?php

namespace App\Services\Captions;

use App\Models\SpeechAsset;
use Illuminate\Support\Str;

/**
 * STEP-09-VERIFICATION-PLAN.md §4.1 "Generation-attempt identity and
 * recovery": `status` + `captions_enabled` alone cannot distinguish an old
 * worker attempt from a brand-new one after disable -> re-enable, or after
 * a manual edit replaces whatever whisper was doing. Every automatic
 * start/retry gets a fresh, unguessable `caption_attempt_id`; every write a
 * job makes back to its own row is a compare-and-set against that exact
 * token, never a bare `status = 'processing'` check.
 *
 * Kept as small static, purely-relational helpers (no state of its own) so
 * every caller — EnsureCaptionJob, GenerateCaptions, WhisperTranscriber,
 * CaptionService, and MediaReconcileCommand — performs the identical atomic
 * `UPDATE ... WHERE` shape rather than five subtly different ones.
 */
class CaptionAttemptTracker
{
    /**
     * Mints a brand-new attempt token and records it as "just queued" on
     * the given asset. Callers already hold the row lock — every call site
     * (EnsureCaptionJob::startProcessing/retryAutomatic) runs inside
     * `DB::transaction()` with `lockForUpdate()` already taken — so a plain
     * `->update()` here is correct; compare-and-set is only needed to
     * CONSUME a token later (claim/heartbeat/reconcile), not to mint one.
     */
    public static function rotate(SpeechAsset $asset): string
    {
        $attemptId = (string) Str::uuid();

        $asset->update([
            'caption_attempt_id' => $attemptId,
            'caption_queued_at' => now(),
            'caption_started_at' => null,
            'caption_heartbeat_at' => null,
        ]);

        return $attemptId;
    }

    /**
     * The owner-only disable path (EnsureCaptionJob::disable) and a
     * speaker's manual edit (CaptionService::update) both retire whatever
     * attempt token currently exists. An old worker still holding that
     * token in memory can no longer claim, heartbeat, or publish against
     * this row via any of the compare-and-set methods below, independent
     * of whatever status write the caller makes in the same request.
     * Callers already hold the row lock.
     */
    public static function invalidate(SpeechAsset $asset): void
    {
        $asset->update([
            'caption_attempt_id' => null,
            'caption_queued_at' => null,
            'caption_started_at' => null,
            'caption_heartbeat_at' => null,
        ]);
    }

    /**
     * GenerateCaptions::handle()'s first atomic step: only a still-
     * `processing` row whose token still matches gets to record
     * `started_at`/`heartbeat_at` and continue. An old attempt A —
     * superseded by a disable -> re-enable's fresh attempt B, or by a
     * manual edit — always finds zero rows here and exits as a no-op. This
     * is what makes B (or the edit) authoritative regardless of how long
     * A's process keeps running after being superseded.
     *
     * @return bool true if this attempt id just claimed the row.
     */
    public static function claim(int $assetId, string $attemptId): bool
    {
        return self::compareAndSet($assetId, $attemptId, [
            'caption_started_at' => now(),
            'caption_heartbeat_at' => now(),
        ]);
    }

    /**
     * Called at each stage boundary inside WhisperTranscriber (before
     * FFmpeg, before whisper-cli, before the storage write) so the recovery
     * reconciler's "started row, heartbeat >= 4200s old" clock reflects
     * real ongoing work, not only the instant the job first claimed the
     * row. A no-op (silently) once the row has moved on — the transcriber's
     * own guarded write already re-checks status/attempt before publishing
     * anything, so a stale heartbeat write here is harmless.
     */
    public static function heartbeat(int $assetId, string $attemptId): void
    {
        self::compareAndSet($assetId, $attemptId, [
            'caption_heartbeat_at' => now(),
        ]);
    }

    /**
     * The same compare-and-set shape the recovery reconciler uses to fail
     * a stale attempt (MediaReconcileCommand) — exposed here so the
     * reconciler and the job/adapter share one implementation of "only
     * transition a row if its attempt token still matches."
     *
     * @param  array<string, mixed>  $values
     * @return bool true if a row was updated.
     */
    public static function compareAndSet(int $assetId, string $attemptId, array $values): bool
    {
        return SpeechAsset::query()
            ->whereKey($assetId)
            ->where('status', 'processing')
            ->where('caption_attempt_id', $attemptId)
            ->update($values) > 0;
    }
}
