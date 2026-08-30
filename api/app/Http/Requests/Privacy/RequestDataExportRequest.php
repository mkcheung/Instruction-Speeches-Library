<?php

namespace App\Http\Requests\Privacy;

use App\Models\DataExport;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** `POST /api/privacy/exports` — STEP-11-FROZEN-CONTRACT.md §7. */
class RequestDataExportRequest extends FormRequest
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
            'kind' => ['required', Rule::in(DataExport::KINDS)],
        ];
    }
}
