<?php

namespace App\Http\Middleware;

use App\Support\Role;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-12-FROZEN-CONTRACT.md / STEP-12.md: gates the entire Filament panel
 * (mounted at `/control-panel` — App\Providers\Filament\AdminPanelProvider)
 * behind the admin tier.
 *
 * ⚠️ This used to be the ONLY panel gate, on the stated grounds that
 * `App\Models\User implements Filament\Models\Contracts\FilamentUser`
 * would drag `filament/filament` into a class loaded on every request.
 * That argument no longer holds — `User` already implements three
 * Filament contracts — and relying on it was a production outage, not a
 * saving: `Filament\Http\Middleware\Authenticate` 403s every
 * authenticated panel route when the user model does not implement
 * `FilamentUser` and `APP_ENV !== 'local'`. `User::canAccessPanel()` now
 * exists and tests the SAME `Role::ADMIN_TIER` predicate as the line
 * below, deliberately, so the two layers cannot disagree about who may
 * enter the panel.
 *
 * Ordinary Laravel auth (session/`auth` middleware) is expected to run
 * before this one in the panel's own middleware stack; this only adds the
 * role check on top.
 */
class EnsureUserIsAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // `PLAN-APP-HEADER.md` names this exact gap as belonging to
        // STEP-12 ("super_admin is inert... the underlying gap belongs to
        // Step 12"): roles are mutually exclusive here (`syncRoles`/
        // `assignRole` never stack `admin` under `super_admin`), so an
        // `admin`-only check permanently 403s a `super_admin`-only
        // account out of the one panel that could otherwise let them
        // manage roles — confirmed by `/code-review`'s line-by-line
        // angle. `super_admin` is a strict superset of `admin`'s
        // privileges (MODERNIZATION_PLAN §7.4), so it must pass here too.
        abort_unless($user !== null && $user->hasAnyRole(Role::ADMIN_TIER), 403);

        return $next($request);
    }
}
