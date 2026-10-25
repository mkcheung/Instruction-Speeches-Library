<?php

use App\Models\User;
use Database\Seeders\RoleSeeder;

/**
 * PLAN-APP-HEADER.md S4: ReviewPolicy::viewDirectory was dead code (P2) —
 * ReviewerDirectoryController::index made no authorization call at all,
 * despite the policy already encoding §7.1's rule that an Admin may never
 * browse the reviewer directory.
 *
 * Both directions are asserted deliberately, in this order, per S4's own
 * warning: a test that only checks the admin-403 half also passes when the
 * `viewDirectory` ability is left undefined and Laravel denies *everyone* —
 * which is the exact bug a naive single-edit ("just add
 * Gate::authorize('viewDirectory')") would ship, since `viewDirectory`
 * isn't in Gate::before's $mustFallThrough list, so an admin's request
 * short-circuits to true UNLESS both edits (Gate::define AND
 * $mustFallThrough) are made together with the controller call.
 */
it('denies an admin and allows a member to browse the reviewer directory', function () {
    $this->seed(RoleSeeder::class);

    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $member = User::factory()->create();
    $member->assignRole('member');

    $adminResponse = $this->actingAs($admin)->getJson('/api/reviewers');
    $adminResponse->assertStatus(403);

    $memberResponse = $this->actingAs($member)->getJson('/api/reviewers');
    $memberResponse->assertOk();
});

it('excludes every administrative role combination before reviewer filtering and pagination', function () {
    $this->seed(RoleSeeder::class);
    $viewer = User::factory()->create();
    $viewer->assignRole('member');

    $members = User::factory()->count(21)->sequence(fn ($sequence) => [
        'first_name' => 'Directory', 'last_name' => 'Member', 'username' => 'directory-member-'.$sequence->index,
    ])->create();
    $coaches = User::factory()->count(21)->sequence(fn ($sequence) => [
        'first_name' => 'Directory', 'last_name' => 'Coach', 'username' => 'directory-coach-'.$sequence->index,
    ])->create();
    foreach ($members as $member) {
        $member->assignRole('member');
    }
    foreach ($coaches as $coach) {
        $coach->assignRole('coach');
    }

    foreach ([['admin'], ['super_admin'], ['member', 'admin'], ['coach', 'admin'], ['member', 'super_admin'], ['coach', 'super_admin']] as $index => $roles) {
        $administrative = User::factory()->create([
            'first_name' => 'Directory', 'last_name' => 'Administrative', 'username' => 'directory-admin-'.$index,
        ]);
        $administrative->assignRole($roles);
    }

    // Existing first/last/username LIKE matching stays intact. A lowercase
    // query also matches the normalized lowercase username on either driver.
    foreach ([null, 'Directory', 'directory', 'rectory'] as $search) {
        foreach ([null, 'member', 'coach'] as $credential) {
            $expected = match ($credential) {
                'member' => $members,
                'coach' => $coaches,
                default => $members->concat($coaches),
            };
            $parameters = array_filter(['search' => $search, 'credential' => $credential], fn ($value) => $value !== null);
            $first = $this->actingAs($viewer)->getJson('/api/reviewers?'.http_build_query($parameters))
                ->assertOk()->assertJsonCount(20, 'reviewers')
                ->assertJsonPath('meta.total', $expected->count());
            $listed = collect($first->json('reviewers'));
            for ($page = 2; $page <= $first->json('meta.last_page'); $page++) {
                $response = $this->getJson('/api/reviewers?'.http_build_query($parameters + ['page' => $page]))
                    ->assertOk()->assertJsonPath('meta.total', $expected->count());
                $listed = $listed->concat($response->json('reviewers'));
            }
            expect($listed->pluck('id')->sort()->values()->all())->toBe($expected->pluck('id')->sort()->values()->all());
        }
    }
});
