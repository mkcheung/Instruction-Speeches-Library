<?php

use App\Filament\Auth\MfaChallenge;
use App\Filament\Auth\PanelLogin;
use App\Http\Middleware\RequireFilamentMfaChallenge;
use App\Models\User;
use App\Support\FilamentMfaStamp;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Auth\MultiFactor\App\AppAuthentication;
use Filament\Facades\Filament;
use Illuminate\Testing\TestResponse;
use Livewire\Drawer\Utils;
use Livewire\Livewire;
use PragmaRX\Google2FA\Google2FA;

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §1, §2, §6 — closing the live MFA bypass.
 *
 * §1: an SPA-authenticated admin's password-only session reached the full
 * panel — `EnsureMultiFactorAuthenticationIsEnabled` only checks that a
 * TOTP secret is ENROLLED, never that this session presented one. §2: the
 * obvious fix ("redirect to login when unstamped") deadlocks against
 * `PanelLogin::mount()`'s own authenticated-visitor bounce. §6 closes both
 * with a session-bound stamp (`FilamentMfaStamp`) and a step-up challenge
 * page (`MfaChallenge`) that an unstamped-but-enrolled admin is routed to
 * instead of back to the login form.
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function mfaEnrolledAdmin(string $role = Role::ADMIN): array
{
    $secret = app(Google2FA::class)->generateSecretKey();
    $user = User::factory()->create();
    $user->assignRole($role);
    $user->saveAppAuthenticationSecret($secret);

    return [$user, $secret];
}

function mfaStampSession(User $user): void
{
    FilamentMfaStamp::write($user);
}

it('reaches /control-panel through its real middleware stack, unstamped, and gets redirected to the challenge — not the login page, not a 200', function () {
    [$admin] = mfaEnrolledAdmin();

    $response = $this->actingAs($admin)->get('/control-panel');

    $response->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
});

it('breaks the mount() loop: an unstamped authenticated admin hitting /control-panel/login is sent to the challenge, not back to the panel', function () {
    // §2's deadlock: the vendor `Login::mount()` bounces any
    // `Filament::auth()->check()` visitor straight back to the panel,
    // which an unstamped `RequireFilamentMfaChallenge` would bounce right
    // back to login — PanelLogin::mount() has to branch on the stamp
    // instead of always targeting the panel.
    [$admin] = mfaEnrolledAdmin();

    $response = $this->actingAs($admin)->get('/control-panel/login');

    $response->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
});

it('sends a STAMPED admin hitting /control-panel/login straight to the panel', function () {
    [$admin] = mfaEnrolledAdmin();
    mfaStampSession($admin);

    $response = $this->actingAs($admin)->get('/control-panel/login');

    $response->assertRedirect(Filament::getUrl());
});

it('redirects a non-enrolled admin to the set-up page from /control-panel, not the challenge', function () {
    // `two_factor_secret` explicit, not omitted: `actingAs()` sets this
    // exact in-memory model onto the guard with no DB round-trip, and
    // `Model::preventAccessingMissingAttributes()` (on outside production)
    // distinguishes "column is NULL" from "this key was never hydrated" —
    // a real session-authenticated request always re-loads the user via a
    // full `SELECT *`, so this gap is a test-harness artifact of
    // `actingAs()`, not a reachable production path.
    $admin = User::factory()->create(['two_factor_secret' => null]);
    $admin->assignRole(Role::ADMIN);
    // Deliberately no `saveAppAuthenticationSecret()` call — not enrolled.

    $response = $this->actingAs($admin)->get('/control-panel');

    $response->assertRedirect(Filament::getSetUpRequiredMultiFactorAuthenticationUrl());
});

it('redirects a non-enrolled admin to the set-up page from the challenge route too', function () {
    $admin = User::factory()->create(['two_factor_secret' => null]);
    $admin->assignRole(Role::ADMIN);

    $response = $this->actingAs($admin)->get(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));

    $response->assertRedirect(Filament::getSetUpRequiredMultiFactorAuthenticationUrl());
});

it('403s a member reaching the challenge URL directly — it is an authenticated admin surface like any other', function () {
    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    $response = $this->actingAs($member)->get(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));

    $response->assertForbidden();
});

it('lets an unstamped enrolled admin actually load the challenge page — the self-gating loop this route must avoid', function () {
    // §6.3's "one fiddly constraint": the challenge route must NOT carry
    // `RequireFilamentMfaChallenge`, or it gates itself. If it ever did,
    // this would redirect instead of rendering 200.
    [$admin] = mfaEnrolledAdmin();

    $response = $this->actingAs($admin)->get(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));

    $response->assertOk();
});

it('blocks GET /horizon for an unstamped admin the same way it blocks the panel', function () {
    [$admin] = mfaEnrolledAdmin();

    $response = $this->actingAs($admin)->get('/horizon/api/stats');

    $response->assertStatus(302);
    expect($response->headers->get('Location'))
        ->toBe(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
});

it('does not throw for an anonymous visitor to Horizon — the middleware is a no-op ahead of the viewHorizon gate', function () {
    // §6.7's real hazard: on Horizon (unlike the panel) the admin-tier
    // check is NOT already guaranteed upstream of this middleware —
    // `Laravel\Horizon\Http\Controllers\Controller`'s own Gate check runs
    // as CONTROLLER middleware, strictly after every route middleware.
    // Without a null/non-admin guard, `AppAuthentication::isEnabled(null)`
    // would throw before Horizon's own 403 ever fires.
    $response = $this->get('/horizon/api/stats');

    $response->assertStatus(403);
});

it('does not throw for an authenticated non-admin hitting Horizon either', function () {
    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    $response = $this->actingAs($member)->get('/horizon/api/stats');

    $response->assertStatus(403);
});

/**
 * Extracts a real Livewire snapshot from a rendered page and posts it back
 * to `/livewire/update`, exactly like a browser's Alpine/Livewire runtime
 * would on any table filter, pagination click, modal open, or the
 * suspend/takedown/purge mutations themselves. A hand-built payload would
 * fail Livewire's own checksum validation before our middleware is ever
 * reached, proving nothing about this plan's change — this is why §6.9
 * calls this "the only assertion that can catch the Livewire gap."
 */
function postLivewireUpdate(string $pageUrl): TestResponse
{
    $html = test()->get($pageUrl)->getContent();

    $snapshot = Utils::extractAttributeDataFromHtml($html, 'wire:snapshot');

    return test()->postJson('/livewire/update', [
        'components' => [[
            'snapshot' => json_encode($snapshot),
            'updates' => [],
            'calls' => [],
        ]],
    ]);
}

it('blocks an unstamped session at the real POST /livewire/update endpoint — the only assertion that can catch the Livewire gap', function () {
    [$admin] = mfaEnrolledAdmin();
    mfaStampSession($admin);
    $this->actingAs($admin);

    // Render the page while stamped, to obtain a real snapshot — the
    // claim under test is what happens to the FOLLOW-UP mutation, not the
    // initial GET.
    $html = $this->get('/control-panel')->getContent();
    $snapshot = Utils::extractAttributeDataFromHtml($html, 'wire:snapshot');

    // Now the session's second-factor proof lapses — exactly what Q3's
    // session-lifetime model does at the two-hour idle ceiling — and the
    // SAME already-open tab tries to act again.
    FilamentMfaStamp::forget();

    $response = $this->postJson('/livewire/update', [
        'components' => [[
            'snapshot' => json_encode($snapshot),
            'updates' => [],
            'calls' => [],
        ]],
    ]);

    // §6.5: Livewire converts the middleware's `RedirectResponse` into an
    // `abort($response)`, so the client performs a full-page navigation to
    // the step-up challenge rather than receiving Livewire's normal JSON
    // component-update response.
    $response->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
});

it('lets a stamped admin mutate through the real POST /livewire/update endpoint', function () {
    [$admin] = mfaEnrolledAdmin();
    mfaStampSession($admin);
    $this->actingAs($admin);

    $response = postLivewireUpdate('/control-panel');

    $response->assertOk();
    expect($response->json('components.0.snapshot'))->not->toBeNull();
});

it('registers RequireFilamentMfaChallenge in the Livewire persistent middleware allowlist', function () {
    // The structural guard for §6.5, in the same spirit as
    // `SuspensionEnforcementTest`'s "is registered in all three stacks"
    // test: a regression here is invisible to every GET-based test above
    // (they all pass against route-middleware alone) and would only ever
    // surface as a stamped admin's table/filter/pagination/modal actions
    // and the suspend/takedown/purge mutations bypassing the challenge
    // entirely — exactly the gap rev 1 of this plan missed.
    // `Panel::register()` (run once, at boot) hands the panel's own
    // `$livewirePersistentMiddleware` array to `Livewire::addPersistentMiddleware()`
    // and then empties it — so the panel object itself has nothing left
    // to inspect by the time a test runs. Livewire's own registry is the
    // thing actually consulted on every `/livewire/update` request.
    expect(Livewire::getPersistentMiddleware())
        ->toContain(RequireFilamentMfaChallenge::class);
});

it('lets a stamped admin reach the panel through livewire/update', function () {
    [$admin] = mfaEnrolledAdmin();
    mfaStampSession($admin);
    $this->actingAs($admin);

    $this->get('/control-panel')->assertOk();
});

it('wipes a stamp on a fresh password-only web-guard login — the resolved Q3 security half', function () {
    // Measured defect this closes: `session()->regenerate()` migrates the
    // session ID but preserves its DATA, so without the `Login` event
    // listener a stamp written by an earlier panel login survives a later
    // password-only Fortify login on the same browser session — inheriting
    // a valid second-factor proof without ever presenting one.
    $password = 'correct-horse-battery-staple';
    $admin = User::factory()->create(['password' => bcrypt($password)]);
    $admin->assignRole(Role::ADMIN);

    mfaStampSession($admin);
    expect(FilamentMfaStamp::isValid($admin))->toBeTrue();

    $this->postJson('/login', [
        'email' => $admin->email,
        'password' => $password,
    ])->assertOk();

    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
});

it('does not admit a different user on a session stamped for someone else', function () {
    [$admin] = mfaEnrolledAdmin();
    [$otherAdmin] = mfaEnrolledAdmin();

    mfaStampSession($admin);

    expect(FilamentMfaStamp::isValid($admin))->toBeTrue()
        ->and(FilamentMfaStamp::isValid($otherAdmin))->toBeFalse();

    $this->actingAs($otherAdmin)
        ->get('/control-panel')
        ->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
});

it('stamps the session on a real panel login, and lands on the panel — the ordering guard in §6.1', function () {
    // §6.1's load-bearing ordering: the `Login` event's clear-on-login
    // listener fires INSIDE `parent::authenticate()` (Fortify's/Filament's
    // own `attemptWhen`), strictly before `PanelLogin::authenticate()`
    // stamps past `parent::authenticate()`'s return. An implementation
    // that stamped any earlier would have the listener delete the stamp
    // it just wrote, and the symptom would be an endless challenge loop
    // rather than an obvious error — this is the test that would catch it.
    $password = 'correct-horse-battery-staple';
    [$admin, $secret] = mfaEnrolledAdmin();
    $admin->forceFill(['password' => bcrypt($password)])->save();

    $component = Livewire::test(PanelLogin::class)
        ->fillForm(['email' => $admin->email, 'password' => $password])
        ->call('authenticate');

    // First submit only gets past the credential check and into the
    // vendor challenge state — Login::authenticate() returns null here,
    // so nothing should be stamped yet.
    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();

    $code = app(Google2FA::class)->getCurrentOtp($secret);

    $component
        ->set('data.multiFactor.app.code', $code)
        ->call('authenticate');

    expect(FilamentMfaStamp::isValid($admin))->toBeTrue();
});

it('authenticates the challenge page with a valid code, stamps, and redirects to the originally requested panel URL', function () {
    [$admin, $secret] = mfaEnrolledAdmin();
    $this->actingAs($admin);

    // Visiting a specific panel URL while unstamped records it as the
    // `url.intended` target, exactly like a real browser following a
    // bookmark into the bypass.
    $this->get('/control-panel/users');

    $code = app(Google2FA::class)->getCurrentOtp($secret);

    Livewire::test(MfaChallenge::class)
        ->fillForm(['code' => $code])
        ->call('authenticate')
        ->assertRedirect('/control-panel/users');

    expect(FilamentMfaStamp::isValid($admin))->toBeTrue();
});

it('accepts a valid recovery code on the challenge page — TOTP-only would reintroduce the lockout risk recovery codes exist to prevent', function () {
    [$admin] = mfaEnrolledAdmin();
    $provider = AppAuthentication::make();
    $codes = $provider->generateRecoveryCodes();
    // `AppAuthentication::saveRecoveryCodes()`, not `User::saveAppAuthenticationRecoveryCodes()`
    // directly — the provider is what hashes each code before storage;
    // `verifyRecoveryCode()` assumes the stored values already are.
    $provider->saveRecoveryCodes($admin, $codes);
    $this->actingAs($admin);

    // `useRecoveryCode` is ephemeral `Get`/`Set` state behind the "use
    // recovery code" link action, not a declared form component —
    // `fillForm()` only fills declared components, so it has to be set
    // directly on the component's own `data` property instead.
    Livewire::test(MfaChallenge::class)
        ->set('data.useRecoveryCode', true)
        ->fillForm(['recoveryCode' => $codes[0]])
        ->call('authenticate')
        ->assertRedirect(Filament::getUrl());

    expect(FilamentMfaStamp::isValid($admin))->toBeTrue();
});

it('rejects replaying the same TOTP code on the challenge page', function () {
    [$admin, $secret] = mfaEnrolledAdmin();
    $this->actingAs($admin);

    $code = app(Google2FA::class)->getCurrentOtp($secret);

    Livewire::test(MfaChallenge::class)
        ->fillForm(['code' => $code])
        ->call('authenticate');

    FilamentMfaStamp::forget();

    Livewire::test(MfaChallenge::class)
        ->fillForm(['code' => $code])
        ->call('authenticate')
        ->assertHasFormErrors(['code']);

    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
});

it('throttles the challenge after six wrong codes — an unthrottled step-up page would be a worse brute-force oracle than the login form it replaces', function () {
    [$admin] = mfaEnrolledAdmin();
    $this->actingAs($admin);

    for ($i = 0; $i < 5; $i++) {
        Livewire::test(MfaChallenge::class)
            ->fillForm(['code' => '000000'])
            ->call('authenticate')
            ->assertHasFormErrors(['code']);
    }

    // The 6th attempt is rate-limited rather than form-validated — no
    // `assertHasFormErrors`, since `isMultiFactorChallengeRateLimited()`
    // returns before the form is ever touched.
    Livewire::test(MfaChallenge::class)
        ->fillForm(['code' => '000000'])
        ->call('authenticate');

    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
});
