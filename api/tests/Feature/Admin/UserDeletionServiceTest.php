<?php

use App\Exceptions\LastAdministratorException;
use App\Models\User;
use App\Services\UserDeletionService;
use Database\Seeders\RoleSeeder;
use Symfony\Component\HttpKernel\Exception\HttpException;

it('suspends and unsuspends a user', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $member = User::factory()->create();
    $member->assignRole('member');

    app(UserDeletionService::class)->suspend($admin, $member);
    expect($member->fresh()->suspended_at)->not->toBeNull();

    app(UserDeletionService::class)->unsuspend($admin, $member);
    expect($member->fresh()->suspended_at)->toBeNull();
});

it('soft-deletes a user with a 30-day-grace deleted_at stamp, reversible via restore', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $member = User::factory()->create();
    $member->assignRole('member');

    app(UserDeletionService::class)->softDelete($admin, $member);
    expect($member->fresh()->deleted_at)->not->toBeNull();

    app(UserDeletionService::class)->restore($admin, $member);
    expect($member->fresh()->deleted_at)->toBeNull();
});

it('refuses to suspend the last standing admin even from a distinct actor', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $actor = User::factory()->create();
    $actor->assignRole('member');

    expect(fn () => app(UserDeletionService::class)->suspend($actor, $admin))
        ->toThrow(LastAdministratorException::class);
});

it('refuses self-suspend regardless of admin count', function () {
    // Found by /code-review's line-by-line diff angle: unlike
    // softDelete(), suspend() had no self-exclusion check at all, so an
    // admin could suspend themselves through the Filament UI (which never
    // calls Gate::authorize()) even though UserPolicy::suspend() denies
    // exactly that. This pins the fix at the service layer, mirroring
    // "refuses self-soft-delete regardless of admin count" below.
    $this->seed(RoleSeeder::class);
    $admin1 = User::factory()->create();
    $admin1->assignRole('admin');
    $admin2 = User::factory()->create();
    $admin2->assignRole('admin');

    expect(fn () => app(UserDeletionService::class)->suspend($admin1, $admin1))
        ->toThrow(HttpException::class);
});

it('refuses to soft-delete the last standing admin even from a distinct actor', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $actor = User::factory()->create();
    $actor->assignRole('member');

    expect(fn () => app(UserDeletionService::class)->softDelete($actor, $admin))
        ->toThrow(LastAdministratorException::class);
});

it('refuses self-soft-delete regardless of admin count', function () {
    $this->seed(RoleSeeder::class);
    $admin1 = User::factory()->create();
    $admin1->assignRole('admin');
    $admin2 = User::factory()->create();
    $admin2->assignRole('admin');

    expect(fn () => app(UserDeletionService::class)->softDelete($admin1, $admin1))
        ->toThrow(HttpException::class);
});

it('caps bulk moderation at 25 targets per call', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $targets = User::factory()->count(26)->create()->all();
    foreach ($targets as $t) {
        $t->assignRole('member');
    }

    expect(fn () => app(UserDeletionService::class)->suspendMany($admin, $targets))
        ->toThrow(InvalidArgumentException::class);
});

it('the concurrency race: two deletes at the last two admins leaves exactly one standing (sqlite single-process approximation)', function () {
    $this->seed(RoleSeeder::class);
    $admin1 = User::factory()->create();
    $admin1->assignRole('admin');
    $admin2 = User::factory()->create();
    $admin2->assignRole('admin');

    $service = app(UserDeletionService::class);
    $survivors = 0;
    $blocked = 0;

    foreach ([$admin1, $admin2] as $target) {
        try {
            $service->softDelete($target->id === $admin1->id ? $admin2 : $admin1, $target);
            $survivors++;
        } catch (LastAdministratorException) {
            $blocked++;
        }
    }

    expect($survivors)->toBe(1);
    expect($blocked)->toBe(1);
});
