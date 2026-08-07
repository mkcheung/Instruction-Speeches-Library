<?php

namespace App\Http\Requests;

use App\Rules\UsernameIsAvailable;
use Illuminate\Foundation\Http\FormRequest;

class UpdateUsernameRequest extends FormRequest
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
            'username' => ['required', 'string', new UsernameIsAvailable($this->user()->id)],
        ];
    }
}
