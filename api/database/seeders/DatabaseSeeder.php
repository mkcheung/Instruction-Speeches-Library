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
     * php artisan user:grant-role checks roles exist) — always run. E2ESeeder
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
