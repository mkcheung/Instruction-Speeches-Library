<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\InvalidVttException;
use App\Services\Captions\TranscriptDeriver;
use App\Services\Captions\Vtt;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-captions.md's own wording for `PUT /speeches/{speech}/captions`:
 * "a speaker-editable VTT endpoint... which dispatches the re-derive job."
 * App\Services\Captions\CaptionService persists the speaker's edited VTT
 * as the new canonical file FIRST (still inside its own DB transaction,
 * `afterCommit` below is why this job isn't picked up before that
 * commits), then dispatches this job to re-read that same file back off
 * storage and turn it into the `speech_transcripts` row, `source =
 * 'edited'`.
 *
 * Deliberately reads the VTT back from storage rather than being handed
 * the string directly: this is the SAME "the file is canonical, the row
 * is derived FROM the file" shape App\Jobs\GenerateCaptions uses for a
 * fresh whisper run, so there is exactly one code path
 * (Vtt::parse + TranscriptDeriver::derive) that ever produces a
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

    public function __construct(public int $captionsAssetId)
    {
        $this->afterCommit = true;
        $this->connection = 'redis-long';

        // Shares the `captions` queue/worker with GenerateCaptions rather
        // than adding a third queue name: a re-derive is a small, fast
        // parse-and-write, so it doesn't compete for the same resource
        // (whisper.cpp's CPU-bound transcription) the way a second
        // whisper job would — see this task's final report for the
        // explicit call-out that this queue choice was a judgment call,
        // not something the frozen contract states outright.
        $this->queue = 'captions';
    }

    /**
     * @return array<int, WithoutOverlapping>
     */
    public function middleware(): array
    {
        return [
            (new WithoutOverlapping('rederive-'.$this->captionsAssetId))
                ->expireAfter(120)
                ->releaseAfter(0),
        ];
    }

    public function handle(TranscriptDeriver $deriver): void
    {
        $captionsAsset = SpeechAsset::query()->find($this->captionsAssetId);

        if ($captionsAsset === null || $captionsAsset->status !== 'ready') {
            return;
        }

        $vtt = Storage::disk($captionsAsset->disk)->get($captionsAsset->path);

        if ($vtt === null) {
            Log::warning('RederiveTranscript: captions asset has no VTT content in storage.', [
                'caption_asset_id' => $captionsAsset->id,
            ]);

            return;
        }

        try {
            $cues = Vtt::parse($vtt);
        } catch (InvalidVttException $e) {
            // Cannot happen through the normal write path (
            // UpdateCaptionsRequest already validated this exact string
            // before CaptionService persisted it) — guarded anyway rather
            // than letting a job exception surface as a queue failure for
            // what would be a data problem, not a retryable one.
            Log::warning('RederiveTranscript: stored VTT failed to re-parse.', [
                'caption_asset_id' => $captionsAsset->id,
                'exception' => $e->getMessage(),
            ]);

            return;
        }

        $derived = $deriver->derive($cues);

        // The model/language a transcript was ORIGINALLY produced by are
        // preserved across an edit (§ acceptance: "a filler count is only
        // comparable against another from the same model" — a manual edit
        // doesn't change which model transcribed the speech). Only a row
        // that never existed before (edited before any whisper run ever
        // completed) falls back to the configured defaults.
        $existing = SpeechTranscript::query()->where('speech_id', $captionsAsset->speech_id)->first();

        $attributes = [
            ...$derived,
            // Explicit null check, not `?->`: `$existing` is legitimately
            // null the first time a speaker hand-edits captions before any
            // whisper run has ever completed for this speech (CaptionService's
            // own documented case) — a plain `$existing->language` would
            // fatal on every such first edit. (`$existing?->language ?? ...`
            // is equivalent at runtime but trips a PHPStan false-positive —
            // `language`/`model` are non-nullable `@property string`, so it
            // can't see that the nullsafe is guarding against $existing
            // itself being null, not the property.)
            'language' => $existing !== null ? $existing->language : (string) config('captions.language'),
            'model' => $existing !== null ? $existing->model : (string) config('captions.model_name'),
            'source' => 'edited',
        ];

        // $existing was already fetched above — reuse it instead of
        // updateOrCreate(), which would re-run the identical lookup as a
        // second SELECT before writing.
        if ($existing !== null) {
            $existing->update($attributes);
        } else {
            SpeechTranscript::query()->create([...$attributes, 'speech_id' => $captionsAsset->speech_id]);
        }
    }
}
