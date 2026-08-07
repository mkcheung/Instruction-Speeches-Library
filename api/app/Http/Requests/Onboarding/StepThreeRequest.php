<?php

namespace App\Http\Requests\Onboarding;

use Illuminate\Foundation\Http\FormRequest;

class StepThreeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Avatar is skippable (§6.5) — this step's submission (with or without
     * a file) is what marks onboarding complete, since it's the last step.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'avatar' => ['sometimes', 'nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ];
    }
}
