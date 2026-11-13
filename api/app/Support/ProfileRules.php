<?php

namespace App\Support;

final class ProfileRules
{
    public const AVATAR = ['image', 'mimes:jpeg,jpg,png,webp', 'max:5120'];

    /** @return array<string, list<string>> */
    public static function text(): array
    {
        return [
            'bio' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'location' => ['sometimes', 'nullable', 'string', 'max:80'],
        ];
    }
}
