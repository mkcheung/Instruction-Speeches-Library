<?php

use App\Models\Speech;
use App\Models\User;
use App\Services\SpeechDeletionService;
use App\Support\SpeechDeletionReason;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Gate;

/**
 * IMPLEMENTATION-PLANS.md §7.5.6/§7.5.7(a): SpeechPolicy::updateDetails /
 * destroyOwn — the speaker's own edit/delete surface. Both are pure
 * ownership, with NO admin branch — the opposite of takedown()/restore()'s
 * admin-tier shape (SpeechPolicyCaptionsTest-style coverage). That property
 * is the one most worth a dedicated assertion, since getting it backwards
 * would silently let an admin edit or delete someone else's speech through
 * the ability a speaker owns alone.
 */
it('grants updateDetails/destroyOwn to the owner only, denying a non-owner and an admin alike', function () {
    $this->seed(RoleSeeder::class);

    $owner = User::factory()->create();
    $owner->assignRole('member');
    $stranger = User::factory()->create();
    $stranger->assignRole('member');
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $speech = Speech::factory()->for($owner)->create();

    expect(Gate::forUser($owner)->allows('speech.update', $speech))->toBeTrue();
    expect(Gate::forUser($owner)->allows('speech.delete', $speech))->toBeTrue();

    expect(Gate::forUser($stranger)->allows('speech.update', $speech))->toBeFalse();
    expect(Gate::forUser($stranger)->allows('speech.delete', $speech))->toBeFalse();

    // The property under test: no admin branch, anywhere. An admin removing
    // content goes through the structurally separate `speech.takedown`
    // ability, never this one.
    expect(Gate::forUser($admin)->allows('speech.update', $speech))->toBeFalse();
    expect(Gate::forUser($admin)->allows('speech.delete', $speech))->toBeFalse();
});

/**
 * IMPLEMENTATION-PLANS.md §7.5.6: `speech.update`/`speech.delete` must be in
 * AppServiceProvider's Gate::before `$mustFallThrough` list — mirrors
 * tests/Feature/Connection/ConnectionBlockAbilityDenialTest.php's pattern.
 * Without this entry, Gate::before's blanket admin bypass would grant an
 * admin `true` before SpeechPolicy::updateDetails/destroyOwn ever ran,
 * which the test immediately above alone cannot distinguish from "the
 * policy itself denies admins" — this test proves the denial comes from
 * the fall-through, not a coincidence of the two producing the same answer.
 */
it('an admin reaches speech.update/speech.delete through the real policy, not the Gate::before blanket bypass', function () {
    $this->seed(RoleSeeder::class);

    $owner = User::factory()->create();
    $owner->assignRole('member');
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $superAdmin = User::factory()->create();
    $superAdmin->assignRole('super_admin');

    $speech = Speech::factory()->for($owner)->create();

    foreach ([$admin, $superAdmin] as $adminUser) {
        expect(Gate::forUser($adminUser)->allows('speech.update', $speech))->toBeFalse();
        expect(Gate::forUser($adminUser)->allows('speech.delete', $speech))->toBeFalse();
    }
});

/**
 * code-review finding: `SpeechResource.php` (Filament)'s `restore` action
 * narrowed its `->visible()` to hide the button for an owner-deleted
 * speech, but that file's own pre-existing docblock documents that
 * Filament's `mountAction()` checks `isDisabled()` and never
 * `isVisible()` — a hidden action is still mountable via a crafted
 * request. The real enforcement has to be here, in the ability itself:
 * `SpeechPolicy::restore()` must deny ANY admin-tier user, not just hide
 * the button, when `deleted_reason === OWNER` — §7.5.2's "no restore
 * affordance for the owner in v1" is a rule about the ability, not
 * merely the UI.
 */
it('denies restore to every admin tier for an owner-deleted speech, even though the policy normally grants admin-tier', function () {
    $this->seed(RoleSeeder::class);

    $owner = User::factory()->create();
    $owner->assignRole('member');
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $superAdmin = User::factory()->create();
    $superAdmin->assignRole('super_admin');

    $speech = Speech::factory()->for($owner)->create();
    app(SpeechDeletionService::class)->deleteOwn($speech);
    $trashed = Speech::withTrashed()->findOrFail($speech->id);
    expect($trashed->deleted_reason)->toBe(SpeechDeletionReason::OWNER);

    foreach ([$admin, $superAdmin] as $adminUser) {
        expect(Gate::forUser($adminUser)->allows('speech.restore', $trashed))->toBeFalse();
    }

    // Sanity check the policy's normal admin-tier grant still holds for a
    // TAKEDOWN (or legacy-null) deletion — this test is pinning the new
    // exception, not accidentally asserting restore is now denied outright.
    $takenDown = Speech::factory()->for($owner)->create();
    $takenDown->delete();
    expect(Gate::forUser($admin)->allows('speech.restore', $takenDown))->toBeTrue();
});
