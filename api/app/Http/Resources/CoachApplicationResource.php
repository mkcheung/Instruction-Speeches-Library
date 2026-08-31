<?php

namespace App\Http\Resources;

use App\Models\CoachApplication;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `{ coachApplication: ... }` singular envelope — STEP-12-FROZEN-
 * CONTRACT.md §9. The envelope KEY is camelCase (`coachApplication`,
 * matching `essayApi`/`speechApi`'s convention), but per the contract's own
 * "snake_case on the wire only inside nested DB-shaped fields" clause, the
 * fields INSIDE this resource stay snake_case/DB-shaped — exactly the
 * convention `EssayResource` already establishes (`essay_html`,
 * `essay_published_at`, etc. — not camelCased). Field names here are
 * pinned exactly against the already-built frontend slice
 * (`web/src/features/coachApplication/coachApplicationApi.ts`'s
 * `CoachApplication` type / test fixtures), not re-guessed.
 *
 * @mixin CoachApplication
 */
class CoachApplicationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'statement' => $this->statement,
            'submitted_at' => $this->submitted_at,
            'decided_at' => $this->decided_at,
            'decision_reason' => $this->decision_reason,
            // Always present (never `whenLoaded`-conditional) — the
            // frontend's `CoachApplication` type requires `documents` as
            // an array unconditionally, including the empty-array case
            // for a fresh draft with none yet.
            'documents' => ApplicationDocumentResource::collection($this->documents),
        ];
    }
}
