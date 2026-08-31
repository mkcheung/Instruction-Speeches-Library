<?php

namespace App\Policies;

use App\Models\User;
use App\Services\RoleAssignmentService;

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
        if (! $actor->hasRole('admin')) {
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
        return $actor->hasRole('admin');
    }

    /**
     * `role.revoke` — admin-gated at the policy layer; the last-admin
     * check itself lives in `RoleAssignmentService::revoke()` (it needs
     * to know WHICH role is being revoked, which this ability alone
     * doesn't carry as a typed argument).
     */
    public function revoke(User $actor, User $target): bool
    {
        return $actor->hasRole('admin');
    }
}
