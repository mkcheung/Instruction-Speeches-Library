<?php

namespace App\Support;

use App\Models\Connection;
use stdClass;

/** Structural validity only; visibility, timestamps and repair authority belong to callers. */
final class ConnectionPair
{
    public static function isValid(Connection|stdClass|null $first, Connection|stdClass|null $second): bool
    {
        if ($first === null || $second === null) {
            return false;
        }
        $a = self::attributes($first);
        $b = self::attributes($second);
        if ($a === null || $b === null) {
            return false;
        }
        $parties = [$a['owner'], $a['peer']];

        return $a['owner'] !== $a['peer']
            && $a['owner'] === $b['peer'] && $a['peer'] === $b['owner']
            && $a['state'] === $b['state']
            && in_array($a['state'], ['pending', 'accepted', 'declined', 'blocked'], true)
            && $a['initiator'] === $b['initiator']
            && ($a['initiator'] === null
                ? in_array($a['state'], ['declined', 'blocked'], true)
                : in_array($a['initiator'], $parties, true))
            && $a['blocker'] === $b['blocker']
            && ($a['state'] === 'blocked'
                ? in_array($a['blocker'], $parties, true)
                : $a['blocker'] === null);
    }

    /** @return array{owner: int, peer: int, state: string, initiator: ?int, blocker: ?int}|null */
    private static function attributes(Connection|stdClass $row): ?array
    {
        $owner = self::id($row->owner_id ?? null);
        $peer = self::id($row->peer_id ?? null);
        $state = $row->state ?? null;
        $rawInitiator = $row->initiated_by_id ?? null;
        $rawBlocker = $row->blocked_by_id ?? null;
        $initiator = self::id($rawInitiator);
        $blocker = self::id($rawBlocker);
        if ($owner === null || $peer === null || ! is_string($state)
            || ($rawInitiator !== null && $initiator === null)
            || ($rawBlocker !== null && $blocker === null)) {
            return null;
        }

        return ['owner' => $owner, 'peer' => $peer, 'state' => $state, 'initiator' => $initiator, 'blocker' => $blocker];
    }

    private static function id(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value > 0 ? $value : null;
        }
        // PDO may return bigint values as strings. Reject coercion, signs, fractions and overflow.
        if (is_string($value) && preg_match('/^[1-9][0-9]*$/D', $value)) {
            $parsed = filter_var($value, FILTER_VALIDATE_INT);

            return is_int($parsed) ? $parsed : null;
        }

        return null;
    }
}
