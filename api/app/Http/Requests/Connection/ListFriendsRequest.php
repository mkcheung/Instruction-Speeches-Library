<?php

namespace App\Http\Requests\Connection;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ListFriendsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'view' => ['sometimes', 'string', Rule::in(['accepted', 'incoming'])],
            'search' => ['sometimes', 'nullable', 'string', 'max:100', function (string $attribute, mixed $value, \Closure $fail): void {
                // Invalid UTF-8 would reach the LIKE query and make PostgreSQL throw (500) instead of failing validation.
                if (is_string($value) && ! mb_check_encoding($value, 'UTF-8')) {
                    $fail("The {$attribute} field must be valid UTF-8 text.");
                }
            }],
            'cursor' => ['sometimes', 'nullable', 'string', 'max:2048'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('search'))) {
            $this->merge(['search' => trim($this->input('search'))]);
        }
    }
}
