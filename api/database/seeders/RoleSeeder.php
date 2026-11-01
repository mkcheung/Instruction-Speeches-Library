<?php

namespace Database\Seeders;

use App\Support\Role as AppRole;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Cache;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * Four roles exactly (§7.1): `super_admin` (protected, not part of the
 * capability matrix — reserved for the operator-of-last-resort), `admin`,
 * `coach`, `member`. Lowercase per Spatie convention even though the
 * product/UI name for `member` is "Member" (§7 — chosen to avoid colliding
 * with the `users` table's own meaning of the word).
 *
 * The roles now come from the `2026_08_07_000612_create_default_roles`
 * migration, so a migrated database already has them. This seeder stays
 * because 48 test files and `DatabaseSeeder` call it; it is an idempotent
 * no-op after the migration.
 */
class RoleSeeder extends Seeder
{
    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (AppRole::ASSIGNABLE as $role) {
            Role::query()->firstOrCreate(['name' => $role, 'guard_name' => 'web']);
        }

        Cache::forget('spatie.permission.cache');
    }
}
