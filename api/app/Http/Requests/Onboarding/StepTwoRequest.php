<?php

namespace App\Http\Requests\Onboarding;

use Illuminate\Foundation\Http\FormRequest;

class StepTwoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * All three fields are individually skippable (§6.5) — `sometimes` +
     * `nullable` rather than `required`.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'bio' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'pronouns' => ['sometimes', 'nullable', 'string', 'max:32'],
            'location' => ['sometimes', 'nullable', 'string', 'max:80'],
        ];
    }
}
