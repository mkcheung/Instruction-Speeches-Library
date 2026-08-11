<?php

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

/**
 * §7.2's scoped Gate::before — admin gets an unconditional yes for
 * abilities NOT in the fall-through list, and defers to the (not-yet-
 * written) policy for abilities that ARE in it. No concrete policies exist
 * yet in S1, so `Gate::allows()` against an ability nobody registered a
 * policy for returns false when Gate::before defers (returns null) — that
 * in itself proves the exclusion list actually short-circuits admin's
 * blanket yes, which is the only thing worth proving before real policies
 * exist to test against.
 */
it('lets an admin through on an arbitrary ability not in the fall-through list', function () {
    $this->seed(RoleSeeder::class);

    $admin = User::factory()->create();
    $admin->assignRole('admin');

    expect(Gate::forUser($admin)->allows('some.arbitrary.ability'))->toBeTrue();
});

it('does not grant an admin a free pass on abilities that must fall through to a real policy', function () {
    $this->seed(RoleSeeder::class);

    $admin = User::factory()->create();
    $admin->assignRole('admin');

    // No policy exists yet for these abilities, so Gate::before deferring
    // (returning null) means Gate::allows() falls back to "no policy ->
    // denied" — proving the exclusion actually excludes, not that these
    // specific operations are already safe (they aren't built yet).
    //
    // 'review.accept' was dropped from this list in STEP-05: it now has a
    // real, model-bound ReviewPolicy::accept registered via Gate::define,
    // so calling Gate::allows('review.accept') with no model argument is a
    // usage error (missing the Review), not a meaningful assertion about
    // the fall-through list. The fall-through behavior for review.accept
    // is covered for real, model-bound calls in the ReviewPolicy/
    // ReviewController tests instead.
    foreach (['user.delete', 'user.erase', 'user.demote'] as $ability) {
        expect(Gate::forUser($admin)->allows($ability))->toBeFalse();
    }
});

it('does not grant a non-admin any Gate::before shortcut', function () {
    $this->seed(RoleSeeder::class);

    $member = User::factory()->create();
    $member->assignRole('member');

    expect(Gate::forUser($member)->allows('some.arbitrary.ability'))->toBeFalse();
});

it('enables preventLazyLoading outside production', function () {
    expect(app()->isProduction())->toBeFalse();
    expect(Model::preventsLazyLoading())->toBeTrue();
});
