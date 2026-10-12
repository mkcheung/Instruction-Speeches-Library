<?php

namespace App\Http\Requests\Review;

use App\Models\Review;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class RevokeReviewRequest extends FormRequest
{
    /**
     * code-review finding: a FormRequest's `rules()` runs during request
     * resolution, BEFORE the controller body (and its `$this->authorize()`
     * call) ever executes. With `authorize()` hard-coded `true`, the
     * conditionally-required `reason` rule below let an authenticated
     * stranger — someone holding neither `review.revoke` nor
     * `review.purge` on this review — learn whether it was already
     * revoked purely from the 422-vs-200-reaches-controller split, before
     * any RBAC check ran. Gating here closes that: an unauthorized caller
     * now gets a uniform 403 regardless of the review's revocation state.
     * `review.revoke` and `review.purge` share one policy method body
     * (`ReviewPolicy::revoke`/`purge` are identical), and this one
     * FormRequest backs both routes, so checking either ability is
     * equivalent to checking the one that actually applies.
     */
    public function authorize(): bool
    {
        /** @var Review|null $review */
        $review = $this->route('review');

        return $review !== null && (Gate::allows('review.revoke', $review) || Gate::allows('review.purge', $review));
    }

    /**
     * §7.2.5: a first revoke must carry a reason (house rule 4); a retry
     * on an already-revoked review must not be rejected for omitting one
     * — `ReviewService::revoke`'s idempotent early-exit guard deliberately
     * does not re-stamp the tombstone, so a 422 here on retry would be the
     * request layer contradicting the service layer. `$this->route('review')`
     * resolves the route-model-bound `Review` the same way
     * `ReviewController::revoke` receives it.
     *
     * code-review finding: `revoke-and-purge` is NOT idempotent — unlike
     * `revoke`, it has no early-exit guard, so a review that was revoked
     * earlier (with its own stored reason) can still be purged fresh
     * later. Keying "reason optional" off `revoked_at !== null` conflated
     * "this is a retry" (true for `revoke`) with "this review happens to
     * be revoked already" (not the same thing for `revoke-and-purge`),
     * which would let a purge of a previously-revoked review skip the
     * mandatory reason entirely. Purge's own route (named
     * `api.reviews.revoke-and-purge`) always requires a reason; only
     * plain `revoke` gets the idempotent-retry exemption.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        /** @var Review|null $review */
        $review = $this->route('review');
        $isPurge = $this->route()?->getName() === 'api.reviews.revoke-and-purge';

        return [
            'reason' => [
                Rule::requiredIf(fn () => $isPurge || $review?->revoked_at === null),
                'nullable', 'string', 'max:1000',
            ],
        ];
    }
}
