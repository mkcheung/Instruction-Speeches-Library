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

    /**
     * Reverse a moderation soft-delete. PLAN-ADMIN-DASHBOARD.md §6.2 is
     * explicit that rev 1 got this method wrong — it called `softDelete`
     * and `restore` alike "guarded and tested", and this body was a bare
     * `forceFill(['deleted_at' => null])->save()`: no self-check, no
     * roster lock, no transaction, nothing. §6.2's correction reads
     * "`restore()` is a bare `forceFill` with no self-check and no roster
     * lock — it is *not* 'guarded'. Add guards before wiring a button to
     * it," and §6.2 is also the section that wires that button
     * (`UserResource::restore`), so both halves land together. Until now
     * the method had ZERO callers, which is the only reason the gap was
     * never exploitable.
     *
     * Two guards, and the asymmetry between them is the decision worth
     * recording:
     *
     *  1. **Self-check — YES.** The question §6.2 leaves open, answered
     *     for the same reason `suspend()`/`softDelete()` above carry
     *     theirs: §7.4's rule that every policy guard must ALSO exist as a
     *     service invariant, because policies are advisory and
     *     `GrantRoleCommand` proves callers that skip them exist.
     *     `UserPolicy::delete()` (the ability `UserResource::restore`
     *     authorizes against — there is no separate `user.restore`) runs
     *     `canModerate()`, which excludes self, so the panel path already
     *     refuses a self-restore; this makes that refusal a property of
     *     the service rather than a courtesy of the Gate.
     *
     *     ⚠️ It is genuinely unreachable through the panel TODAY, and that
     *     is not a reason to omit it. §5.1's `CheckUserIsActive` logs out
     *     and refuses to re-authenticate any user with `deleted_at` set,
     *     so a soft-deleted operator cannot be the actor in the first
     *     place, and an actor who is NOT soft-deleted restoring themselves
     *     is a no-op write. The check earns its line against the next
     *     caller — an artisan command or a queued job, neither of which
     *     passes through the session stack or the Gate — because
     *     "an administrator undoing a moderation decision taken against
     *     them personally" is self-dealing whether or not a session was
     *     involved.
     *
     *     This deliberately does NOT follow `RoleAssignmentService::
     *     revoke()`'s "no self-check on the reversing verb" precedent.
     *     That reasoning ("a role is the one thing a person should always
     *     be able to put down") turns on the direction of POWER, not on
     *     which verb reverses which: giving up a role reduces what you
     *     can do, while clearing your own `deleted_at` hands you back
     *     access another administrator took away.
     *
     *  2. **Last-admin re-count — NO, lock only.** `guardedRemoval()` is
     *     the wrong guard here and calling it would be an outright bug: it
     *     throws `LastAdministratorException` when `wouldOrphanAdminRoster
     *     ($target)` is true, i.e. when the target is an admin and no
     *     other eligible admin remains — which is precisely the state in
     *     which restoring an administrator is most obviously correct. An
     *     ADDITION can never reduce the admin count (`RoleAssignmentService
     *     ::assign()` and `UserPolicy::assign()` both state the same rule
     *     for the same reason), so there is nothing to refuse.
     *
     *     The advisory lock is still taken, inside a transaction, because
     *     the roster count is what every REMOVAL reads to decide whether
     *     it is legal. A restore changes that count, so it must serialize
     *     against those removals instead of landing in the middle of one's
     *     lock-then-count window. Both orderings are then safe: counted
     *     before the restore, a concurrent removal sees the smaller roster
     *     and fails safe; counted after, it sees the restored admin and
     *     correctly allows itself.
     */
    public function restore(User $actor, User $target): void
    {
        abort_if($target->id === $actor->id, 422, 'You cannot restore your own account.');

        $this->guardedAddition(fn () => $target->forceFill(['deleted_at' => null])->save());
    }

    /**
     * ⚠️ ONE transaction around the WHOLE batch, not one per target.
     *
     * Each `$each($target)` is itself a `guardedRemoval()`, i.e. its own
     * `DB::transaction` — which, un-nested, made this loop partially
     * committing: a `LastAdministratorException` on target 10 of 25 left
     * targets 1-9 suspended and committed. `UserResource::suspendSelected`
     * writes its audit rows and sends its notifications AFTER
     * `suspendMany()` returns, so that state produced nine suspended
     * accounts with no `audit_log` row and no notice to any of them — the
     * exact §5.5/§5.7 defect the bulk action was changed to close, reopened
     * by the partial failure.
     *
     * Wrapping here makes the "all-or-nothing by exception" claim that
     * call site relies on actually true: the inner `DB::transaction` calls
     * become savepoints, and any throw unwinds every write in the batch.
     * The roster advisory lock is transaction-scoped and re-entrant within
     * a session, so holding it across the batch is also strictly more
     * correct than taking and releasing it 25 times — a concurrent
     * demotion can no longer interleave between two targets of one batch.
     *
     * The cap is still checked BEFORE the transaction opens: it is a
     * caller bug, not a write that needs rolling back.
     *
     * @param  list<User>  $targets
     */
    private function guardedBulk(array $targets, callable $each): void
    {
        if (count($targets) > self::BULK_DELETE_CAP) {
            throw new InvalidArgumentException('Bulk moderation actions are capped at '.self::BULK_DELETE_CAP.' users per call.');
        }

        DB::transaction(function () use ($targets, $each) {
            foreach ($targets as $target) {
                $each($target);
            }
        });
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

    /**
     * The counterpart to `guardedRemoval()` for a write that can only ever
     * GROW the admin roster (§6.2's `restore()`): identical lock, inside
     * an identical transaction, deliberately WITHOUT the
     * `wouldOrphanAdminRoster()` throw.
     *
     * Kept as a sibling rather than a `bool $checkRoster` parameter on
     * `guardedRemoval()`, and named for what it asserts rather than for
     * what it skips, so that "this write takes the roster lock but makes
     * no last-admin decision" is a statement in the code instead of a
     * falsy argument a reader has to chase. `RoleAssignmentService::
     * assign()` is the same shape for the same reason — it takes the lock
     * and never throws `LastAdministratorException`. `UserPolicy::
     * canModerate()`'s docblock anticipated exactly this kind of fork
     * ("a future rule that must differ... has one obvious place to fork
     * from").
     */
    private function guardedAddition(callable $write): void
    {
        DB::transaction(function () use ($write) {
            $this->roles->acquireAdminRosterLock();

            $write();
        });
    }
}
