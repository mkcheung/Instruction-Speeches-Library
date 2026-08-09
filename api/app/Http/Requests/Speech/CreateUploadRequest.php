<?php

namespace App\Http\Requests\Speech;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The multipart `create` step (§9.1). `byte_size` here is the client's
 * DECLARED size — untrusted, used only to reserve quota up front
 * (App\Services\QuotaService::reserve) and later reconciled against the
 * real size at `complete`. Never trust it for anything else.
 */
class CreateUploadRequest extends FormRequest
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
            'original_filename' => ['required', 'string', 'max:255'],
            'content_type' => ['required', 'string', 'max:255'],
            'byte_size' => ['required', 'integer', 'min:1'],
        ];
    }
}
