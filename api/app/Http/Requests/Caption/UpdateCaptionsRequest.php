<?php

namespace App\Http\Requests\Caption;

use App\Services\Captions\InvalidVttException;
use App\Services\Captions\Vtt;
use Illuminate\Contracts\Validation\Validator as ValidatorContract;
use Illuminate\Foundation\Http\FormRequest;

/**
 * `PUT /speeches/{speech}/captions` — the frozen STEP-09 backend contract
 * §4: "server-side VTT validation; 422 on invalid VTT". `authorize()`
 * stays `true` here (matching UpdateEssayRequest's own convention) — the
 * real authorization call is `SpeechPolicy::updateCaptions`, made
 * explicitly in the controller against the resolved `Speech`, not this
 * request.
 *
 * Validation runs the SAME parser (App\Services\Captions\Vtt::parse) the
 * rest of the caption pipeline uses — a payload this class accepts is, by
 * construction, one App\Services\Captions\TranscriptDeriver can also
 * derive from without a second, possibly-divergent, "is this valid VTT"
 * check anywhere else.
 */
class UpdateCaptionsRequest extends FormRequest
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
            'vtt' => ['required', 'string'],
        ];
    }

    public function withValidator(ValidatorContract $validator): void
    {
        $validator->after(function (ValidatorContract $validator): void {
            $vtt = $this->input('vtt');

            if (! is_string($vtt) || $vtt === '') {
                return; // already caught by the `required`/`string` rule above
            }

            try {
                Vtt::parse($vtt);
            } catch (InvalidVttException $e) {
                $validator->errors()->add('vtt', 'This is not valid WebVTT: '.$e->getMessage());
            }
        });
    }
}
