<?php

namespace App\Http\Requests\Speech;

use Illuminate\Foundation\Http\FormRequest;

/**
 * §9.5's single frame-picking endpoint: `time_seconds` is nullable because
 * omitting it (or sending null) means "let the transcoder pick
 * automatically" — the same meaning NULL has on `speech_assets.poster_time_seconds`
 * itself (see 2026_08_08_160001_add_poster_columns_to_speech_assets_table.php's
 * doc comment).
 */
class SetPosterFrameRequest extends FormRequest
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
            'time_seconds' => ['nullable', 'numeric', 'min:0'],
        ];
    }
}
