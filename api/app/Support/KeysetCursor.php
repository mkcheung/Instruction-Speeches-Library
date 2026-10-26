<?php

namespace App\Support;

use DateTimeImmutable;

/**
 * Opaque keyset cursor shared by the endpoints that page on `{timestamp}|{id}`.
 *
 * Decoding is deliberately forgiving: anything that is not a well-formed
 * cursor (wrong type, bad base64, no separator, or a timestamp half that is
 * not a stored `Y-m-d H:i:s[.u]` value) returns null, which callers treat as
 * "restart from page one". A timestamp is validated before it can reach a
 * `where(... '<', $ts)` clause, because PostgreSQL rejects a malformed
 * timestamp literal with an uncaught QueryException (HTTP 500) where SQLite
 * would silently compare it as a string.
 */
final class KeysetCursor
{
    /**
     * @return array{0: string, 1: int}|null
     */
    public static function decode(mixed $cursor): ?array
    {
        // `?cursor[]=x` arrives as an array.
        if (! is_string($cursor) || $cursor === '') {
            return null;
        }

        $decoded = base64_decode($cursor, true);
        if ($decoded === false || ! str_contains($decoded, '|')) {
            return null;
        }

        [$timestamp, $id] = explode('|', $decoded, 2);

        if (! self::validTimestamp($timestamp) || ! preg_match('/^\d{1,18}$/D', $id)) {
            return null;
        }

        return [$timestamp, (int) $id];
    }

    public static function encode(string $timestamp, int $id): string
    {
        return base64_encode("{$timestamp}|{$id}");
    }

    public static function validTimestamp(string $value): bool
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/D', $value)) {
            return false;
        }

        $parsed = DateTimeImmutable::createFromFormat(str_contains($value, '.') ? '!Y-m-d H:i:s.u' : '!Y-m-d H:i:s', $value);
        $errors = DateTimeImmutable::getLastErrors();

        return $parsed !== false && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0));
    }
}
