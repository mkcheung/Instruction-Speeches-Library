<?php

namespace App\Http\Requests\Onboarding;

use App\Rules\UsernameIsAvailable;
use Illuminate\Foundation\Http\FormRequest;

class StepOneRequest extends FormRequest
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
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'username' => ['required', 'string', new UsernameIsAvailable($this->user()->id)],
        ];
    }
}
