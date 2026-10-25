<?php

namespace App\Http\Requests\Review;

use Illuminate\Foundation\Http\FormRequest;

/**
 * §6.3/§6.11: the invite composer's payload. Speech-ownership, self-review
 * and admin-eligibility checks are NOT here — they need the target Speech
 * row and reviewer User row, which `authorize()` doesn't have cheaply
 * without a query. Ownership lives in SpeechPolicy::invite (route-model-
 * bound); self-review (assertNotSelfReview) and the "an administrator is
 * never a reviewer" rule live in App\Services\ReviewService::invite.
 */
class InviteReviewerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'reviewer_id' => ['required', 'integer', 'exists:users,id'],
            'message' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'allow_preview' => ['sometimes', 'boolean'],
            'prior_commentary_shared' => ['sometimes', 'boolean'],
        ];
    }
}
