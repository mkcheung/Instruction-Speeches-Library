<?php

namespace App\Http\Requests;

use App\Support\ProfileRules;
use Illuminate\Foundation\Http\FormRequest;

class UpdateAvatarRequest extends FormRequest
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
            'avatar' => ['required', ...ProfileRules::AVATAR],
        ];
    }
}
