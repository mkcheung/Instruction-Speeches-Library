<?php

namespace App\Services;

use App\Exceptions\LastAdministratorException;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * STEP-12-FROZEN-CONTRACT.md §3 / MODERNIZATION_PLAN §7.4. The ONLY
 * legal way any role assignment/removal happens in this codebase from
 * this step forward — never a direct `assignRole()`/`removeRole()` call
 * in a controller or Filament action (bulk actions bypass policies, per
 * §7.4's own warning).
 *
 * Both `assign()` and `revoke()` wrap the same
 * `pg_advisory_xact_lock(hashtext('admin_roster'))` + re-count pattern:
 * the lock serializes concurrent admin-roster changes against each other
 * (the two-concurrent-deletes-at-the-last-two-admins race this step's
 * acceptance criterion names), and the re-count — of every
 * `admin`/`super_admin` EXCLUDING the target, alive (`deleted_at`),
 * active (`suspended_at`), and not anonymized (`anonymized_at`) — is what
 * decides whether a REMOVAL is legal.
 *
 * The advisory lock is Postgres-only (`hashtext`/`pg_advisory_xact_lock`
 * have no sqlite equivalent — this codebase's test suite runs on sqlite,
 * per phpunit.xml). On sqlite this degrades to "just the transaction",
 * which is correct for the single-process Pest suite; the real
 * concurrency guarantee is proven against a real Postgres instance by
 * scripts/verify-postgres-last-admin-lock.sh (STEP-12-FROZEN-CONTRACT.md
 * §8), not by a PHPUnit-level test.
 */
class RoleAssignmentService
{
    /**
     * Grant `$role` to `$target`. Never itself throws
     * `LastAdministratorException` — an ADDITION can never reduce the
     * admin count.
     *
     * `assignRole()`, NOT `syncRoles()` — `syncRoles()` REPLACES the
     * target's entire role set. A prior version of this method used
     * `syncRoles([$role])`, which meant granting `coach` to an admin (or
     * the last admin) silently stripped their `admin`/`super_admin` role
     * with zero last-admin check, defeating the exact guarantee this
     * class exists to provide — found by `/code-review`'s cross-file
     * tracer angle and confirmed by direct read before this fix landed.
     * `assignRole()` is idempotent (Spatie no-ops if the role is already
     * held), so this stays safe to call from `CoachApplicationDecisionService`
     * without a pre-check.
     */
    public function assign(User $actor, User $target, string $role): void
    {
        DB::transaction(function () use ($target, $role) {
            $this->acquireAdminRosterLock();

            $target->assignRole($role);
        });
    }

    /**
     * Remove `$role` from `$target`. Throws `LastAdministratorException`
     * (rolling back the transaction) if removing an `admin`/`super_admin`
     * role from `$target` would leave zero eligible administrators
     * standing.
     */
    public function revoke(User $actor, User $target, string $role): void
    {
        DB::transaction(function () use ($target, $role) {
            $this->acquireAdminRosterLock();

            if (in_array($role, ['admin', 'super_admin'], true) && $this->wouldOrphanAdminRoster($target)) {
                throw new LastAdministratorException;
            }

            $target->removeRole($role);
        });
    }

    /**
     * The same re-count `App\Services\UserDeletionService` reuses for
     * suspend/soft-delete/erase — demotion-to-zero and deletion-to-zero
     * are the same bug, so both go through this one query.
     */
    public function remainingAdminCountExcluding(User $target): int
    {
        return User::query()
            ->role(['admin', 'super_admin'])
            ->whereKeyNot($target->id)
            ->whereNull('deleted_at')
            ->whereNull('suspended_at')
            ->whereNull('anonymized_at')
            ->count();
    }

    /**
     * "Would removing/demoting/suspending/deleting/erasing `$target` leave
     * zero eligible administrators standing?" — the single predicate every
     * lifecycle-destructive verb in this codebase must check before
     * acting on an admin/super_admin. Previously hand-duplicated across
     * `UserPolicy::delete`/`suspend`, `AccountPolicy::eraseSelf`,
     * `UserDeletionService::guardedRemoval`, and this class's own
     * `revoke()` — centralized here (found by three independent
     * `/code-review` finder angles) so a future change to what counts as
     * "an eligible administrator" only has one call site to update.
     */
    public function wouldOrphanAdminRoster(User $target): bool
    {
        return $target->hasRole(['admin', 'super_admin']) && $this->remainingAdminCountExcluding($target) < 1;
    }

    public function acquireAdminRosterLock(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("SELECT pg_advisory_xact_lock(hashtext('admin_roster'))");
        }
    }
}
