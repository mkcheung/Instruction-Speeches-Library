<?php

namespace App\Providers\Filament;

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
 * `filament:upgrade` is not a real artisan command in this installed
 * version (no `filament` namespace commands are registered by
 * `filament/filament` itself) — assets/views ship pre-published in the
 * package and needed no publish step to boot.
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
