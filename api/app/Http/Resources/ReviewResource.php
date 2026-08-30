<?php

namespace App\Http\Resources;

use App\Models\Review;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * §7.5's dashboard payload shape — used by both `GET /reviews` (the
 * reviewer's own dashboard) and `GET /speeches/{speech}/reviews` (the
 * speech owner's track selector). `speech`/`reviewer` are conditionally
 * included via whenLoaded so each caller only pays for what it eager-loads.
 *
 * @mixin Review
 */
class ReviewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'invitation_message' => $this->invitation_message,
            'allow_preview' => $this->allow_preview,
            'prior_commentary_shared' => $this->prior_commentary_shared,
            'invited_at' => $this->invited_at,
            'responded_at' => $this->responded_at,
            'first_published_at' => $this->first_published_at,
            'last_published_at' => $this->last_published_at,
            'last_transition_at' => $this->last_transition_at,
            'revoked_at' => $this->revoked_at,
            'revocation_reason' => $this->revocation_reason,
            'speech' => $this->whenLoaded('speech', fn () => [
                'id' => $this->speech->id,
                'ulid' => $this->speech->ulid,
                'title' => $this->speech->title,
                'owner_name' => $this->speech->relationLoaded('user')
                    ? trim("{$this->speech->user->first_name} {$this->speech->user->last_name}")
                    : null,
            ]),
            // STEP-11-FROZEN-CONTRACT.md §9: a null `reviewer_id` means the
            // reviewer's account was erased (App\Services\Privacy\
            // AccountErasureService step 5 nulls it, never the row itself).
            // The label is a literal string, never derived from a stored
            // snapshot — snapshotting the name at publish time would defeat
            // the erasure it is meant to survive. "Positionally
            // disambiguated" (two erased reviewers on one speech) comes for
            // free from this list's stable `ORDER BY reviews.id ASC`
            // ordering, not from numbering the label itself.
            //
            // Deliberately `when()`, not `whenLoaded()`: whenLoaded()'s own
            // implementation short-circuits to `null` (never calling the
            // value closure at all) whenever the loaded relation's value
            // IS null — exactly the "Former reviewer" case this resource
            // exists to handle. `when()` has no such special case.
            // `anonymized_at !== null` is defense-in-depth against the
            // narrow race window step 5's null-authorship UPDATE closes in
            // the ordinary path: if a `reviews` row for this reviewer is
            // ever created/updated between AccountErasureService's gate
            // stamp and that UPDATE, `reviewer_id` could still point at an
            // anonymized-but-not-null user row. Render it the same as a
            // genuinely null one rather than leaking blank/empty fields.
            'reviewer' => $this->when($this->relationLoaded('reviewer'), fn () => ($this->reviewer === null || $this->reviewer->anonymized_at !== null)
                ? ['display_name' => 'Former reviewer']
                : [
                    'id' => $this->reviewer->id,
                    'username' => $this->reviewer->username,
                    'name' => trim("{$this->reviewer->first_name} {$this->reviewer->last_name}"),
                ]),
        ];
    }
}
