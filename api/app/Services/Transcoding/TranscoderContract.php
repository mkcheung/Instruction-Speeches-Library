<?php

namespace App\Services\Transcoding;

use App\Models\SpeechAsset;

/**
 * §9.4 rule 2: "No application code ever calls FFmpeg — everything through
 * TranscoderContract." §9.2's idempotency guarantees start with "never
 * create the asset row inside the job — the request creates it, the job
 * only updates": `$videoAsset` is the already-`processing` `kind=video`
 * row the upload-complete request created; implementations read the
 * sibling `kind=source` row (`$videoAsset->speech->assets`) and leave
 * `$videoAsset` `ready` or `failed` with a user-safe `failure_code` — never
 * throwing, since a thrown exception here is a job retry, not a visible
 * Failed state.
 */
interface TranscoderContract
{
    public function transcode(SpeechAsset $videoAsset): void;
}
