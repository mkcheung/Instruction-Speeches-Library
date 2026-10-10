# Plan — Role-Based Post-Login Routing for the Admin Tier

**rev 3 · 2026-10-09 · branch `step-16-admin-dashboard`**

> **Q1, Q2, Q3 and Q5 are resolved** (all 2026-10-09). Q1 → the step-up challenge
> (§6.3, routed to by §6.2/§6.4, justified by §7.5). Q2 → admins keep the SPA, with
> a specific destination always beating the escort. Q3 → session-lifetime plus
> clear-on-login (§6.1). Q5 → fold in all three bare role literals (§6.8).
> **Only Q4 remains open** — a second factor for SPA login — and it is a larger
> separate piece that does not block Phase 1. No code has been written.

The ask: send `admin` and `super_admin` to the Filament panel after login; leave
`member` and `coach` on `/dashboard`.

That feature is roughly twenty lines of TypeScript. This plan is long because
investigating it surfaced a live authentication defect the feature would sit on
top of; because the obvious fix for that defect contains an infinite redirect
loop; and because rev 1's own fix missed the endpoint where every panel mutation
actually happens. All three were reproduced by execution, not reasoned about.
§13 lists what each revision corrects.

---

## 0. Summary

| | |
|---|---|
| **Can the redirect be built?** | Yes. `user.roles` is already on the login response; no backend change is needed to express it. |
| **Should it ship as asked?** | **No.** It would make a live MFA bypass the standard path every admin takes. |
| **Structure** | **Phase 1** closes the bypass on both surfaces that have it. **Phase 2** is the redirect. |
| **Does Phase 1 close everything?** | **No** — §1.5 and §1.6 state precisely what it leaves open. The title "make MFA real" is narrower than it sounds. |
| **Breakage** | Phase 1 breaks 2 backend assertions and 1 e2e test. Phase 2 breaks 1 more e2e block. CI catches none of it. |
| **Open questions** | **Q1, Q2, Q3, Q5 resolved.** Only Q4 remains (second factor for SPA login, §10) — it does not block Phase 1. |

---

## 1. The blocking finding: the panel's mandatory TOTP is not enforced

`AdminPanelProvider.php:96-99` declares `multiFactorAuthentication([...],
isRequired: true)`. **An admin's password alone is sufficient to reach the full
panel.** No second factor is ever demanded.

### 1.1 Reproduction

A temporary Pest probe, since deleted, against the real middleware stack:

```
fortify_login_status => 200      # POST /login, password only, no TOTP
authenticated_as     => 1
panel_status         => 200      # GET /control-panel
panel_redirect       => null
challenge_shown      => false
session_keys         => ["_token","login_web_<sha1>","_flash",
                         "password_hash_web","_previous"]
```

Run independently twice, with identical results.

### 1.2 Mechanism

Three facts compose into the hole, all quoted from vendor source.

**a. The challenge is Livewire component state, not session state.**
`Login.php:62` holds `$userUndertakingMultiFactorAuthentication` as a `#[Locked]`
property. `Login.php:158-160` returns `null` while a challenge is outstanding, and
the guard call plus `session()->regenerate()` only happen *past* that gate, at
`:162-167`. MFA is a precondition of Filament **creating** a session. It is never
a property **of** a session.

**b. The middleware `isRequired: true` installs checks enrollment, not
authentication.** `EnsureMultiFactorAuthenticationIsEnabled.php:11-22`:

```php
foreach (Filament::getMultiFactorAuthenticationProviders() as $provider) {
    if ($provider->isEnabled($user)) {
        return $next($request);          // passes on ENROLLMENT alone
    }
}
return redirect()->guest(Filament::getSetUpRequiredMultiFactorAuthenticationUrl());
```

`AppAuthentication.php:75` defines `isEnabled()` as
`filled($user->getAppAuthenticationSecret())`. The class name is the trap:
**"is enabled" means "has a secret stored," not "has passed a challenge."**

**c. Nothing writes an MFA marker, so nothing can check one.** The probe's session
bag (§1.1) contains no MFA key.

The two surfaces share one credential by design — `SESSION_DOMAIN=.speechcoach.test`
carries a leading dot, documented in STEP-02 as deliberate so the cookie is valid
on both `app.` and `api.` subdomains — and both use the `web` guard
(`config/fortify.php:18`, `AdminPanelProvider.php:75`). Compounding it,
`config/fortify.php:186-192` does **not** enable
`Features::twoFactorAuthentication()`: the SPA login has no second factor at all,
so it mints a strictly weaker credential than the panel's own login demands, and
the panel honours it in full.

### 1.3 What `isRequired: true` actually buys

**Enrollment coercion, and nothing else.** With an empty `two_factor_secret` the
probe is redirected to the setup page (302 →
`/control-panel/multi-factor-authentication/set-up`); with a secret present, 200.
`E2ESeeder.php:231` seeds secrets for ids 9001/9002, so every seeded admin is in
the "200, no challenge" case.

### 1.4 We already documented this as correct behaviour

`admin-panel.spec.ts:467-485` is a passing test whose comment reads:

> *"This also pins something worth knowing: the SPA session is accepted by the
> panel directly (same `web` guard, and `SESSION_DOMAIN=.speechcoach.test` spans
> both hosts), so an admin who is already signed into the app is **NOT challenged
> for TOTP again** — `EnsureMultiFactorAuthenticationIsEnabled` only requires that
> a secret EXISTS…"*

The mechanism was described accurately, a week ago, and filed as a convenience
worth protecting with an assertion. **The bypass is not an unknown; it is a known
fact that was never read as a defect.** That test must be inverted in Phase 1 — it
currently guards the hole.

### 1.5 Phase 1 does not close the API

`AppServiceProvider.php:297-299` grants via `Gate::before` on
`hasAnyRole(Role::ADMIN_TIER)` with no MFA consideration, so an SPA-authenticated
admin keeps **admin authorization across the entire API** after Phase 1. Closing
that means a second factor on SPA login — Q4, out of scope here.

### 1.6 Horizon has the same hole — verified, and it is in Phase 1's scope

Probe with a negative control, run twice:

```
role => "admin"   authenticated_as => 1   horizon_status => 200   panel_status => 200
role => "member"  authenticated_as => 1   horizon_status => 403   panel_status => 403
```

The member 403 proves the admin 200 comes from the role gate passing, not from an
unauthenticated pass-through. `config('horizon.middleware') === ['web']`, and
Horizon's `Authenticate` middleware calls `Gate::check('viewHorizon')` →
`HorizonServiceProvider.php:40`'s `hasAnyRole(['admin','super_admin'])` — no MFA
anywhere.

This matters to the plan's shape, not just its completeness: after a panel-only
Phase 1, a password-only admin credential still yields **full queue control** —
retry, delete, job-payload inspection — on the same shared cookie. Phase 2 would
then make that credential the one every admin uses daily. **Horizon is therefore
in Phase 1** (§6.7), not deferred.

### 1.7 Why the redirect would make all of this worse

The redirect does not create the hole — a bookmark or typed URL already walks
through it. But it would make that path **the only way an admin ever enters the
panel**, converting a latent defect into the authentication flow itself, and it
would retire the panel login page from normal use — the one screen whose
appearance would otherwise reveal that something is wrong.

---

## 2. A second finding: the obvious fix deadlocks

"Add a middleware that redirects to the panel login when the session carries no
MFA stamp" **loops**. `Login.php:64-71`:

```php
public function mount(): void
{
    if (Filament::auth()->check()) {
        redirect()->intended(Filament::getUrl());
    }
    $this->form->fill();
}
```

An SPA-authenticated admin is already `check()`-true. Middleware sees no stamp →
redirects to `/control-panel/login` → `mount()` sees an authenticated user →
redirects to `/control-panel` → **loop.** There is no guest middleware on that
route to stop it; the bounce is in the page. §6.3 and §6.4 break it together.

---

## 3. Baseline — verified facts

**The redirect is expressible today.**

| Fact | Evidence |
|---|---|
| `roles` is on the login response | `UserResource.php:33` — `'roles' => $this->getRoleNames()` |
| Login and `/api/me` share that resource | `LoginResponse.php:17-22`, `routes/api.php:62-70` — identical class and `{"user": …}` envelope, no wrapper |
| `hasRole(user,'admin')` already covers `super_admin` | `roles.ts:18-24` |
| The panel URL is built in exactly one place | `roles.ts:99-104` |
| `Role::ADMIN_TIER` is `['admin','super_admin']` | `Role.php:43` |
| Roles never stack — `syncRoles` | `E2ESeeder.php:277`; a super_admin does **not** hold `admin` |

**Three places decide where an authenticated user lands.**

| # | Site | Mechanism | Roles in scope? | Can it leave the origin? |
|---|---|---|---|---|
| 1 | `Login.tsx:40-41` | `user.onboarding_completed` from the login response | **Yes** | Yes — post-mutation callback |
| 2 | `AuthShell.tsx:70-71` (`RequireGuest`) | `data.user.onboarding_completed` from `useGetMeQuery` | **Yes** | **Not directly** — render-phase `<Navigate>`; see §7.1 |
| 3 | `Onboarding.tsx:69-72` | `status.step === 4` from `getOnboardingStatus` | **No** — deliberately (`:59-64`) | n/a |

Site 2 is the post-email-verification path: `VerifyEmailResponse` sends the browser
to `/login?verified=1` with a live session, which falls through `RequireGuest`.

**What an admin sees at `/dashboard` today.** `Dashboard.tsx:53-101` renders "My
reviews" — invitations, in progress, published, revoked — with no admin-specific
content, and `Dashboard.tsx:51` hides even the profile link from admins. With the
three *subtractive* branches in `navItemsFor` (`roles.ts:134,139,143`), an admin's
SPA is strictly smaller than a member's and those four sections are near-certainly
empty, since admins are barred from holding reviews. **The destination the redirect
replaces is close to an empty page** — the affirmative case for Phase 2,
independent of §1. §7.5 re-examines whether that still holds after Phase 1.

**Seeded admin state.** ids 9001 (`super_admin`) and 9002 (`admin`), both with
`onboarding_completed_at` set (`E2ESeeder.php:263`) and TOTP secrets present
(`:231`, bound to those ids at `:202-203`). A seeded admin logging in today lands
on `/dashboard`.

---

## 4. The prior decision this reverses

[`PLAN-POST-ONBOARDING-UX.md:163`](PLAN-POST-ONBOARDING-UX.md#L163) considered
role-gating this exact redirect and **rejected** it:

> *"Role-gating the redirect makes the admin experience worse, not better… There
> is no third destination to send them to: admin tooling is a separate Filament
> panel at `/control-panel` with mandatory TOTP, **which the React app never links
> to**. `/dashboard` is the only React home an admin has."*

Both halves of that premise are now false: `roles.ts:157-159` adds
`ADMIN_PANEL_ITEM`, so a third destination exists; and §1 shows the TOTP is not
mandatory in practice. The reversal is knowing, on changed facts, and should be
recorded in that file when Phase 2 lands.

Two standing constraints still bind:

- `PLAN-APP-HEADER.md:137` — the admin entry is *"one link that leaves the SPA,
  not a tree of in-app screens."* A redirect changes that intent; §3 and §7.5 are
  the argument it has to win.
- `PLAN-APP-HEADER.md:407` — role-conditional UI is permitted but **never relied
  upon**. The redirect is convenience only; `canAccessPanel()` (`User.php:239-241`)
  and `EnsureUserIsAdmin.php:46` remain the gate, and Phase 1 adds a third.

---

## 5. Scope

**In:** the MFA session stamp, its middleware, and its Livewire coverage; the
step-up challenge page (§6.3, the resolved Q1); the loop fix; Horizon (§1.6); the
three bare role literals (§6.8, the resolved Q5); the role branch at landing sites
1 and 2, with a specific destination always winning (§7.3, the resolved Q2); the
broken tests; tests for all of it.

**Out:** a second factor for SPA login (Q4); landing site 3 (§7.2); any change to
`UserResource` or to what `/dashboard` renders; Pulse/Telescope, not audited.

---

## 6. Phase 1 — Close the bypass

### 6.1 Stamp the session — new `api/app/Filament/Auth/PanelLogin.php`

Extend `Filament\Auth\Pages\Login`. Override `authenticate()`: call
`parent::authenticate()` and, **only when it returns a non-null `LoginResponse`**
— the one path past the challenge gate at `Login.php:158-169` — write the stamp.

Bind it to the user id and a timestamp (`['user' => …, 'at' => …]`). A bare boolean
would survive a re-login as a different user on the same session.

Ordering is favourable and was verified: `session()->regenerate()` runs at
`Login.php:167` *inside* `parent::authenticate()`, and `regenerate()` preserves
session data, so a stamp written after the call survives. Both `null` returns
(rate limit `:80`, challenge pending `:159`) correctly skip stamping.

**Clear the stamp on every `web`-guard login — the resolved Q3.** Listen for
`Illuminate\Auth\Events\Login` and forget the stamp key. Without this the stamp is
inheritable: a fresh password-only login on a previously stamped session keeps it,
because Laravel migrates the session **id** but preserves its **data** (verified —
see §10 Q3). There is no `Event::listen` wiring in `app/Providers` today, so this
is new.

**The two must be ordered correctly, and they are — but only because of where
§6.1 stamps.** `attemptWhen` (`Login.php:162`) fires the `Login` event *inside*
`parent::authenticate()`, so the sequence on a real panel login is: event fires →
listener clears → `regenerate()` → `parent` returns → **then** this override
stamps. The stamp therefore outlives its own wipe. An implementation that wrote
the stamp any earlier — inside a hook, or before `parent::authenticate()` returns
— would have the listener delete the stamp it just created, and the symptom would
be an endless challenge loop rather than an obvious error.

### 6.2 Check the stamp — new `api/app/Http/Middleware/RequireFilamentMfaChallenge.php`

Keep the vendor enrollment check **first** — this ordering is load-bearing, not
cosmetic: checking the stamp first would let a stamped admin who subsequently
disabled TOTP keep their 200s, silently defeating `isRequired: true`. Then require
that the stamp exists, matches the current user id, and is within the accepted age
(Q3).

On failure, branch on **why**:

- **not enrolled** → vendor behaviour, `redirect()->guest(setUpUrl)` (§1.3)
- **enrolled, no valid stamp** → `redirect()->guest(` the step-up challenge of
  §6.3 `)`. `guest()` sets `url.intended`, so the challenge can return the admin
  to where they were headed.

Sending them to the **challenge**, not the login page, is what Q1(b) buys: the
session is kept and only the second factor is demanded.

### 6.3 The step-up challenge — new `api/app/Filament/Auth/MfaChallenge.php`

**This is Q1(b), and it is the decision that makes Phase 2 worth building** (§7.5).
A page that proves a second factor for an *already-authenticated* session.

It is much cheaper than rev 2 estimated, because Filament exposes its challenge
form as a public, reusable method rather than burying it in the login page.
`AppAuthentication::getChallengeFormComponents($user)` (`:354-395`) returns:

- a `OneTimeCodeInput` whose validation rule calls
  `verifyCode($value, $secret, shouldPreventCodeReuse: true)` (`:370`)
- a "use recovery code" link action and a `recoveryCode` field validated by
  `verifyRecoveryCode()` (`:389`)
- localized invalid-code messages

and the provider rate-limits challenges itself —
`"filament-multi-factor-challenge:{id}"`, `maxAttempts: 5` (`:183-185`). So reuse
prevention, recovery codes and throttling all arrive with the component. **Do not
hand-roll a code input**; an unthrottled step-up page is a TOTP brute-force oracle
and strictly worse than the login page it replaces.

Recovery-code support is not optional here. `User.php:252-258` already argues the
point for the login flow — role management lives *inside* the panel, so an admin
who loses their phone cannot be restored unless another admin exists. A step-up
page that accepted only TOTP would reintroduce exactly that one-way door.

**Page behaviour.** `mount()` resolves in this order, and the order is the design:

| Condition | Result |
|---|---|
| not authenticated | → panel login |
| authenticated, not admin tier | 403 (`canAccessPanel()`) |
| authenticated, **not enrolled** | → set-up page (the challenge cannot help) |
| authenticated, enrolled, **already stamped** | → `redirect()->intended(panel)` |
| otherwise | render the challenge form |

On successful submit: write the §6.1 stamp, then `redirect()->intended(Filament::getUrl())`.

**⚠️ The one fiddly constraint, stated rather than hand-waved.** The challenge
route must **not** carry `RequireFilamentMfaChallenge`, or it gates itself and
loops. Not-attaching is also what keeps the page usable under §6.5: Livewire's
allowlist filters the *originating route's* gathered middleware, so a challenge
route without the middleware yields update requests without it, and the admin can
actually submit the code. Attaching it and trying to skip by route name does
**not** work — during `POST /livewire/update` the current route is the Livewire
endpoint, not the page. This is the same mechanism that keeps Filament's own
set-up page working, and the exact registration hook for a custom page is the one
implementation detail to confirm at build time.

### 6.4 Retarget `PanelLogin::mount()`

Per §2 the vendor `mount()` bounces any authenticated visitor back to the panel,
which deadlocks against §6.2. With the challenge in place the fix is a redirect,
not a form:

```php
public function mount(): void
{
    if (Filament::auth()->check()) {
        redirect()->intended(
            $this->hasValidMfaStamp() ? Filament::getUrl() : route(/* §6.3 challenge */),
        );
        return;
    }
    $this->form->fill();
}
```

All five traced cases terminate: unstamped authenticated admin → challenge;
stamped → panel; anonymous → login form; **suspended admin → never reaches this
code**, because `CheckUserIsActive` sorts ahead of Filament's `Authenticate` and
evicts first; stamp belonging to a different user id → challenge, which re-stamps
against the current user on success.

### 6.5 Cover Livewire — the part rev 1 got wrong

**Route middleware alone does not protect the panel.** Every panel interaction
after the initial page load — table actions, filters, pagination, modals, and the
suspend / takedown / purge mutations — is a `POST /livewire/update`, which Livewire
registers against the **`web` group**, not the panel's stack. Confirmed:

```
POST livewire/update  default.livewire.update › Livewire\Mechanisms › HandleRequests@handleUpdate
 ⇂ web
```

This repo already documents it, in the very file Phase 1 edits next door to —
`bootstrap/app.php:73-78`: *"Livewire's own `/livewire/update` endpoint — **which
is where every Filament panel interaction after the initial page load actually
goes**, since Livewire registers that route against this group rather than the
panel's middleware stack."*

Livewire re-applies the original page's middleware through a **hardcoded
allowlist** (`PersistentMiddleware.php:160-178`). A new app middleware is not on
it. So a route-scoped stamp check would fire on initial GETs only, and never on the
POST that performs every mutation.

**Therefore wire it twice:**

```php
->multiFactorAuthenticationRequiredMiddlewareName(RequireFilamentMfaChallenge::class)
->persistentMiddleware([RequireFilamentMfaChallenge::class])
```

`persistentMiddleware()` (`HasMiddleware.php:84`) adds **only** to the Livewire
allowlist, not to `$this->middleware`, and route scoping survives automatically —
the allowlist filters the *originating route's* gathered middleware, so an update
request whose page was `control-panel/login` still will not receive it.

The failure mode is clean rather than broken state: Livewire converts a
`RedirectResponse` into an `abort($response)` and the client performs a full-page
navigation to the step-up challenge, which §6.3 renders.

**Do not use `->authMiddleware([...])`** (`AdminPanelProvider.php:167-170`). It
appends to every authenticated panel route including `control-panel/logout` and
`.../multi-factor-authentication/set-up` — the two Filament deliberately excludes —
risking a loop on the setup page and locking an admin out of logging out.

**One line of foresight:** `filament/exports/{export}/download` and
`filament/imports/{import}/failed-rows/download` are registered outside the
`control-panel` prefix and carry no `Authenticate`, no role check and no MFA. No
resource uses an export action today, so nothing leaks — but the next person to add
one reopens this. Note it beside the wiring.

### 6.6 Wire it — `api/app/Providers/Filament/AdminPanelProvider.php`

`->login(PanelLogin::class)` at `:74`, plus both calls from §6.5 beside
`->multiFactorAuthentication(...)` at `:96-99`. The setters exist at
`HasAuth.php:181` and `HasMiddleware.php:84`.

### 6.7 Horizon

Per §1.6, add the same middleware to `config/horizon.php:86`'s `'middleware' =>
['web']` array. Horizon is not Livewire, so route middleware is sufficient there.

### 6.8 The three bare role literals — resolved Q5

Mechanical substitution to `Role::ADMIN_TIER` at `HorizonServiceProvider.php:40`,
`GrantsReviewWriteAccess.php:31` and `GrantRoleCommand.php:64`; the exclusions and
the scope guard are in §10 Q5. Behaviour-preserving, so the existing suite is the
test. Do the Horizon one in the same commit as §6.7 — it is the same gate.

### 6.9 Tests

| Assertion | Why |
|---|---|
| Fortify `POST /login` then `GET /control-panel` → **redirect, not 200** | §1.1 inverted. The regression test for the whole bypass. |
| Panel login with a valid TOTP → `GET /control-panel` 200 | The legitimate path still works. |
| **`POST /livewire/update` on an unstamped session → redirect, not 200** | **§6.5. The only assertion that can catch the Livewire gap — every other case here is a GET.** |
| Unstamped admin `GET /control-panel` → redirect to the **challenge**, not to login | §6.2's enrolled branch — the Q1(b) behaviour. |
| Unstamped admin `GET /control-panel/login` → redirect to the challenge | §2's loop, via §6.4. Assert the *target*, not merely that a redirect happened. |
| Stamped admin `GET /control-panel/login` → redirect to panel | Preserves normal behaviour. |
| Admin with empty `two_factor_secret` → 302 to set-up, **from both** `/control-panel` and the challenge | Pins §1.3, and the challenge must not strand a non-enrolled admin (§6.3). |
| Stamp for user A does not admit user B | Why the stamp is id-bound. **Must be driven through `livewire/update`**, or it passes while B drives A's open tab. |
| **Stamped, then a password-only `POST /login` on the same session → stamp gone** | The resolved Q3. This is the measured inheritance defect; without the listener it passes today and the whole mechanism is bypassable with a password. |
| **A real panel login still ends up stamped** | The ordering guard in §6.1. If the listener and the stamp write are sequenced wrongly, the login wipes its own stamp and the symptom is an endless challenge loop, not an error. |
| Fortify login then `GET /horizon` → not 200 | §1.6. |

**Challenge-specific** (§6.3) — these exist because the page is a new authenticated surface:

| Assertion | Why |
|---|---|
| Valid code → stamped, then `redirect()->intended()` to the originally requested panel URL | The whole point; `intended` is what makes the §6.2 bounce invisible. |
| **Valid recovery code → stamped** | `User.php:252-258`: role management lives inside the panel, so TOTP-only would recreate the lockout risk recovery codes exist to prevent. |
| **Replaying the same code fails** | `shouldPreventCodeReuse: true` must actually be in force on this page, not just on login. |
| **6 wrong codes → throttled** | An unthrottled step-up page is a brute-force oracle and worse than what it replaces. |
| The challenge route is reachable **without** a stamp | The self-gating loop named in §6.3. Assert over `livewire/update` too, or submitting the code is blocked by the middleware it exists to satisfy. |
| A member reaching the challenge URL → 403 | It is an authenticated admin surface like any other. |

---

## 7. Phase 2 — The redirect

### 7.1 Where the branch goes

Add one exported helper to `web/src/lib/roles.ts` — the module that already owns
`hasRole` and the only construction of the panel URL — and call it from sites 1
and 2. One definition, one place to test.

**The call shape differs between the two sites and cannot be identical.** Site 1
is a post-mutation callback, so `window.location.replace()` is a direct statement.
Site 2 (`AuthShell.tsx:54-75`) is a render-phase guard whose only exit is
`<Navigate>`, which cannot express a cross-origin URL (§7.3). It needs a
`useEffect` performing the navigation plus a `<FullPageSpinner />` return while it
is in flight — a bare side effect during render would double-fire under
`<StrictMode>` (`main.tsx:14`) and flash the login form.

### 7.2 Site 3 is deliberately left alone

Making `Onboarding.tsx:69-72` role-aware means adding `useGetMeQuery()` to the one
route that documents why it avoids `getMe` (`:59-64`). The only user who reaches it
as an admin is someone promoted mid-onboarding — a state no seeder or production
path produces. They would land on `/dashboard` and find the Admin panel link.
**Known gap, accepted, recorded rather than silently left.**

### 7.3 Mechanics

- **`from` precedence must survive.** `Login.tsx:41` is `from?.pathname ?? landing`.
  An admin deep-linked into the SPA and bounced to login by `RequireAuth` currently
  returns to that deep link; a role check placed *before* the `from` lookup
  silently discards it. **The role branch applies only when `from` is absent.**
- **Cross-origin.** The panel is on `API_URL`, so `navigate()` cannot express it —
  it would resolve as an SPA path and render the 404 route inside the app shell.
  This is the same reasoning `roles.ts:36-45` gives for `NavItem.external`.
- **`replace()`, not `assign()`.** `LogoutButton.tsx:55` uses `assign`, but a login
  redirect wants `replace` so Back does not return to the submitted login form.
- **Do not fire for a suspended admin.** `CheckUserIsActive` runs *before* the
  login controller, so `$request->user()` is null and a suspended user's `POST
  /login` returns **200 with `roles` in the body**; only the next request evicts
  them. The role branch would therefore bounce them cross-origin to a bare Blade
  suspension page on `api.speechcoach.test`, and `replace()` means Back cannot
  return. The helper must fall through to the SPA landing for a suspended account.

### 7.4 Tests

Vitest: the helper's full truth table — admin, super_admin, coach, member,
roleless, undefined, suspended. `roles.test.ts` has 21 cases to extend. **No
vitest test anywhere currently renders `Login` or asserts a post-login
destination**, so site 1 needs the first one.

Three of these encode the resolved Q2 and must not be dropped as redundant:

| Case | Expected |
|---|---|
| admin, **`from` present** | the `from` path — **not** the panel. The shared-link rule; a role check ordered ahead of the `from` lookup silently eats it. |
| admin, no `from` | the panel |
| **suspended** admin, no `from` | the SPA landing — §7.3's eviction trap, not the panel |

E2E: update `admin-panel.spec.ts`'s §7 block (§8).

### 7.5 The value, re-derived under the Q1 decision

§3's case for Phase 2 was that `/dashboard` is nearly empty for an admin. That
still holds, and Phase 1 no longer undercuts it.

Had Q1 gone the other way, Phase 1 would have changed the redirect's *destination*
from "the panel" to "a second login form" — and since `roles.ts:157-159` already
provides a one-click link, Phase 2 would have bought roughly one click at the cost
of a second **password** entry on every login. A net loss.

**With the step-up challenge (§6.3) the arithmetic reverses.** The admin signs in
once, is carried to the panel, and supplies only a six-digit code — which is a
factor they should be supplying for an admin surface regardless. Phase 2 then
delivers what was asked for *and* is the mechanism that makes the second factor
routine rather than avoidable. That is the justification Phase 2 now rests on.

---

## 8. What breaks

**Phase 1:**

| Site | What happens |
|---|---|
| `admin-panel.spec.ts:467-485` | Asserts the SPA session reaches the panel un-challenged (§1.4). Now lands on `/control-panel/login`; `:483` and `:484` fail. **Must be inverted in the Phase 1 commit** — it currently guards the hole. |
| `DashboardPageTest.php:136-137` | `actingAs(...)->get('/control-panel')->assertOk()` writes no stamp; both assertions become 302s. |
| Other panel tests | Those using `Livewire::test()` are unaffected — they never traverse the HTTP middleware stack. That is the same blind spot that hid the panel's 500 last week. |

`SuspensionEnforcementTest.php:299-306` survives **by design, not by luck**: it
asserts only that `Location` does not contain the suspension route, and its own
comment names the reason — the assertion "has to survive that being null as well
as it survives a redirect somewhere else (the panel login page, say)." It was
written to tolerate exactly the redirect Phase 1 introduces.

**Phase 2:** `admin-panel.spec.ts:422-426` SPA-logs-in as `USERS.admin` and waits
for `${APP_URL}/dashboard`. The click now lands on the API origin, so the wait
burns 120 s and fails. It is a `beforeAll` in a `describe.serial` (`:406`), so all
three tests in the block fail — **3 × 4 browser projects = 12** on a full local run.

**CI catches none of it.** `ci.yml:319` and `:328` name five specs and
`admin-panel.spec.ts` is not among them. Green CI, red local.

**The shared fixture is safe.** `auth.setup.ts:75,79,83` authenticates only
`speaker` (member) and `reviewerA`/`reviewerB` (coaches). `USERS.admin` and
`USERS.superAdmin` carry no `storageState` — `fixtures.ts:42-48` records this as
deliberate so *"a panel regression [does not] take the entire suite down with it."*
That decision is why neither phase is suite-fatal.

**Nothing else.** No vitest test breaks. No backend test asserts the login response
body — zero `assertJson` near any of the five `postJson('/login')` sites.
`Dashboard.test.tsx:161-174` survives **only because the branch lives in
`Login`/`RequireGuest`**; a `/dashboard` route guard would break it.

---

## 9. Sequencing

1. ~~Q1~~ — **resolved: the step-up challenge** (§10). Nothing else blocks starting.
2. **Phase 1** — §6.1-6.8, then §6.9, then repair §8's Phase 1 breakage **in the
   same commit**. Phase 1 is independently shippable and worth shipping on its own
   merits, but only with those repairs included. The one unresolved implementation
   detail is §6.3's registration hook for keeping the challenge route free of its
   own middleware; settle that first, since the page is unusable otherwise.
3. **Phase 2** — §7.1-7.3, the helper and its vitest tests, then
   `admin-panel.spec.ts:422-426`.
4. **Verification** — the literal `ci.yml` commands: `pint --test`,
   `phpstan analyse`, `pest`, `tsc -b`, `eslint .`, `vitest run`, plus
   `admin-panel.spec.ts` by hand, since CI will not run it.
5. **Record the reversal** in `PLAN-POST-ONBOARDING-UX.md` (§4).

---

## 10. Questions for you

**Q1 — Step-up UX. ✅ RESOLVED 2026-10-09: option (b), the step-up challenge.**
The admin keeps their session and supplies only the six-digit code. Designed in
§6.3; it is what the middleware redirects to (§6.2) and what the login page
retargets to (§6.4), and §7.5 re-derives Phase 2's value on top of it.

The decision also turned out cheaper than rev 2 priced it. Rev 2 called (b) "a new
auth surface to get right"; in fact
`AppAuthentication::getChallengeFormComponents()` is public and ships the code
input, the recovery-code fallback, code-reuse prevention and rate limiting as one
unit, so the page is mostly mount-guards and a stamp write. **Rejected option (a)**
— re-entering email, password *and* code at the panel's own login — is recorded in
§13 row 11 so the reasoning is not lost.

**Q2 — Should admins keep the SPA? ✅ RESOLVED 2026-10-09: yes, they keep it.**

Three rules, in priority order, and the first is the one that decides it:

1. **A specific destination always wins.** If `from` is set — the admin followed a
   link to `/speeches/123`, was bounced to login by `RequireAuth`, and signed in —
   they land on `/speeches/123`. Shared links must survive, and a role check placed
   ahead of the `from` lookup would silently eat them (§7.3).
2. **A plain sign-in with no destination escorts them to the panel.** That is the
   feature.
3. **No route guard.** Typing `/dashboard` still works for an admin, forever.

**Rejected:** sealing admins out of the SPA. It breaks rule 1's shared-link case
and `Dashboard.test.tsx:161-174`, and it would make an admin account strictly less
capable than a member's for no security gain — the panel's own gates
(`canAccessPanel()`, `EnsureUserIsAdmin`, and now §6.2) are what protect the panel,
not the absence of a dashboard.

This resolution is **testable, not just stated**: §7.4's vitest truth table must
include a `from`-present admin case asserting the SPA path wins.

**Q3 — Stamp lifetime. ✅ RESOLVED 2026-10-09: session-lifetime, plus
clear-on-login.** No separate timer.

**The clear-on-login half is the security half, and it is not optional.** Measured:
a stamp survives a password-only Fortify re-login on the same session, because
Laravel migrates the session **id** but preserves its **data**. Left alone, that
means someone with the password, at a browser whose session was stamped earlier,
inherits a valid second-factor proof **without ever presenting a second factor** —
defeating the whole mechanism. Wiring in §6.1, with the ordering constraint that
makes it safe.

**The duration half is comfort, and "until the session ends" is already bounded.**
`SESSION_LIFETIME=120` with `expire_on_close` false (`config/session.php:35,37`),
so the practical ceiling is two idle hours, and any new login re-challenges.

**Rejected: a separate shorter window.** It would now genuinely bite — §6.5's
Livewire coverage is what makes expiry reach an already-open tab, where previously
it would not have — which is exactly why it would interrupt an admin mid-action,
for a small gain over a 2-hour idle ceiling. If admin sessions should be shorter
than ordinary ones, express that as a shorter **session** for the panel, not as a
second clock that can disagree with the first.

**Q4 — Does SPA login get a second factor?** Per §1.5, Phase 1 leaves an
un-challenged admin holding admin authorization across the whole API via
`Gate::before`. Fortify's `Features::twoFactorAuthentication()` is the only thing
that closes it. **Out of scope here, but it is the real end state** — say if you
want it planned.

**Q5 — Fold in the three surviving bare `['admin','super_admin']` literals?
✅ RESOLVED 2026-10-09: yes, fold in all three.**

| Site | Convert to | Note |
|---|---|---|
| `HorizonServiceProvider.php:40` | `hasAnyRole(Role::ADMIN_TIER)` | **Not incidental.** This is the `viewHorizon` gate §1.6 proved is MFA-blind, and §6.7 edits that surface anyway. |
| `GrantsReviewWriteAccess.php:31` | `hasAnyRole(Role::ADMIN_TIER)` | Policy trait. |
| `GrantRoleCommand.php:64` | `in_array($roleName, Role::ADMIN_TIER, true)` | CLI; note it is an `in_array` over the list, not a role check. |

**Deliberately excluded**, so a later sweep does not "fix" them by mistake:
`RoleSeeder.php:23` is the canonical creator of the roles and is intentionally
literal (`Role.php:20-21`), and the two occurrences in `AppServiceProvider.php:283`
and `Role.php:9` are prose *about* the literal inside comments.

Scope guard: this is a mechanical substitution with no behaviour change. If any of
the three turns out not to be behaviour-preserving, it leaves this plan and becomes
its own change.

---

## 11. Deliberately not doing, and one thing deliberately deferred

- **Landing site 3** — §7.2, gap stated.
- **Changing `UserResource`** — `roles` is already there.
- **A `RequireAdmin` route guard** — the redirect is convenience
  (`PLAN-APP-HEADER.md:407`); server-side denial is the gate.
- **Pulse / Telescope** — share the `web` guard, not audited. Horizon was, and it
  was holed (§1.6), so treat "not audited" here as unknown rather than safe.
- **⚠️ Deferred with eyes open — first-time TOTP enrollment is self-service.** For
  an admin with an empty `two_factor_secret`, `GET /control-panel` redirects to the
  set-up page, which carries no MFA middleware by design, and
  `SetUpAppAuthenticationAction` requires only a code generated from the server's
  own freshly-issued secret — no password re-prompt, no existing-factor proof. So a
  password-only session can enroll **its own** authenticator and then pass §6.2's
  check legitimately. Phase 1's real guarantee is therefore: *the bypass is closed
  for admins already enrolled.* Both seeded admins are enrolled, so §6.9’s matrix
  goes green while this path stays open. Fortify already ships `password.confirm`,
  so gating enrollment behind a password re-confirmation is cheap — **recommend
  doing it in Phase 1**, but it is called out separately because it is the one
  place Phase 1's title overstates its reach.

---

## 12. Evidence index

**Reproduced by execution:** the §1.1 probe (twice); the §1.6 Horizon probe with a
member negative control; stamp survival across a Fortify re-login; `route:list`
middleware for `control-panel`, `control-panel/login` and `livewire/update`; the
Livewire persistent-middleware allowlist; `Role::ADMIN_TIER`; seeded TOTP secrets;
`roles.test.ts` at 21 cases; the absence of `assertJson` at every `/login` test.

**Read directly in vendor source:** `EnsureMultiFactorAuthenticationIsEnabled.php:11-22`;
`AppAuthentication.php:75`; `Login.php:62,64-71,158-169`; `HasAuth.php:181`;
`HasMiddleware.php:84`; `PersistentMiddleware.php:160-178`.

**Unverified, labelled as such:** browser-level cookie transmission between the
subdomains (config verified; a real two-origin browser request was not —
`phpunit.xml:31` runs `SESSION_DRIVER=array`); parity under `APP_ENV=production`;
Horizon's production posture specifically, where a `SentinelMiddleware` sits ahead
of the role gate with unpublished config and may or may not add a factor of its
own; and whether a crafted `POST /livewire/update` can reach a data-bearing
component from a session that never held a stamp (the snapshot checksum is
HMAC'd with `APP_KEY`, so §6.5 is framed as incomplete enforcement, not total
bypass).

---

## 13. Corrections by revision

### rev 3 — the Q1 decision

| # | rev 2 said | rev 3 |
|---|---|---|
| 11 | Q1 open; (b) is "more code and a new auth surface to get right" | **Resolved to (b)**, and the cost was overstated: `getChallengeFormComponents()` (`AppAuthentication.php:354-395`) is public and ships the code input, recovery-code fallback, `shouldPreventCodeReuse: true` and `maxAttempts: 5` throttling as one unit. Option (a) — full re-login at the panel — is **rejected**: it made Phase 2 a net loss (§7.5). |
| 12 | §6.3 broke the loop by letting an unstamped admin see the **login form** | The loop now breaks by routing them to the **challenge** instead (§6.3), with `PanelLogin::mount()` retargeted (§6.4). Same five cases traced; all still terminate. |
| 13 | Middleware failure → `redirect()->guest(getLoginUrl())`, one path | Two paths, branching on cause: not enrolled → set-up; enrolled-but-unstamped → challenge (§6.2). |
| 14 | — | **New constraint surfaced:** the challenge route must not carry the stamp middleware, or it gates itself; and skipping by route name cannot work, because during `POST /livewire/update` the current route is the Livewire endpoint, not the page (§6.3). |
| 15 | Q2 open — "this plan says yes" | **Resolved: admins keep the SPA.** Stated as three ordered rules, with "a specific destination always wins" first — the shared-link case is what decides it, not preference. Now carries a required test (§7.4) rather than being an assertion in prose. **Rejected:** sealing admins out, which breaks the shared-link case and `Dashboard.test.tsx:161-174` for no security gain. |
| 16 | Q5 open — "recommend folding in" | **Resolved: fold in all three** (§6.8). Added the per-site conversion, the two deliberate exclusions so a later sweep does not "fix" `RoleSeeder.php:23`, and a scope guard: if any substitution is not behaviour-preserving it leaves this plan. |
| 17 | Q3 open; clear-on-login mentioned only as a recommendation | **Resolved: session-lifetime + clear-on-login**, and the clear half is promoted from advice to specified wiring (§6.1). It is the security half: without it a password-only login **inherits** a prior stamp and the entire mechanism is bypassable. Separate timer **rejected** — §6.5 is what would finally make expiry reach an open tab, which is precisely why a timer would interrupt mid-action for little gain over the 2-hour idle ceiling. |
| 18 | — | **New ordering constraint surfaced by the Q3 decision:** `attemptWhen` fires the `Login` event *inside* `parent::authenticate()`, so the listener clears **before** §6.1 stamps. Correct as specified — but an implementation that stamped any earlier would delete its own stamp, and the symptom would be an endless challenge loop, not an error. Pinned by a test in §6.9. |

### rev 2 — what the adversarial review found

| # | rev 1 said | Correction |
|---|---|---|
| 1 | `multiFactorAuthenticationRequiredMiddlewareName()` alone wires the fix | **Wrong, and it was the central defect.** It cannot reach `POST /livewire/update`, where every panel mutation happens. `persistentMiddleware()` is required too (§6.5). |
| 2 | Horizon "not verified — flagged, not claimed" (§11) | Verified in 30 seconds: admin 200 / member 403. Promoted into Phase 1 scope (§1.6, §6.7). |
| 3 | "Phase 1 is independently shippable" | True only if `admin-panel.spec.ts:467-485` and `DashboardPageTest.php:136-137` are repaired in the same commit (§8). |
| 4 | Phase 1 "makes panel MFA real" | Narrower: it closes the bypass **for already-enrolled admins**. Self-service enrollment is an open path (§11). |
| 5 | Call the helper "from landing sites 1 and 2" | Site 2 is a render-phase guard; it needs `useEffect` + spinner, not the same call shape (§7.1). |
| 6 | Phase 2 never mentioned suspension | A suspended admin's login returns 200 with `roles`; the branch would strand them cross-origin with no Back (§7.3). |
| 7 | Q3 "session-lifetime… strictly better" | The stamp survives a password-only re-login, making it indefinitely renewable (§10 Q3). |
| 8 | §6.2 "send the user to the login page via §6.3's exit" | Incoherent — §6.3 is a `mount()` override, not a callable exit. The middleware issues a plain `redirect()->guest(...)` (§6.2). |
| 9 | Phase 2's value taken as settled | Under Q1(a) it is a net loss; it is only worth building under Q1(b) (§7.5). |
| 10 | `Login.php:165` / `E2ESeeder.php:121,123` / "four bare literals" / "20 cases" | Citation errors: `:162`; `:231`; **three** literals (`RoleAssignmentService` already uses `Role::ADMIN_TIER`); 21 cases. |
