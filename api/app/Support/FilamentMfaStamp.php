<?php

namespace App\Support;

use Illuminate\Contracts\Auth\Authenticatable;

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §6.1-§6.2 (Q1/Q3 resolved).
 *
 * `EnsureMultiFactorAuthenticationIsEnabled` (Filament vendor middleware)
 * only checks that a TOTP secret is ENROLLED, not that this session ever
 * passed a challenge — a password-only SPA session reaches the panel in
 * full (§1 of the plan). This is the marker that records "this session's
 * current user presented a second factor," written only past the
 * challenge gate (`PanelLogin::authenticate()` / `MfaChallenge::authenticate()`),
 * and bound to the user id so it cannot be inherited by a different user
 * logging in on the same browser session.
 *
 * Deliberately id-bound rather than a bare boolean (§6.1): `regenerate()`
 * preserves session DATA across a fresh login, so an unbound flag would
 * survive a password-only re-login as someone else. Deliberately no
 * separate expiry beyond the session's own lifetime (Q3): a second clock
 * that can disagree with `SESSION_LIFETIME` would interrupt an admin
 * mid-action for little gain over the existing idle ceiling.
 */
final class FilamentMfaStamp
{
    public const SESSION_KEY = 'filament_mfa_stamp';

    public static function write(Authenticatable $user): void
    {
        session()->put(self::SESSION_KEY, [
            'user' => $user->getAuthIdentifier(),
            'at' => now()->toIso8601String(),
        ]);
    }

    public static function isValid(Authenticatable $user): bool
    {
        $stamp = session(self::SESSION_KEY);

        return is_array($stamp) && ($stamp['user'] ?? null) === $user->getAuthIdentifier();
    }

    public static function forget(): void
    {
        session()->forget(self::SESSION_KEY);
    }

    private function __construct() {}
}
