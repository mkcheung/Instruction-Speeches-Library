<?php

namespace App\Http\Requests\Annotation;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `GET /speeches/{speech}/annotations?review_id=`. Per the frozen STEP-06
 * contract: `review_id` is a required query param, validated here rather
 * than silently defaulted — a missing/non-integer value is a 422, never a
 * quiet "no track selected" fallback (§8.5's "rejects rather than silently
 * falling back to 'no commentary'").
 */
class ListAnnotationsRequest extends FormRequest
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
            'review_id' => ['required', 'integer'],
        ];
    }
}
