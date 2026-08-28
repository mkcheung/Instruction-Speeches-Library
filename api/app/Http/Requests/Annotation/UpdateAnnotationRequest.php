<?php

namespace App\Http\Requests\Annotation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `PATCH /speeches/{speech}/annotations/{annotation}`. `lock_version` is
 * required on every call — it's the version the client last saw, and
 * `AnnotationService::update` compares it against the row's current value
 * under `lockForUpdate()` (§10.2). Everything else is `sometimes`: a
 * retime-only PATCH need not resend the body, and vice versa.
 */
class UpdateAnnotationRequest extends FormRequest
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
            'lock_version' => ['required', 'integer', 'min:0'],
            'body' => ['sometimes', 'string'],
            // See CreateAnnotationRequest: the column is NUMERIC(10,3) and
            // `ck_annotations_timing` bounds start_seconds only from below,
            // so an out-of-domain value was a Postgres-only 500.
            'start_seconds' => ['sometimes', 'numeric', 'min:0', 'max:9999999.999'],
            'duration_seconds' => ['sometimes', 'numeric', 'gt:0', 'max:120'],
            'kind' => ['sometimes', Rule::in(['praise', 'correction', 'observation'])],
            'topic' => ['sometimes', 'nullable', 'string', 'max:32'],
        ];
    }
}
