<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * PLAN-ADMIN-DASHBOARD.md §1.1/§5.1 — the defect this exists to close.
 *
 * `App\Services\UserDeletionService` stamps `users.suspended_at` (and
 * `users.deleted_at`), and before this middleware **nothing in the entire
 * application read either column for access control.** The complete set of
 * reads of `suspended_at` in `app/` was: a Filament display column, a
 * button label, the admin-roster count in `RoleAssignmentService`, and the
 * two writes themselves. There was no `authenticateUsing`, no
 * `canAccessPanel`, no `validateCredentials`, no global scope, and `User`
 * deliberately does not use the `SoftDeletes` trait (see
 * `2026_08_22_100003_add_suspended_at_to_users_table.php`), so `deleted_at`
 * excluded a user from exactly nothing.
 *
 * Net effect of the shipped state: **a suspended user kept their session
 * cookie and every Sanctum token and carried on using the whole product
 * indefinitely.** `UserDeletionService`'s own docblock claimed "session
 * dies within one request… this service only stamps the column the rest of
 * the auth stack already checks" — that sentence described a middleware
 * that did not exist. This is it.
 *
 * Three states are terminal-for-access, not one:
 *   - `suspended_at`  — moderation, reversible (`unsuspend()`).
 *   - `deleted_at`    — moderation soft-delete, 30-day grace, reversible
 *                       (`restore()`). Not Eloquent `SoftDeletes`, so the
 *                       session guard happily rehydrates the row.
 *   - `anonymized_at` — STEP-11 self-erasure (`AccountErasureService`).
 *                       The row survives anonymization by design; without
 *                       this check an erased account stays usable.
 *
 * ## Why this is registered per-group and NEVER globally
 *
 * `$middleware->append()` in `bootstrap/app.php` registers *global*
 * middleware, which runs **before `StartSession`**. At that point
 * `$request->user()` resolves through `SessionGuard` with no started
 * session and returns `null`, so this class would wave every request
 * through while looking entirely correct in review. (`AssignCorrelationId`
 * is appended globally and is fine precisely because it needs no auth.)
 * It is therefore registered in the `api` group, the `web` group, and
 * `AdminPanelProvider`'s own explicit middleware array — see each site's
 * comment for why all three are load-bearing.
 *
 * ## Why the logout routes are exempt
 *
 * A suspended user must still be able to log out cleanly: if the logout
 * POST were itself redirected to the suspension notice, the browser would
 * keep a cookie for a session that the controller never got to tear down,
 * and the only way out would be clearing cookies by hand. On the exempt
 * routes we hand off to Fortify/Filament, which perform the same teardown
 * this middleware would.
 *
 * ## Rollback note (§5.1)
 *
 * Revoked Sanctum tokens are not un-revoked by reverting this commit.
 * Every suspended-then-unsuspended user must log in again. §0 calls
 * suspension "reversible"; this is the asterisk on that word.
 */
class CheckUserIsActive
{
    public const REASON_SUSPENDED = 'suspended';

    public const REASON_DELETED = 'deleted';

    public const REASON_ANONYMIZED = 'anonymized';

    /**
     * Routes that must stay reachable for an inactive user.
     *
     * `logout` is Fortify's (root-mounted — config/fortify.php `prefix` =>
     * ''), `filament.admin.auth.logout` is the panel's own (the panel is
     * `->id('admin')`, so Filament derives that name itself); both are
     * POSTs and both are the escape hatch described above.
     * `suspension.notice` is the page this middleware redirects to — it
     * lives in the `web` group, so without the exemption the redirect
     * would loop against itself for any user whose teardown left a
     * resolvable identity on the guard.
     *
     * @var list<string>
     */
    public const EXEMPT_ROUTE_NAMES = [
        'logout',
        'filament.admin.auth.logout',
        'suspension.notice',
    ];

    /**
     * Deliberately vague about *which* moderation action was taken, and
     * deliberately not a statement of reasons: §5.5 tracks capturing and
     * communicating a reason properly (a required field plus a
     * notification). Leaking "you were suspended by a moderator" versus
     * "your account was deleted" through an unauthenticated 403 body is
     * not the place to do it.
     *
     * @var array<string, string>
     */
    private const MESSAGES = [
        self::REASON_SUSPENDED => 'Your account is not currently active. Contact support if you believe this is a mistake.',
        self::REASON_DELETED => 'Your account is not currently active. Contact support if you believe this is a mistake.',
        self::REASON_ANONYMIZED => 'This account has been erased and can no longer be used.',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $this->resolveUser($request);

        if ($user === null) {
            return $next($request);
        }

        $reason = $this->inactiveReason($user);

        if ($reason === null) {
            return $next($request);
        }

        if ($request->routeIs(...self::EXEMPT_ROUTE_NAMES)) {
            return $next($request);
        }

        $this->endEveryCredential($request, $user);

        // `expectsJson()` rather than the `wantsJson()` used by
        // `bootstrap/app.php`'s `shouldRenderJsonWhen`: the narrower
        // `wantsJson()` only inspects the Accept header, and an inactive
        // user's XHR that forgot to set one would otherwise be answered
        // with a 302 to an HTML page, which no fetch caller can act on.
        // The SPA (web/src/lib/api.ts) always sends
        // `Accept: application/json`, so both forms agree for it.
        if ($request->expectsJson()) {
            return new JsonResponse([
                'message' => self::MESSAGES[$reason],
                'reason' => $reason,
            ], Response::HTTP_FORBIDDEN);
        }

        return redirect()->route('suspension.notice', ['reason' => $reason]);
    }

    /**
     * Both halves of the auth stack, because both halves are affected.
     *
     * `$request->user()` reads the default (`web`, session) guard, which
     * covers the SPA — Sanctum SPA mode authenticates `/api/*` through the
     * session cookie, and the `web` group and the Filament panel are
     * session-only. A bearer token never touches that guard, so it is
     * checked separately: §1.1's defect statement is explicitly about "the
     * session cookie **and every Sanctum token**", and a middleware that
     * only looked at the session would leave the token half of it open.
     *
     * The `sanctum` guard's config key is pushed at runtime by
     * `SanctumServiceProvider::register()` rather than declared in
     * `config/auth.php` (which lists only `web`), so it is checked for
     * presence first — `Auth::guard()` throws on an undefined guard.
     */
    private function resolveUser(Request $request): ?User
    {
        $sessionUser = $request->user();

        if ($sessionUser instanceof User) {
            return $sessionUser;
        }

        if (config('auth.guards.sanctum') === null) {
            return null;
        }

        $tokenUser = Auth::guard('sanctum')->user();

        return $tokenUser instanceof User ? $tokenUser : null;
    }

    /**
     * The three lifecycle columns, read from the raw attribute bag rather
     * than through `$user->suspended_at`.
     *
     * `AppServiceProvider:135` enables
     * `Model::preventAccessingMissingAttributes(! isProduction())`, and a
     * `User` instance does not always carry these columns: a factory-built
     * model and any `select()`-narrowed query both omit them. A direct
     * property read therefore threw `MissingAttributeException` on every
     * authenticated request outside production — 199 of the suite's tests
     * at the time this was found.
     *
     * The production behaviour was worse than the crash, and is the real
     * reason this method re-reads rather than merely guarding: with the
     * strict mode OFF (as it is in production), a missing attribute
     * resolves to `null` instead of throwing, `null !== null` is false,
     * and the middleware would wave an inactive user straight through —
     * silently, in exactly the case it exists to catch. A security control
     * must not be able to fail open because of how its subject happened to
     * be loaded.
     *
     * So: use the loaded values when they are all genuinely present (the
     * normal path — session and token auth both resolve the user with a
     * full `SELECT *`, so this costs no extra query), and fall back to one
     * authoritative primary-key read when any are absent.
     *
     * @return array{suspended_at: mixed, deleted_at: mixed, anonymized_at: mixed}
     */
    private function lifecycleColumns(User $user): array
    {
        $loaded = $user->getAttributes();

        $present = array_key_exists('suspended_at', $loaded)
            && array_key_exists('deleted_at', $loaded)
            && array_key_exists('anonymized_at', $loaded);

        if ($present) {
            return [
                'suspended_at' => $loaded['suspended_at'],
                'deleted_at' => $loaded['deleted_at'],
                'anonymized_at' => $loaded['anonymized_at'],
            ];
        }

        /** @var object{suspended_at: mixed, deleted_at: mixed, anonymized_at: mixed}|null $row */
        $row = DB::table('users')
            ->select(['suspended_at', 'deleted_at', 'anonymized_at'])
            ->where('id', $user->getKey())
            ->first();

        if ($row === null) {
            // The row is gone from under an authenticated session — a hard
            // delete, which `UserDeletionService` never performs but
            // `AccountErasureService` and test teardown both can. Treat it
            // as deleted rather than as active: a credential whose user no
            // longer exists must not keep working.
            return [
                'suspended_at' => null,
                'deleted_at' => now()->toDateTimeString(),
                'anonymized_at' => null,
            ];
        }

        return [
            'suspended_at' => $row->suspended_at,
            'deleted_at' => $row->deleted_at,
            'anonymized_at' => $row->anonymized_at,
        ];
    }

    private function inactiveReason(User $user): ?string
    {
        $columns = $this->lifecycleColumns($user);

        if ($columns['suspended_at'] !== null) {
            return self::REASON_SUSPENDED;
        }

        if ($columns['deleted_at'] !== null) {
            return self::REASON_DELETED;
        }

        if ($columns['anonymized_at'] !== null) {
            return self::REASON_ANONYMIZED;
        }

        return null;
    }

    /**
     * Stamping a column is not an eviction; this is. All three of these
     * are required, and each one alone is insufficient:
     *
     *   1. `Auth::logout()` — forgets the user on the guard AND queues the
     *      "remember me" recaller cookie for deletion, which a bare
     *      session flush would leave behind as a working credential.
     *   2. `invalidate()` + `regenerateToken()` — flushes the session data
     *      and migrates to a fresh id, so the captured cookie value is
     *      worthless rather than merely logged-out, and the CSRF token
     *      matches the new session. Guarded on `hasSession()` because a
     *      bearer-token request legitimately has no session at all.
     *   3. `tokens()->delete()` — every personal access token. This is the
     *      irreversible half (see the class docblock's rollback note).
     */
    private function endEveryCredential(Request $request, User $user): void
    {
        // `Auth::logout()` logs out the DEFAULT guard, and for a
        // bearer-token request that is Sanctum's `RequestGuard`, which has
        // no `logout()` at all — it threw
        // `BadMethodCallException: Method Illuminate\Auth\RequestGuard::logout
        // does not exist` and turned every token-authenticated eviction
        // into a 500. Only a `StatefulGuard` (the session-backed `web`
        // guard) can be logged out, so name it explicitly and type-check
        // it rather than relying on whichever guard happened to resolve
        // the user. The token half of the eviction is `tokens()->delete()`
        // below, which is what actually ends a bearer credential.
        Auth::guard('web')->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        $user->tokens()->delete();
    }
}
