<?php

namespace App\Providers\Filament;

use App\Http\Middleware\CheckUserIsActive;
use App\Http\Middleware\EnsureUserIsAdmin;
use Filament\Auth\MultiFactor\App\AppAuthentication;
use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Support\Colors\Color;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

/**
 * STEP-12-admin-portal.md / STEP-12-FROZEN-CONTRACT.md §11.
 *
 * `filament/filament:^4.0` (v4.12.6) is installed, this provider is
 * registered in `bootstrap/providers.php`, and the `phpstan.neon`
 * exclusion for `app/Filament/*`/`app/Providers/Filament/*` has been
 * removed. The build agent that originally wrote this file had no
 * outbound network access to Packagist and could not run `composer
 * require`; it left the dependency undeclared rather than leave
 * composer.lock/vendor out of sync (which breaks `composer install
 * --no-dev` in the Docker `vendor` stage). Both finished in a later pass
 * with real network access. One real bug was caught only once the
 * package was actually installed and booted: `AppAuthentication` has no
 * `required()` method — `isRequired` is `Panel::multiFactorAuthentication()`'s
 * own third parameter, confirmed by reading the installed
 * `HasAuth::multiFactorAuthentication()` signature directly, correcting
 * the original guess.
 *
 * Two claims that used to stand here were wrong, corrected in place
 * rather than deleted because the second kept the panel unusable for a
 * whole step without failing anything. `filament:upgrade` is indeed not
 * a command in this version, but the `filament` namespace IS registered
 * and has ~30 commands (`php artisan list filament`) — among them
 * `filament:assets`, which is required. Assets do NOT ship pre-published:
 * a fresh image's `public/` holds only favicon.ico, index.php and
 * robots.txt, so every /css/filament and /js/filament request 404s and
 * the panel renders unstyled with no Alpine. The Dockerfile `runtime`
 * stage now runs `filament:assets`, and the `nginx` stage copies the
 * output onto nginx's own disk — nginx cannot read this container's
 * public/, and api.speechcoach.test fastcgi_pass'es every path to
 * php-fpm, which can only execute index.php. See the
 * `location ~ ^/(css|js|fonts)/filament/` block in
 * docker/nginx/default.conf.
 *
 * Both errors share a cause worth remembering: the login page returns
 * HTTP 200 whether or not its stylesheet exists, and no test ever
 * requested an asset, so "it boots" was mistaken for "it works".
 *
 * Mounted at `/control-panel` (STEP-12.md: "a separate prefix... pick
 * something clearly non-default") — never the framework's own
 * `/admin` default. `EnsureUserIsAdmin` (a plain, non-Filament
 * middleware — see its own docblock) is what actually restricts the
 * panel to the `admin` role; ordinary session auth is enforced by
 * Filament's own `Authenticate` middleware ahead of it.
 */
class AdminPanelProvider extends PanelProvider
{
    public function panel(Panel $panel): Panel
    {
        return $panel
            ->id('admin')
            ->path('control-panel')
            ->login()
            ->authGuard('web')
            ->colors(['primary' => Color::Indigo])
            // PLAN-ADMIN-DASHBOARD.md §7. Filament already collapses the
            // sidebar to an overlay below `lg` with no help, so the mobile
            // case was never the gap — the DESKTOP one was. This panel's
            // densest surfaces are the annotations and video modals, and
            // on a laptop the fixed rail costs them horizontal room they
            // actually use. Collapsible-on-desktop is opt-in; nothing
            // called it.
            ->sidebarCollapsibleOnDesktop()
            ->discoverResources(in: app_path('Filament/Resources'), for: 'App\\Filament\\Resources')
            ->discoverPages(in: app_path('Filament/Pages'), for: 'App\\Filament\\Pages')
            ->discoverWidgets(in: app_path('Filament/Widgets'), for: 'App\\Filament\\Widgets')
            // STEP-12.md: "2FA required" — Filament 4's built-in TOTP
            // app-authentication, not a hand-rolled implementation.
            // `isRequired` is Panel::multiFactorAuthentication()'s third
            // parameter, not a method on the provider itself — confirmed
            // against the real installed v4.12.6 API (`AppAuthentication`
            // has no `required()` method; `HasAuth::multiFactorAuthentication`
            // takes `$isRequired` directly), correcting an earlier guess
            // that couldn't be verified without a real install.
            ->multiFactorAuthentication(
                [AppAuthentication::make()],
                isRequired: true,
            )
            ->middleware([
                EncryptCookies::class,
                AddQueuedCookiesToResponse::class,
                StartSession::class,
                // PLAN-ADMIN-DASHBOARD.md §5.1, third of the three
                // registration sites. This panel declares its own explicit
                // middleware list and does NOT use the `web` group, so the
                // `$middleware->web(append: ...)` registration in
                // bootstrap/app.php does not reach a single panel route.
                // Without this line a suspended ADMIN keeps full
                // /control-panel access — an RBAC hole introduced by the
                // fix for an RBAC hole, and one that no test of the SPA
                // would ever notice.
                //
                // ## Why it sits HERE, immediately after StartSession
                //
                // An earlier version of this file placed it after
                // `AuthenticateSession` and claimed in a comment that it
                // therefore ran "ahead of that `authMiddleware()`". That
                // claim was false, and measurably so: `Router::gatherRouteMiddleware`
                // pipes the array through `SortedMiddleware` using the
                // kernel's `$middlewarePriority`, in which
                // `Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests`
                // ranks at index 5 — above `AuthenticatesSessions` (8) and
                // `SubstituteBindings` (9) — so `Filament\Http\Middleware\Authenticate`
                // is hoisted out of `authMiddleware()` and lands directly
                // after `ShareErrorsFromSession`, which is *before* any
                // unmapped middleware declared later in this list.
                // Declaration order does not decide this; the priority map
                // does.
                //
                // That mattered, because Filament's `Authenticate` ends in
                //
                //     abort_if($user instanceof FilamentUser
                //         ? (! $user->canAccessPanel($panel))
                //         : (config('app.env') !== 'local'), 403)
                //
                // and `App\Models\User` implements neither `FilamentUser`
                // nor `canAccessPanel()`. So outside `local` that is an
                // unconditional 403 on every panel route — and with this
                // middleware downstream of it, a suspended admin got a
                // bare, unexplained 403 (§8.1 asks for the opposite) and,
                // far worse, **was never actually evicted**: `handle()`
                // never ran, so the session was not invalidated and the
                // Sanctum tokens were not revoked. The credential survived
                // the "block".
                //
                // Placed before `AuthenticateSession` (an unmapped
                // middleware cannot be hoisted past a priority-mapped one,
                // and `AuthenticateSession` is mapped at 8) this lands at
                // sorted index 4 — after StartSession, so `$request->user()`
                // has a session to resolve through, and before
                // Filament's `Authenticate` at index 6.
                //
                // Nothing is lost by preceding `AuthenticateSession`: that
                // middleware's job is to log out a session whose password
                // hash is stale, and this one either waves an active user
                // through to it untouched or performs a strictly larger
                // teardown of its own.
                CheckUserIsActive::class,
                AuthenticateSession::class,
                ShareErrorsFromSession::class,
                VerifyCsrfToken::class,
                SubstituteBindings::class,
                DisableBladeIconComponents::class,
                DispatchServingFilamentEvent::class,
            ])
            ->authMiddleware([
                Authenticate::class,
                EnsureUserIsAdmin::class,
            ]);
    }
}
