<?php

namespace App\Http\Requests\Report;

use App\Models\Report;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `POST /api/reports` — STEP-11-FROZEN-CONTRACT.md §1. `reportable_type`
 * is validated to `speech`|`review` ONLY here; App\Http\Controllers\Api\
 * ReportController resolves that string server-side to the two allowed
 * Eloquent model classes (never a client-supplied class name).
 */
class CreateReportRequest extends FormRequest
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
            'reportable_type' => ['required', Rule::in(array_keys(Report::REPORTABLE_TYPES))],
            'reportable_id' => ['required', 'integer'],
            'reason' => ['required', Rule::in(Report::REASONS)],
            'detail' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
