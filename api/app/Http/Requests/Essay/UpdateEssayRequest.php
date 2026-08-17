<?php

namespace App\Http\Requests\Essay;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `PUT /speeches/{speech}/essay`. `lock_version` is required on every
 * call — the version the client last saw, compared by `EssayService::
 * update()` against the row's current `essay_lock_version` under
 * `lockForUpdate()`. `html` has no max-length rule: the frozen contract's
 * "a 30,000-word essay round-trips without truncation" acceptance item
 * means this must not cap input length before it ever reaches the
 * sanitizer/derivation path (the `mediumText` column is good for 16MB).
 */
class UpdateEssayRequest extends FormRequest
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
            'html' => ['required', 'string'],
            'lock_version' => ['required', 'integer', 'min:0'],
        ];
    }
}
