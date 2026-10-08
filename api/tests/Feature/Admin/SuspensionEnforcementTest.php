<?php

use App\Http\Middleware\CheckUserIsActive;
use App\Models\User;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Facades\Filament;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Support\Facades\Route;

/**
 * PLAN-ADMIN-DASHBOARD.md §1.1/§5.1/§9. `users.suspended_at` was written by
 * `App\Services\UserDeletionService` and read by NOTHING for access
 * control, so a suspended user kept their session cookie and every Sanctum
 * token and carried on using the product indefinitely. Same for
 * `deleted_at` and `anonymized_at`.
 *
 * ## Why these tests are written the hard way
 *
 * §5.1: **"The test must drive a real login."** `$this->actingAs($user)`
 * calls `setUser()` straight onto the guard, so `$request->user()` resolves
 * without a session existing at all — which means an `actingAs`-based test
 * stays green even if the middleware is registered as GLOBAL middleware
 * (where it runs before `StartSession`, sees a null user, and waves every
 * real browser request through). Green test, untouched production.
 *
 * Driving `post('/login')` is necessary but, in this harness, not
 * sufficient — two artifacts of a feature test sharing one container with
 * the requests it makes had to be dealt with, both found by probing the
 * harness rather than by reading it:
 *
 *   1. **`AuthManager` memoizes the guard, and `SessionGuard` memoizes the
 *      `User` model it loaded at login.** So a follow-up request in the
 *      same test sees the model as it was *before* the test suspended it,
 *      and sails through. A naive real-login test therefore FAILS against
 *      correct code — the stale model, not the middleware, is what it
 *      measures.
 *   2. **`Store::loadSession()` is `array_replace($this->attributes, …)`,
 *      a merge.** The session Store is a singleton, so its attributes
 *      survive into the next request even with no cookie carried. A
 *      follow-up request is therefore authenticated whether or not the
 *      cookie works, which is precisely the condition under which a
 *      global registration would also look correct.
 *
 * `asANewHttpRequest()` clears both (and `loggedInForReal()` carries the
 * real session cookie), so every follow-up request below has to do what a
 * browser's second request does: present a cookie, have `StartSession`
 * load the session from the handler by id, and have a cold guard resolve
 * the user from it and fetch the row fresh. That is the only shape in
 * which this test distinguishes a working registration from a global one.
 *
 * A third artifact, found the same way, is why no assertion below is a
 * bare `assertGuest()`:
 *
 *   3. **`assertGuest()` does not ask about the guard you think it does,
 *      and on `/api/*` it asks the one guard that cannot answer.**
 *      `assertGuest()` resolves `guard(null)` — the *default* guard — and
 *      the default is not a constant. `Illuminate\Auth\Middleware\Authenticate::authenticate()`
 *      ends in `$this->auth->shouldUse($guard)`, which is
 *      `setDefaultDriver()`, which is literally
 *      `config(['auth.defaults.guard' => 'sanctum'])`. Laravel's
 *      `$middlewarePriority` hoists that middleware above
 *      `SubstituteBindings`, so on every `/api/*` route `auth:sanctum`
 *      runs *before* `CheckUserIsActive` and performs that config write.
 *      A feature test shares one container with the requests it makes and
 *      never reloads config, so the write outlives the response:
 *      `config('auth.defaults.guard')` is `web` before `getJson('/api/me')`
 *      and `sanctum` after it. `assertGuest()` then interrogates the
 *      `sanctum` guard — an `Illuminate\Auth\RequestGuard`, which
 *      memoizes its resolved user, has no session behind it and no
 *      `logout()` to call, and so keeps reporting the pre-eviction
 *      identity for the life of the container no matter what the
 *      middleware did.
 *
 * So `assertEvictedForReal()` names the guard that actually holds the
 * credential (`web`), and then re-asks both guards *cold* — rebuilt after
 * the request, which is the only state in which the question is
 * meaningful for `sanctum` at all.
 *
 * `it('is registered in all three stacks…')` at the bottom pins the three
 * registration sites structurally, so the trap cannot be reintroduced by a
 * refactor that leaves the behavioural tests passing for the wrong reason.
 */
function loggedInForReal(array $roles = []): User
{
    $password = 'correct-horse-battery-staple';

    $user = User::factory()->create(['password' => bcrypt($password)]);

    foreach ($roles as $role) {
        $user->assignRole($role);
    }

    // The test client only sends cookies on JSON requests when told to —
    // `MakesHttpRequests::prepareCookiesForJsonRequest()` returns `[]`
    // otherwise. This is the harness's stand-in for the SPA's
    // `credentials: 'include'` (web/src/lib/api.ts), not a workaround.
    test()->withCredentials();

    test()->postJson('/login', [
        'email' => $user->email,
        'password' => $password,
    ])->assertOk();

    test()->assertAuthenticatedAs($user);

    // The cookie the browser is now holding. Everything after this point
    // authenticates through it rather than through the test's own state.
    test()->withCookie((string) config('session.cookie'), session()->getId());

    // Sanctum SPA mode only treats an `/api/*` request as
    // session-authenticated when Referer/Origin matches a configured
    // stateful domain (EnsureFrontendRequestsAreStateful::fromFrontend);
    // with no such header every `/api/*` request below would 401 as a
    // token request with no token, and prove nothing. Read from config
    // rather than hardcoded — SANCTUM_STATEFUL_DOMAINS is set in this
    // repo's .env, so `localhost` is NOT in the list.
    $statefulHost = trim((string) (config('sanctum.stateful')[0] ?? 'localhost'));
    test()->withHeader('Referer', 'http://'.$statefulHost);

    return $user;
}

/**
 * Discard everything the test process is holding that a real second HTTP
 * request would not have: the memoized guard (and the stale `User` model
 * inside it) and the session Store's in-memory attributes. What survives
 * is exactly what a browser has — a cookie — plus whatever the session
 * handler persisted under that id.
 */
function asANewHttpRequest(): void
{
    app('auth')->forgetGuards();
    app('session')->driver()->flush();
}

/**
 * "The eviction ended every credential", asked in the three forms that
 * are actually capable of a false answer. See artifact 3 in the file
 * docblock for why `test()->assertGuest()` is not one of them.
 *
 * Deliberately NOT `asANewHttpRequest()` first. That helper flushes the
 * session Store, which would destroy the very evidence under test: a
 * middleware that returned 403 and invalidated nothing would still look
 * evicted once the test itself had emptied the session. The hot `web`
 * assertion therefore runs against untouched post-request state, and only
 * then are the guards (and nothing else) discarded.
 *
 *   - hot `web` — the `SessionGuard` the middleware called `logout()` on.
 *     This is the one that would fail if `endEveryCredential()` stopped
 *     logging out, and the only one that can be asked immediately.
 *   - cold `web` / cold `sanctum` — guards constructed *after* the
 *     request, resolving from whatever survived it: the session Store as
 *     the middleware left it (flushed and migrated to a new id) plus the
 *     request's cookies and headers. This is the state a genuinely new
 *     HTTP request would start from, and the only state in which the
 *     `sanctum` `RequestGuard`'s answer means anything.
 */
function assertEvictedForReal(): void
{
    test()->assertGuest('web');

    app('auth')->forgetGuards();

    test()->assertGuest('web');
    test()->assertGuest('sanctum');
}

it('403s a suspended member on an API route and leaves the cookie worthless', function () {
    $user = loggedInForReal();

    $user->forceFill(['suspended_at' => now()])->save();

    asANewHttpRequest();

    test()->getJson('/api/me')
        ->assertForbidden()
        ->assertJsonPath('reason', CheckUserIsActive::REASON_SUSPENDED);

    assertEvictedForReal();

    // Not merely logged out for one request: the session was invalidated
    // and migrated, so the captured cookie no longer names a session that
    // exists. Without this assertion a middleware that only returned 403
    // (leaving the session intact for whatever runs next) would pass.
    asANewHttpRequest();

    test()->getJson('/api/me')->assertUnauthorized();
});

it('403s a soft-deleted user — `deleted_at` is not an Eloquent soft delete here', function () {
    // `User` deliberately omits the SoftDeletes trait (see
    // 2026_08_22_100003_add_suspended_at_to_users_table.php), so nothing
    // in Eloquent excludes this row: the session guard rehydrates it
    // happily and only this middleware stands in the way.
    $user = loggedInForReal();

    $user->forceFill(['deleted_at' => now()])->save();

    asANewHttpRequest();

    test()->getJson('/api/me')
        ->assertForbidden()
        ->assertJsonPath('reason', CheckUserIsActive::REASON_DELETED);

    assertEvictedForReal();
});

it('403s a user whose account was erased (anonymized_at)', function () {
    $user = loggedInForReal();

    $user->forceFill(['anonymized_at' => now()])->save();

    asANewHttpRequest();

    test()->getJson('/api/me')
        ->assertForbidden()
        ->assertJsonPath('reason', CheckUserIsActive::REASON_ANONYMIZED);

    assertEvictedForReal();
});

it('redirects a suspended user to the notice on a browser navigation through the web group', function () {
    // §5.1's second registration site, and until this test existed it was
    // pinned by NOTHING behavioural: deleting
    // `$middleware->web(append: [...])` from bootstrap/app.php failed only
    // `it('is registered in all three stacks…')`, the structural check —
    // every other test in this file either used `/api/*` (the api group),
    // `/control-panel` (the panel's own list), or `/logout` (exempt). A
    // registration whose only guard is a structural assertion is one
    // `expect()` away from being silently dropped.
    //
    // `/` is the cheapest non-exempt `web` route; the group also covers
    // Fortify's root-mounted auth routes, `/application-documents/*` and
    // Livewire's `/livewire/update`, which is where every panel
    // interaction after the first page load actually goes.
    //
    // This is also the only test that exercises the HTML branch of
    // `handle()` for a non-admin — the 302 rather than the JSON 403 —
    // because `get()` sends no `Accept: application/json`.
    $user = loggedInForReal();

    $user->forceFill(['suspended_at' => now()])->save();

    asANewHttpRequest();

    test()->get('/')
        ->assertRedirect(route('suspension.notice', ['reason' => CheckUserIsActive::REASON_SUSPENDED]));

    assertEvictedForReal();

    // Follow the redirect. Nothing else in the suite ever renders
    // `resources/views/auth/suspended.blade.php`, so without this the
    // page the middleware sends everyone to is 180 lines of uncompiled
    // Blade — and a `reason` outside the view's whitelist, or a typo in
    // the `@php` block, would surface as a 500 only in production.
    asANewHttpRequest();

    test()->get(route('suspension.notice', ['reason' => CheckUserIsActive::REASON_SUSPENDED]))
        ->assertOk()
        ->assertSee('Your account has been suspended');
});

it('evicts a suspended ADMIN from /control-panel, which the web group does not cover', function () {
    // §5.1's third registration site. The panel declares its own explicit
    // middleware list and never touches the `web` group, so the api/web
    // registrations reach exactly none of these routes — without
    // AdminPanelProvider's own entry a suspended admin keeps full panel
    // access.
    test()->seed(RoleSeeder::class);

    $admin = loggedInForReal([Role::ADMIN]);

    // Baseline: while active, the admin is NOT evicted. Deliberately
    // asserted as "still authenticated, not redirected to the notice"
    // rather than as a status code: Filament's own `Authenticate`
    // middleware `abort(403)`s every panel user in any environment other
    // than `local` because `User` does not implement `FilamentUser`
    // (vendor/filament/filament/src/Http/Middleware/Authenticate.php), so
    // the status here is a pre-existing panel defect that has nothing to
    // do with suspension — and asserting it would make this test fail the
    // day somebody fixes it.
    //
    // ⚠️ That 403 is also why `AdminPanelProvider`'s middleware array had
    // to be reordered for this test to say anything at all. An earlier
    // version of this test asserted the redirect while the panel declared
    // `CheckUserIsActive` *after* `AuthenticateSession`, and got the 403
    // instead — because `SortedMiddleware` hoists Filament's
    // `Authenticate` (priority 5, as an `AuthenticatesRequests`) above
    // every unmapped middleware declared after `ShareErrorsFromSession`.
    // In that order the suspended admin was never evicted: `handle()` did
    // not run, so the session stayed valid and the Sanctum tokens stayed
    // live. The provider now declares it immediately after
    // `StartSession`, which sorts to index 4 against `Authenticate`'s 6 —
    // see that file's comment. The two outcomes are distinguishable only
    // because of that.
    asANewHttpRequest();

    $active = test()->get('/control-panel/users');

    // `str_contains` on a cast string rather than `assertRedirect`'s
    // negation or `expect()->not->toContain()`: an `abort(403)` carries no
    // `Location` header at all, and the assertion has to survive that
    // being null as well as it survives a redirect somewhere else (the
    // panel login page, say).
    expect(str_contains((string) $active->headers->get('Location'), route('suspension.notice')))
        ->toBeFalse();
    test()->assertAuthenticatedAs($admin, 'web');

    // Now suspend them and come back.
    $admin->forceFill(['suspended_at' => now()])->save();

    asANewHttpRequest();

    test()->get('/control-panel/users')
        ->assertRedirect(route('suspension.notice', ['reason' => CheckUserIsActive::REASON_SUSPENDED]));

    assertEvictedForReal();
});

it('leaves an active user entirely alone', function () {
    $user = loggedInForReal();

    asANewHttpRequest();

    test()->getJson('/api/me')->assertOk();
    test()->assertAuthenticatedAs($user);

    // Same for a browser navigation through the `web` group.
    asANewHttpRequest();

    test()->get('/')->assertOk();
});

it('still lets a suspended user log out cleanly', function () {
    // §5.1 "Exempt the logout route." Without the exemption the logout
    // POST would itself be redirected to the suspension notice, so the
    // controller that tears the session down would never run and the only
    // way out of the state would be clearing cookies by hand.
    $user = loggedInForReal();

    $user->forceFill(['suspended_at' => now()])->save();

    asANewHttpRequest();

    test()->postJson('/logout')->assertOk();

    // Same helper as the eviction tests, for the same reason: `/logout` is
    // a `web`-group route, so nothing in THIS test calls
    // `shouldUse('sanctum')` and a bare `assertGuest()` happens to be
    // correct today — purely by accident of which routes it touches. Ask
    // the guards by name so it stays correct.
    assertEvictedForReal();
});

it('revokes every Sanctum token, not just the session', function () {
    $user = loggedInForReal();
    $user->createToken('phone');

    expect($user->tokens()->count())->toBe(1);

    $user->forceFill(['suspended_at' => now()])->save();

    asANewHttpRequest();

    test()->getJson('/api/me')->assertForbidden();

    expect($user->fresh()->tokens()->count())->toBe(0);
});

it('blocks a bearer token belonging to a suspended user, with no session involved', function () {
    // The other half of §1.1's defect statement ("their session cookie AND
    // every Sanctum token"). No login, no cookie, no session at all: a
    // middleware that only consulted the session guard would pass this
    // request straight through to `auth:sanctum`, which would happily
    // authenticate it.
    $user = User::factory()->create(['suspended_at' => now()]);

    $token = $user->createToken('phone')->plainTextToken;

    test()->withToken($token)
        ->getJson('/api/me')
        ->assertForbidden()
        ->assertJsonPath('reason', CheckUserIsActive::REASON_SUSPENDED);

    expect($user->fresh()->tokens()->count())->toBe(0);
});

it('is registered in all three stacks and never globally', function () {
    // The structural half of §5.1's warning, pinned so a later refactor to
    // `$middleware->append()` fails here even if every behavioural test
    // above somehow still passed. Global middleware runs BEFORE
    // StartSession, where `$request->user()` is always null.
    $kernel = app(Kernel::class);

    expect($kernel->getGlobalMiddleware())
        ->not->toContain(CheckUserIsActive::class);

    $groups = $kernel->getMiddlewareGroups();

    expect($groups['api'])->toContain(CheckUserIsActive::class)
        ->and($groups['web'])->toContain(CheckUserIsActive::class)
        ->and(Filament::getPanel('admin')->getMiddleware())->toContain(CheckUserIsActive::class);
});

it('exempts both logout routes and the notice page itself', function () {
    // The notice page lives in the `web` group, so omitting it from the
    // exemption list turns the redirect into a loop.
    expect(CheckUserIsActive::EXEMPT_ROUTE_NAMES)
        ->toContain('logout')
        ->toContain('filament.admin.auth.logout')
        ->toContain('suspension.notice');

    foreach (CheckUserIsActive::EXEMPT_ROUTE_NAMES as $name) {
        expect(Route::has($name))
            ->toBeTrue("Exempt route `{$name}` does not exist — the exemption is dead config.");
    }
});
