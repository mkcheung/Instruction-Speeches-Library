<?php

namespace App\Http\Resources;

use App\Models\Review;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * §7.2.3/§7.2.5 — the speech owner's full reviewer roster (every status,
 * including revoked), served only by `GET /speeches/{speech}/review-roster`
 * via `ReviewController::roster`. Deliberately NOT shared with
 * `ReviewResource`: that resource is also used by the reviewer's own
 * dashboard, where `annotations_count`/`published_annotations_count` have
 * no consumer, and `revoked_by_is_self` is meaningless outside the owner's
 * own view.
 *
 * `speech` is omitted entirely (unlike `ReviewResource`) — this resource is
 * already scoped to one speech via the route, so it would be redundant.
 *
 * @mixin Review
 */
class ReviewRosterResource extends JsonResource
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
            'annotations_count' => $this->annotations_count,
            'published_annotations_count' => $this->published_annotations_count,
            // The speaker does not need an admin's user id — only whether
            // they themselves were the one who revoked access. `false`
            // whenever `revoked_at` is null, not just when someone else
            // revoked it.
            'revoked_by_is_self' => $this->revoked_at !== null && $this->revoked_by_id === $request->user()?->id,
            // Copied verbatim from ReviewResource's erased-reviewer block
            // (STEP-11-FROZEN-CONTRACT.md §9): a null `reviewer_id` means
            // the reviewer's account was erased (App\Services\Privacy\
            // AccountErasureService step 5 nulls it, never the row
            // itself). The label is a literal string, never derived from a
            // stored snapshot — snapshotting the name at publish time
            // would defeat the erasure it is meant to survive.
            // `anonymized_at !== null` is defense-in-depth against the
            // narrow race window step 5's null-authorship UPDATE closes in
            // the ordinary path.
            //
            // code-review finding: this resource's one current caller
            // (`ReviewController::roster`) always eager-loads `reviewer`,
            // but omitting ReviewResource's `when(relationLoaded(...))`
            // guard entirely meant any FUTURE caller that constructs this
            // resource over rows without that eager-load would hit
            // `AppServiceProvider`'s `preventLazyLoading` — loud in dev/
            // test, a silent N+1 in production, where ReviewResource would
            // have just omitted the field. `when()`, not `whenLoaded()`:
            // the latter short-circuits to null on ITS OWN whenever the
            // loaded relation's value is null, which is exactly the
            // "Former reviewer" case this field exists to render.
            'reviewer' => $this->when($this->relationLoaded('reviewer'), fn () => ReviewerIdentityFields::fromUser($this->reviewer)),
        ];
    }
}
