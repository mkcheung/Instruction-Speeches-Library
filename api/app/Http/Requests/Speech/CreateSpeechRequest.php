<?php

namespace App\Http\Requests\Speech;

use Illuminate\Foundation\Http\FormRequest;

/**
 * §6.11: `change_note` is required whenever `supersedes_id` is present —
 * the whole point of the "linked to a previous attempt" feature is the
 * speaker saying what they changed; an empty note defeats it.
 * Same-owner/cycle enforcement is NOT here (can't be — `authorize()` has no
 * access to the target row's owner without a query, and the cycle defense
 * is a DB CHECK) — see App\Services\SpeechService::create.
 */
class CreateSpeechRequest extends FormRequest
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
            'title' => ['required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'delivered_on' => ['sometimes', 'nullable', 'date'],
            'supersedes_id' => ['sometimes', 'nullable', 'integer', 'exists:speeches,id'],
            'change_note' => ['required_with:supersedes_id', 'nullable', 'string', 'max:1000'],
        ];
    }
}
