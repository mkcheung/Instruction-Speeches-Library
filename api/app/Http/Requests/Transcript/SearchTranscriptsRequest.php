<?php

namespace App\Http\Requests\Transcript;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `GET /speeches/search?q=...` — the frozen STEP-09 backend contract §4.
 * No authorize() gate beyond `auth:sanctum` (already applied at the route
 * group level): search is scoped to the caller's OWN speeches inside
 * TranscriptController::search itself, never a client-suppliable scope.
 */
class SearchTranscriptsRequest extends FormRequest
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
            'q' => ['required', 'string', 'min:1', 'max:255'],
        ];
    }
}
