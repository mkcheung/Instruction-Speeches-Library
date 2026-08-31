<?php

use App\Exceptions\LastAdministratorException;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Services\RoleAssignmentService;
use Database\Seeders\RoleSeeder;

/**
 * STEP-12-FROZEN-CONTRACT.md §3. The sqlite-level (single-process)
 * coverage of the re-count guard; the real cross-process concurrency
 * guarantee is proven separately against Postgres by
 * scripts/verify-postgres-last-admin-lock.sh (§8).
 */
it('assigns a role via the service, never a direct assignRole()', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $member = User::factory()->create();
    $member->assignRole('member');

    app(RoleAssignmentService::class)->assign($admin, $member, 'coach');

    expect($member->fresh()->hasRole('coach'))->toBeTrue();
});

it('revokes a role from a non-last admin without throwing', function () {
    $this->seed(RoleSeeder::class);
    $admin1 = User::factory()->create();
    $admin1->assignRole('admin');
    $admin2 = User::factory()->create();
    $admin2->assignRole('admin');

    app(RoleAssignmentService::class)->revoke($admin1, $admin2, 'admin');

    expect($admin2->fresh()->hasRole('admin'))->toBeFalse();
});

it('throws LastAdministratorException when revoking the last admin would leave zero', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $actor = User::factory()->create();
    $actor->assignRole('admin'); // acting admin, distinct from target for the call shape

    // Now demote $actor first so $admin is the ONLY remaining admin.
    app(RoleAssignmentService::class)->revoke($admin, $actor, 'admin');

    expect(fn () => app(RoleAssignmentService::class)->revoke($admin, $admin, 'admin'))
        ->toThrow(LastAdministratorException::class);

    expect($admin->fresh()->hasRole('admin'))->toBeTrue();
});

it('a suspended or soft-deleted admin does not count toward the remaining-admin total', function () {
    $this->seed(RoleSeeder::class);
    $admin1 = User::factory()->create();
    $admin1->assignRole('admin');
    $admin2 = User::factory()->create(['suspended_at' => now()]);
    $admin2->assignRole('admin');

    // $admin2 is suspended, so removing $admin1's admin role would leave
    // zero ACTIVE admins even though two admin-tagged rows exist.
    expect(fn () => app(RoleAssignmentService::class)->revoke($admin1, $admin1, 'admin'))
        ->toThrow(LastAdministratorException::class);
});

it('demoting a coach leaves their reviews untouched (demotion removes reach, not history)', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $coach = User::factory()->create();
    $coach->assignRole('coach');

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $review = Review::factory()->accepted()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $coach->id,
        'speech_owner_id' => $speaker->id,
    ]);

    app(RoleAssignmentService::class)->revoke($admin, $coach, 'coach');

    expect($coach->fresh()->hasRole('coach'))->toBeFalse();
    expect(Review::query()->find($review->id))->not->toBeNull();
    expect($review->fresh()->reviewer_id)->toBe($coach->id);
});
