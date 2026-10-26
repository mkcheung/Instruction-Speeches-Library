<?php

namespace App\Support;

use Illuminate\Validation\Rule;

/** Request constraints only; AnnotationTiming owns effective geometry and overlap. */
final class AnnotationRules
{
    public const START_SECONDS = ['numeric', 'min:0', 'max:9999999.999'];

    public const DURATION_SECONDS = ['numeric', 'gt:0', 'max:120'];

    /** @return array<string, mixed> */
    public static function metadata(): array
    {
        return [
            'kind' => ['sometimes', Rule::in(['praise', 'correction', 'observation'])],
            'topic' => ['sometimes', 'nullable', 'string', 'max:32'],
        ];
    }
}
