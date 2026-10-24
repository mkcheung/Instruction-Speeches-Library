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
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
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
