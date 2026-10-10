# PLAN — Post-Onboarding Routing & the Dashboard ↔ Social Page Loop

**Status:** ✅ **Implemented and verified** (see §8 for results). Uncommitted on `development`.
**Date:** 2026-10-05
**Branch:** `development`
**Scope:** Frontend-only. **No backend, schema, or API changes were required** — every field the redirect needs was already on the wire.

> §§1–7 below are the original plan, left as written so the reasoning stays
> auditable. §8 records what was actually built, what changed during
> implementation, and the verification evidence.

---

## 0. The ask, restated

1. A user whose profile is already established must **not** see the "You're all set / Your profile is ready" screen — send them straight to `/dashboard`.
2. The dashboard needs a link to their **social page** (where they review their connections).
3. The social page needs a link **back to the dashboard**.
4. Advice requested on whether this flow should apply to `user`/`coach` but not `admin`/`super-admin`.

---

## 1. Executive summary

| # | Finding | Impact |
|---|---|---|
| **F1** | Three separate code paths send people to `/onboarding`, not one. Fixing only the "all set" card leaves two of them. | Scopes change #1 |
| **F2** | `Onboarding.tsx:292` is the **only** in-app navigation to `/u/:username` anywhere in the app. | Change #2 is **mandatory**, not cosmetic |
| **F3** | **There is no `user` role.** It is `member`. And real self-registered users have `roles: []`. | A positive allowlist breaks your own login |
| **F4** | **Pre-existing P1, confirmed live:** `/u/:username` ejects anonymous visitors to `/login`. The e2e test guarding this is failing on `development` today. | Prerequisite for change #3 |
| **F5** | "See all" on the connections rail is an inert `<span>`; no connections-index route exists. The backend endpoint for one **does** exist. | Scoping decision |

**Recommendation on #4 (short form): do not role-gate the redirect. Role-gate the nav link instead.** Reasoning in §5.

---

## 2. Verified current state

Everything below was read from the working tree, the live Postgres DB, or a live HTTP probe. Claims that were checked but *not* confirmable are marked.

### 2.1 How people reach `/onboarding` (F1)

| # | Location | Code | Trigger |
|---|---|---|---|
| 1 | `web/src/routes/Login.tsx:35` | `navigate(from?.pathname ?? '/onboarding', { replace: true })` | **Every login** with no saved `from` |
| 2 | `web/src/components/auth/AuthShell.tsx:64` | `return <Navigate to={\`/onboarding${suffix}\`} replace />` | `RequireGuest` — any **authenticated** visitor hitting `/login`, `/register`, `/forgot-password` |
| 3 | `web/src/routes/VerifyEmail.tsx:57` | `<Button render={<Link to="/onboarding" />}>` | Explicit click after verifying |
| 4 | `web/src/routes/Onboarding.tsx:79` | `{status.step === 4 && <OnboardingComplete … />}` | Renders the "You're all set" card |

**No guard anywhere reads onboarding status.** Verified: `RequireAuth` checks session only, `RequireVerified` checks `email_verified` only, `RequireGuest` is the only guard that names `/onboarding` and it fires regardless of completion. So nothing *forces* an incomplete user into onboarding — and nothing keeps a *complete* user out. That is exactly the reported symptom.

Post-register goes to `/verify` (`Register.tsx:36-39`), and the backend's `VerifyEmailResponse.php:24` redirects the browser to `{frontend}/login?verified=1` — which hits path #2 and lands on `/onboarding?verified=1`. That is the only reason the `?verified` banner at `Onboarding.tsx:55-57` exists. **This matters for §4.1.**

### 2.2 The data is already on the wire

`api/app/Http/Resources/UserResource.php:33-35`:

```php
'roles' => $this->getRoleNames(),
'onboarding_completed' => (bool) $this->profile?->onboarding_completed_at,
'onboarding_step' => Onboarding::currentStep($this->resource),
```

Typed on the frontend already at `web/src/features/auth/types.ts:12-27`. `UserResource` is returned by `/api/me`, all four onboarding endpoints, **and `POST /login`** — so the login handler can decide its destination with zero extra requests.

Completion is a real column, not a derivation: `profiles.onboarding_completed_at`, nullable timestamp (`api/database/migrations/2026_08_07_004006_create_profiles_table.php:32`), checked first and short-circuiting in `api/app/Support/Onboarding.php:28-31`. Every other profile field is nullable, so step 4 is reachable with an empty bio, location, and avatar.

### 2.3 The RTK Query cache trap

`authApi` (`reducerPath: 'authApi'`, `tagTypes: ['Me']`) and `profileApi` (`reducerPath: 'profileApi'`, `tagTypes: ['OnboardingStatus','PublicProfile']`) are **separate `createApi` instances**. Verified — they cannot invalidate each other.

Consequence: `submitOnboardingStep3` invalidates `['OnboardingStatus']` only. The cached `/api/me` still says `onboarding_completed: false` for the rest of the session. There is no `setupListeners`, no `refetchOnFocus`.

**Therefore:** the redirect inside `Onboarding.tsx` must read `useGetOnboardingStatusQuery` (correctly invalidated), **not** `useGetMeQuery`. The `Login.tsx` and `RequireGuest` paths may read `/api/me` safely because `login`/`register`/`logout` all invalidate `Me`.

### 2.4 What the "social page" actually is

It is **`/u/:username`** — `PublicProfile.tsx`, with the connections rail, the arc strip, the profile timeline, and three nested tab routes (About / Reviews you left / Reviews they left you). There is no other candidate; **no `/connections` route exists**.

Two structural facts:
- `/u/:username` is registered at `App.tsx:103`, **outside** the `AppLayout` group that opens at `App.tsx:115`. It therefore renders **no header, no sidebar, no user menu** — and has no link back to anywhere. Browser-back is the only way out.
- It carries **no guard at all** — deliberately anonymous-accessible (`PLAN-APP-HEADER.md` D5).

### 2.5 F2 — the social page has exactly one door, and change #1 removes it

Exhaustive grep of non-test `web/src` for navigation to a profile page returns **one** result:

```tsx
// web/src/routes/Onboarding.tsx:292 — inside OnboardingComplete
<Button onClick={() => navigate(username ? `/u/${username}` : '/')}>
  View your profile
</Button>
```

`ReviewerDirectory.tsx:126` renders `@{username}` as **plain text**. `ConnectionsRail` tiles are `<li>` + `<span>`, not links. The header's people icon (`ConnectionRequestsBell.tsx:43`) is a popover trigger containing zero `<Link>`s.

> **This is the load-bearing finding.** Deleting the "You're all set" card without adding change #2 makes the entire social layer (STEP-13) reachable only by typing a URL.

### 2.6 F4 — `/u/:username` already ejects anonymous visitors (pre-existing bug)

`PublicProfile.tsx:47` calls `useGetConnectionsRailQuery(undefined, { skip: !profile })`. `/api/connections` is `auth:sanctum`. For an anonymous visitor the public profile loads (200), so the rail query is **not** skipped, fires, and 401s. `baseQuery.ts:66` broadcasts `auth:unauthenticated` on any 401, and `UnauthenticatedRedirect.tsx:9` exempts only `/login`, `/register`, `/forgot-password`.

Confirmed by live HTTP probe:

```
/api/connections    status=401
/api/me             status=401
/api/u/e2e-member   status=200
```

And confirmed end-to-end with a headless browser against the running stack:

```
FINAL URL: https://app.speechcoach.test/login
API CALLS:  200 /api/u/e2e-member
            401 /api/connections      <-- the trigger
            200 /api/u/e2e-member
            401 /api/me
BODY: "Log in  Welcome back. Email Password …"
```

`web/tests/app-shell.spec.ts:82` (`D5 — public profile stays public`) guards exactly this and **fails on all four browser projects today**. Git history explains it: the test landed in `2ddc752` (app shell); `ConnectionsRail` landed later in `a16cbbc` (STEP-13). STEP-13 broke it and the e2e suite evidently was not re-run.

> This is **not** caused by anything in this plan, but it is a **prerequisite** for change #3 — and it means the social page is currently not publicly shareable at all.

### 2.7 F3 — roles, verified against the live database

`RoleSeeder.php:23` seeds exactly four: `super_admin`, `admin`, `coach`, `member`. **There is no `user` role.** Registration (`CreateNewUser.php:41-44`) calls no `assignRole` at all.

Live query against the running Postgres:

```
  id  |            email            |    username     |    role     | onboarded
------+-----------------------------+-----------------+-------------+-----------
    1 | mars.demo@example.com       | marsdemo        | (none)      | t
    3 | mars.kwong.cheung@gmail.com | mkcheung        | (none)      | t
   29 | mars@gmail.com              | mkcheung0       | (none)      | t
   41 | mars2@gmail.com             | mc1             | (none)      | t
   44 | test3@gmail.com             | mkcheung1       | (none)      | t
 9001 | super-admin@e2e.test        | e2e-super-admin | super_admin | t
 9002 | admin@e2e.test              | e2e-admin       | admin       | t
 9003 | coach@e2e.test              | e2e-coach       | coach       | t
 9004 | member@e2e.test             | e2e-member      | member      | t
```

**Every real (non-fixture) account has no role — including `mc1`, the account in your screenshots, and your own primary login.** A check written as `roles.includes('member') || roles.includes('coach')` matches **none of them**.

The existing frontend helper already handles the hierarchy correctly (`web/src/lib/roles.ts:17-23`) — `hasRole(user,'admin')` returns true for `admin` **or** `super_admin`. Use it; do not hand-roll.

### 2.8 F5 — connections surface gaps (pre-existing, informational)

- `ConnectionsRail.tsx:45` — "See all" is a `<span>`, not a link. Its own comment says no connections-index route exists.
- The rail always shows the **viewer's own** connections, on every profile it is rendered on (`ConnectionsRail.tsx:11-21` flags this as an open product question).
- `GET /api/connections` **is** a full cursor-paginated list (20/page, `meta.next_cursor`, `?state=accepted|pending`) — so a real connections page needs **no new backend**.
- The `connections` table currently has **0 rows**. The rail will be empty on every account until requests are sent.

---

## 3. Advice on the role question (#4)

**Your instinct is directionally right, but it should be applied to the link, not the redirect.** Three reasons:

**a) Role-gating the redirect makes the admin experience worse, not better.** All six seeded fixture users — including `admin@e2e.test` and `super-admin@e2e.test` — have `onboarding_completed_at` set (`E2ESeeder.php:191`). Nothing in the backend ever puts an admin in a half-onboarded state. So the only thing a role carve-out on the redirect would achieve is *stranding an already-onboarded admin on a "You're all set" card* that the change exists to eliminate. There is no third destination to send them to: admin tooling is a **separate Filament panel at `/control-panel`** with mandatory TOTP (`AdminPanelProvider.php:57`, `isRequired: true`), which the React app never links to. `/dashboard` is the only React home an admin has.

> **Reversed 2026-10-10, on changed facts — see `PLAN-ADMIN-LOGIN-REDIRECT.md`.** Both premises above no longer hold: `roles.ts` now exports `ADMIN_PANEL_ITEM`, so a third destination exists; and the panel's mandatory TOTP was found to be unenforced for an SPA-authenticated session (a live bypass, closed by that plan's Phase 1, `RequireFilamentMfaChallenge` + a step-up challenge page). With the bypass closed, the redirect's post-login destination for `admin`/`super_admin` (no `from` present) is now `ADMIN_PANEL_ITEM.to`, via `web/src/lib/roles.ts`'s `getPostLoginDestination()` — implemented, not merely proposed. The reversal is knowing: `/dashboard` is close to empty for an admin (nothing in `navItemsFor`'s subtractive branches leaves them much to do there), and the panel is where their actual work lives, once reaching it demands a second factor the way the panel's own login form already does.

**b) The role name in your ask does not exist, and the obvious implementation would break your own account.** Per §2.7: the role is `member`, not `user`, and every real self-registered account has `roles: []`. An allowlist would silently exclude you from the fix you asked for — and it would work fine for `member@e2e.test`, which is the worst failure mode (passes in testing, fails in real use).

**c) The codebase already has the right pattern for role-differentiated UX, and it's at the nav layer.** `web/src/lib/roles.ts:81-86` hides `Find reviewers` and `Become a Coach` from admins via `!hasRole(user,'admin')`. A social/connections link is the same shape of thing: admins moderate connections in Filament's `ConnectionResource`, they don't maintain a social graph. Indeed `ConnectionPolicy.php:29-36` already bars admins from blocking, on the stated principle *"Admin never acts as a party to a connection."*

### Recommendation

| Behaviour | Applies to |
|---|---|
| Onboarding-complete → `/dashboard` | **Everyone**, no role check |
| "Your profile / connections" link shown | Everyone **except** `admin` / `super_admin` |

Write the gate as `!hasRole(user, 'admin')` — never a positive check for `'user'`, `'member'`, or `'coach'`.

> **Pre-existing bug worth noting while you're here:** `ConnectionPolicy.php:31` checks `$user->hasRole('admin')` only, so a `super_admin` currently **passes** the block gate that `admin` is denied — contradicting `EnsureUserIsAdmin.php:31-39`'s own stated rule that `super_admin` is a strict superset. Out of scope; flagged because it is the same distinction this plan has to get right.

---

## 4. Proposed changes

Ordered by dependency. **Phase 0 is a prerequisite for Phase 3.**

### Phase 0 — Fix the D5 regression (prerequisite, F4)

**Problem:** any 401 from a public route ejects the visitor to `/login`.

**Recommended fix — widen the exemption list in `UnauthenticatedRedirect.tsx:9`:**

```ts
const GUEST_PATHS = ['/login', '/register', '/forgot-password']
/** Public routes that may legitimately fire authenticated queries whose
 *  401 is an expected "no session", not a sign-out. */
const PUBLIC_PATHS = ['/u/']
```

…and skip the redirect when the current path matches either. This is preferred over `skip`-ing the rail query because it is a route-level invariant, it fixes the problem for *any* future probe on a public page (including the one Phase 3 wants to add), and it keeps the fix in the one file whose whole job is this decision.

**Alternative considered and rejected:** gating the rail query on a session check — that just moves the same 401 to a different query.

**Verification:** `npx playwright test tests/app-shell.spec.ts -g "public profile stays public"` must go 4/4 green (it is 0/4 today).

### Phase 1 — Onboarding-complete users land on `/dashboard`

**1a. `web/src/routes/Onboarding.tsx` — the authoritative backstop.**
Replace the `status.step === 4` branch with a redirect and **delete `OnboardingComplete` entirely** (lines 283-298):

```tsx
if (status.step === 4) {
  return <Navigate to="/dashboard" replace />
}
```

Place this **before** the step-rail `<ol>` renders — today `stepIndex` is `3` at step 4, so the rail renders in a nonsense all-past state behind the card.

Reads `useGetOnboardingStatusQuery`, which **is** invalidated by `submitOnboardingStep3` — so finishing step 3 redirects immediately (§2.3). This single change also covers typed URLs and `VerifyEmail.tsx:57`'s link, at the cost of one hop through a `Loading…` flash.

**1b. `web/src/routes/Login.tsx:35` — remove the flash on the common path.**
The `POST /login` response already carries `onboarding_completed` (§2.2):

```tsx
const { user } = await login(values).unwrap()
const from = (location.state as { from?: { pathname?: string } } | null)?.from
navigate(from?.pathname ?? (user.onboarding_completed ? '/dashboard' : '/onboarding'), { replace: true })
```

> Confirm the unwrapped login response shape is `{ user }` before relying on it — `LoginResponse.php:17-22` returns `new JsonResponse(['user' => new UserResource(...)])`, but check `authApi.ts`'s `transformResponse`, if any.

**1c. `web/src/components/auth/AuthShell.tsx:64` — `RequireGuest`.**
It already holds `data` from `useGetMeQuery`:

```tsx
const target = data.user.onboarding_completed ? '/dashboard' : '/onboarding'
return <Navigate to={`${target}${suffix}`} replace />
```

**1d. ⚠️ Decide what happens to the `?verified=1` banner.**
Today the "Email verified." banner renders at `Onboarding.tsx:55-57`. After 1c, an already-onboarded user who clicks a verification link lands on `/dashboard` and **the confirmation silently disappears**. Two options:

- **(i) Recommended** — forward the suffix (1c already does) and render the same `<FormBanner variant="success" message="Email verified." />` on `Dashboard.tsx` when `searchParams.has('verified')`. ~4 lines, preserves the feedback.
- (ii) Accept the loss. Cheaper, but silently drops confirmation of a security-relevant action.

*This is the one genuine product decision in the plan — flagging rather than assuming.*

### Phase 2 — Dashboard → social page (F2: mandatory)

**2a. `web/src/routes/Dashboard.tsx:39` — the link you asked for.**
Pair it with the `<h1>` in a header row. The file already establishes the idiom at lines 150-158:

```tsx
<div className="flex items-baseline justify-between gap-4">
  <h1 className="text-2xl font-semibold">My reviews</h1>
  {username && !hasRole(user, 'admin') && (
    <Button variant="outline" size="sm" render={<Link to={`/u/${username}`} />}>
      Your profile & connections
    </Button>
  )}
</div>
```

Needs `useGetMeQuery` for `user.username` + `user.roles`. `Dashboard.tsx` does not currently call it — RTK Query dedupes against `RequireAuth`'s existing subscription, so no extra request.

> **Test trap:** `Dashboard.test.tsx`'s `stubReviews` fetchMock handles only `/api/reviews` and **throws** on anything else. Adding `/api/me` requires stubbing it in all five tests in that file.

**2b. Recommended — also add it to the sidebar/user menu.**
A dashboard-only link leaves the social page unreachable from the other eight authenticated routes. Adding one item to `navItemsFor()` in `web/src/lib/roles.ts` surfaces it in **both** `AppSidebar` and `UserMenu` (both consume that one function).

Requires widening the signature from `Pick<CurrentUser,'roles'>` to `Pick<CurrentUser,'roles'|'username'>`, and the item must be omitted when `username` is null. Gate it `!hasRole(user,'admin')`, matching the two existing precedents at `roles.ts:81-86`.

> `roles.test.ts` uses `toContain` / `not.toContain` throughout — no test asserts the exact item list or ordering, so adding an item breaks nothing. The signature widening will need the test's user fixtures updated.

### Phase 3 — Social page → dashboard (depends on Phase 0)

**`web/src/routes/PublicProfile.tsx`** — add a back link **above the cover card** (i.e. as the first child of the `max-w-5xl` column at line 65), for authenticated viewers only:

```tsx
{me && (
  <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
    ← Back to dashboard
  </Link>
)}
```

Two hard constraints:

1. **It must NOT go inside the `<nav aria-label="Profile sections">` block** (lines 89-99). `PublicProfile.test.tsx:152-185` asserts `expect(links).toHaveLength(3)` plus an exact-order `toEqual` on their hrefs. Placing it outside that `<nav>` keeps those green.
2. **Gating on `useGetMeQuery` is only safe after Phase 0.** Without it, the probe's 401 ejects anonymous visitors — the §2.6 bug, by a second route. With Phase 0, it is safe and correct: anonymous visitors see no back-link, authenticated ones do.

If you prefer to skip Phase 0, the fallback is an **unconditional** link — but an anonymous visitor clicking it hits `RequireAuth` and bounces to `/login`. Not recommended; and Phase 0 should be done regardless, since the D5 regression is live on `development` right now.

---

## 5. Test impact

### Will break — must be updated with the change

| File | Line | Why |
|---|---|---|
| `web/tests/auth.setup.ts` | 69 | `waitForURL(\`${APP_URL}/onboarding\`)`. Fixture users **are** onboarded, so they will land on `/dashboard` and this times out. **All three setup projects fail → every browser project `dependencies: ['setup']` → the entire Playwright suite fails.** One-line fix, but suite-fatal if missed. Its own comment names this change as "not yet existing". |
| `web/tests/onboarding.spec.ts` | 56-58 | Clicks `'View your profile'` then asserts `/u/${username}`. That button will no longer exist. Rewrite to assert the redirect to `/dashboard`, then navigate via the new Phase 2 link. |
| `web/src/routes/Onboarding.test.tsx` | 90-113 | `'shows a link to the finished profile once step 4 is reached'` — asserts `"You're all set"` and the button. Rewrite as a redirect assertion. **Note:** `renderWithProviders` mounts the component under a single catch-all route (`test/renderWithProviders.tsx:74`), so a `<Navigate to="/dashboard">` re-matches `*` and loops. This test needs its own router with a real `/dashboard` route. |
| `web/tests/app-shell.spec.ts` | 82-99 | Already failing (§2.6). Phase 0 **fixes** it. |

### At risk — verify

| File | Why |
|---|---|
| `web/src/routes/Dashboard.test.tsx` | `stubReviews` throws on unstubbed URLs; Phase 2a adds `/api/me`. Also asserts `queryByRole('link', {name: /watch/i})` is absent in 3 negative cases — keep the new link's accessible name clear of `/watch/i`. |
| `web/src/routes/PublicProfile.test.tsx` | Safe **if** the back-link stays outside the profile-sections `<nav>` (see Phase 3). Its fetchMocks also throw on unstubbed URLs — Phase 3's `/api/me` needs stubbing in all 7. |
| `web/src/lib/roles.test.ts` | Assertions are `toContain`-based, so a new item is safe; the `navItemsFor` signature widening needs fixture updates. |
| `web/tests/speech-create.spec.ts` | Lines 52-66 walk the wizard and click `/skip|continue/i`. Navigates by URL afterward so it may survive, but the regex could match on the post-redirect page. **Unverified — must be re-run.** |

### Backend tests

**None affected.** Backend tests assert JSON contracts, never navigation, and no backend change is proposed. The contracts this plan depends on are already pinned by `ResumableOnboardingTest.php:60` (`step → 4`), `MeEndpointTest.php:45-46` / `:93-94` (`roles`, `onboarding_completed`), and `E2ESeederRolesTest.php:31` (seeded users onboarded). A subagent ran three of these: **9 passed, 48 assertions** — baseline green.

---

## 6. Open decisions for you

1. **`?verified=1` banner** (Phase 1d) — forward it to `/dashboard`, or let it drop? *Recommend: forward.*
2. **Phase 2b sidebar item** — dashboard-only link, or sidebar + user menu too? *Recommend: both; a dashboard-only link leaves the social page unreachable from 8 other routes.*
3. **Link label** — "Your profile & connections", "Your profile", or something else? The destination is a profile page that happens to carry the connections rail.
4. **Scope of "review their connections."** `/u/:username` shows at most 20 connections with an inert "See all" (§2.8). If you meant a real, full, paginated connections page, that is a **separate piece of work** — but `GET /api/connections` already supports it fully (cursor paging, 20/page), so it needs no backend. Say the word and I will scope it as a Phase 4; I have deliberately left it out as beyond the stated ask.

## 7. Out of scope — found en route, not addressed

- `ConnectionsRail` shows the **viewer's own** connections on every profile, including other people's (`ConnectionsRail.tsx:11-21` — flagged there as an open product question).
- `ConnectionPolicy.php:31` lets `super_admin` block connections while denying `admin` (§3).
- `useUnblockConnectionMutation` is exported but unreachable from any UI (`connectionApi.ts:101-107`).
- No endpoint lists blocked connections (`?state=blocked` → 422 by design).
- The `connections` table has 0 rows, so every rail is empty until requests are sent.

---

## 8. Implementation record

All four phases shipped. Decisions taken on §6's open questions: **(1)** forward
`?verified=1` to the dashboard and render the banner there; **(2)** sidebar item
*in addition to* the dashboard link; **(3)** label "Your profile & connections"
on the dashboard, "Your profile" in the nav; **(4)** the full connections page
was left out of scope, as flagged.

### 8.1 Files changed

| File | Change |
|---|---|
| `web/src/components/auth/UnauthenticatedRedirect.tsx` | **Phase 0.** Added `PUBLIC_PATHS = ['/u/']`, exempted from the 401 eject |
| `web/src/routes/Onboarding.tsx` | Step 4 → `<Navigate to="/dashboard" replace />`, carrying `?verified=1`; deleted `OnboardingComplete` |
| `web/src/features/auth/authApi.ts` | `login` retyped `mutation<void>` → `mutation<MeResponse>` so the response can be read |
| `web/src/routes/Login.tsx` | Lands on `/dashboard` vs `/onboarding` off `user.onboarding_completed` |
| `web/src/components/auth/AuthShell.tsx` | `RequireGuest` likewise, preserving the `?verified=1` suffix |
| `web/src/routes/Dashboard.tsx` | "Your profile & connections" link (role-gated) + the `?verified=1` banner |
| `web/src/lib/roles.ts` | `Your profile` nav item; `navItemsFor` widened to `Pick<CurrentUser,'roles'\|'username'>` |
| `web/src/routes/PublicProfile.tsx` | "← Back to dashboard", signed-in viewers only, outside the sections `<nav>` |
| **`web/src/features/profile/profileApi.ts`** | **Not in the original plan** — see §8.2 |

Tests updated: `Onboarding.test.tsx`, `roles.test.ts`, `Dashboard.test.tsx`,
`PublicProfile.test.tsx`, `auth.setup.ts`, `onboarding.spec.ts`,
`speech-create.spec.ts`.

### 8.2 The one real bug found during verification

§2.3 warned that `profileApi` cannot invalidate `authApi`'s `Me` tag. That trap
bit the implementation itself, and **only the live e2e walk caught it** — every
unit test passed because each stubs `/api/me` directly.

A user who finished onboarding got the redirect, but `/api/me` still reported
`username: null` for the rest of the session. Both new links are keyed off that
username, so **neither the dashboard link nor the sidebar item appeared** until a
full page reload. The failing run's DOM snapshot showed the sidebar with the item
absent entirely.

Fix: a `refreshMe` helper in `profileApi.ts` that dispatches
`authApi.util.invalidateTags(['Me'])` from `onQueryStarted` after the request
succeeds, wired into the five mutations that change what `UserResource` reports —
onboarding steps 1 and 3, `updateOwnProfile`, `updateOwnUsername`,
`updateOwnAvatar`. It no-ops on failure, so a rejected mutation does not trigger a
pointless refetch.

This also repairs two pre-existing staleness bugs the audit noted in passing:
renaming yourself or changing your avatar previously left `/api/me` stale too.

### 8.3 Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint src tests` | **0 errors** (2 pre-existing warnings in the untouched `SpeechCreate.tsx`) |
| `npx vitest run` | **62 files, 339 tests, all passing** |
| `onboarding.spec.ts` (chromium, full walk) | **6/6 passing** — register → verify → 3 steps → `/dashboard?verified=1` + banner → profile link → `/u/{username}` → back link → `/dashboard`, plus the sidebar item's href |
| `app-shell.spec.ts` D5 (all 4 browsers) | **passing** — was 0/4 before Phase 0 |
| Login redirect + role gate, all 4 roles, live | see below |

Live browser probe against the running stack:

```
member       /dashboard  Your profile: YES  | … Find reviewers … Your profile, Edit profile … Become a Coach
coach        /dashboard  Your profile: YES  | … Find reviewers … Your profile, Edit profile … (no Become a Coach)
admin        /dashboard  Your profile: NO   | … (no Find reviewers) … Edit profile …
super_admin  /dashboard  Your profile: NO   | … (no Find reviewers) … Edit profile …
```

Every role lands on `/dashboard`; the social link is present for member/coach and
absent for admin/super_admin — §3's recommendation, confirmed in the real app.

### 8.4 Known-flaky tests, confirmed pre-existing

`auth.setup.ts` logins and several `app-shell.spec.ts` cases fail intermittently
on firefox/webkit with `page.goto`/`locator.fill` timeouts. **This was verified as
pre-existing, not a regression:** the changes were stashed and the same suite
re-run on a clean baseline, producing an **identical 6 failed / 8 passed on the
same tests**. `auth.setup.ts`'s own docblock documents this at "roughly two runs
in five."

Two related fixes were applied. `speech-create.spec.ts` — which **does** run in
CI — had the same bare-`goto` problem and failed locally before reaching any of
this work's code; it now uses `DOM_READY` too, and its budget was raised for the
same reason. Its `waitForURL` is matched as a pattern, since that walk arrives via
a verification link and the URL carries `?verified=1`. It passes 6/6.

`onboarding.spec.ts` used a bare `page.goto`, whose
default `waitUntil: 'load'` **never resolves** on `/register` behind the Vite dev
server — measured at 60s+ pending, while `domcontentloaded` returned in 638ms and
the page rendered at 970ms. It now uses the `DOM_READY` constant that
`essay-editor.spec.ts`, `captions.spec.ts`, and `voice-test-helpers.ts` already
use, and its budget was raised to 120s since the walk grew by three navigations.

### 8.5 Still out of scope

Everything in §7 remains untouched, as does §6's question 4 (a real paginated
connections page — `GET /api/connections` already supports it fully, so it needs
no backend work whenever you want it).
