<?php

namespace App\Policies;

use App\Models\User;
use App\Services\RoleAssignmentService;
use App\Support\Role;

/**
 * STEP-12-FROZEN-CONTRACT.md §4. New class — nothing existed to extend
 * (`app/Policies/` held only `AnnotationPolicy`/`ReviewPolicy`/
 * `SpeechPolicy` before this step). Moderation-only: admin acting on
 * ANOTHER user, never a self-service ability (that's `AccountPolicy`).
 *
 * `delete`/`suspend` are registered in AppServiceProvider's
 * `$mustFallThrough` alongside `role.assign`/`role.revoke` — Gate::
 * before's blanket admin bypass must NEVER short-circuit these to `true`,
 * since both exclude self and the last admin below.
 *
 * PLAN-ADMIN-DASHBOARD.md §5.3 adds the four methods at the bottom of this
 * class. They back ability strings (`user.erase`, `user.demote`,
 * `role.grantSuperAdmin`, `role.revokeSuperAdmin`) that had sat in
 * `$mustFallThrough` since STEP-12 WITHOUT a matching `Gate::define` —
 * "phantom abilities". That state was safe but inert: an unregistered
 * ability excluded from the bypass denies everyone, so per §5.3 "there is
 * no path to grant `super_admin` at all." These four give them real
 * bodies, and §4's role matrix makes all four `super_admin`-ONLY — the
 * single place in this codebase where the two administrative roles
 * genuinely diverge. Everywhere else §5.2 has just finished collapsing
 * them into `Role::ADMIN_TIER`, so the contrast is deliberate: read
 * `Role::SUPER_ADMIN` below as "this is one of §4's bottom three rows",
 * not as a site §5.2 missed.
 */
class UserPolicy
{
    public function __construct(private readonly RoleAssignmentService $roles) {}

    /**
     * Admin-only, excludes self, excludes the last standing admin.
     */
    public function delete(User $actor, User $target): bool
    {
        return $this->canModerate($actor, $target);
    }

    /**
     * Same shape as `delete()` — suspension is reversible but must never
     * be able to zero out the admin roster either.
     */
    public function suspend(User $actor, User $target): bool
    {
        return $this->canModerate($actor, $target);
    }

    /**
     * `delete()`/`suspend()` share this exact predicate today; kept as one
     * private method rather than two independently-maintained bodies so a
     * future rule that must differ between them (§7.4 already
     * distinguishes "irreversible" from "reversible") has one obvious
     * place to fork from instead of two copies to keep in sync by hand.
     */
    private function canModerate(User $actor, User $target): bool
    {
        if (! $actor->hasAnyRole(Role::ADMIN_TIER)) {
            return false;
        }

        if ($actor->id === $target->id) {
            return false;
        }

        return ! $this->roles->wouldOrphanAdminRoster($target);
    }

    /**
     * `role.assign` — admin-gated; `RoleAssignmentService::assign()` is
     * the one place that actually writes the role. An ADDITION can never
     * reduce the admin count, so no last-admin check is needed here.
     */
    public function assign(User $actor, User $target): bool
    {
        return $actor->hasAnyRole(Role::ADMIN_TIER);
    }

    /**
     * `role.revoke` — admin-gated at the policy layer; the last-admin
     * check itself lives in `RoleAssignmentService::revoke()` (it needs
     * to know WHICH role is being revoked, which this ability alone
     * doesn't carry as a typed argument).
     */
    public function revoke(User $actor, User $target): bool
    {
        return $actor->hasAnyRole(Role::ADMIN_TIER);
    }

    /**
     * `user.erase` (§5.3, §4's "GDPR erase" row) — super_admin ONLY.
     *
     * Irreversible: `AccountErasureService` anonymizes the row and deletes
     * every stored byte, and §5.1's rollback note does not apply because
     * there is nothing to roll back to. That is the whole reason §4 holds
     * it one tier above `user.delete` (which is admin-tier and a soft
     * delete). The erase SCOPE itself is §0's "Erase scope" decision and
     * belongs to the service, not to this gate — this method answers only
     * "is this actor permitted to erase anyone at all".
     *
     * Note this is the ADMIN-erasing-SOMEONE-ELSE path, distinct from
     * `AccountPolicy::eraseSelf` / `DELETE /api/account`, which is
     * self-scoped and needs no target (see AccountController's docblock,
     * which names this very ability as deferred to a later step — it
     * arrives here).
     */
    public function erase(User $actor, User $target): bool
    {
        return $this->canModerateAsSuperAdmin($actor, $target);
    }

    /**
     * `user.demote` (§5.3) — super_admin ONLY.
     *
     * Demotion is the inverse of a role grant, so §4's "Grant / revoke
     * `admin`, `super_admin`" row governs it: a plain admin who could
     * demote peers could unilaterally reduce the admin roster to just
     * themselves, which is the same escalation as minting peers, run
     * backwards. The last-admin guard in the shared predicate below is
     * what stops the final step of that from ever landing, and it is the
     * reason demotion cannot be left to the generic `role.revoke`.
     */
    public function demote(User $actor, User $target): bool
    {
        return $this->canModerateAsSuperAdmin($actor, $target);
    }

    /**
     * `role.grantSuperAdmin` (§5.3, §4's "Grant / revoke `admin`,
     * `super_admin`" row) — super_admin ONLY. This is the ability §5.3
     * reports as having had no path at all: `Role::SUPER_ADMIN_ONLY_GRANTS`
     * existed, and `$mustFallThrough` reserved the string, but nothing
     * ever defined it, so the roster could not be grown even by hand.
     *
     * Gating it on `Role::SUPER_ADMIN` IS the enforcement of
     * `Role::SUPER_ADMIN_ONLY_GRANTS` at the ability layer — that
     * constant lists `admin` and `super_admin`, and this ability plus
     * `revokeSuperAdmin()` are the only sanctioned route to either.
     * `RoleAssignmentService` still owns the allowlist check for the
     * generic `assign`/`revoke` pair (§5.4), because that pair takes the
     * role name as a runtime argument and this one does not.
     *
     * NO last-admin check, matching `assign()` above for the identical
     * reason spelled out there: an ADDITION can never reduce the admin
     * count. Self-exclusion is kept — not as a safety guard (a
     * super_admin granting themselves a role they must already hold to
     * reach this line is a no-op) but to honour this class's stated
     * contract of "acting on ANOTHER user, never a self-service ability".
     */
    public function grantSuperAdmin(User $actor, User $target): bool
    {
        if (! $actor->hasRole(Role::SUPER_ADMIN)) {
            return false;
        }

        return $actor->id !== $target->id;
    }

    /**
     * `role.revokeSuperAdmin` (§5.3) — super_admin ONLY, and the one
     * removal in this class that deliberately does NOT exclude self.
     *
     * ⚠️ This is a considered divergence from `canModerate()`, not an
     * omission. §5.4 puts the decision explicitly on the record — "Decide
     * explicitly whether `revoke()` also gets a self-check... Recommend:
     * no self-check on `revoke`, preserving those tests; the last-admin
     * guard already prevents the dangerous case" — and the same reasoning
     * transfers from the service to this gate unchanged. Two consequences
     * worth stating:
     *
     *  1. A super_admin stepping down voluntarily is a legitimate act, and
     *     a self-check would make the senior tier the only role on the
     *     platform nobody can ever leave.
     *  2. `wouldOrphanAdminRoster()` is evaluated against `$target`, so
     *     when actor and target are the same person it is precisely the
     *     "last admin tries to demote themselves" case — already covered,
     *     and covered better than a self-check would cover it, since a
     *     self-check would also block the safe case where other admins
     *     remain.
     *
     * `canModerate()`'s own docblock anticipated exactly this: it exists
     * as one shared private method so "a future rule that must differ
     * between them has one obvious place to fork from." This is that fork.
     */
    public function revokeSuperAdmin(User $actor, User $target): bool
    {
        if (! $actor->hasRole(Role::SUPER_ADMIN)) {
            return false;
        }

        return ! $this->roles->wouldOrphanAdminRoster($target);
    }

    /**
     * The super-admin-tier counterpart to `canModerate()`, for §4's
     * bottom rows. Same three clauses in the same order — role, then
     * self-exclusion, then last-admin — with `Role::SUPER_ADMIN` alone
     * standing in for `Role::ADMIN_TIER`.
     *
     * Kept as a sibling of `canModerate()` rather than folded into it
     * behind a role parameter: the two differ in exactly one clause
     * today, but they answer different questions (§4 draws a hard line
     * between the admin-tier rows and the super-admin-only rows), and a
     * single predicate taking "which roles count" as an argument would
     * invite a caller to pass `Role::ADMIN_TIER` to an erase. The
     * duplication is three lines and it is load-bearing.
     */
    private function canModerateAsSuperAdmin(User $actor, User $target): bool
    {
        if (! $actor->hasRole(Role::SUPER_ADMIN)) {
            return false;
        }

        if ($actor->id === $target->id) {
            return false;
        }

        return ! $this->roles->wouldOrphanAdminRoster($target);
    }
}
