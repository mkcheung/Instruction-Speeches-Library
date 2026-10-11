<?php

use App\Models\User;
use App\Support\Role;
use Illuminate\Database\Migrations\Migration;

/**
 * `CreateNewUser::create()` (app/Actions/Fortify/CreateNewUser.php) used
 * to create a user with no role at all, which failed
 * `User::scopeReviewerCandidates()`'s `role(['member', 'coach'])` filter
 * — the only reviewer-discovery query in the product (its own docblock)
 * — forever. Every self-registered user before that fix is still
 * roleless and still invisible in the directory; this backfill is the
 * one-time catch-up for the accounts that already exist.
 *
 * Scoped to the same three lifecycle columns `RoleAssignmentService::
 * remainingAdminCountExcluding()` checks together (`deleted_at`,
 * `suspended_at`, `anonymized_at` — RoleAssignmentService.php:240-242),
 * not `anonymized_at` alone: a roleless user who was suspended or
 * soft-deleted before ever holding a role is excluded from
 * `scopeReviewerCandidates()` today only as a side effect of having no
 * role at all. This backfill must not remove that accidental exclusion
 * by handing them one.
 *
 * `assignRole()`, not `syncRoles()` — additive, same reasoning as
 * `RoleAssignmentService.php:55-62` and `CreateNewUser.php`. These users
 * have no roles to begin with, so the two are equivalent here, but
 * additive-only is the house rule regardless of whether a given caller's
 * before-state makes the distinction matter.
 *
 * Deliberately writes no `audit_log` row per user: unlike `CreateNewUser`'s
 * grant (an ongoing, recurring path), this is a one-time historical
 * catch-up, and the migration's own presence in version control is that
 * event's record. Chunked, not bulk-inserted into `model_has_roles`
 * directly — this touches an unbounded, one-time set rather than a hot
 * path, so the straightforward `assignRole()` form is kept over a faster
 * but less obviously-correct raw insert.
 */
return new class extends Migration
{
    public function up(): void
    {
        User::query()
            ->doesntHave('roles')
            ->whereNull('deleted_at')
            ->whereNull('suspended_at')
            ->whereNull('anonymized_at')
            ->chunkById(200, function ($users) {
                foreach ($users as $user) {
                    $user->assignRole(Role::MEMBER);
                }
            });
    }

    /**
     * Not reversible: some of these users may have since been granted
     * `coach` or an admin-tier role through `RoleAssignmentService`
     * (or `GrantRoleCommand`'s `syncRoles()`), and this migration has no
     * record of which rows it touched versus which were assigned later
     * by something else. Stripping `member` back off indiscriminately
     * would be wrong for any user in the second group.
     */
    public function down(): void
    {
        // Intentional no-op — see docblock above.
    }
};
