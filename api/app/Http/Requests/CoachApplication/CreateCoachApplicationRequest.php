<?php

namespace App\Http\Requests\CoachApplication;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `POST /api/coach-applications` — STEP-12-FROZEN-CONTRACT.md §9. Always
 * self-scoped to `$request->user()`, no ownership ambiguity (same shape
 * as `AccountController::destroy`/`PrivacyExportController` — no Policy
 * needed).
 */
class CreateCoachApplicationRequest extends FormRequest
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
            'statement' => ['required', 'string', 'max:2000'],
        ];
    }
}
