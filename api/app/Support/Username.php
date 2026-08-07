<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Username normalization — the Postgres trap (STEP-01-identity.md "Watch
 * for"). The plan's collation advice (`utf8mb4_0900_ai_ci`) is MySQL-only
 * and does not apply here: Postgres is case-sensitive by default, so
 * `MarsCheung`, `marscheung` and `märscheung` would NOT collide on a plain
 * UNIQUE index. Case-folding and accent-stripping must happen in
 * application code, before both the uniqueness check and storage, never
 * left to the database collation.
 */
final class Username
{
    /**
     * Normalize a candidate username for comparison and storage:
     * transliterate to ASCII (folds accents — "märscheung" -> "marscheung"),
     * lowercase, then trim anything the transliteration/lowercasing left
     * outside the allowed charset.
     */
    public static function normalize(string $raw): string
    {
        return Str::lower(Str::ascii(trim($raw)));
    }

    /**
     * The canonical format rule (§6.5): 3-30 chars, lowercase alphanumeric
     * plus `_.-`, no leading/trailing punctuation, no doubled boundary
     * chars beyond what the regex already forbids.
     */
    public static function pattern(): string
    {
        return '/^[a-z0-9](?:[a-z0-9_.-]{1,28}[a-z0-9])$/';
    }

    public static function isValidFormat(string $normalized): bool
    {
        return preg_match(self::pattern(), $normalized) === 1;
    }
}
