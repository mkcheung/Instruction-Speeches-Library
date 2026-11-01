<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * RoleSeeder and ReservedUsernameSeeder are data every environment
     * needs to function at all (registration checks reserved_usernames;
     * php artisan user:grant-role checks roles exist) — always run. The
     * roles also come from the 2026_08_07_000612_create_default_roles
     * migration, so RoleSeeder is an idempotent no-op on a migrated
     * database; reserved usernames still come only from here. E2ESeeder
     * is opt-in (`php artisan db:seed --class=E2ESeeder`) since it creates
     * concrete demo accounts with a known password, deliberately not part
     * of the default chain.
     */
    public function run(): void
    {
        $this->call([
            RoleSeeder::class,
            ReservedUsernameSeeder::class,
        ]);
    }
}
