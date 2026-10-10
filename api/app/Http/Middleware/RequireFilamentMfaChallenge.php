<?php

namespace App\Http\Middleware;

use App\Filament\Auth\MfaChallenge;
use App\Support\FilamentMfaStamp;
use App\Support\Role;
use Closure;
use Filament\Facades\Filament;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §6.2.
 *
 * Replaces the panel's `multiFactorAuthenticationRequiredMiddlewareName()`
 * (vendor default: `EnsureMultiFactorAuthenticationIsEnabled`), which only
 * checks that a provider is ENROLLED — never that this session passed a
 * challenge. Keeps that enrollment check first, unconditionally: checking
 * the stamp before enrollment would let a stamped admin who later disabled
 * TOTP keep their 200s, silently defeating `isRequired: true`.
 *
 * Wired twice on the panel (§6.5): as the route-level MFA-required
 * middleware (reaches the initial GET) and as Livewire persistent
 * middleware (reaches `POST /livewire/update`, where every panel mutation
 * after the first page load actually happens).
 *
 * Also wired directly onto `config('horizon.middleware')` (§1.6/§6.7),
 * where the admin-tier check is NOT already guaranteed upstream: on the
 * panel, route-level `Authenticate`+`EnsureUserIsAdmin` run first (sorted
 * ahead of this unmapped middleware by priority), so `$user` is always a
 * non-null admin by the time this handles. Horizon's own `viewHorizon`
 * gate, by contrast, runs as CONTROLLER middleware
 * (`Laravel\Horizon\Http\Controllers\Controller::__construct()`), which
 * executes strictly after every route-level middleware — including
 * whatever is in `config('horizon.middleware')`. So on Horizon this
 * middleware can see an anonymous visitor or a non-admin user. The guard
 * below makes it a no-op for both, deferring to the gate that runs after
 * it; without it, `AppAuthentication::isEnabled(null)` throws for an
 * anonymous request before Horizon's own 403 ever has a chance to fire.
 */
class RequireFilamentMfaChallenge
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = Filament::auth()->user();

        if ($user === null || (! $user->hasAnyRole(Role::ADMIN_TIER))) {
            return $next($request);
        }

        foreach (Filament::getMultiFactorAuthenticationProviders() as $provider) {
            if (! $provider->isEnabled($user)) {
                continue;
            }

            if (FilamentMfaStamp::isValid($user)) {
                return $next($request);
            }

            return redirect()->guest(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
        }

        // Typed `?string` only because it is `null` when the panel has no
        // MFA providers at all — unreachable here, since this very
        // `foreach` just iterated at least the panel's own provider list
        // without returning.
        $setUpUrl = Filament::getSetUpRequiredMultiFactorAuthenticationUrl();
        abort_if($setUpUrl === null, 500);

        return redirect()->guest($setUpUrl);
    }
}
