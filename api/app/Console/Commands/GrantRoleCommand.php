<?php

namespace App\Console\Commands;

use App\Exceptions\LastAdministratorException;
use App\Models\User;
use App\Services\RoleAssignmentService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Role;

/**
 * Role assignment has no admin UI until S12 (STEP-01-identity.md) — this
 * command IS the S1 mechanism, not a placeholder for one. STEP-12 made
 * `RoleAssignmentService` "the ONLY legal way any role assignment/removal
 * happens in this codebase" (its own docblock), but this pre-existing
 * command was left calling `syncRoles()` directly with zero lock/recount
 * — `php artisan user:grant-role lastadmin@x.com member` could demote the
 * last admin with no protection at all, found by `/code-review`'s
 * altitude angle. Now routes through the same lock + last-admin guard
 * `RoleAssignmentService` uses, so this command can no longer bypass the
 * one invariant STEP-12 exists to hold everywhere else.
 *
 * Usage: php artisan user:grant-role {user} {role}
 *   {user} may be a numeric id or an email address.
 */
class GrantRoleCommand extends Command
{
    protected $signature = 'user:grant-role {user : User id or email} {role : super_admin|admin|coach|member}';

    protected $description = 'Grant a role to a user (the S1 substitute for an admin UI, per STEP-01-identity.md).';

    public function handle(RoleAssignmentService $roles): int
    {
        $identifier = $this->argument('user');
        $roleName = $this->argument('role');

        if (! Role::query()->where('name', $roleName)->where('guard_name', 'web')->exists()) {
            $this->error("Unknown role \"{$roleName}\". Run the RoleSeeder first.");

            return self::FAILURE;
        }

        $user = is_numeric($identifier)
            ? User::query()->find($identifier)
            : User::query()->where('email', $identifier)->first();

        if ($user === null) {
            $this->error("No user found matching \"{$identifier}\".");

            return self::FAILURE;
        }

        try {
            DB::transaction(function () use ($user, $roleName, $roles) {
                $roles->acquireAdminRosterLock();

                // This command REPLACES the role set (unlike
                // `RoleAssignmentService::assign()`, which only adds), so
                // switching a user away from admin/super_admin is a
                // removal in every sense that matters here — it must be
                // guarded exactly like `RoleAssignmentService::revoke()`
                // guards a real revoke.
                if (! in_array($roleName, ['admin', 'super_admin'], true) && $roles->wouldOrphanAdminRoster($user)) {
                    throw new LastAdministratorException;
                }

                $user->syncRoles([$roleName]);
            });
        } catch (LastAdministratorException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->info("Granted role \"{$roleName}\" to {$user->email} (id {$user->id}).");

        return self::SUCCESS;
    }
}
