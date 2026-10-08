<?php

use App\Exceptions\LastAdministratorException;
use App\Filament\Resources\UserResource;
use App\Filament\Resources\UserResource\Pages\ManageUsers;
use App\Filament\Resources\UserResource\Pages\ViewUser;
use App\Models\AuditLog;
use App\Models\Connection;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Notifications\AccountDeleted;
use App\Services\RoleAssignmentService;
use App\Services\UserDeletionService;
use App\Support\AuditAction;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Filament\Tables\Table;
use Illuminate\Support\Facades\Notification;
use Livewire\Livewire;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * PLAN-ADMIN-DASHBOARD.md §6.2 — "Users — finish the half-built surface."
 *
 * One file per plan section, following `PanelModerationTest.php`'s stated
 * rule ("keeping the plan's coverage in one file is what makes 'all eight
 * are closed' checkable in one place"). That file covers §5.4's eight
 * authorization holes; this one covers everything §6.2 adds:
 *
 *   - `softDelete`/`restore` row actions — the first callers of
 *     `UserDeletionService::softDelete()`/`restore()`, which had ZERO, and
 *     the first call sites of `AuditAction::USER_DELETED`/`USER_RESTORED`.
 *   - `restore()`'s new guards. §6.2's correction to rev 1 is that the
 *     method was "a bare `forceFill` with no self-check and no roster lock
 *     — it is *not* 'guarded'", so the guards get their own assertions
 *     rather than being taken on trust from the button that calls them.
 *   - `softDeleteMany()`, which §6.2 reports as having "zero callers **and
 *     zero tests**." It still has no caller (no bulk-delete button ships
 *     in v1); it no longer has zero tests.
 *   - `grantAdminRole`/`revokeAdminRole` — §4's "Grant / revoke `admin`,
 *     `super_admin`" row, and the first use of `role.grantSuperAdmin`/
 *     `role.revokeSuperAdmin` outside a direct Gate assertion.
 *   - `Pages\ViewUser` — §6.2's detail page.
 *   - The storage column and lifecycle filter on the table.
 *
 * ## Why these are Livewire tests
 *
 * Same reasoning `PanelModerationTest` records, and it is the reason §5.4's
 * eight holes survived two reviews: `EnsureUserIsAdmin` guards the ROUTE,
 * and every hole was inside an action closure BEHIND that guard. Driving
 * the component directly is the only way to assert that each closure
 * authorizes for itself instead of inheriting a middleware's word for it.
 *
 * ⚠️ A non-admin actor is used as the denial probe throughout. That is not
 * a reachable production state (the route 403s first) and is not pretending
 * to be — it is the only way to prove a `Gate::authorize` call exists
 * INSIDE the closure. §6 of this step's brief is explicit that
 * `->visible()` alone is cosmetic, so both halves are asserted separately:
 * `assertActionHidden` for the button, a real call for the Gate.
 *
 * ## Capability parity is tested on both administrative roles
 *
 * §5.2 had just finished collapsing `admin` and `super_admin` into
 * `Role::ADMIN_TIER` everywhere except §4's four super-admin-only rows, and
 * §1.2 records what the bug looked like before that: "a super_admin-only
 * account logs in, sees every table, and every moderation button fails with
 * a red toast." So every verb below is exercised as `admin` AND as
 * `super_admin` where §4 says the capability is shared, and the two role
 * grants are exercised as `super_admin` (allowed) and `admin` (denied),
 * which is the only place in this panel where the two genuinely diverge.
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);
    Filament::setCurrentPanel('admin');
    renderUserSurfaceWithoutIntl();
});

/**
 * ⚠️ ENVIRONMENT, not a test convenience, and a duplicate of
 * `PanelModerationTest::renderPanelTablesWithoutIntl()` under a different
 * name ON PURPOSE. Functions declared in a Pest test file are global once
 * PHPUnit loads the file to discover its tests, so re-declaring that exact
 * name here would be a fatal `cannot redeclare` the moment both files are
 * in the same run — and there is no shared helper file this could live in
 * that this change owns (`tests/Pest.php` is not ours to edit).
 *
 * The reason it is needed at all: `filament/support` declares `ext-intl`
 * in its own `require`, this dev host has none, and `composer install` ran
 * with `--ignore-platform-req=ext-intl` (the same flag the Dockerfile
 * passes). The production image installs intl for real, so the gap is
 * local-only — but it makes EVERY Filament table render throw
 * `RuntimeException: The "intl" PHP extension is required to use the
 * [format] method` out of `Illuminate\Support\Number::format()`.
 *
 * Two render paths reach it, hence two levers:
 *
 *  - `paginated(false)` removes the pagination component, which formats
 *    first/last/total. Pagination is noise in a three-row test.
 *  - `selectable(false)` on `ManageUsers` ALONE removes the select-all
 *    indicator, which formats `$allSelectableRecordsCount`
 *    (`tables/.../index.blade.php:813`, rendered when
 *    `$isSelectionEnabled && ($maxSelectableRecords !== 1) && $isLoaded`).
 *    `UserResource` is the only table in this panel with a `BulkAction`,
 *    so it is the only one where `$isSelectionEnabled` is ever true.
 *
 * ⚠️ `selectable(false)` and NOT `deferLoading()`, which is the lever
 * `PanelModerationTest` uses for the same blade line — and the difference
 * is load-bearing rather than stylistic. `deferLoading()` works by leaving
 * `$isLoaded` false, which ALSO means the table holds no records; that is
 * fine for a file that only calls actions, and useless for this one, which
 * asserts on rendered rows (`assertCanSeeTableRecords`,
 * `assertTableColumnFormattedStateSet`, `assertActionHasUrl`). Calling
 * `->loadTable()` to get the records back flips `$isLoaded` to true and
 * walks straight back into the intl crash. Killing `$isSelectionEnabled`
 * instead removes the branch outright, so the table can load for real.
 *
 * The cost is that `suspendSelected` is unreachable from this file. That is
 * acceptable precisely because `PanelModerationTest` already owns the bulk
 * action's coverage (§5.5/§7.4), and §6.2 adds no bulk verb — `softDelete
 * Many()` still has no button, and is driven through the service below.
 */
function renderUserSurfaceWithoutIntl(): void
{
    Table::configureUsing(function (Table $table): void {
        $table->paginated(false);

        if ($table->getLivewire() instanceof ManageUsers) {
            $table->selectable(false);
        }
    });
}

function userSurfaceAdmin(): User
{
    $admin = User::factory()->create();
    $admin->assignRole(Role::ADMIN);

    return $admin;
}

function userSurfaceSuperAdmin(): User
{
    $superAdmin = User::factory()->create();
    $superAdmin->assignRole(Role::SUPER_ADMIN);

    return $superAdmin;
}

function userSurfaceMember(): User
{
    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    return $member;
}

function userSurfaceCoach(): User
{
    $coach = User::factory()->create();
    $coach->assignRole(Role::COACH);

    return $coach;
}

/**
 * Both `UserDeletionService` and `RoleAssignmentService` guard with
 * `abort_if(...)`, so a denial arrives as Symfony's `HttpException` and the
 * STATUS is the assertion worth making: the guards deliberately answer with
 * different codes (403 for a super-admin-only tier check, 422 for a
 * self-check), and a test asserting only "it threw" would still pass if the
 * two were collapsed into one.
 *
 * ⚠️ Usable for DIRECT SERVICE CALLS ONLY — never around a `Livewire::test`
 * chain, where it silently returns null and the assertion passes for the
 * wrong reason. `Livewire\Features\SupportTesting\RequestBroker` calls
 * `withoutExceptionHandling([HttpException::class,
 * AuthorizationException::class])`, and that argument is the EXEMPTION
 * list: those two classes keep going through the real exception handler, so
 * a 403 or 422 raised inside a Livewire test becomes a rendered error
 * response and never reaches a `catch` in the test body. Every denial
 * driven through the panel below is therefore asserted on OUTCOME — no
 * state change, no audit row — which is also how `PanelModerationTest`
 * asserts its eight holes, and which is the stronger claim anyway: "the
 * write did not happen" rather than "something threw".
 */
function userSurfaceStatus(Closure $callback): ?int
{
    try {
        $callback();
    } catch (HttpException $e) {
        return $e->getStatusCode();
    }

    return null;
}

// ---------------------------------------------------------------------
// §6.2 — softDelete row action
// ---------------------------------------------------------------------

it('an admin can soft-delete a user, with the reason audited and the user notified', function () {
    Notification::fake();

    $admin = userSurfaceAdmin();
    $target = userSurfaceMember();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('softDelete')->table($target), ['reason' => 'Repeated harassment reports.']);

    $row = AuditLog::query()
        ->where('action', AuditAction::USER_DELETED)
        ->where('subject_id', $target->id)
        ->sole();

    expect($target->fresh()->deleted_at)->not->toBeNull()
        // §5.5: the reason is the whole point of the audit row for a
        // moderation verb. Asserted on the metadata, not just on the row's
        // existence — `suspendSelected` shipped with `'metadata' => []` and
        // looked audited.
        ->and($row->metadata['reason'])->toBe('Repeated harassment reports.')
        ->and($row->actor_id)->toBe($admin->id)
        ->and($row->subject_type)->toBe(User::class);

    Notification::assertSentTo($target, AccountDeleted::class);
});

it('a super_admin can soft-delete a user too (§5.2 capability parity)', function () {
    // §1.2's bug, in one assertion: before §5.2, `Gate::before` tested
    // `hasRole('admin')` exactly, so a super_admin reached this closure and
    // was denied by it. `user.delete` is in `$mustFallThrough`, so the
    // answer comes from `UserPolicy::delete` — which is `ADMIN_TIER` — and
    // not from the bypass.
    $superAdmin = userSurfaceSuperAdmin();
    $target = userSurfaceMember();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('softDelete')->table($target), ['reason' => 'Account used for spam.']);

    expect($target->fresh()->deleted_at)->not->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_DELETED)->count())->toBe(1);
});

it('a member reaching the softDelete closure is refused by the Gate, not by the route', function () {
    Notification::fake();

    $target = userSurfaceMember();

    Livewire::actingAs(userSurfaceMember())
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('softDelete')->table($target), ['reason' => 'I do not like them.']);

    expect($target->fresh()->deleted_at)->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_DELETED)->count())->toBe(0);

    Notification::assertNothingSent();
});

it('a coach reaching the softDelete closure is refused as well', function () {
    // A coach is the sharper probe of the two: coaches hold real abilities
    // in this product (`review.*`, `annotation.*`), so "has some power" is
    // not "has moderation power". `UserPolicy::canModerate` needs
    // `ADMIN_TIER`.
    $target = userSurfaceMember();

    Livewire::actingAs(userSurfaceCoach())
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('softDelete')->table($target), ['reason' => 'Student stopped replying.']);

    expect($target->fresh()->deleted_at)->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_DELETED)->count())->toBe(0);
});

it('an admin cannot soft-delete their own account through the panel', function () {
    // A second active admin exists, so the last-admin clause of
    // `canModerate()` passes and ONLY the self-exclusion can be what
    // denies this — the same probe construction `PanelModerationTest` uses
    // for hole 1.
    userSurfaceAdmin();
    $admin = userSurfaceAdmin();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('softDelete')->table($admin), ['reason' => 'Resigning.']);

    expect($admin->fresh()->deleted_at)->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_DELETED)->count())->toBe(0);
});

it('the last standing admin cannot be soft-deleted', function () {
    // "Demotion-to-zero and deletion-to-zero are the same bug"
    // (STEP-12-FROZEN-CONTRACT.md §3). Denied at the Gate here, before
    // `guardedRemoval()`'s own `LastAdministratorException` is reached —
    // both layers exist on purpose, since policies are advisory.
    $admin = userSurfaceAdmin();
    $soleOther = userSurfaceAdmin();
    $soleOther->forceFill(['suspended_at' => now()])->save();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('softDelete')->table($soleOther), ['reason' => 'Cleaning up.']);

    // `$soleOther` is suspended, so `remainingAdminCountExcluding($admin)`
    // is 0 and `$admin` is the one who may not be removed. Asserting on
    // the suspended admin keeps the fixture honest: the actor is the last
    // ELIGIBLE admin, and the target is the one whose removal is legal.
    expect($soleOther->fresh()->deleted_at)->not->toBeNull();

    Livewire::actingAs($soleOther)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('softDelete')->table($admin), ['reason' => 'Cleaning up harder.']);

    expect($admin->fresh()->deleted_at)->toBeNull();
});

it('the softDelete button is hidden for an already-deleted user, and restore is shown instead', function () {
    $admin = userSurfaceAdmin();
    $target = userSurfaceMember();
    $target->forceFill(['deleted_at' => now()])->save();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->assertActionHidden(TestAction::make('softDelete')->table($target))
        ->assertActionVisible(TestAction::make('restore')->table($target));
});

// ---------------------------------------------------------------------
// §6.2 — restore row action, and restore()'s new guards
// ---------------------------------------------------------------------

it('an admin can restore a soft-deleted user, with the reason audited', function () {
    Notification::fake();

    $admin = userSurfaceAdmin();
    $target = userSurfaceMember();
    $target->forceFill(['deleted_at' => now()])->save();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('restore')->table($target), ['reason' => 'Appeal upheld — reports were malicious.']);

    $row = AuditLog::query()
        ->where('action', AuditAction::USER_RESTORED)
        ->where('subject_id', $target->id)
        ->sole();

    expect($target->fresh()->deleted_at)->toBeNull()
        // §6.2 decided against a `suspended_by_id` column, so this row IS
        // the attribution record. If the reason or the actor is missing,
        // `ViewUser`'s history section has nothing to show.
        ->and($row->metadata['reason'])->toBe('Appeal upheld — reports were malicious.')
        ->and($row->actor_id)->toBe($admin->id);

    // Deliberately no counterpart notice — `AccountDeleted`'s docblock
    // states the decision and `toggleSuspend` is the precedent: §5.5's
    // notification duty attaches to the ADVERSE decision, and a
    // reinstatement announces itself the moment the person can sign in.
    Notification::assertNothingSent();
});

it('a super_admin can restore too', function () {
    $target = userSurfaceMember();
    $target->forceFill(['deleted_at' => now()])->save();

    Livewire::actingAs(userSurfaceSuperAdmin())
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('restore')->table($target), ['reason' => 'Mistaken identity.']);

    expect($target->fresh()->deleted_at)->toBeNull();
});

it('a member reaching the restore closure is refused by the Gate', function () {
    $target = userSurfaceMember();
    $target->forceFill(['deleted_at' => now()])->save();

    Livewire::actingAs(userSurfaceMember())
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('restore')->table($target), ['reason' => 'Letting my friend back in.']);

    expect($target->fresh()->deleted_at)->not->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_RESTORED)->count())->toBe(0);
});

it('restore() refuses a self-restore — guard 1, the self-check §6.2 left open', function () {
    // §6.2: "`restore()` is a bare `forceFill` with no self-check and no
    // roster lock — it is *not* 'guarded'. Add guards before wiring a
    // button to it." This is the first of the two guards that landed.
    //
    // ⚠️ Driven through the SERVICE, not the panel, and that is the point.
    // `CheckUserIsActive` logs out any user with `deleted_at` set, so a
    // soft-deleted operator can never be the actor through the UI — the
    // check earns its line against the next caller (an artisan command, a
    // queued job), neither of which passes through the session stack or
    // the Gate. 422 matches `suspend()`/`softDelete()`'s own self-checks.
    $admin = userSurfaceAdmin();
    $admin->forceFill(['deleted_at' => now()])->save();

    $status = userSurfaceStatus(fn () => app(UserDeletionService::class)->restore($admin, $admin));

    expect($status)->toBe(422)
        ->and($admin->fresh()->deleted_at)->not->toBeNull();
});

it('restore() does NOT refuse the last admin — guard 2 is a lock, never a roster re-count', function () {
    // The decision §6.2's docblock records at length, asserted so a future
    // "make restore consistent with softDelete" change cannot land
    // silently. Routing `restore()` through `guardedRemoval()` would throw
    // `LastAdministratorException` exactly when restoring an administrator
    // is most obviously correct — `wouldOrphanAdminRoster($target)` is true
    // for the only remaining admin — so the shared guard is the WRONG one
    // here and `guardedAddition()` exists to take the same lock without
    // that throw.
    $superAdmin = userSurfaceSuperAdmin();
    $soleAdmin = userSurfaceAdmin();
    $soleAdmin->forceFill(['deleted_at' => now()])->save();

    // `$soleAdmin` is soft-deleted, so `remainingAdminCountExcluding()`
    // skips them; the acting super_admin is deliberately a different
    // person, since `restore()`'s self-check (above) owns that case.
    app(UserDeletionService::class)->restore($superAdmin, $soleAdmin);

    expect($soleAdmin->fresh()->deleted_at)->toBeNull();
});

it('a soft-deleted sole administrator CAN be restored through the panel', function () {
    // ⚠️ The test that turns the `restore` action's longest comment from an
    // argument into a fact. That action authorizes `user.delete` — there is
    // no `user.restore` ability — and `UserPolicy::delete()`'s third clause
    // is `! wouldOrphanAdminRoster($target)`, i.e. "would REMOVING this
    // user zero the admin roster", which is not a question a restoration
    // asks and reads as if it should refuse here.
    //
    // It cannot refuse, because `remainingAdminCountExcluding($target)`
    // counts the ACTOR: the actor must be admin-tier to pass the first
    // clause, and alive and unsuspended to hold a session at all (§5.1's
    // `CheckUserIsActive`), so the count is never below 1 on this path.
    // That reasoning is load-bearing for the decision not to widen the
    // Gate, and reasoning is exactly what a test should replace.
    $admin = userSurfaceAdmin();
    $deletedAdmin = userSurfaceAdmin();
    $deletedAdmin->forceFill(['deleted_at' => now()])->save();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('restore')->table($deletedAdmin), ['reason' => 'Wrongly removed during the incident.']);

    expect($deletedAdmin->fresh()->deleted_at)->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_RESTORED)->count())->toBe(1);
});

it('softDeleteMany caps the batch at 25 and is all-or-nothing on the cap', function () {
    // §6.2: `softDeleteMany` had "zero callers **and zero tests**." It
    // still has no caller — no bulk-delete button ships in v1, matching
    // §10's "v1 is the non-negotiable list" — but the cap is a public
    // contract (`BULK_DELETE_CAP`) and an untested one was how the method
    // came to be described as guarded.
    $admin = userSurfaceAdmin();
    $targets = User::factory()->count(UserDeletionService::BULK_DELETE_CAP + 1)->create()->values()->all();

    expect(fn () => app(UserDeletionService::class)->softDeleteMany($admin, $targets))
        ->toThrow(InvalidArgumentException::class);

    // `guardedBulk()` checks the cap BEFORE the loop, so an over-cap call
    // must delete nobody — a cap enforced inside the loop would leave the
    // first 25 deleted and throw on the 26th.
    expect(User::query()->whereNotNull('deleted_at')->count())->toBe(0);
});

it('softDeleteMany soft-deletes every target under the cap', function () {
    $admin = userSurfaceAdmin();
    $targets = User::factory()->count(3)->create()->values()->all();

    app(UserDeletionService::class)->softDeleteMany($admin, $targets);

    expect(User::query()->whereNotNull('deleted_at')->count())->toBe(3);
});

it('a bulk batch is all-or-nothing on the LAST-ADMIN guard too, not only on the cap', function () {
    // The cap test above passes trivially, because the cap is checked
    // before any write. The last-admin guard is the case that was broken:
    // `guardedBulk()` called a per-target `guardedRemoval()`, each opening
    // its OWN transaction, so a throw on target N committed targets
    // 1..N-1 and rolled back nothing.
    //
    // That is not an abstract atomicity preference. `UserResource::
    // suspendSelected` writes its `USER_SUSPENDED` audit rows and sends
    // its `AccountSuspended` notices AFTER `suspendMany()` returns, so a
    // partial batch suspended people with NO audit row and NO notice —
    // reintroducing, through the bulk path, exactly the §5.5/§5.7 defect
    // the single-user path was changed to close.
    $admin = userSurfaceAdmin();
    $soleOtherAdmin = userSurfaceSuperAdmin();

    // Ordered so two ordinary targets land BEFORE the one that throws.
    // Reversed, the test would pass even against the broken version.
    $first = userSurfaceMember();
    $second = userSurfaceMember();

    // Suspending the sole remaining super_admin empties the roster once
    // `$admin` is excluded... it does not, `$admin` is still eligible — so
    // strip `$admin`'s own eligibility first by making the senior account
    // the only one the re-count can see.
    $admin->forceFill(['suspended_at' => now()])->save();

    expect(fn () => app(UserDeletionService::class)->suspendMany($admin, [$first, $second, $soleOtherAdmin]))
        ->toThrow(LastAdministratorException::class);

    expect($first->fresh()->suspended_at)->toBeNull()
        ->and($second->fresh()->suspended_at)->toBeNull()
        ->and($soleOtherAdmin->fresh()->suspended_at)->toBeNull();
});

// ---------------------------------------------------------------------
// §4 / §6.2 — grant and revoke admin | super_admin (super_admin only)
// ---------------------------------------------------------------------

it('a super_admin can grant the admin role, and RoleAssignmentService audits it', function () {
    $superAdmin = userSurfaceSuperAdmin();
    $target = userSurfaceMember();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('grantAdminRole')->table($target), ['role' => Role::ADMIN]);

    $row = AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->sole();

    expect($target->fresh()->hasRole(Role::ADMIN))->toBeTrue()
        // §5.7 moved this write out of the caller and INTO the service, so
        // exactly one row exists. Two would mean the old caller-side write
        // came back.
        ->and($row->metadata['role'])->toBe(Role::ADMIN)
        ->and($row->actor_id)->toBe($superAdmin->id)
        ->and($row->subject_id)->toBe($target->id);
});

it('a super_admin can grant super_admin — §5.3 says there was no path to this at all', function () {
    // `role.grantSuperAdmin` sat in `$mustFallThrough` since STEP-12 with
    // no `Gate::define`, and an unregistered ability excluded from the
    // bypass denies everyone: "there is no path to grant `super_admin` at
    // all." Phase 1 gave it a body; this asserts it now has a caller.
    $superAdmin = userSurfaceSuperAdmin();
    $target = userSurfaceAdmin();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('grantAdminRole')->table($target), ['role' => Role::SUPER_ADMIN]);

    expect($target->fresh()->hasRole(Role::SUPER_ADMIN))->toBeTrue();
});

it('a plain admin cannot grant an administrative role — neither the button nor the closure', function () {
    // §6 of this step's brief, in one test, and the two halves are asserted
    // SEPARATELY because they are different claims:
    //
    //  1. `assertActionHidden` — the button is not offered. Ergonomics.
    //  2. A CRAFTED mount — the closure refuses anyway. Enforcement.
    //
    // ⚠️ Step 2 cannot use `callAction()`: that helper asserts the action
    // is visible before calling it, so it would fail on the hidden button
    // and prove nothing about the Gate. `mountAction()` +
    // `callMountedAction()` is the honest reproduction of a tampered
    // Livewire payload, and it reproduces it EXACTLY — Filament's runtime
    // `InteractsWithActions::mountAction()` checks `isDisabled()` and never
    // `isVisible()`, which is precisely why §8.2 says visibility alone is
    // cosmetic and why the in-closure `Gate::authorize` is load-bearing.
    $admin = userSurfaceAdmin();
    $target = userSurfaceMember();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->assertActionHidden(TestAction::make('grantAdminRole')->table($target));

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->mountAction(TestAction::make('grantAdminRole')->table($target))
        ->fillForm(['role' => Role::ADMIN])
        ->callMountedAction();

    expect($target->fresh()->hasRole(Role::ADMIN))->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->count())->toBe(0);
});

it('the grant closure denies a super_admin granting to themselves, with the button fully visible', function () {
    // The companion to the crafted-payload probe above, and the one that
    // proves the Gate runs on the HAPPY path too. Here `->visible()` passes
    // (the actor IS a super_admin, which is all that closure tests), the
    // action mounts normally through `callAction`, and the ONLY thing that
    // can refuse is `UserPolicy::grantSuperAdmin`'s self-exclusion. Without
    // the `Gate::authorize` line in the closure, this grant would land.
    $superAdmin = userSurfaceSuperAdmin();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->assertActionVisible(TestAction::make('grantAdminRole')->table($superAdmin))
        ->callAction(TestAction::make('grantAdminRole')->table($superAdmin), ['role' => Role::ADMIN]);

    expect($superAdmin->fresh()->hasRole(Role::ADMIN))->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->count())->toBe(0);
});

it('the grant button IS visible to a super_admin', function () {
    // The complement of the hidden assertion above. Without this, a
    // `->visible(fn () => false)` typo would make the denial test pass for
    // entirely the wrong reason.
    $target = userSurfaceMember();

    Livewire::actingAs(userSurfaceSuperAdmin())
        ->test(ManageUsers::class)
        ->assertActionVisible(TestAction::make('grantAdminRole')->table($target));
});

it('a member cannot grant an administrative role', function () {
    $target = userSurfaceMember();

    Livewire::actingAs(userSurfaceMember())
        ->test(ManageUsers::class)
        ->mountAction(TestAction::make('grantAdminRole')->table($target))
        ->fillForm(['role' => Role::SUPER_ADMIN])
        ->callMountedAction();

    expect($target->fresh()->hasRole(Role::SUPER_ADMIN))->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->count())->toBe(0);
});

it('a tampered role of coach is refused — the §0/Q0 certification bypass', function () {
    // ⚠️ THE test for the one line standing between a tampered Livewire
    // payload and the certification-review rule. `RoleAssignmentService`'s
    // allowlist ACCEPTS `coach` (it must —
    // `CoachApplicationDecisionService::approve()` depends on it), so the
    // `in_array(..., Role::SUPER_ADMIN_ONLY_GRANTS, true)` check inside the
    // action closure is the enforcement, not belt-and-braces with the
    // Select's own options.
    //
    // §0/Q0: "Only an Admin can create a Coach, and only after reviewing
    // certification PDFs the user uploaded." A prior version of
    // `UserResource` had a standalone grant-coach button with no
    // application precondition; this is the regression test for the shape
    // of that bug returning through a different door.
    // ⚠️ Asserted on OUTCOME, not on the 422 status. The `abort_if` raises
    // an `HttpException`, and `RequestBroker`'s exemption list keeps that
    // class going through the real exception handler, so inside a Livewire
    // test it becomes a rendered error response rather than something a
    // `catch` in this file can see (see `userSurfaceStatus`'s own warning).
    // "The coach role was not granted and nothing was audited" is the claim
    // that matters here anyway.
    $superAdmin = userSurfaceSuperAdmin();
    $target = userSurfaceMember();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('grantAdminRole')->table($target), ['role' => Role::COACH]);

    expect($target->fresh()->hasRole(Role::COACH))->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->count())->toBe(0);
});

it('the 422 tier guard is reachable and distinct when the service is called directly', function () {
    // The status half of the test above, asserted where it can actually be
    // observed: a direct service call, outside Livewire's exception
    // handling. §5.4's two `RoleAssignmentService` guards deliberately
    // answer with DIFFERENT codes — 403 for the super-admin-only tier
    // check, 422 for the self-check — and a test that only said "it threw"
    // would still pass if the two were collapsed into one.
    $admin = userSurfaceAdmin();
    $target = userSurfaceMember();

    expect(userSurfaceStatus(fn () => app(RoleAssignmentService::class)->assign($admin, $target, Role::SUPER_ADMIN)))
        ->toBe(403)
        ->and(userSurfaceStatus(fn () => app(RoleAssignmentService::class)->assign($admin, $admin, Role::MEMBER)))
        ->toBe(422);
});

it('a super_admin can revoke the admin role, and the service audits it', function () {
    $superAdmin = userSurfaceSuperAdmin();
    $target = userSurfaceAdmin();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('revokeAdminRole')->table($target), ['role' => Role::ADMIN]);

    $row = AuditLog::query()->where('action', AuditAction::ROLE_REVOKED)->sole();

    expect($target->fresh()->hasRole(Role::ADMIN))->toBeFalse()
        ->and($row->metadata['role'])->toBe(Role::ADMIN)
        ->and($row->actor_id)->toBe($superAdmin->id);
});

it('a plain admin cannot revoke an administrative role', function () {
    // Same two-step shape as the grant denial: the button is hidden, and a
    // crafted mount that ignores the button is still refused by the
    // closure's `Gate::authorize('role.revokeSuperAdmin', ...)`. An admin
    // able to demote peers could reduce the roster to themselves, which §4
    // treats as the same escalation as minting peers, run backwards.
    $admin = userSurfaceAdmin();
    $target = userSurfaceAdmin();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->assertActionHidden(TestAction::make('revokeAdminRole')->table($target));

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->mountAction(TestAction::make('revokeAdminRole')->table($target))
        ->fillForm(['role' => Role::ADMIN])
        ->callMountedAction();

    expect($target->fresh()->hasRole(Role::ADMIN))->toBeTrue()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_REVOKED)->count())->toBe(0);
});

it('the revoke button is hidden for a target holding no administrative role', function () {
    // The `->visible()` closure's second clause. Without it the panel
    // offers a revocation whose Select would render with zero options.
    $target = userSurfaceMember();

    Livewire::actingAs(userSurfaceSuperAdmin())
        ->test(ManageUsers::class)
        ->assertActionHidden(TestAction::make('revokeAdminRole')->table($target));
});

it('a super_admin may step down from super_admin — revokeSuperAdmin has no self-check, by decision', function () {
    // `UserPolicy::revokeSuperAdmin`'s docblock: a self-check "would make
    // the senior tier the only role on the platform nobody can ever
    // leave," and `wouldOrphanAdminRoster($target)` covers the one
    // dangerous case better than a self-check would. A second admin exists
    // so the roster survives the step-down.
    userSurfaceAdmin();
    $superAdmin = userSurfaceSuperAdmin();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('revokeAdminRole')->table($superAdmin), ['role' => Role::SUPER_ADMIN]);

    expect($superAdmin->fresh()->hasRole(Role::SUPER_ADMIN))->toBeFalse();
});

it('revoking the last administrator is refused and the role survives', function () {
    // The `LastAdministratorException` branch, which the action catches and
    // turns into a red toast rather than Filament's raw error page. The
    // acting super_admin IS the last administrator, which is the state
    // `wouldOrphanAdminRoster` exists to refuse.
    $superAdmin = userSurfaceSuperAdmin();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('revokeAdminRole')->table($superAdmin), ['role' => Role::SUPER_ADMIN]);

    expect($superAdmin->fresh()->hasRole(Role::SUPER_ADMIN))->toBeTrue()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_REVOKED)->count())->toBe(0);
});

it('the last-admin refusal reaches the panel as LastAdministratorException, not a 500', function () {
    // The exception the action above CATCHES, asserted at its source. Every
    // closure in `UserResource` catches
    // `AuthorizationException|LastAdministratorException` so a denial
    // becomes a red toast rather than Filament's raw error page — and a
    // rename or a change of throw type in `RoleAssignmentService` would
    // turn every denial in that panel into a 500 while leaving the
    // outcome-based test above perfectly green, since "the role survives"
    // is true of a 500 too.
    $superAdmin = userSurfaceSuperAdmin();

    expect(fn () => app(RoleAssignmentService::class)->revoke($superAdmin, $superAdmin, Role::SUPER_ADMIN))
        ->toThrow(LastAdministratorException::class);
});

// ---------------------------------------------------------------------
// §6.2 — the detail page
// ---------------------------------------------------------------------

/**
 * One fixture for every detail-page assertion: a user with speeches (one
 * taken down), reviews in both directions, connections in both states, and
 * real quota numbers. Built directly rather than through the services
 * because the page under test is a READ — routing through
 * `SpeechService`/`ConnectionService` would add a second subject.
 */
function userSurfaceSubject(): User
{
    $subject = userSurfaceMember();
    $subject->forceFill([
        'storage_bytes_used' => 2 * 1024 * 1024 * 1024,
        'quota_bytes' => 5 * 1024 * 1024 * 1024,
        'uploads_in_flight' => 1,
    ])->save();

    Speech::factory()->count(2)->create(['user_id' => $subject->id]);
    $takenDown = Speech::factory()->create(['user_id' => $subject->id]);
    $takenDown->delete();

    $peer = userSurfaceMember();

    Review::factory()->create([
        'speech_id' => Speech::factory()->create(['user_id' => $peer->id])->id,
        'reviewer_id' => $subject->id,
        'speech_owner_id' => $peer->id,
        'status' => 'published',
    ]);
    Review::factory()->create([
        'speech_id' => Speech::factory()->create(['user_id' => $subject->id])->id,
        'reviewer_id' => $peer->id,
        'speech_owner_id' => $subject->id,
        'status' => 'invited',
    ]);

    Connection::factory()->accepted()->create(['owner_id' => $subject->id, 'peer_id' => $peer->id]);
    Connection::factory()->create(['owner_id' => $subject->id, 'peer_id' => userSurfaceMember()->id]);

    return $subject;
}

it('the detail page renders storage, quota, counts and roles for an admin', function () {
    $subject = userSurfaceSubject();

    // ⚠️ `assertSchemaComponentStateSet`, not `assertSee`. A Filament page
    // in a Livewire test renders the bare `fi-page` shell, so `assertSee`
    // on page body text passes or fails for reasons unrelated to the
    // schema. Asserting the component's resolved STATE is what actually
    // pins the numbers this page exists to show.
    Livewire::actingAs(userSurfaceAdmin())
        ->test(ViewUser::class, ['record' => $subject->getKey()])
        ->assertSchemaComponentStateSet('storage_bytes_used', '2.0 GiB')
        ->assertSchemaComponentStateSet('quota_bytes', '5.0 GiB')
        ->assertSchemaComponentStateSet('quota_share', '40.0%')
        ->assertSchemaComponentStateSet('uploads_in_flight', 1)
        // `Speech` DOES use `SoftDeletes`, so the live count excludes the
        // takedown and the trashed count is its own number. Conflating
        // them would make "has 3 speeches and 36 takedowns" read as "has
        // 39 speeches".
        ->assertSchemaComponentStateSet('speech_count', 3)
        ->assertSchemaComponentStateSet('taken_down_speech_count', 1)
        ->assertSchemaComponentStateSet('review_count', 1)
        ->assertSchemaComponentStateSet('granting_review_count', 1)
        ->assertSchemaComponentStateSet('reviews_received_count', 1)
        // `connections` is MIRRORED — a pair is two rows — so counting the
        // `owner_id` side is this user's own list exactly once.
        ->assertSchemaComponentStateSet('connection_count', 1)
        ->assertSchemaComponentStateSet('pending_connection_count', 1)
        // A scalar, not a one-element array: Filament resolves a
        // `TextEntry` on a relationship path to the bare value when the
        // relation yields one row, and `->badge()` renders either shape.
        ->assertSchemaComponentStateSet('roles.name', Role::MEMBER);
});

it('a super_admin can open the detail page too', function () {
    $subject = userSurfaceSubject();

    Livewire::actingAs(userSurfaceSuperAdmin())
        ->test(ViewUser::class, ['record' => $subject->getKey()])
        ->assertSchemaComponentStateSet('speech_count', 3);
});

it('a member and a coach are both refused the detail page, and an admin is not', function () {
    // §8.2 asks for TWO independent guards on this page, and both are
    // asserted here because they are enforced at different points of the
    // Livewire lifecycle and either one alone leaves a hole:
    //
    //  - `ViewUser::canAccess()` — run by
    //    `Filament\Pages\Concerns\CanAuthorizeAccess` on BOTH
    //    `mountCanAuthorizeAccess()` and `hydrateCanAuthorizeAccess()`. The
    //    hydrate half is the one that matters: `POST livewire/update` runs
    //    the `web` middleware group alone, and `AdminPanelProvider`
    //    declares its own middleware array and never uses `web`, so
    //    `EnsureUserIsAdmin` is NOT in the stack for a Livewire round trip
    //    and a page guarded only at mount stays directly addressable.
    //  - `UserResource::getViewAuthorizationResponse()` — what
    //    `ViewRecord::authorizeAccess()` consults from `mount`, and what
    //    the table's `ViewAction` consults for its own visibility.
    //
    // ⚠️ Asserted by calling the guards under each actor rather than by
    // catching a 403 from `Livewire::test()`. The abort DOES fire — a
    // denied mount renders the 403 error view instead of the page — but
    // `RequestBroker` exempts `HttpException` from
    // `withoutExceptionHandling()`, so nothing is thrown for a test to
    // catch, and a status-based assertion here would quietly pass against
    // `null` (see `userSurfaceStatus`).
    $subject = userSurfaceSubject();

    $this->actingAs(userSurfaceMember());
    expect(ViewUser::canAccess())->toBeFalse()
        ->and(UserResource::canView($subject))->toBeFalse();

    $this->actingAs(userSurfaceCoach());
    expect(ViewUser::canAccess())->toBeFalse()
        ->and(UserResource::canView($subject))->toBeFalse();

    // The positive control. Without it, a guard that denied EVERYONE would
    // pass both denials above and break the whole page.
    $this->actingAs(userSurfaceAdmin());
    expect(ViewUser::canAccess())->toBeTrue()
        ->and(UserResource::canView($subject))->toBeTrue();

    $this->actingAs(userSurfaceSuperAdmin());
    expect(ViewUser::canAccess())->toBeTrue()
        ->and(UserResource::canView($subject))->toBeTrue();
});

it('the detail page guards deny an unauthenticated caller rather than falling through to allow', function () {
    // §1.2's whole warning in one assertion: "no `viewAny` exists in
    // `app/Policies/` and Laravel's missing-method fallback is
    // `Response::allow()`." A hand-written guard that forgot its null
    // branch would reproduce that bug exactly — `auth()->user()` is null,
    // `?->hasAnyRole()` is null, and a loose check reads null as "no
    // objection".
    $subject = userSurfaceSubject();

    expect(ViewUser::canAccess())->toBeFalse()
        ->and(UserResource::canView($subject))->toBeFalse();
});

it('the detail page sources suspension and deletion history from audit_log', function () {
    // §6.2's decided answer to the missing `users.suspended_by_id` column:
    // "skip the column, read `audit_log`." This is the assertion that the
    // decision actually works end to end — the history is produced by the
    // panel's OWN moderation actions, not by hand-written fixtures, so a
    // future change that drops the audit write or its reason breaks here.
    $admin = userSurfaceAdmin();
    // ⚠️ An explicit username, because `UserFactory` defaults it to NULL —
    // the column is only populated during onboarding. The attribution
    // fallback for a real actor with no username is `user #<id>`, never
    // `system`, and a fixture that left it null would be asserting the
    // fallback rather than the normal path.
    $admin->forceFill(['username' => 'moderator_one'])->save();
    $target = userSurfaceMember();

    $panel = Livewire::actingAs($admin)->test(ManageUsers::class);
    $panel->callAction(TestAction::make('toggleSuspend')->table($target), ['reason' => 'Spam in the directory.']);
    $panel->callAction(TestAction::make('toggleSuspend')->table($target), ['reason' => 'Appeal upheld.']);
    $panel->callAction(TestAction::make('softDelete')->table($target), ['reason' => 'Did it again.']);

    $history = Livewire::actingAs($admin)
        ->test(ViewUser::class, ['record' => $target->getKey()])
        ->instance()
        ->getSchema('infolist')
        ->getFlatComponents(withHidden: true)['moderation_history']
        ->getState();

    // Newest first, with the actor and the reason on every row — the three
    // columns a moderator reviewing an appeal reads.
    expect($history)->toHaveCount(3)
        ->and($history[0]['action'])->toBe(AuditAction::USER_DELETED)
        ->and($history[0]['reason'])->toBe('Did it again.')
        ->and($history[0]['actor'])->toBe('moderator_one')
        ->and($history[1]['action'])->toBe(AuditAction::USER_UNSUSPENDED)
        ->and($history[1]['reason'])->toBe('Appeal upheld.')
        ->and($history[2]['action'])->toBe(AuditAction::USER_SUSPENDED)
        ->and($history[2]['reason'])->toBe('Spam in the directory.');
});

it('the history includes role grants with the role named, and excludes admin read-audit rows', function () {
    // Role changes ARE moderation history — §4 holds administrative grants
    // one tier ABOVE suspension — and `RoleAssignmentService::audit()`
    // records the role in `metadata`, so the rows are self-describing.
    //
    // ⚠️ The exclusion is the half worth pinning. `audit_log.action` is
    // free text (an open vocabulary), and `ADMIN_VIEWED_SPEECH` and the
    // account-export verbs ALSO carry `subject_type = User::class`. A
    // blanket "every row about this user" would bury four suspensions
    // under four hundred page views, which is why the query is an explicit
    // `whereIn` of six lifecycle constants.
    $superAdmin = userSurfaceSuperAdmin();
    $target = userSurfaceMember();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('grantAdminRole')->table($target), ['role' => Role::ADMIN]);

    AuditLog::query()->create([
        'actor_id' => $superAdmin->id,
        'action' => AuditAction::ADMIN_VIEWED_SPEECH,
        'subject_type' => User::class,
        'subject_id' => $target->id,
        'metadata' => [],
        'created_at' => now(),
    ]);

    $history = Livewire::actingAs($superAdmin)
        ->test(ViewUser::class, ['record' => $target->getKey()])
        ->instance()
        ->getSchema('infolist')
        ->getFlatComponents(withHidden: true)['moderation_history']
        ->getState();

    expect($history)->toHaveCount(1)
        ->and($history[0]['action'])->toBe(AuditAction::ROLE_ASSIGNED.' ('.Role::ADMIN.')')
        // No reason recorded on a role change — `RoleAssignmentService`
        // writes `['role' => ...]` only — so the placeholder is what a
        // moderator sees rather than a blank cell.
        ->and($history[0]['reason'])->toBe('—');
});

it('a soft-deleted user is still reachable on the detail page', function () {
    // `User` deliberately omits the `SoftDeletes` trait, so `{record}`
    // resolution has no global scope filtering `deleted_at` — and that is
    // exactly what an appeal review needs, the same reasoning §6.3 gives
    // for querying speeches `withTrashed()`. A moderator who cannot open
    // the record they just deleted cannot review the decision.
    $subject = userSurfaceSubject();
    $subject->forceFill(['deleted_at' => now()])->save();

    Livewire::actingAs(userSurfaceAdmin())
        ->test(ViewUser::class, ['record' => $subject->getKey()])
        ->assertSchemaComponentStateSet('speech_count', 3);
});

// ---------------------------------------------------------------------
// §6.2 — storage column and the lifecycle filter
// ---------------------------------------------------------------------

it('the lifecycle filter separates active, suspended, deleted and anonymized users', function () {
    // No `loadTable()` anywhere below, and that is a consequence of this
    // file's intl lever rather than an oversight: `selectable(false)`
    // leaves the table loading normally, so the records are there on the
    // initial render. A file that used `deferLoading()` instead would need
    // `loadTable()` before every assertion here — and would then crash on
    // the select-all indicator's `Number::format()`. See
    // `renderUserSurfaceWithoutIntl()`.
    $admin = userSurfaceAdmin();

    $active = userSurfaceMember();
    $suspended = userSurfaceMember();
    $suspended->forceFill(['suspended_at' => now()])->save();
    $deleted = userSurfaceMember();
    $deleted->forceFill(['deleted_at' => now()])->save();
    $anonymized = userSurfaceMember();
    $anonymized->forceFill(['anonymized_at' => now()])->save();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->filterTable('lifecycle', 'suspended')
        ->assertCanSeeTableRecords([$suspended])
        ->assertCanNotSeeTableRecords([$active, $deleted, $anonymized]);

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->filterTable('lifecycle', 'deleted')
        ->assertCanSeeTableRecords([$deleted])
        ->assertCanNotSeeTableRecords([$active, $suspended, $anonymized]);

    // `active` tests all THREE terminal states, not the two §6.2 names:
    // `CheckUserIsActive` refuses access on `suspended_at`, `deleted_at`
    // AND `anonymized_at`, so a filter calling an anonymized account
    // "active" would contradict the middleware that decides it.
    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->filterTable('lifecycle', 'active')
        ->assertCanSeeTableRecords([$active, $admin])
        ->assertCanNotSeeTableRecords([$suspended, $deleted, $anonymized]);

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->filterTable('lifecycle', 'anonymized')
        ->assertCanSeeTableRecords([$anonymized])
        ->assertCanNotSeeTableRecords([$active, $suspended, $deleted]);
});

it('the storage column renders used, quota and share from the same two integers', function () {
    // `formatBytes()` is hand-rolled because `Number::fileSize()` throws
    // without `ext-intl` — present in the production image, absent on this
    // host. Binary units (1024) match `quota_bytes`' own 5 GiB default, so
    // a full quota cannot render as "5.4 GB of 5.0 GB".
    $subject = userSurfaceMember();
    $subject->forceFill([
        'storage_bytes_used' => 2 * 1024 * 1024 * 1024,
        'quota_bytes' => 5 * 1024 * 1024 * 1024,
    ])->save();

    Livewire::actingAs(userSurfaceAdmin())
        ->test(ManageUsers::class)
        ->assertTableColumnFormattedStateSet('storage_bytes_used', '2.0 GiB / 5.0 GiB · 40.0%', $subject);
});

it('a user record can be opened from the table, and the action links to the detail page', function () {
    // The `ViewAction` is a LINK rather than a modal only because
    // `getPages()` registers a `view` key: `Page::getDefaultActionUrl()`
    // returns the resource's view URL when `hasPage('view')`. Drop that
    // registration and this silently degrades into a blank modal rendering
    // `UserResource::form()`, which is an empty schema — so the URL is the
    // assertion, not the button's presence.
    $subject = userSurfaceMember();

    Livewire::actingAs(userSurfaceAdmin())
        ->test(ManageUsers::class)
        ->assertActionHasUrl(
            TestAction::make('view')->table($subject),
            ViewUser::getUrl(['record' => $subject->getKey()]),
        );
});

it('LastAdministratorException is caught by the panel rather than escaping as a 500', function () {
    // Shape assertion rather than behaviour: every action in this file
    // catches `AuthorizationException|LastAdministratorException` so a
    // denial is a red toast, not Filament's raw error page. This pins that
    // the exception class the catches name still exists and is still what
    // the services throw — a rename would otherwise turn every denial in
    // this panel into a 500 with all the tests above still green.
    $superAdmin = userSurfaceSuperAdmin();

    expect(fn () => app(UserDeletionService::class)->softDelete($superAdmin, $superAdmin->fresh() ?? $superAdmin))
        ->toThrow(HttpException::class);

    expect(class_exists(LastAdministratorException::class))->toBeTrue();
});
