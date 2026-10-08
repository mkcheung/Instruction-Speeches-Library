<?php

namespace App\Support;

/**
 * PLAN-ADMIN-DASHBOARD.md §5.2. Role names were bare string literals across
 * 15 files (25 non-comment lines, 35 occurrences) before this class — and
 * that drift is exactly what produced the `super_admin` split this step
 * exists to fix: `EnsureUserIsAdmin` admitted `['admin','super_admin']`
 * while `Gate::before` and all 15 policy sites tested `hasRole('admin')`
 * alone, so a super_admin entered the panel and was then denied every
 * action inside it.
 *
 * `spatie/laravel-permission` applies NO hierarchy, and the roles never
 * stack (`GrantRoleCommand` and `E2ESeeder` both use `syncRoles`), so
 * "super_admin is a superset of admin" is not something the package gives
 * us — it has to be written at every call site. `ADMIN_TIER` is that
 * statement, in one place.
 *
 * Names must match `database/seeders/RoleSeeder.php:23` exactly; that
 * seeder is the only thing that creates these rows.
 */
final class Role
{
    public const SUPER_ADMIN = 'super_admin';

    public const ADMIN = 'admin';

    public const COACH = 'coach';

    public const MEMBER = 'member';

    /**
     * Both administrative roles, for `hasAnyRole()` checks. This is THE
     * replacement for a bare `hasRole('admin')` anywhere the question is
     * "does this actor hold administrative power" — per §4's matrix,
     * super_admin is a strict superset of admin for every capability
     * except the four it alone holds (role grants, erase, audit log,
     * system health), and those are gated on SUPER_ADMIN directly.
     *
     * @var list<string>
     */
    public const ADMIN_TIER = [self::ADMIN, self::SUPER_ADMIN];

    /**
     * Roles an admin-tier actor may assign or revoke through
     * `RoleAssignmentService`. §5.4: that service had no allowlist at all,
     * so an admin could self-assign `super_admin`. `coach` must stay in
     * this list — `CoachApplicationDecisionService::approve()` assigns it
     * and `RoleAssignmentServiceTest.php:23` pins that.
     *
     * Note this does NOT cover `GrantRoleCommand`, which calls
     * `syncRoles()` directly and bypasses the service entirely.
     *
     * @var list<string>
     */
    public const ASSIGNABLE = [self::MEMBER, self::COACH, self::ADMIN, self::SUPER_ADMIN];

    /**
     * Roles only a `super_admin` may grant or revoke (§4). A plain admin
     * assigning `admin` would let any admin mint peers; assigning
     * `super_admin` would let them escalate past their own tier.
     *
     * @var list<string>
     */
    public const SUPER_ADMIN_ONLY_GRANTS = [self::ADMIN, self::SUPER_ADMIN];

    private function __construct() {}
}
