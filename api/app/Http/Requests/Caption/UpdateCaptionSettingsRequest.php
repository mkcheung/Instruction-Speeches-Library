<?php

namespace App\Http\Requests\Caption;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `PATCH /speeches/{speech}/caption-settings` — the missing surface for
 * toggling `speeches.captions_enabled` (STEP-09 shipped the column and the
 * defensive reads of it, but no write path). `authorize()` stays `true`,
 * same convention as `UpdateCaptionsRequest`/`UpdateEssayRequest` — the
 * real authorization call is `SpeechPolicy::updateCaptions` (`caption.
 * update`), made explicitly in the controller against the resolved
 * `Speech`, reusing the exact same ownership-only gate `PUT /captions`
 * already uses rather than a new policy method.
 */
class UpdateCaptionSettingsRequest extends FormRequest
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
            'captions_enabled' => ['required', 'boolean'],
        ];
    }
}
