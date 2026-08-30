<?php

namespace App\Support;

/**
 * STEP-11-FROZEN-CONTRACT.md §2. `audit_log.action` is free text at the DB
 * level (an open vocabulary — §14's trigger list includes admin actions
 * STEP-12 hasn't built yet), but every value STEP-11 itself writes lives
 * here so call sites never hand-type a string.
 *
 * §14 also lists "role assignment, admin viewing a private speech, admin
 * reading a coach's commentary, takedown, suspension" as audit triggers —
 * none of those have a call site yet (STEP-12 hasn't built the admin
 * surface), so no constant exists for them here. Do not add stub audit
 * writes for triggers with nothing to call them; add the constant when
 * STEP-12 adds the call site.
 */
final class AuditAction
{
    public const ACCOUNT_EXPORT_REQUESTED = 'account.export.requested';

    public const ACCOUNT_EXPORT_DOWNLOADED = 'account.export.downloaded';

    public const ACCOUNT_ERASED = 'account.erased';

    public const REPORT_CREATED = 'report.created';

    private function __construct() {}
}
