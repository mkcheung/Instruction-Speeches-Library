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
    /**
     * Unchanged signature (STEP-03). §9.5: on a successful transcode
     * (remux OR full re-encode), implementations automatically run the
     * poster pipeline afterwards with an automatic (not speaker-chosen)
     * seek time, AND generate the one-time sprite strip — both derived
     * from the just-written rendition, never the source upload.
     */
    public function transcode(SpeechAsset $videoAsset): void;

    /**
     * §9.5's "let the speaker choose a frame" / sprite-picker affordance.
     * Regenerates JUST the poster set (never the sprite — that's a
     * transcode-time-only pass, since it doesn't depend on a chosen frame)
     * for an ALREADY-`ready` video asset.
     *
     * `$explicitTimeSeconds === null` means "use the automatic
     * `clamp(0.10 * duration, 2, 30)` seek", same as transcode()'s
     * post-transcode call. A non-null value is a speaker/coach-chosen
     * frame — clamped only to `[0, duration]`, deliberately without the
     * `[2, 30]` automatic-seek clamp, since the user explicitly picked it.
     *
     * Callers (a job/controller owned elsewhere) are responsible for
     * guarding that `$videoAsset->status === 'ready'` before calling this;
     * implementations do not throw on a bad state, matching the
     * never-throw contract above.
     */
    public function generatePoster(SpeechAsset $videoAsset, ?float $explicitTimeSeconds): void;
}
