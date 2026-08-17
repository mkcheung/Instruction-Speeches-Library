<?php

namespace App\Http\Resources;

use App\Models\Review;
use App\Services\EssayHtmlSanitizer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The frozen STEP-08 backend contract: bare resource, no envelope wrapper —
 * matches `AnnotationResource`'s convention (STEP-07's frontend agent had
 * to self-correct a guessed envelope once; don't repeat that here).
 *
 * `essay_html` is re-sanitized here, on every read, via `EssayHtmlSanitizer`
 * — the "read" half of R14's defense in depth. This resource is the ONLY
 * place `$review->essay_html` is allowed to reach a JSON response; nothing
 * else in the essay read path may return the raw column value.
 *
 * @mixin Review
 */
class EssayResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'essay_html' => app(EssayHtmlSanitizer::class)->sanitize($this->essay_html),
            'essay_text' => $this->essay_text,
            'essay_published_at' => $this->essay_published_at,
            'essay_updated_at' => $this->essay_updated_at,
            'essay_words' => (int) $this->essay_words,
            'essay_lock_version' => (int) $this->essay_lock_version,
        ];
    }
}
