<?php

namespace App\Services;

use App\Exceptions\LastAdministratorException;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\AuditAction;
use App\Support\Role;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

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
 *
 * PLAN-ADMIN-DASHBOARD.md §5.4/§5.7 added what the "ONLY legal way"
 * claim above was missing to be true. Being the only path is worth
 * nothing if the path itself checks nothing: this class had no role
 * allowlist, no self-check, no tier check on administrative grants, and
 * no audit write, and it discarded the `$actor` it was given in both
 * write methods. So "every role change goes through here" was enforced,
 * and an admin could still walk through here and hand themselves
 * `super_admin` with no trace. The guards live in `assign()`/`revoke()`
 * below, each with the reasoning for its own presence or deliberate
 * absence.
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
     *
     * PLAN-ADMIN-DASHBOARD.md §5.4, hole 5 — three guards, all new:
     *
     *  1. `$actor` was accepted and DISCARDED. The closure closed over
     *     `$target`/`$role` only, so the parameter named in the signature
     *     had no effect on anything the method did. Every caller passed
     *     it; nothing read it.
     *  2. No role allowlist, so `assign($admin, $admin, 'super_admin')`
     *     was a working self-escalation to the one tier that holds erase,
     *     role grants and the audit log.
     *  3. No self-check, which is what turned (2) from "an admin can mint
     *     a peer" into "an admin can promote themselves."
     */
    public function assign(User $actor, User $target, string $role): void
    {
        $this->assertAssignableRole($role);

        // §4's "Grant / revoke `admin`, `super_admin`" row. Checked here
        // and not only in `UserPolicy::grantSuperAdmin` because this
        // method takes the role as a RUNTIME argument while that ability
        // does not: `role.assign` is one ability covering four role names,
        // so the policy layer physically cannot tell `coach` from
        // `super_admin` and this is the only layer that can.
        abort_if(
            in_array($role, Role::SUPER_ADMIN_ONLY_GRANTS, true) && ! $actor->hasRole(Role::SUPER_ADMIN),
            403,
            "Only a super_admin may grant the '{$role}' role.",
        );

        // Self-check, on `assign()` ONLY — see `revoke()` below for why
        // the asymmetry is deliberate. §7.4's rule that a policy guard
        // must ALSO exist as a service invariant is the reason this is an
        // `abort_if` here rather than left to the Gate: policies are
        // advisory, and `GrantRoleCommand` proves callers that skip them
        // exist. 422 matches `UserDeletionService::suspend()`'s own
        // self-check, the closest sibling of this guard in the codebase.
        abort_if(
            $actor->id === $target->id,
            422,
            'You cannot assign a role to your own account.',
        );

        DB::transaction(function () use ($actor, $target, $role) {
            $this->acquireAdminRosterLock();

            $target->assignRole($role);

            $this->audit($actor, $target, $role, AuditAction::ROLE_ASSIGNED);
        });
    }

    /**
     * Remove `$role` from `$target`. Throws `LastAdministratorException`
     * (rolling back the transaction) if removing an `admin`/`super_admin`
     * role from `$target` would leave zero eligible administrators
     * standing.
     *
     * ⚠️ NO self-check here, and NO `SUPER_ADMIN_ONLY_GRANTS` check
     * either. Both omissions are decisions on the record, not oversights:
     *
     *  - §5.4 put the self-check question explicitly to the reviewer and
     *    answered it: "Recommend: no self-check on `revoke`... the
     *    last-admin guard already prevents the dangerous case."
     *    `RoleAssignmentServiceTest.php:50-51` and `:65-66` both
     *    deliberately self-revoke to CONSTRUCT the last-admin scenario, so
     *    a self-check here would not just break two tests, it would make
     *    the scenario they exist to pin unreachable. A role is also the
     *    one thing a person should always be able to put down:
     *    `UserPolicy::revokeSuperAdmin` reaches the same conclusion from
     *    the policy side ("a self-check would make the senior tier the
     *    only role on the platform nobody can ever leave").
     *  - The super-admin-only clause is on grants, not removals, because
     *    `RoleAssignmentServiceTest.php:35`/`:48`/`:65` all revoke
     *    `admin` while acting as a plain `admin`. Removal is already
     *    bounded by the thing that actually matters — the last-admin
     *    re-count below — and that guard does not care who is asking.
     *
     * The role allowlist DOES apply, because an unknown role string is a
     * programming error in either direction.
     */
    public function revoke(User $actor, User $target, string $role): void
    {
        $this->assertAssignableRole($role);

        DB::transaction(function () use ($actor, $target, $role) {
            $this->acquireAdminRosterLock();

            // `Role::ADMIN_TIER`, not `SUPER_ADMIN_ONLY_GRANTS`: the two
            // constants hold the same two names today but answer
            // different questions, and this one is "is the role being
            // removed an administrative role" — the roster question, not
            // the who-may-grant-it question.
            if (in_array($role, Role::ADMIN_TIER, true) && $this->wouldOrphanAdminRoster($target)) {
                throw new LastAdministratorException;
            }

            $target->removeRole($role);

            $this->audit($actor, $target, $role, AuditAction::ROLE_REVOKED);
        });
    }

    /**
     * §5.4: there was no allowlist at all, so the `$role` string reached
     * Spatie verbatim. Two distinct failures came through that gap — the
     * `super_admin` self-escalation (guarded separately in `assign()`,
     * since `super_admin` is a legitimate value here), and a typo'd or
     * renamed role silently throwing Spatie's own `RoleDoesNotExist`
     * from inside a transaction with the roster lock held.
     *
     * `coach` MUST stay in `Role::ASSIGNABLE`:
     * `CoachApplicationDecisionService::approve()` assigns it and
     * `RoleAssignmentServiceTest.php:23` pins exactly that call.
     *
     * ⚠️ This does NOT cover the CLI. `GrantRoleCommand.php:68` calls
     * `syncRoles()` on the model directly and never enters this class, so
     * the break-glass path (§5.8) bypasses the allowlist, the self-check,
     * the roster lock and the audit write alike. That is deliberate for a
     * break-glass tool and it is the reason this is not the last word on
     * role safety.
     *
     * `InvalidArgumentException` rather than `abort()`: an unknown role is
     * not a permission decision about the actor, it is a caller bug, and
     * it matches `UserDeletionService::guardedBulk()`'s over-cap throw —
     * the other "this call should never have been made" case in the pair
     * of services.
     */
    private function assertAssignableRole(string $role): void
    {
        if (! in_array($role, Role::ASSIGNABLE, true)) {
            throw new InvalidArgumentException("'{$role}' is not an assignable role.");
        }
    }

    /**
     * §5.7: "`RoleAssignmentService` writes NO audit at all (`AuditLog`
     * isn't imported) — audit is the caller's responsibility and
     * `GrantRoleCommand` writes none, making CLI role changes
     * unauditable." `ROLE_ASSIGNED` was one of four constants with no call
     * site anywhere.
     *
     * Moved from the callers to here on purpose. `UserResource::
     * revokeCoach` was the only caller that did write a `ROLE_REVOKED`
     * row, which means the guarantee was "audited if the caller
     * remembered" — and the next caller never does. Inside the
     * transaction, after the write: a rolled-back role change (the
     * last-admin throw below) must not leave an audit row claiming it
     * happened, and the plan's own standard for this table is that the
     * trail survives the thing it recorded, not that it predicts it.
     *
     * `UserResource`'s own duplicate write was removed in the same change
     * — leaving both would log one revocation twice.
     */
    private function audit(User $actor, User $target, string $role, string $action): void
    {
        AuditLog::query()->create([
            'actor_id' => $actor->id,
            'action' => $action,
            'subject_type' => User::class,
            'subject_id' => $target->id,
            'metadata' => ['role' => $role],
            'created_at' => now(),
        ]);
    }

    /**
     * The same re-count `App\Services\UserDeletionService` reuses for
     * suspend/soft-delete/erase — demotion-to-zero and deletion-to-zero
     * are the same bug, so both go through this one query.
     */
    public function remainingAdminCountExcluding(User $target): int
    {
        return User::query()
            ->role(Role::ADMIN_TIER)
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
        return $target->hasAnyRole(Role::ADMIN_TIER) && $this->remainingAdminCountExcluding($target) < 1;
    }

    public function acquireAdminRosterLock(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("SELECT pg_advisory_xact_lock(hashtext('admin_roster'))");
        }
    }
}
