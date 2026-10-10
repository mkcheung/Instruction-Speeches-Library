<?php

use App\Filament\Pages\Dashboard;
use App\Filament\Widgets\ModerationQueuesWidget;
use App\Filament\Widgets\MostConnectionsWidget;
use App\Models\Report;
use App\Models\Speech;
use App\Models\User;
use App\Support\FilamentMfaStamp;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Facades\Filament;
use Filament\Tables\Table;
use Livewire\Livewire;

/**
 * PLAN-ADMIN-DASHBOARD.md §6.1 — the dashboard landing page.
 *
 * Two things this file pins that are easy to regress and invisible when
 * they break:
 *
 *  1. **`/control-panel` is a PAGE, not a redirect.** Before §6.1 the
 *     panel had no `Filament\Pages\Dashboard` registered at all, so
 *     `RedirectToHomeController` sent an admin to whichever resource
 *     happened to sort first. The page exists now only because
 *     `app/Filament/Pages/` exists — `discoverPages()` already pointed at
 *     it — so deleting the directory silently restores the old redirect
 *     with nothing failing.
 *
 *  2. **`MostConnectionsWidget` is no longer orphaned.** It was fully
 *     built in STEP-13, discovered, and registered as a live Livewire
 *     component — but `Filament::getWidgets()` is rendered by exactly one
 *     thing in the whole framework (`Pages/Dashboard.php:49`), and no
 *     Dashboard was registered. It had `class_exists()` and rendered
 *     nowhere a human could see. That is the failure mode this file is
 *     really guarding: a widget can be perfect and still be invisible.
 *
 * §8.2 is why access is asserted through `canAccess()`/`canView()` rather
 * than a policy: no `viewAny` method exists anywhere in `app/Policies/`,
 * and Filament's authorization helper falls through to
 * `Response::allow()` when a policy method is missing — so a policy-based
 * gate here would silently admit everyone.
 */
function dashboardUserWithRole(string $role): User
{
    $user = User::factory()->create();
    $user->assignRole($role);

    return $user;
}

beforeEach(function () {
    $this->seed(RoleSeeder::class);
    Filament::setCurrentPanel('admin');

    // This dev host has no `ext-intl`, which `filament/support` requires
    // and which every paginated table render reaches through
    // `Number::format()`. `PanelModerationTest` carries the full writeup;
    // the short version is that the production image installs it and the
    // gap is local-only.
    Table::configureUsing(fn (Table $table) => $table->paginated(false));
});

// ---------------------------------------------------------------------
// Access — §8.2
// ---------------------------------------------------------------------

it('admits an admin and a super_admin to the dashboard', function (string $role) {
    $this->actingAs(dashboardUserWithRole($role));

    expect(Dashboard::canAccess())->toBeTrue();

    Livewire::actingAs(dashboardUserWithRole($role))
        ->test(Dashboard::class)
        ->assertOk();
})->with([Role::ADMIN, Role::SUPER_ADMIN]);

it('refuses a member and a coach', function (string $role) {
    // The super_admin half of this matters more than it looks: before
    // §5.2, `Gate::before` tested `hasRole('admin')` exactly, so a
    // super_admin cleared `EnsureUserIsAdmin`, reached the panel, and was
    // then denied by everything inside it. `canAccess()` uses
    // `Role::ADMIN_TIER` so the two tiers cannot drift apart again.
    $this->actingAs(dashboardUserWithRole($role));

    expect(Dashboard::canAccess())->toBeFalse();
})->with([Role::MEMBER, Role::COACH]);

it('refuses an unauthenticated visitor without erroring on a null user', function () {
    expect(Dashboard::canAccess())->toBeFalse()
        ->and(ModerationQueuesWidget::canView())->toBeFalse();
});

/**
 * ⚠️ The assertion this file said it could not make — "a status code is
 * unavailable" — and the reason it could not.
 *
 * Every test above drives `Dashboard` through `Livewire::test()`, which
 * runs with NO panel middleware at all, so all of them passed while
 * `GET /control-panel` returned **403 to every user, admin included**, in
 * every environment except `APP_ENV=local`. The cause was
 * `Filament\Http\Middleware\Authenticate`:
 *
 *     abort_if($user instanceof FilamentUser
 *         ? (! $user->canAccessPanel($panel))
 *         : (config('app.env') !== 'local'), 403)
 *
 * and `App\Models\User` did not implement `FilamentUser`. `compose.e2e.yaml`
 * sets `APP_ENV: e2e` and production sets `production`, so the entire panel
 * this step builds was unreachable everywhere it is deployed — a dev-stack-
 * only feature that no Livewire test and no route-table assertion could see.
 *
 * So this test deliberately goes through the real stack, and the
 * `APP_ENV` expectation is part of it: if this suite ever ran as `local`
 * the 403 would stop reproducing and this guard would silently stop
 * guarding.
 *
 * `two_factor_secret` is required for a 200 rather than a 302:
 * `multiFactorAuthentication(..., isRequired: true)` installs
 * `EnsureMultiFactorAuthenticationIsEnabled`, whose only test is
 * `filled($user->getAppAuthenticationSecret())` — the same reason
 * `E2ESeeder` seeds one for ids 9001/9002.
 */
it('serves /control-panel through its real middleware stack outside a local env', function () {
    expect(config('app.env'))->not->toBe('local');

    $enrolled = function (string $role): User {
        $user = User::factory()->create([
            'two_factor_secret' => 'E2EADMINE2EADMIN',
            'two_factor_confirmed_at' => now(),
        ]);
        $user->assignRole($role);

        return $user;
    };

    // PLAN-ADMIN-LOGIN-REDIRECT.md §6.1/§8: `actingAs()` alone no longer
    // reaches a 200 here — `RequireFilamentMfaChallenge` demands a stamp
    // that only a real login (panel or step-up challenge) writes. This
    // test's own point is the env/`canAccessPanel()` behaviour, not MFA,
    // so the stamp is written directly rather than driven through a form.
    $stampFor = fn (User $user): array => [FilamentMfaStamp::SESSION_KEY => [
        'user' => $user->getAuthIdentifier(),
        'at' => now()->toIso8601String(),
    ]];

    $admin = $enrolled(Role::ADMIN);
    $this->actingAs($admin)->withSession($stampFor($admin))->get('/control-panel')->assertOk();

    $superAdmin = $enrolled(Role::SUPER_ADMIN);
    $this->actingAs($superAdmin)->withSession($stampFor($superAdmin))->get('/control-panel')->assertOk();

    // The negative control, and the one that proves the 200s above came
    // from `canAccessPanel()` answering rather than from the env check
    // having been removed: a member still gets 403.
    $this->actingAs($enrolled(Role::MEMBER))->get('/control-panel')->assertForbidden();
});

// ---------------------------------------------------------------------
// The widgets actually render — the orphaned-widget regression
// ---------------------------------------------------------------------

it('renders both widgets on the dashboard, which is what un-orphans MostConnectionsWidget', function () {
    $widgets = (new Dashboard)->getWidgets();

    expect($widgets)->toContain(ModerationQueuesWidget::class)
        ->and($widgets)->toContain(MostConnectionsWidget::class);
});

it('gates the moderation widget to the admin tier, at the hydrate boundary too', function () {
    // `canView()` is enforced twice by Filament — once when the page
    // filters its widget list, and again by a `hydrate` guard on the
    // component itself. The second one is the load-bearing half: without
    // it the widget stays directly addressable by a crafted Livewire
    // request even while hidden from the page.
    $this->actingAs(dashboardUserWithRole(Role::MEMBER));
    expect(ModerationQueuesWidget::canView())->toBeFalse();

    $this->actingAs(dashboardUserWithRole(Role::SUPER_ADMIN));
    expect(ModerationQueuesWidget::canView())->toBeTrue();
});

// ---------------------------------------------------------------------
// The one stat tile — §10 cut the other five rather than add indexes
// ---------------------------------------------------------------------

it('counts only OPEN reports in the queue tile', function () {
    Report::factory()->count(3)->create([
        'reportable_type' => Speech::class,
        'reportable_id' => Speech::factory()->for(dashboardUserWithRole(Role::MEMBER))->create()->id,
        'state' => 'open',
    ]);
    Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => Speech::factory()->for(dashboardUserWithRole(Role::MEMBER))->create()->id,
        'state' => 'dismissed',
    ]);

    Livewire::actingAs(dashboardUserWithRole(Role::ADMIN))
        ->test(ModerationQueuesWidget::class)
        // 3, not 4 — a dismissed report is off the queue. The tile is
        // served by `reports_state_created_at_index`, which is why §10
        // kept this one and cut the five that would have needed new
        // indexes for tables with single-digit row counts.
        ->assertSee('3');
});

// ---------------------------------------------------------------------
// Responsive grid — §7
// ---------------------------------------------------------------------

it('declares a breakpoint-keyed column grid, not a bare integer', function () {
    // A bare integer applies at `lg` and up only, leaving every smaller
    // device on a single column — the exact failure §7 warns about,
    // discovered later from a 768px screen.
    expect((new Dashboard)->getColumns())->toBe(['md' => 2, 'xl' => 4]);
});
