<?php

namespace App\Support;

/**
 * IMPLEMENTATION-PLANS.md §7.5.5. Mirrors App\Support\AuditAction's shape:
 * final class, private constructor, public string constants — the two
 * possible values of `speeches.deleted_reason`.
 *
 * `OWNER` is written by App\Services\SpeechDeletionService for a speaker's
 * own delete. `TAKEDOWN` is an explicit value for any FUTURE admin takedown
 * write — existing/legacy takedown rows read the reason via a NULL column
 * (no backfill migration was written; see the migration's own comment), but
 * new code should write `TAKEDOWN` explicitly rather than rely on the
 * omission convention going forward.
 */
final class SpeechDeletionReason
{
    public const OWNER = 'owner';

    public const TAKEDOWN = 'takedown';

    private function __construct() {}
}
