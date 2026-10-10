<?php

namespace App\Policies;

use App\Models\Report;
use App\Models\User;
use App\Support\Role;

/**
 * PLAN-ADMIN-DASHBOARD.md §5.4. New class — `app/Policies/` had no policy
 * for `Report` at all, which is the fourth row of §5.4's eight-hole table
 * and the worst of them on paper: "Report resolve/dismiss have **neither
 * Gate nor audit** — `AuditLog` isn't even imported" (`ReportResource.php:
 * 47-69`). Every other moderation verb in the panel had at least one of
 * the two. This class supplies the authorization half; the audit half is
 * `AuditAction::REPORT_RESOLVED`/`REPORT_DISMISSED`, added in the same
 * commit, and is written by the caller.
 *
 * Admin-tier per §4's "Resolve / dismiss report" row, NOT super_admin-only
 * — report triage is the routine work the dashboard exists for, and
 * restricting it to the senior tier would leave the queue unworked.
 *
 * One ability covers both verbs. Resolving and dismissing are the same
 * capability pointed at two outcomes (`Report::STATES` holds `actioned`
 * and `dismissed` beside `open`), and nothing in §4 or §6.4 distinguishes
 * who may do which — the two AuditAction constants, not two abilities, are
 * what keep the outcomes distinguishable after the fact. A reviewer
 * looking for `report.dismiss` should find that absence deliberate.
 */
class ReportPolicy
{
    /**
     * `report.resolve` — admin-tier, and registered in AppServiceProvider's
     * `$mustFallThrough` in this same commit per §5.7's standing rule.
     *
     * That rule is the reason this method exists rather than the panel
     * simply leaning on `EnsureUserIsAdmin` as it does today: `Gate::
     * before` state 3 is allow-by-default for admins on any UNREGISTERED
     * ability string, so a `Gate::authorize('report.resolve', $report)`
     * added to `ReportResource` without both halves of this change would
     * have been an unconditional yes that merely looked like a check.
     *
     * `$report` is unused in the body and is kept deliberately: §6.4
     * ("Reports — add the missing context") is where per-report conditions
     * land, and an ability registered without its model now would have to
     * be re-registered — and every call site re-audited — later.
     */
    public function resolve(User $user, Report $report): bool
    {
        return $user->hasAnyRole(Role::ADMIN_TIER);
    }
}
