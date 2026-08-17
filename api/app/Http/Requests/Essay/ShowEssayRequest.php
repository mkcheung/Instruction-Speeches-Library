<?php

namespace App\Http\Requests\Essay;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `GET /speeches/{speech}/essay?review_id=`. Same shape as
 * `ListAnnotationsRequest`: `review_id` is a required query param,
 * validated here rather than silently defaulted.
 */
class ShowEssayRequest extends FormRequest
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
