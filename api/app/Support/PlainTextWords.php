<?php

namespace App\Support;

/**
 * Whitespace-delimited word count for PLAIN TEXT (never HTML — callers
 * strip/sanitize first). Unicode-aware rather than `str_word_count`, which
 * is locale/ASCII-sensitive. Tokens are kept or dropped by emptiness only:
 * a bare `array_filter` drops every falsy token, which deleted the literal
 * word "0" ("we scored 0 goals" counted 3).
 */
final class PlainTextWords
{
    public static function count(string $plainText): int
    {
        // `false` (invalid UTF-8) counts as no words, as both callers did.
        $tokens = preg_split('/\s+/u', $plainText, -1, PREG_SPLIT_NO_EMPTY);

        return $tokens === false ? 0 : count($tokens);
    }
}
