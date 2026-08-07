<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Spatie\Permission\Models\Role;

/**
 * Role assignment has no admin UI until S12 (STEP-01-identity.md) — this
 * command IS the S1 mechanism, not a placeholder for one.
 *
 * Usage: php artisan user:grant-role {user} {role}
 *   {user} may be a numeric id or an email address.
 */
class GrantRoleCommand extends Command
{
    protected $signature = 'user:grant-role {user : User id or email} {role : super_admin|admin|coach|member}';

    protected $description = 'Grant a role to a user (the S1 substitute for an admin UI, per STEP-01-identity.md).';

    public function handle(): int
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

        $user->syncRoles([$roleName]);

        $this->info("Granted role \"{$roleName}\" to {$user->email} (id {$user->id}).");

        return self::SUCCESS;
    }
}
