<?php

use App\Models\Connection;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Gate;

/**
 * STEP-13-FROZEN-CONTRACT.md §11: mirrors
 * tests/Feature/Admin/AdminAbilityDenialTest.php's pattern — direct Gate
 * assertions proving `connection.block` is in AppServiceProvider's
 * Gate::before `$mustFallThrough` list, i.e. an admin does NOT get a
 * blanket `true` here. This is the exact bug class §11 says has happened
 * twice before in this project's history (STEP-05 rev2, a STEP-12
 * `/code-review` finding): a new Gate::define with no matching
 * `$mustFallThrough` entry.
 */
it('an admin is denied connection.block, unlike an ordinary party to the connection', function () {
    $this->seed(RoleSeeder::class);

    $a = User::factory()->create();
    $a->assignRole('member');
    $b = User::factory()->create();
    $b->assignRole('member');
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $connection = Connection::factory()->create(['owner_id' => $a->id, 'peer_id' => $b->id]);

    // The blanket admin bypass must NOT grant this — an Admin is never a
    // party to a connection, the same categorical rule as "an Admin never
    // acts as a reviewer" (§7.1).
    expect(Gate::forUser($admin)->allows('connection.block', $connection))->toBeFalse();

    // Control: an actual party to the connection CAN reach the ability —
    // proves the denial above is the admin-specific branch, not a broken
    // policy method.
    expect(Gate::forUser($a)->allows('connection.block', $connection))->toBeTrue();
    expect(Gate::forUser($b)->allows('connection.block', $connection))->toBeTrue();
});

it('a stranger to the connection is denied connection.block', function () {
    $this->seed(RoleSeeder::class);

    $a = User::factory()->create();
    $a->assignRole('member');
    $b = User::factory()->create();
    $b->assignRole('member');
    $stranger = User::factory()->create();
    $stranger->assignRole('member');

    $connection = Connection::factory()->create(['owner_id' => $a->id, 'peer_id' => $b->id]);

    expect(Gate::forUser($stranger)->allows('connection.block', $connection))->toBeFalse();
});
