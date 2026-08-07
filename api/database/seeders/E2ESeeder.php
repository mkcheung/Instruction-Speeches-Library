<?php

namespace Database\Seeders;

use App\Models\Profile;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Fixed ids, literal timestamps — NEVER now() (STEP-01-identity.md). This
 * seeder is explicitly expected to grow across every future step, so it is
 * structured for extension: one method per concern (users, profiles, roles
 * today; later steps add speeches/reviews/etc. as their own methods called
 * from run()), rather than one flat blob that gets harder to extend safely
 * each time.
 *
 * All four seed users share the password "password" and a fixed
 * `email_verified_at`/profile timestamp of 2026-01-01 00:00:00 UTC so the
 * fixture is byte-for-byte reproducible across every run and every
 * developer's machine.
 */
class E2ESeeder extends Seeder
{
    private const FIXTURE_TIMESTAMP = '2026-01-01 00:00:00';

    /**
     * Fixed, hardcoded user ids — deliberately outside the range
     * autoincrement would normally produce from a clean migrate, so a
     * seeded id collision with test-created users is obvious rather than
     * silent.
     */
    public const SUPER_ADMIN_ID = 9001;

    public const ADMIN_ID = 9002;

    public const COACH_ID = 9003;

    public const MEMBER_ID = 9004;

    public function run(): void
    {
        $this->call(RoleSeeder::class);

        $users = $this->seedUsers();
        $this->seedProfiles($users);
        $this->seedRoles($users);
    }

    /**
     * @return array<string, User>
     */
    private function seedUsers(): array
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $spec = [
            'super_admin' => ['id' => self::SUPER_ADMIN_ID, 'email' => 'super-admin@e2e.test', 'first_name' => 'Sadie', 'last_name' => 'Superadmin', 'username' => 'e2e-super-admin'],
            'admin' => ['id' => self::ADMIN_ID, 'email' => 'admin@e2e.test', 'first_name' => 'Adam', 'last_name' => 'Admin', 'username' => 'e2e-admin'],
            'coach' => ['id' => self::COACH_ID, 'email' => 'coach@e2e.test', 'first_name' => 'Cora', 'last_name' => 'Coach', 'username' => 'e2e-coach'],
            'member' => ['id' => self::MEMBER_ID, 'email' => 'member@e2e.test', 'first_name' => 'Milo', 'last_name' => 'Member', 'username' => 'e2e-member'],
        ];

        $users = [];

        foreach ($spec as $role => $attrs) {
            $users[$role] = User::query()->updateOrCreate(
                ['id' => $attrs['id']],
                [
                    'email' => $attrs['email'],
                    'first_name' => $attrs['first_name'],
                    'last_name' => $attrs['last_name'],
                    'username' => $attrs['username'],
                    'username_changed_at' => $timestamp,
                    'password' => Hash::make('password'),
                    'email_verified_at' => $timestamp,
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ]
            );
        }

        return $users;
    }

    /**
     * @param  array<string, User>  $users
     */
    private function seedProfiles(array $users): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        foreach ($users as $role => $user) {
            Profile::query()->updateOrCreate(
                ['user_id' => $user->id],
                [
                    'display_name' => "{$user->first_name} {$user->last_name}",
                    'bio' => "E2E fixture profile for the {$role} role.",
                    'pronouns' => null,
                    'location' => 'Fixture City',
                    'timezone' => 'UTC',
                    'locale' => 'en',
                    'onboarding_completed_at' => $timestamp,
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ]
            );
        }
    }

    /**
     * @param  array<string, User>  $users
     */
    private function seedRoles(array $users): void
    {
        foreach ($users as $role => $user) {
            $user->syncRoles([$role]);
        }
    }
}
