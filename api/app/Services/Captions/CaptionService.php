<?php

namespace App\Services\Captions;

use App\Jobs\RederiveTranscript;
use App\Models\Speech;
use App\Models\SpeechAsset;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * `PUT /speeches/{speech}/captions` (the frozen STEP-09 backend contract
 * §4). STEP-09-captions.md is explicit that "the VTT stays canonical; the
 * table is derived... never write back the other way" — this class is the
 * ONE place a speaker's edit is written to the canonical VTT file; nothing
 * else in the caption-write path touches `speech_assets`/storage for a
 * `kind=captions` row.
 *
 * The already-parsed cue list never needs re-validating here —
 * App\Http\Requests\Caption\UpdateCaptionsRequest already ran the payload
 * through Vtt::parse() and would have 422'd a malformed one before this
 * class is ever reached.
 */
class CaptionService
{
    /**
     * Creates the `captions` asset row if none exists yet (a speaker can
     * edit even when nothing was ever generated — e.g. captions were off
     * at upload time, or whisper failed and they're writing captions by
     * hand) — otherwise overwrites the existing row's VTT in place,
     * deterministic path unchanged (§9.2's "never a timestamp suffix"
     * rule, reused: a retried/re-edited write must never leave two VTT
     * files for one speech).
     *
     * `status` goes straight to `ready` (a speaker-submitted edit is not
     * an async pipeline the way whisper is) and any prior `failed` state
     * is cleared — an edit is itself the resolution of a stuck/failed
     * caption generation, matching the "failed captions are visible and
     * retryable" acceptance item ("edit it by hand" is a valid retry path,
     * not just re-running whisper).
     */
    public function update(Speech $speech, string $vtt): SpeechAsset
    {
        return DB::transaction(function () use ($speech, $vtt) {
            /** @var SpeechAsset $captionsAsset */
            $captionsAsset = SpeechAsset::query()
                ->where('speech_id', $speech->id)
                ->where('kind', 'captions')
                ->lockForUpdate()
                ->first() ?? $speech->assets()->create([
                    'kind' => 'captions',
                    'format' => 'vtt',
                    'disk' => 'media',
                    'path' => "speeches/{$speech->ulid}/{$speech->ulid}/captions.vtt",
                    'status' => 'processing',
                ]);

            // STEP-09-VERIFICATION-PLAN.md §4.1: "checks the storage
            // write" — Storage::put()'s boolean return is the only signal
            // a disk driver gives that the write actually landed; an
            // unchecked call here would let this method go on to compute
            // and persist a `content_revision` (and dispatch a re-derive
            // job) for bytes that were never actually written.
            if (! Storage::disk($captionsAsset->disk)->put($captionsAsset->path, $vtt)) {
                throw new RuntimeException("Failed writing VTT to disk for caption asset {$captionsAsset->id}.");
            }

            $revision = CaptionRevision::compute($vtt);

            $captionsAsset->update([
                'status' => 'ready',
                'failure_code' => null,
                'failure_detail' => null,
                'byte_size' => Storage::disk($captionsAsset->disk)->size($captionsAsset->path),
                'content_revision' => $revision,
            ]);

            // STEP-09-VERIFICATION-PLAN.md §4.1: "disable/manual edit
            // invalidates it" — a manual edit is itself the resolution of
            // whatever automatic attempt (if any) was in flight for this
            // row. Retiring the token here means a still-running whisper
            // attempt's own compare-and-set writes (WhisperTranscriber's
            // guarded success/fail paths) can never land after this edit,
            // even in the narrow window before its `status` write above is
            // what a slower reader would otherwise rely on alone.
            CaptionAttemptTracker::invalidate($captionsAsset);

            // STEP-09.md's own wording: "dispatches the re-derive job" —
            // kept asynchronous (rather than deriving inline here) so this
            // endpoint's response time doesn't grow with transcript size,
            // and so the exact same RederiveTranscript job path is
            // exercised whether the edit came from the caption editor or
            // (in principle) any other future write surface. See this
            // class's own report note: STEP-09.md also calls a synchronous
            // re-derive "not necessarily" wrong for a small VTT file — the
            // job was chosen because the frozen contract quotes the
            // "dispatches... job" phrasing directly and a queued job keeps
            // the two derivation call sites (whisper output, edited VTT)
            // structurally identical (both go through a job that reads a
            // captions asset's stored VTT and calls TranscriptDeriver).
            RederiveTranscript::dispatch($captionsAsset->id, $revision);

            return $captionsAsset;
        });
    }
}
