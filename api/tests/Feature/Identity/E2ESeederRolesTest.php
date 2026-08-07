<?php

use App\Models\User;
use Database\Seeders\E2ESeeder;

/**
 * "All four roles register, verify, onboard and log in" (STEP-01
 * acceptance list). Registration/verification/onboarding are already
 * proven role-agnostic elsewhere (nothing in CreateNewUser, the
 * verification flow, or OnboardingController branches on role), so this
 * test seeds E2ESeeder — the fixture those flows produce, frozen — and
 * proves each of the four seeded users can actually log in and is wearing
 * the role E2ESeeder assigned.
 */
it('logs in as each of the four seeded roles with a completed profile', function () {
    $this->seed(E2ESeeder::class);

    $expected = [
        E2ESeeder::SUPER_ADMIN_ID => ['email' => 'super-admin@e2e.test', 'role' => 'super_admin'],
        E2ESeeder::ADMIN_ID => ['email' => 'admin@e2e.test', 'role' => 'admin'],
        E2ESeeder::COACH_ID => ['email' => 'coach@e2e.test', 'role' => 'coach'],
        E2ESeeder::MEMBER_ID => ['email' => 'member@e2e.test', 'role' => 'member'],
    ];

    foreach ($expected as $id => ['email' => $email, 'role' => $role]) {
        $user = User::query()->find($id);

        expect($user)->not->toBeNull();
        expect($user->hasRole($role))->toBeTrue();
        expect($user->email_verified_at)->not->toBeNull();
        expect($user->profile->onboarding_completed_at)->not->toBeNull();

        $this->postJson('/login', [
            'email' => $email,
            'password' => 'password',
        ])->assertOk();

        $this->post('/logout')->assertOk();
    }
});
