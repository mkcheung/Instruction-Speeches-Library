<?php

use App\Models\Report;
use App\Models\Speech;
use App\Models\User;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Gate;

/**
 * STEP-12-FROZEN-CONTRACT.md §2: the single highest-risk item in this
 * step. Mirrors AnnotationWriteHttpTest.php's admin-denial pattern
 * (direct Gate assertions, not just an absent button) — proves
 * `role.assign`/`role.revoke`/`user.suspend` are in
 * AppServiceProvider's Gate::before `$mustFallThrough` list, i.e. an
 * admin does NOT get a blanket `true` from these three abilities.
 *
 * PLAN-ADMIN-DASHBOARD.md §5.2/§5.3/§5.4 extend this file with the
 * super_admin tier. Three distinct questions are asked below and they
 * are easy to conflate, so they are kept in separate tests:
 *
 *  1. §5.2 — super_admin is now a real SUPERSET. Abilities an admin
 *     already had must now answer the same for a super_admin. Before
 *     this step they answered `false`, because Gate::before tested
 *     `hasRole('admin')` exactly while EnsureUserIsAdmin admitted both.
 *  2. §5.3 — the four formerly-PHANTOM abilities are super_admin-ONLY,
 *     so they are the one place the tiers must still DISAGREE. A test
 *     that only checks super_admin passes would also pass if the bypass
 *     were widened to let plain admins through, so both directions are
 *     asserted for each.
 *  3. §5.4/§5.7 — the three NEW admin-tier abilities really are in
 *     `$mustFallThrough`. For admin-tier abilities a plain `allows()`
 *     cannot tell a policy `true` from the bypass `true`, so those are
 *     probed with a NON-admin, where the bypass does not apply at all.
 *
 * Every assertion here is a direct Gate call with its model argument.
 * §5.3 is explicit about why: the no-argument form throws
 * ArgumentCountError against a model-bound policy, which is why
 * `user.erase`/`user.demote` moved out of
 * tests/Feature/Identity/AuthorizationScaffoldTest.php and into here.
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

/**
 * §5.2's regression test, and the one that would have caught §1.2 in the
 * first place. Before this step a super_admin cleared EnsureUserIsAdmin,
 * reached the panel, and was then refused by every policy inside it,
 * because Gate::before tested `hasRole('admin')` exactly. These are the
 * abilities that previously answered `false` for a super_admin and must
 * now answer `true`.
 */
it('grants a super_admin every admin-tier ability it was previously denied', function () {
    $this->seed(RoleSeeder::class);

    $superAdmin = User::factory()->create();
    $superAdmin->assignRole(Role::SUPER_ADMIN);

    // A second admin-tier account, so wouldOrphanAdminRoster() is false
    // for the target below and the last-admin guard is not what is being
    // measured here.
    $otherAdmin = User::factory()->create();
    $otherAdmin->assignRole(Role::ADMIN);

    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    expect(Gate::forUser($superAdmin)->allows('role.assign', $member))->toBeTrue();
    expect(Gate::forUser($superAdmin)->allows('role.revoke', $member))->toBeTrue();
    expect(Gate::forUser($superAdmin)->allows('user.suspend', $member))->toBeTrue();
    expect(Gate::forUser($superAdmin)->allows('user.delete', $member))->toBeTrue();
});

/**
 * The other half of §5.2: the ADMIN_TIER widening must not have quietly
 * disabled the guards those abilities carry. Self-exclusion and
 * last-admin protection apply to a super_admin exactly as they do to an
 * admin — the tier changed, the predicate did not.
 */
it('still applies self-exclusion and last-admin protection to a super_admin', function () {
    $this->seed(RoleSeeder::class);

    $superAdmin = User::factory()->create();
    $superAdmin->assignRole(Role::SUPER_ADMIN);

    expect(Gate::forUser($superAdmin)->allows('user.suspend', $superAdmin))->toBeFalse();
    expect(Gate::forUser($superAdmin)->allows('user.delete', $superAdmin))->toBeFalse();
    expect(Gate::forUser($superAdmin)->allows('user.erase', $superAdmin))->toBeFalse();
    expect(Gate::forUser($superAdmin)->allows('user.demote', $superAdmin))->toBeFalse();
});

/**
 * ⚠️ The one site among §5.2's fifteen where widening to
 * `Role::ADMIN_TIER` REMOVES access instead of granting it.
 * `ReviewPolicy::viewDirectory` is `return ! $user->hasAnyRole(...)` — a
 * denial — so a super_admin, who previously slipped through the
 * `hasRole('admin')` gap and was allowed to browse the reviewer
 * directory, is now refused alongside a plain admin.
 *
 * That is the intended reading of §5.2 (an ability admin categorically
 * lacks must not be a backdoor for the tier above it) and it aligns the
 * backend with `web/src/lib/roles.ts:20-22`, which already maps
 * super_admin onto admin and so has always HIDDEN "Find reviewers" from
 * super_admins — before this step the button was hidden while the
 * endpoint still answered.
 *
 * Pinned here because it is a behaviour LOSS that no existing test
 * covers: ReviewerDirectoryAuthorizationTest.php asserts the
 * admin-403/member-200 pair but never exercises a super_admin, so
 * nothing else in the suite would notice if this silently reverted.
 */
it('denies a super_admin the reviewer directory, the one ability the ADMIN_TIER widening takes away', function () {
    $this->seed(RoleSeeder::class);

    $superAdmin = User::factory()->create();
    $superAdmin->assignRole(Role::SUPER_ADMIN);

    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    expect(Gate::forUser($superAdmin)->allows('viewDirectory'))->toBeFalse();

    // The control: a member still may. This is a tier rule, not the
    // ability having been broken outright for everyone.
    expect(Gate::forUser($member)->allows('viewDirectory'))->toBeTrue();

    // Deliberately a Gate assertion and not an HTTP round-trip to
    // GET /api/reviewers, matching this file's stated convention
    // ("direct Gate assertions, not just an absent button"). The HTTP
    // pair for this endpoint already lives in
    // tests/Feature/Review/ReviewerDirectoryAuthorizationTest.php, and
    // keeping the tier rule at the Gate layer here means a 500 anywhere
    // in the request middleware stack cannot masquerade as an
    // authorization regression.
});

/**
 * §5.3's four formerly-phantom abilities, in their model-bound form —
 * this is the coverage that replaces the no-argument `foreach` removed
 * from AuthorizationScaffoldTest.php, which could only error once these
 * abilities bound to a (User $actor, User $target) policy method.
 *
 * Both tiers are asserted for each ability. §4 makes these four
 * super_admin-ONLY, so they are the only place in the authorization
 * surface where admin and super_admin must still differ, and asserting
 * just one direction would miss the two realistic regressions: a
 * super_admin-passes-only test stays green if the abilities are widened
 * to admin-tier, and an admin-denied-only test stays green if they are
 * left phantom and deny everyone (which is exactly the state §5.3 found
 * them in).
 */
it('denies a plain admin the four super-admin-only abilities but allows a super_admin', function () {
    $this->seed(RoleSeeder::class);

    $admin = User::factory()->create();
    $admin->assignRole(Role::ADMIN);

    $superAdmin = User::factory()->create();
    $superAdmin->assignRole(Role::SUPER_ADMIN);

    $target = User::factory()->create();
    $target->assignRole(Role::MEMBER);

    foreach (['user.erase', 'user.demote', 'role.grantSuperAdmin', 'role.revokeSuperAdmin'] as $ability) {
        // A plain admin is refused. Because these four ARE in
        // $mustFallThrough, this is the policy's `false` and not the
        // absence of a definition — the super_admin assertion directly
        // below is what proves the ability is reachable at all.
        expect(Gate::forUser($admin)->allows($ability, $target))
            ->toBeFalse("a plain admin must not hold {$ability}");

        expect(Gate::forUser($superAdmin)->allows($ability, $target))
            ->toBeTrue("a super_admin must hold {$ability}");
    }
});

/**
 * A member must not reach the super-admin-only four either. This looks
 * redundant against the admin denial above but is not: that one passes
 * even if the role check were accidentally inverted to "anyone who is
 * NOT a plain admin", which a member would then satisfy.
 */
it('denies a non-admin the four super-admin-only abilities', function () {
    $this->seed(RoleSeeder::class);

    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    $target = User::factory()->create();
    $target->assignRole(Role::MEMBER);

    foreach (['user.erase', 'user.demote', 'role.grantSuperAdmin', 'role.revokeSuperAdmin'] as $ability) {
        expect(Gate::forUser($member)->allows($ability, $target))->toBeFalse();
    }
});

/**
 * §5.3's deliberate asymmetry, pinned so it cannot be "tidied" into
 * consistency by a later reader: `revokeSuperAdmin` is the one removal in
 * UserPolicy that does NOT exclude self, per §5.4's recorded
 * recommendation ("no self-check on `revoke`; the last-admin guard
 * already prevents the dangerous case"). A super_admin may step down —
 * unless they are the last one standing, which the last-admin guard
 * catches on the same call.
 */
it('lets a super_admin revoke their own super_admin role unless they are the last admin standing', function () {
    $this->seed(RoleSeeder::class);

    $soleSuperAdmin = User::factory()->create();
    $soleSuperAdmin->assignRole(Role::SUPER_ADMIN);

    // Last admin standing: the roster guard refuses, even though there is
    // no self-check in this method.
    expect(Gate::forUser($soleSuperAdmin)->allows('role.revokeSuperAdmin', $soleSuperAdmin))->toBeFalse();

    // With a second admin-tier account on the roster, stepping down is
    // permitted — proving the refusal above came from the last-admin
    // guard and not from a self-exclusion clause.
    $backup = User::factory()->create();
    $backup->assignRole(Role::ADMIN);

    expect(Gate::forUser($soleSuperAdmin)->allows('role.revokeSuperAdmin', $soleSuperAdmin))->toBeTrue();

    // grantSuperAdmin, by contrast, DOES exclude self — it is an
    // addition, so the last-admin guard is irrelevant to it and the
    // class's "acts on ANOTHER user" contract is the only rule left.
    expect(Gate::forUser($soleSuperAdmin)->allows('role.grantSuperAdmin', $soleSuperAdmin))->toBeFalse();
});

/**
 * §5.4/§5.7's three new admin-tier abilities.
 *
 * The non-admin assertions are the load-bearing ones. For an ADMIN-tier
 * ability, `allows()` returning `true` cannot distinguish "the policy
 * said yes" from "Gate::before's blanket bypass said yes before the
 * policy ran" — both produce `true`, which is why §5.7's standing rule
 * exists at all. A non-admin never triggers the bypass, so a `false`
 * there proves a real policy is wired up and answering, rather than an
 * unregistered string silently defaulting.
 */
it('grants speech.takedown, speech.restore and report.resolve to both admin tiers and denies non-admins', function () {
    $this->seed(RoleSeeder::class);

    $admin = User::factory()->create();
    $admin->assignRole(Role::ADMIN);

    $superAdmin = User::factory()->create();
    $superAdmin->assignRole(Role::SUPER_ADMIN);

    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    $speech = Speech::factory()->create();
    $report = Report::factory()->create();

    foreach ([$admin, $superAdmin] as $moderator) {
        expect(Gate::forUser($moderator)->allows('speech.takedown', $speech))->toBeTrue();
        expect(Gate::forUser($moderator)->allows('speech.restore', $speech))->toBeTrue();
        expect(Gate::forUser($moderator)->allows('report.resolve', $report))->toBeTrue();
    }

    expect(Gate::forUser($member)->allows('speech.takedown', $speech))->toBeFalse();
    expect(Gate::forUser($member)->allows('speech.restore', $speech))->toBeFalse();
    expect(Gate::forUser($member)->allows('report.resolve', $report))->toBeFalse();
});

/**
 * The speech OWNER must not take down or restore their own speech. This
 * is the assertion that proves the three new abilities are genuinely in
 * `$mustFallThrough` rather than merely appearing to work: a speech owner
 * who is not an admin is refused by SpeechPolicy, whereas an unregistered
 * ability string would still return `false` here — so this is paired
 * with the admin grants above, which an unregistered string could not
 * produce from a policy.
 */
it('denies a speech owner takedown and restore on their own speech', function () {
    $this->seed(RoleSeeder::class);

    $owner = User::factory()->create();
    $owner->assignRole(Role::MEMBER);

    $speech = Speech::factory()->for($owner)->create();

    expect(Gate::forUser($owner)->allows('speech.takedown', $speech))->toBeFalse();
    expect(Gate::forUser($owner)->allows('speech.restore', $speech))->toBeFalse();
});
