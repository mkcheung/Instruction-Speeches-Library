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
            // The upper bound mirrors the column's own domain, the way
            // duration_seconds' `max:120` mirrors `ck_annotations_timing`.
            // `ck_annotations_timing` bounds start_seconds only from below,
            // so without this a value past NUMERIC(10,3) passed validation
            // AND the CHECK, then raised `22003 numeric field overflow` on
            // the Postgres INSERT — a 500 instead of a 422. Invisible to the
            // suite, which runs on SQLite: its NUMERIC affinity accepts it.
            'start_seconds' => ['required', 'numeric', 'min:0', 'max:9999999.999'],
            'duration_seconds' => ['sometimes', 'numeric', 'gt:0', 'max:120'],
            'kind' => ['sometimes', Rule::in(['praise', 'correction', 'observation'])],
            'topic' => ['sometimes', 'nullable', 'string', 'max:32'],
        ];
    }
}
