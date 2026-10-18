<?php

namespace App\Http\Requests\Speech;

use Illuminate\Foundation\Http\FormRequest;

/**
 * IMPLEMENTATION-PLANS.md §7.5.6: `PATCH /speeches/{speech}`. Modeled on
 * CreateSpeechRequest in this same directory — `authorize(): true` (the
 * real authorization is the `speech.update` Gate check in
 * SpeechController::update, not this request), rules as a plain array.
 *
 * Four fields only, all `sometimes` (a PATCH, not a PUT — an omitted field
 * is left untouched, not nulled).
 *
 * ⚠️ Two deliberate exclusions, each with its own reason:
 *
 *  - `captions_enabled`: has its own route and real side effects via
 *    Captions\EnsureCaptionJob (`PATCH /speeches/{speech}/caption-settings`
 *    already exists). Accepting it here would duplicate or shadow that
 *    write path.
 *  - `supersedes_id`: it IS fillable on the Speech model, but
 *    SpeechService::assertLinkableSupersedes only runs on *create*.
 *    Accepting it on this path would let a slot collision (see
 *    SupersedeTest.php's `uq_speeches_successor` coverage) surface as an
 *    uncaught QueryException -> 500 instead of a clean 422, since nothing
 *    validates it here. Do NOT "just add it, it's already fillable" — that
 *    is exactly the gap this comment exists to flag.
 */
class UpdateSpeechRequest extends FormRequest
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
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'delivered_on' => ['sometimes', 'nullable', 'date'],
            'change_note' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ];
    }
}
