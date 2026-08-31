<?php

namespace App\Services;

use App\Exceptions\LastAdministratorException;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * STEP-12-FROZEN-CONTRACT.md §3/§4 / MODERNIZATION_PLAN §7.4. The three
 * moderation/lifecycle verbs on a `User` row, distinct from
 * `App\Services\Privacy\AccountErasureService` (self-initiated, permanent
 * erasure — STEP-11):
 *
 *   - `suspend()`   — `suspended_at`, reversible, session dies within one
 *                      request (the session/token invalidation itself is
 *                      the caller's concern via `Sanctum`/session
 *                      revocation — this service only stamps the column
 *                      the rest of the auth stack already checks).
 *   - `softDelete()` — `deleted_at`, a 30-day moderation grace period,
 *                      also reversible via `restore()`.
 *
 * Both removal verbs share `RoleAssignmentService`'s
 * `pg_advisory_xact_lock(hashtext('admin_roster'))` + re-count — per the
 * frozen contract, "demotion-to-zero and deletion-to-zero are the same
 * bug." Bulk deletion is capped at 25 targets per call; bulk erasure
 * (irreversible) is never exposed at all — only `softDelete()`/`suspend()`
 * accept an array.
 */
class UserDeletionService
{
    public const BULK_DELETE_CAP = 25;

    public function __construct(private readonly RoleAssignmentService $roles) {}

    /**
     * Suspend one user. Reversible — the counterpart is `unsuspend()`.
     */
    public function suspend(User $actor, User $target): void
    {
        // `softDelete()` below has always had this check; `suspend()` did
        // not, which meant an admin could suspend themselves through the
        // Filament UI (which never calls `Gate::authorize('user.suspend',
        // ...)` — see `UserResource`'s actions) even though
        // `UserPolicy::suspend()` explicitly denies exactly that. Found
        // by `/code-review`'s line-by-line diff angle; enforced here too
        // per §7.4's own rule that every policy guard must ALSO exist as
        // an invariant in the service, since policies are advisory.
        abort_if($target->id === $actor->id, 422, 'You cannot suspend your own account.');

        $this->guardedRemoval($target, fn () => $target->forceFill(['suspended_at' => now()])->save());
    }

    /**
     * @param  list<User>  $targets
     */
    public function suspendMany(User $actor, array $targets): void
    {
        $this->guardedBulk($targets, fn (User $target) => $this->suspend($actor, $target));
    }

    public function unsuspend(User $actor, User $target): void
    {
        $target->forceFill(['suspended_at' => null])->save();
    }

    /**
     * Moderation soft-delete: `deleted_at`, 30-day grace, reversible via
     * `restore()`. Distinct from Eloquent's `SoftDeletes` trait (`User`
     * deliberately does not use it — see the migration's own docblock);
     * every other query that must exclude a soft-deleted user filters on
     * `whereNull('deleted_at')` explicitly.
     */
    public function softDelete(User $actor, User $target): void
    {
        abort_if($target->id === $actor->id, 422, 'You cannot delete your own account this way.');

        $this->guardedRemoval($target, fn () => $target->forceFill(['deleted_at' => now()])->save());
    }

    /**
     * @param  list<User>  $targets
     */
    public function softDeleteMany(User $actor, array $targets): void
    {
        $this->guardedBulk($targets, fn (User $target) => $this->softDelete($actor, $target));
    }

    public function restore(User $actor, User $target): void
    {
        $target->forceFill(['deleted_at' => null])->save();
    }

    /**
     * @param  list<User>  $targets
     */
    private function guardedBulk(array $targets, callable $each): void
    {
        if (count($targets) > self::BULK_DELETE_CAP) {
            throw new InvalidArgumentException('Bulk moderation actions are capped at '.self::BULK_DELETE_CAP.' users per call.');
        }

        foreach ($targets as $target) {
            $each($target);
        }
    }

    /**
     * Shared guard for every single-target removal-shaped write: the same
     * lock + re-count `RoleAssignmentService::revoke()` uses, so a
     * demotion and a suspension/deletion of the last admin can never race
     * each other into zero.
     */
    private function guardedRemoval(User $target, callable $write): void
    {
        DB::transaction(function () use ($target, $write) {
            $this->roles->acquireAdminRosterLock();

            if ($this->roles->wouldOrphanAdminRoster($target)) {
                throw new LastAdministratorException;
            }

            $write();
        });
    }
}
