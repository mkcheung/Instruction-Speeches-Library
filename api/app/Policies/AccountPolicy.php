<?php

namespace App\Policies;

use App\Models\User;
use App\Services\RoleAssignmentService;

/**
 * STEP-12-FROZEN-CONTRACT.md §4. New class — confirmed nothing
 * `AccountErasureService`-adjacent existed to extend. Self-service rights,
 * distinct from `UserPolicy` (admin acting on someone else): `eraseSelf`
 * extends STEP-11's `App\Services\Privacy\AccountErasureService` with the
 * "unless last admin" clause §7.1's capability matrix requires — a lone
 * remaining admin must not be able to erase their own account and leave
 * the system with none.
 */
class AccountPolicy
{
    public function __construct(private readonly RoleAssignmentService $roles) {}

    public function eraseSelf(User $user): bool
    {
        return ! $this->roles->wouldOrphanAdminRoster($user);
    }
}
