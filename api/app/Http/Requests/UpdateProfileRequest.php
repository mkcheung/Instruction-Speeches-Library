<?php

namespace App\Http\Requests;

use App\Support\ProfileRules;
use Illuminate\Foundation\Http\FormRequest;

class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Every field can be sent alone (the profile page saves one field at a
     * time), but a display name that is sent can't be blank: TrimStrings and
     * ConvertEmptyStringsToNull turn "  " into null, which `required` rejects.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'display_name' => ['sometimes', 'required', 'string', 'max:60'],
        ] + ProfileRules::text() + [
            'timezone' => ['sometimes', 'string', 'max:64'],
            'locale' => ['sometimes', 'string', 'max:10'],
        ];
    }
}
