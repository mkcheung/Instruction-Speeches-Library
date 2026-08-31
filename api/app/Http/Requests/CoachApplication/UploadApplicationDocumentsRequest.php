<?php

namespace App\Http\Requests\CoachApplication;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `POST /api/coach-applications/{id}/documents` — multipart, up to two
 * files (STEP-12-FROZEN-CONTRACT.md §9). `mimes:pdf` is a client-declared-
 * extension/mime check only, deliberately NOT trusted as the real content
 * validation — App\Services\PdfUploadValidator's magic-byte check in the
 * controller is the authoritative gate.
 */
class UploadApplicationDocumentsRequest extends FormRequest
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
            'documents' => ['required', 'array', 'min:1', 'max:2'],
            'documents.*' => ['required', 'file', 'mimes:pdf', 'max:10240'],
        ];
    }
}
