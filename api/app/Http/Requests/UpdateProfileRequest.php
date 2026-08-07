<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateProfileRequest extends FormRequest
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
            'display_name' => ['sometimes', 'nullable', 'string', 'max:60'],
            'bio' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'pronouns' => ['sometimes', 'nullable', 'string', 'max:32'],
            'location' => ['sometimes', 'nullable', 'string', 'max:80'],
            'timezone' => ['sometimes', 'string', 'max:64'],
            'locale' => ['sometimes', 'string', 'max:10'],
        ];
    }
}
