<?php

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Notification;
use Spatie\Permission\Models\Role;

/**
 * `2026_08_07_000612_create_default_roles` — a production database is
 * only ever migrated (`scripts/deploy.sh` never seeds), so the roles have
 * to come from a migration. Deliberately seeds nothing: every assertion
 * here is about the state `RefreshDatabase`'s plain `migrate` leaves.
 */
it('creates the four roles during migration, with no seeder run', function () {
    $roles = Role::query()->where('guard_name', 'web')->orderBy('name')->pluck('name')->all();

    expect($roles)->toBe(['admin', 'coach', 'member', 'super_admin']);
});

it('lets the first user register on a database that has only been migrated', function () {
    Notification::fake();

    $this->postJson('/register', [
        'email' => 'first@example.com',
        'password' => 'correct-horse-battery-staple',
        'password_confirmation' => 'correct-horse-battery-staple',
    ])->assertCreated();

    expect(User::query()->where('email', 'first@example.com')->firstOrFail()->hasRole('member'))->toBeTrue();
});

it('is a no-op when run again, and RoleSeeder after it adds nothing', function () {
    $migration = require database_path('migrations/2026_08_07_000612_create_default_roles.php');
    $migration->up();
    $this->seed(RoleSeeder::class);

    expect(Role::query()->count())->toBe(4);
});

it('user:grant-role names the valid roles when given an unknown one', function () {
    $this->artisan('user:grant-role', ['user' => 'nobody@example.com', 'role' => 'moderator'])
        ->expectsOutputToContain('Expected one of: member, coach, admin, super_admin')
        ->assertFailed();
});
