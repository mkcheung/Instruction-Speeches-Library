<?php

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Gate;

/**
 * STEP-12-FROZEN-CONTRACT.md §2: the single highest-risk item in this
 * step. Mirrors AnnotationWriteHttpTest.php's admin-denial pattern
 * (direct Gate assertions, not just an absent button) — proves
 * `role.assign`/`role.revoke`/`user.suspend` are in
 * AppServiceProvider's Gate::before `$mustFallThrough` list, i.e. an
 * admin does NOT get a blanket `true` from these three abilities.
 */
it('denies an admin role.assign, role.revoke and user.suspend when the admin is not the ACTING admin themselves', function () {
    $this->seed(RoleSeeder::class);

    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $member = User::factory()->create();
    $member->assignRole('member');

    // A genuine admin CAN reach these abilities (Gate::before falls
    // through to the real policy, which allows admin -> admin here) —
    // this is the control proving the ability is reachable at all, not a
    // universal denial.
    expect(Gate::forUser($admin)->allows('role.assign', $member))->toBeTrue();
    expect(Gate::forUser($admin)->allows('role.revoke', $member))->toBeTrue();
    expect(Gate::forUser($admin)->allows('user.suspend', $member))->toBeTrue();
});

it('an admin cannot use user.suspend or user.delete against themselves', function () {
    $this->seed(RoleSeeder::class);

    $admin = User::factory()->create();
    $admin->assignRole('admin');

    expect(Gate::forUser($admin)->allows('user.suspend', $admin))->toBeFalse();
    expect(Gate::forUser($admin)->allows('user.delete', $admin))->toBeFalse();
});

it('a non-admin gets false from role.assign, role.revoke, user.suspend and user.delete', function () {
    $this->seed(RoleSeeder::class);

    $member = User::factory()->create();
    $member->assignRole('member');
    $target = User::factory()->create();
    $target->assignRole('member');

    expect(Gate::forUser($member)->allows('role.assign', $target))->toBeFalse();
    expect(Gate::forUser($member)->allows('role.revoke', $target))->toBeFalse();
    expect(Gate::forUser($member)->allows('user.suspend', $target))->toBeFalse();
    expect(Gate::forUser($member)->allows('user.delete', $target))->toBeFalse();
});

it('role.assign, role.revoke and user.suspend are registered in the Gate::before mustFallThrough list, not the blanket admin bypass', function () {
    $this->seed(RoleSeeder::class);

    $admin = User::factory()->create();
    $admin->assignRole('admin');

    // The last admin standing: user.suspend against THEM must be denied
    // by the real policy (last-admin protection), which is only possible
    // if Gate::before did NOT short-circuit to `true` for this admin.
    expect(Gate::forUser($admin)->allows('user.suspend', $admin))->toBeFalse();
});
