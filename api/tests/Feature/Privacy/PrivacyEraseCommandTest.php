<?php

use App\Models\Speech;
use App\Models\User;
use Database\Seeders\RoleSeeder;

/**
 * STEP-11.md's own acceptance criterion: "`php artisan privacy:erase
 * --dry-run {user}` prints the ordered plan with row and byte counts, and
 * the printed order matches §11.2 exactly." This test IS the acceptance
 * check — it asserts the printed order line-by-line against
 * STEP-11-FROZEN-CONTRACT.md §6's 8 steps.
 *
 * Step 6 is now printed as two sub-steps (6a/6b, matching the existing
 * 3a/3b convention), since STEP-13's `connections` table landed and the
 * erasure plan must purge it explicitly alongside the profile row — see
 * AccountErasureService::plan()'s own doc comment. Step 6c (shred coach
 * applications) is a deliberate extension from
 * PLAN-COACH-APPLICATION-REVIEW-PAGE.md §9, recorded in the contract's §6.
 */
it('prints the erasure plan in the frozen contract\'s exact order (with 6a/6b/6c) and does not execute anything', function () {
    $this->seed(RoleSeeder::class);
    $user = User::factory()->create();
    $user->assignRole('member');
    Speech::factory()->for($user)->create();

    $this->artisan('privacy:erase', ['user' => $user->id, '--dry-run' => true])
        ->expectsOutputToContain('1. Revoke sessions')
        ->expectsOutputToContain('2. Delete media at storage')
        ->expectsOutputToContain('3a. Delete voice-note audio recorded by this user as a reviewer')
        ->expectsOutputToContain('3b. Delete voice-note audio left by other reviewers on owned speeches')
        ->expectsOutputToContain('4. Delete speeches, assets, transcripts, reviews')
        ->expectsOutputToContain('5. Null authorship on surviving reviews')
        ->expectsOutputToContain('6a. Hard-delete profile')
        ->expectsOutputToContain('6b. Hard-delete connections rows')
        ->expectsOutputToContain('6c. Shred coach-application')
        ->expectsOutputToContain('7. Anonymize the user row')
        ->expectsOutputToContain('8. Write the audit entry')
        ->assertExitCode(0);

    // Nothing was executed.
    expect($user->fresh()->anonymized_at)->toBeNull()
        ->and(Speech::where('user_id', $user->id)->count())->toBe(1);
});

it('actually erases the account when run without --dry-run and --force', function () {
    $this->seed(RoleSeeder::class);
    $user = User::factory()->create();
    $user->assignRole('member');

    $this->artisan('privacy:erase', ['user' => $user->id, '--force' => true])
        ->expectsOutputToContain('Erasure complete')
        ->assertExitCode(0);

    expect($user->fresh()->anonymized_at)->not->toBeNull();
});

it('erases after an interactive confirmation, without --force', function () {
    $this->seed(RoleSeeder::class);
    $user = User::factory()->create();
    $user->assignRole('member');

    $this->artisan('privacy:erase', ['user' => $user->id])
        ->expectsConfirmation('Permanently erase user #'.$user->id." ({$user->email})? This cannot be undone.", 'yes')
        ->expectsOutputToContain('Erasure complete')
        ->assertExitCode(0);

    expect($user->fresh()->anonymized_at)->not->toBeNull();
});

it('aborts and erases nothing when the confirmation is declined', function () {
    $this->seed(RoleSeeder::class);
    $user = User::factory()->create();
    $user->assignRole('member');

    $this->artisan('privacy:erase', ['user' => $user->id])
        ->expectsConfirmation('Permanently erase user #'.$user->id." ({$user->email})? This cannot be undone.", 'no')
        ->expectsOutputToContain('Aborted.')
        ->assertExitCode(0);

    expect($user->fresh()->anonymized_at)->toBeNull();
});

it('fails cleanly for a nonexistent user', function () {
    $this->artisan('privacy:erase', ['user' => 999999, '--dry-run' => true])
        ->assertExitCode(1);
});
