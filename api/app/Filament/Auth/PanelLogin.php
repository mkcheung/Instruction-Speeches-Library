<?php

namespace App\Filament\Auth;

use App\Support\FilamentMfaStamp;
use Filament\Auth\Http\Responses\Contracts\LoginResponse;
use Filament\Auth\Pages\Login;
use Filament\Facades\Filament;

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §6.1/§6.4.
 *
 * Two jobs on top of the vendor `Login` page:
 *
 * 1. Write the MFA stamp (`FilamentMfaStamp`) once `parent::authenticate()`
 *    returns a non-null response — the one path past the vendor challenge
 *    gate (`Login::authenticate()`, both `null` returns are rate-limit and
 *    challenge-pending). The `Illuminate\Auth\Events\Login` listener that
 *    clears a stale stamp (`AppServiceProvider::boot()`) fires *inside*
 *    `parent::authenticate()`, before `session()->regenerate()` — so
 *    stamping here, after `parent::authenticate()` returns, cannot race its
 *    own clear.
 * 2. Retarget `mount()`'s authenticated-visitor bounce. The vendor version
 *    always sends an authenticated visitor straight to the panel, which
 *    deadlocks against `RequireFilamentMfaChallenge` for an admin who is
 *    authenticated (via the shared SPA session) but never stamped: the
 *    middleware would redirect back to this login page, whose `mount()`
 *    would redirect straight back to the panel. Routing the unstamped case
 *    to the challenge instead breaks the loop.
 */
class PanelLogin extends Login
{
    public function mount(): void
    {
        $user = Filament::auth()->user();

        if ($user !== null) {
            redirect()->intended(
                FilamentMfaStamp::isValid($user)
                    ? Filament::getUrl()
                    : route(MfaChallenge::getRouteName(Filament::getDefaultPanel())),
            );

            return;
        }

        $this->form->fill();
    }

    public function authenticate(): ?LoginResponse
    {
        $response = parent::authenticate();

        $user = Filament::auth()->user();

        if ($response !== null && $user !== null) {
            FilamentMfaStamp::write($user);
        }

        return $response;
    }
}
