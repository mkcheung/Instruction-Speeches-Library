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

    // STEP-12-admin-portal.md / STEP-12-FROZEN-CONTRACT.md §14: the admin
    // surface's own audit triggers — §14's original list ("role
    // assignment, admin viewing a private speech, admin reading a coach's
    // commentary, takedown, suspension") finally has call sites. Written
    // from controllers/Filament actions only, never a Policy (same rule
    // as every constant above).
    public const ROLE_ASSIGNED = 'role.assigned';

    public const ROLE_REVOKED = 'role.revoked';

    public const USER_SUSPENDED = 'user.suspended';

    public const USER_UNSUSPENDED = 'user.unsuspended';

    public const USER_DELETED = 'user.deleted';

    public const USER_RESTORED = 'user.restored';

    public const COACH_APPLICATION_APPROVED = 'coach_application.approved';

    public const COACH_APPLICATION_REJECTED = 'coach_application.rejected';

    public const ADMIN_VIEWED_SPEECH = 'admin.viewed_speech';

    public const ADMIN_VIEWED_DOCUMENT = 'admin.viewed_document';

    public const ADMIN_VIEWED_COMMENTARY = 'admin.viewed_commentary';

    public const SPEECH_TAKEN_DOWN = 'speech.taken_down';

    // PLAN-ADMIN-DASHBOARD.md §5.7. `ReportResource::resolve`/`dismiss`
    // were the only moderation verbs in the panel with NEITHER a
    // `Gate::authorize` NOR an audit write (the class does not even import
    // AuditLog) — and no constant covered report resolution, so the audit
    // half could not be fixed without adding these two first.
    public const REPORT_RESOLVED = 'report.resolved';

    public const REPORT_DISMISSED = 'report.dismissed';

    // §6.3: takedown is reversible (soft delete), so the inverse verb
    // needs its own trail — `SPEECH_TAKEN_DOWN` alone would leave a
    // restored speech looking permanently removed in the audit history.
    public const SPEECH_RESTORED = 'speech.restored';

    // §5.6: the object-purge half of a takedown, written when the bytes
    // are actually deleted rather than when the row is soft-deleted. These
    // are separated deliberately — a takedown is immediate, the purge runs
    // after the quarantine window, and conflating them would record a
    // deletion that has not happened yet.
    public const SPEECH_MEDIA_PURGED = 'speech.media_purged';

    private function __construct() {}
}
