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
 */
interface CaptionTranscriberContract
{
    public function transcribe(SpeechAsset $sourceAsset, SpeechAsset $captionsAsset): void;
}
