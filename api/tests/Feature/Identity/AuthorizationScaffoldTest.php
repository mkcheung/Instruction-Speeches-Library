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

    // Gate::before deferring (returning null) means Gate::allows() falls
    // through to the real policy — proving the exclusion actually
    // excludes, rather than proving anything about the operation itself.
    //
    // 'review.accept' was dropped from this list in STEP-05, 'user.delete'
    // in STEP-12, and 'user.erase'/'user.demote' here in STEP-16, all for
    // the identical reason: each now has a real, MODEL-BOUND policy method
    // registered via Gate::define, so calling e.g.
    // Gate::allows('user.erase') with no target-User argument is a usage
    // error rather than a meaningful assertion. PLAN-ADMIN-DASHBOARD.md
    // §5.3 names this precisely — the call "throws ArgumentCountError —
    // it errors rather than failing an assertion", which is strictly worse
    // than a red assertion because it reads as a broken test rather than a
    // broken invariant. (Verified before this edit: the run errored with
    // "Too few arguments to function App\Policies\UserPolicy::erase(), 1
    // passed ... and exactly 2 expected".) Model-bound coverage for all
    // four lives in tests/Feature/Admin/AdminAbilityDenialTest.php.
    //
    // 'viewDirectory' is what remains, and it is now the ONLY member of
    // $mustFallThrough whose policy signature takes no model at all
    // (ReviewPolicy::viewDirectory(User $user)) — every other entry binds
    // a Review, Speech, User, Connection or Report. So it is the only
    // ability that can still make this specific assertion, which is worth
    // keeping distinct from the model-bound file: this test pins the
    // SHAPE of Gate::before (an excluded string is not short-circuited),
    // not any policy's rule. If a future step gives viewDirectory a model
    // argument, this assertion must move too rather than be deleted.
    expect(Gate::forUser($admin)->allows('viewDirectory'))->toBeFalse();
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
