<?php

namespace Database\Seeders;

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
 */
class RoleSeeder extends Seeder
{
    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (['super_admin', 'admin', 'coach', 'member'] as $role) {
            Role::query()->firstOrCreate(['name' => $role, 'guard_name' => 'web']);
        }

        Cache::forget('spatie.permission.cache');
    }
}
