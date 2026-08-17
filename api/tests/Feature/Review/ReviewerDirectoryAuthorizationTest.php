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
