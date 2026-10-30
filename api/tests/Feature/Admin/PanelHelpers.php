<?php

use App\Filament\Resources\UserResource\Pages\ManageUsers;
use App\Models\User;
use App\Support\FilamentMfaStamp;
use App\Support\Role;
use Filament\Tables\Table;

/*
 * Shared panel-test helpers, loaded with `require_once` by
 * `PanelModerationTest.php`, `CoachApplicationReviewPageTest.php`
 * (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §11) and `AdminStyleTest.php`. Global functions in a Pest
 * file are declared once per process, so a copy in each file would be a
 * "cannot redeclare" fatal and leaving them in one would be an "undefined
 * function" when the other runs alone. Not a `*Test.php`, so Pest never
 * collects it as a test file.
 */

/**
 * ⚠️ ENVIRONMENT, not a test convenience. `filament/support` declares
 * `ext-intl: *` in its own `require` (composer.lock), and this dev host has
 * no `intl` — `composer install` here must have run with
 * `--ignore-platform-req=ext-intl`, the same flag the Dockerfile passes at
 * lines 39/307. The production image installs it for real
 * (`docker-php-ext-install ... intl ...`, Dockerfile:115), so the gap is
 * local-only, but it makes EVERY Filament table render throw
 * `RuntimeException: The "intl" PHP extension is required to use the
 * [format] method` out of `Illuminate\Support\Number::format()`. All twelve
 * tests in the first draft of `PanelModerationTest` errored on exactly that
 * and none had ever been run — which is how §5.4's eight holes nearly
 * shipped "tested" a second time.
 *
 * Two independent render paths reach `Number::format()`, so two levers:
 *
 *  - `paginated(false)` — `filament/support`'s `components/pagination/
 *    index.blade.php:51-53` formats first/last/total. Guarded by
 *    `@if ($hasPagination)` (`tables/.../index.blade.php:2555`), so turning
 *    pagination off removes the component entirely. Pagination is noise in
 *    a test with three rows.
 *  - `deferLoading()`, and ONLY for `ManageUsers` —
 *    `tables/.../index.blade.php:813` formats `$allSelectableRecordsCount`
 *    inside the select-all indicator, which renders when
 *    `$isSelectionEnabled && ($maxSelectableRecords !== 1) && $isLoaded`
 *    (:772). `UserResource` is the one table in this panel with a
 *    `BulkAction`, so it is the only one where `$isSelectionEnabled` is
 *    true. `deferLoading` leaves `$isLoaded` false — nothing calls
 *    `loadTable` in a Livewire test — which skips that branch.
 *
 * It must be `deferLoading()` on `ManageUsers` ALONE. Deferring every table
 * also skips the mounted action's modal body, and holes 6/7 are asserted by
 * reading that body: under a blanket `deferLoading()` the annotations modal
 * renders as nothing, `assertSee('PUBLISHED-TEXT')` fails, and the audit
 * row it is paired with still appears — a test that looks half-right for
 * entirely the wrong reason. `getLivewire()` is readable here because
 * `Table::make()` sets it in the constructor, before `configure()` runs
 * (`Table.php:70-77`).
 *
 * Registered per test rather than once per process:
 * `Configurable::configureUsing()` delegates to
 * `ComponentManager::resolve()`, which is container-scoped and so is thrown
 * away with the application between tests.
 */
function renderPanelTablesWithoutIntl(): void
{
    Table::configureUsing(function (Table $table): void {
        $table->paginated(false);

        if ($table->getLivewire() instanceof ManageUsers) {
            $table->deferLoading();
        }
    });
}

function panelAdmin(): User
{
    $admin = User::factory()->create();
    $admin->assignRole(Role::ADMIN);

    return $admin;
}

function panelSuperAdmin(): User
{
    $superAdmin = User::factory()->create();
    $superAdmin->assignRole(Role::SUPER_ADMIN);

    return $superAdmin;
}

function panelMember(): User
{
    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    return $member;
}

function panelCoach(): User
{
    $coach = User::factory()->create();
    $coach->assignRole(Role::COACH);

    return $coach;
}

/** A user with an app-authentication secret, so the panel's enrollment check passes. */
function enrolledPanelUser(string $role): User
{
    $user = User::factory()->create(['two_factor_secret' => 'E2EADMINE2EADMIN']);
    $user->assignRole($role);

    return $user;
}

/**
 * The session stamp a completed panel MFA challenge writes, for tests whose
 * subject is not the challenge itself.
 *
 * @return array<string, array{user: mixed, at: string}>
 */
function panelMfaStamp(User $user): array
{
    return [FilamentMfaStamp::SESSION_KEY => [
        'user' => $user->getAuthIdentifier(),
        'at' => now()->toIso8601String(),
    ]];
}
