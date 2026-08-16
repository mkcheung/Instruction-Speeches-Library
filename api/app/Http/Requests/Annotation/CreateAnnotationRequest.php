<?php

namespace App\Http\Requests\Annotation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `POST /speeches/{speech}/annotations`. Deliberately has NO `review_id`
 * field of any kind — STEP-07's own text: the caller's own review is
 * always resolved server-side from `(speech, $request->user())`, "so no
 * reviewer can construct a URL targeting a peer" (mirrors
 * `InviteReviewerRequest`'s pattern of deferring ownership/policy checks
 * that need a route-model-bound resource to the controller).
 */
class CreateAnnotationRequest extends FormRequest
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
            'client_uuid' => ['required', 'uuid'],
            'body' => ['required', 'string'],
            'start_seconds' => ['required', 'numeric', 'min:0'],
            'duration_seconds' => ['sometimes', 'numeric', 'gt:0', 'max:120'],
            'kind' => ['sometimes', Rule::in(['praise', 'correction', 'observation'])],
            'topic' => ['sometimes', 'nullable', 'string', 'max:32'],
        ];
    }
}
