<?php

use App\Support\Role as AppRole;
use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * The four roles (§7.1) are reference data the application cannot run
 * without: `CreateNewUser` assigns `member` inside a transaction, so on a
 * database that has only been migrated every registration throws
 * `RoleDoesNotExist` and rolls back, and `user:grant-role` refuses every
 * role. They used to exist only through `RoleSeeder`, which nothing in
 * `scripts/deploy.sh` runs (PLATFORM-READINESS-REVIEW.md B3). Creating them
 * here means `php artisan migrate --force` alone yields a database that
 * can register its first user.
 *
 * Dated directly after `create_permission_tables` so every later migration
 * can rely on the roles existing; a database migrated before this file
 * existed simply runs it as a pending migration. `firstOrCreate`, so it is
 * a no-op wherever `RoleSeeder` already ran, and `RoleSeeder` stays a
 * harmless no-op after it.
 *
 * A new role needs its own migration: this file is history, and it has
 * already run on every existing database.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach ([AppRole::SUPER_ADMIN, AppRole::ADMIN, AppRole::COACH, AppRole::MEMBER] as $name) {
            Role::query()->firstOrCreate(['name' => $name, 'guard_name' => 'web']);
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    /**
     * Not reversed: deleting a role cascades through `model_has_roles`
     * (create_permission_tables), which would silently strip that role from
     * every user holding it, including the last super_admin.
     */
    public function down(): void
    {
        // Intentional no-op — see docblock above.
    }
};
