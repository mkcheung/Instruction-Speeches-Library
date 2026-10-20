<?php

namespace App\Http\Requests\Annotation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CreateVoiceAnnotationRequest extends FormRequest
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
            // Fileinfo can identify audio-only browser WebM recordings as video/webm.
            'audio' => ['required', 'file', 'max:16384', 'mimetypes:audio/webm,video/webm,audio/mp4,audio/x-m4a,audio/m4a,video/mp4,audio/ogg,audio/wav,audio/x-wav,audio/mpeg'],
            'client_uuid' => ['required', 'uuid'],
            'start_seconds' => ['required', 'numeric', 'min:0', 'max:9999999.999'],
            'kind' => ['sometimes', Rule::in(['praise', 'correction', 'observation'])],
            'topic' => ['sometimes', 'nullable', 'string', 'max:32'],
        ];
    }
}
