<?php

namespace App\Filament\Pages;

use App\Support\Role;
use Filament\Pages\Dashboard as BaseDashboard;

/**
 * PLAN-ADMIN-DASHBOARD.md §6.1 (Phase 2a) — the panel's landing page, and
 * the first `app/Filament/Pages` class in this codebase (the directory did
 * not exist before this step).
 *
 * ## Why there is no provider edit
 *
 * `AdminPanelProvider.php:77` already declares
 * `discoverPages(in: app_path('Filament/Pages'), for: 'App\Filament\Pages')`,
 * and `HasComponents::discoverComponents()` opens with
 * `if ((! $filesystem->exists($directory)) && ...) return;` — so for the
 * whole of STEP-12 through STEP-15 that call was a no-op against a
 * directory that was never created. Creating the directory is the entire
 * registration step. A `->pages([static::class])` call in the provider
 * would additionally double-register this page alongside discovery.
 *
 * ## Why `/control-panel` does not collide, and how to tell it worked
 *
 * `$routePath = '/'` is the inherited default on `Filament\Pages\Dashboard`,
 * so this page claims the panel root. Filament also wants that path for its
 * "redirect to the first navigation item" controller, but
 * `vendor/filament/filament/routes/web.php:187-199` registers that redirect
 * only behind two guards: `version_compare(Application::VERSION, '13.0.0',
 * '>=')`, and
 *
 *     if (! isset(Route::getRoutes()->getRoutesByMethod()['GET'][$rootKey]))
 *
 * Pages are registered earlier in that same closure (`:166-173`, before the
 * resources at `:175`), so by the time the guard runs the root key is taken
 * and the redirect is never registered at all. This repo is on Laravel
 * 13.24.0; on Laravel <13 the branch is skipped and `Route::get('/')` would
 * have been registered unconditionally *first*, which is why the version
 * matters enough to record.
 *
 * The observable before/after is a route-table row, and `DashboardPageTest`
 * asserts exactly that rather than a status code (see below for why a
 * status code is unavailable):
 *
 *     before:  GET control-panel  filament.admin.home  -> RedirectToHomeController
 *     after:   GET control-panel  filament.admin.pages.dashboard -> this page
 *
 * ## Why `canAccess()` and not a policy — §8.2
 *
 * §8.2 is explicit that super-admin-only and admin-only panel surfaces are
 * gated by `canAccess()`/`canView()` overrides and **never** by policies,
 * and §1.2 gives the reason: no `viewAny` method exists anywhere in
 * `app/Policies/`, and Laravel's fallback for a missing policy method is
 * `Response::allow()`. A policy-based gate here would silently allow
 * everyone while reading like a restriction.
 *
 * ## Why `canAccess()` is worth overriding at all when `EnsureUserIsAdmin`
 *    already guards every panel route
 *
 * Because it does not guard this component's Livewire round trips.
 * `php artisan route:list --path=livewire/update -v` reports:
 *
 *     POST livewire/update  default.livewire.update  ⇂ web
 *
 * — the `web` group only. `AdminPanelProvider` declares its own explicit
 * middleware array and never uses `web`, so neither `EnsureUserIsAdmin` nor
 * any other panel middleware is in that stack. Every `wire:click`,
 * `wire:poll` and `wire:init` on this page therefore arrives through a route
 * that has never heard of the `admin` role. `CanAuthorizeAccess` on
 * `Filament\Pages\Page` runs `abort_unless(static::canAccess(), 403)` from
 * BOTH `mountCanAuthorizeAccess()` and `hydrateCanAuthorizeAccess()`, which
 * is precisely the two-layer enforcement §8.2 asks for — but only once
 * `canAccess()` says something, since the trait's own default is a
 * documented `return true`.
 *
 * `Role::ADMIN_TIER` (not `Role::ADMIN`) for §1.2/§5.2's reason: the two
 * roles never stack, so an `admin`-only predicate permanently locks out a
 * `super_admin`, who is a strict superset everywhere except the four
 * abilities they alone hold.
 */
class Dashboard extends BaseDashboard
{
    public static function canAccess(): bool
    {
        $user = auth()->user();

        return $user !== null && $user->hasAnyRole(Role::ADMIN_TIER);
    }

    /**
     * PLAN-ADMIN-DASHBOARD.md §7 — the responsive dashboard grid.
     *
     * An **array**, not the inherited bare `2`, and the difference is not
     * cosmetic. `Filament\Schemas\Concerns\HasColumns::columns()` opens with
     *
     *     if (! is_array($columns)) { $columns = ['lg' => $columns]; }
     *
     * so a bare integer is a `lg`-and-up declaration and every narrower
     * viewport falls back to `getAllColumns()`'s `'default' => 1`. §7's
     * `['md' => 2, 'xl' => 4]` is what actually makes the breakpoints
     * between 768px and 1024px do anything.
     *
     * ## This needs no asset build, which §8.3 makes load-bearing
     *
     * §8.3 bans ad-hoc Tailwind utilities because `api/` has no
     * `node_modules` and no `public/build`, so nothing compiles classes this
     * repo writes itself. The grid is safe because Filament emits none:
     * `ComponentAttributeBag::grid()`
     * (`support/src/SupportServiceProvider.php:221-250`) emits its own
     * `fi-grid` / `md:fi-grid-cols` / `xl:fi-grid-cols` marker classes plus
     * an INLINE `--cols-md: repeat(2, minmax(0, 1fr))` style, and
     * `support/resources/css/components/grid.css:10,18` resolves those
     * markers through `grid-cols-(--cols-md)`. Both marker classes are
     * present in the shipped `support/dist/index.css` (10 and 55
     * occurrences), so the only thing this file contributes is two integers
     * that land in a `style` attribute.
     *
     * Both widgets currently declare `$columnSpan = 'full'` — a stats row
     * does its own internal container-query layout and a table is unreadable
     * at a quarter width — so this declaration has no *visible* effect until
     * a third, narrower widget lands. It is set now because it is §7's
     * stated value and because the alternative (discovering the `lg`-only
     * fallback later, from a 768px screen) is exactly the bug §7 warns about.
     *
     * @return int|array<string, ?int>
     */
    public function getColumns(): int|array
    {
        return ['md' => 2, 'xl' => 4];
    }
}
