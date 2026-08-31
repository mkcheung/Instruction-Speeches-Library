<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-12-FROZEN-CONTRACT.md / STEP-12.md: gates the entire Filament panel
 * (mounted at `/control-panel` — App\Providers\Filament\AdminPanelProvider)
 * behind the `admin` role. Deliberately a plain middleware, not
 * `App\Models\User implements Filament\Models\Contracts\FilamentUser` —
 * that interface lives in the `filament/filament` package, and `User.php`
 * is loaded on EVERY request (including every request in an environment
 * where that package isn't installed yet); this middleware only ever
 * loads when a `/control-panel` route is actually hit, so it carries zero
 * risk to the rest of the app either way.
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
        abort_unless($user !== null && $user->hasAnyRole(['admin', 'super_admin']), 403);

        return $next($request);
    }
}
