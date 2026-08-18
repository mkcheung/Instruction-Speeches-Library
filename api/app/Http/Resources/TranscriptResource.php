<?php

namespace App\Http\Resources;

use App\Models\SpeechTranscript;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The frozen STEP-09 backend contract §4:
 * `{ transcript: { body, segments, word_count, words_per_minute, language, model, source } }`.
 *
 * @mixin SpeechTranscript
 */
class TranscriptResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'body' => $this->body,
            'segments' => $this->segments,
            'word_count' => $this->word_count,
            'words_per_minute' => $this->words_per_minute,
            'language' => $this->language,
            'model' => $this->model,
            'source' => $this->source,
            'updated_at' => $this->updated_at,
            // STEP-09-VERIFICATION-PLAN.md §4.1 "Projection convergence
            // token": read-only, server-computed, `null` when unavailable
            // — the PUT UI's bounded condition-poll waits for this to
            // equal the caption revision the save response returned,
            // never a client-supplied precondition or optimistic lock.
            'caption_revision' => $this->caption_revision,
        ];
    }
}
