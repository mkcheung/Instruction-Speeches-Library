<?php

namespace App\Services\Captions;

use App\Models\SpeechAsset;

/**
 * Mirrors App\Services\Transcoding\TranscoderContract exactly (STEP-09-
 * captions.md / the frozen backend contract §6): a single seam application
 * code calls through, never a direct shell-out. `$captionsAsset` is the
 * already-`processing` `kind=captions` row SpeechUploadController::complete
 * creates before dispatching App\Jobs\GenerateCaptions (TranscoderContract's
 * own rule, reused here: "never create the asset row inside the job — the
 * request creates it, the job only updates") — implementations write the
 * VTT to
 * `$captionsAsset->disk`/`$captionsAsset->path`, then leave the row
 * `ready` or `failed` with a user-safe `failure_code`, exactly like
 * TranscoderContract's implementations do for a video asset. Never
 * throws — a thrown exception here is a job retry, not a visible Failed
 * state.
 *
 * Also responsible for upserting the one App\Models\SpeechTranscript row
 * for the speech (source = 'whisper') on success, via
 * App\Services\Captions\TranscriptDeriver — the same derivation the
 * caption-edit re-derive path (source = 'edited') uses, so a fresh
 * whisper run and a speaker edit can never disagree about how body/
 * segments/word_count/words_per_minute are computed from a cue list.
 *
 * `$attemptId` (STEP-09-VERIFICATION-PLAN.md §4.1) is App\Jobs\
 * GenerateCaptions's own current `caption_attempt_id`. Implementations use
 * it for two things: heartbeating via CaptionAttemptTracker::heartbeat()
 * at internal stage boundaries (the recovery reconciler's "started row"
 * clock), and — critically — including it in the SAME `WHERE status =
 * 'processing' AND caption_attempt_id = ?` compare-and-set every terminal
 * write (ready or failed) already used to guard against a concurrent
 * manual edit. Without the attempt-id half of that predicate, an old,
 * still-running attempt A could publish over a NEWER attempt B (started by
 * a disable -> re-enable cycle) purely because both attempts, at the
 * moment A finally writes, happen to see `status = 'processing'`.
 */
interface CaptionTranscriberContract
{
    public function transcribe(SpeechAsset $sourceAsset, SpeechAsset $captionsAsset, string $attemptId): void;
}
