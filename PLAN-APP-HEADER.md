# Plan — the application shell (header + sidebar)

**Scope:** one shared header and one role-aware left sidebar on every authenticated page, plus a height-capped video player on the watch screen · **Depends on:** [01](STEP-01-identity.md) · **Sits alongside:** [07](STEP-07-write-commentary.md) (current `HEAD`)
**Plan:** [§5.9 auth](MODERNIZATION_PLAN.md) · [§6.5 profiles and onboarding](MODERNIZATION_PLAN.md) · [§7.1 the capability matrix](MODERNIZATION_PLAN.md) · [§9.5 typographic placeholder](MODERNIZATION_PLAN.md)

> **Note on this file.** It began as a header-only plan and now covers the whole authenticated shell — header, sidebar, and the watch screen's player height — because they share one layout route, one landmark structure and one vertical budget. Splitting them would reproduce exactly the per-page duplication D1 exists to remove. Decisions are prefixed **D** (header), **S** (sidebar) and **W** (watch screen); the watch-screen work is genuinely independent and can ship on its own. The filename is unchanged so existing references still resolve.

---

# ⛔ Read this before building anything

Reviewing permissions and roles for the sidebar turned up **one live security vulnerability and three RBAC gaps**. The first is unrelated to navigation and outranks it.

## P0 — `GET /api/spikes/presign` is unauthenticated and signs arbitrary storage paths

[`api.php:23`](api/routes/api.php#L23) registers it with **no middleware at all**, outside the `auth:sanctum` group. [`PresignController`](api/app/Http/Controllers/Api/PresignController.php) validates `path` as `['required','string']` and hands it straight to `MediaUrlSigner::presign` — no prefix check, no ownership check, no allow-list. There is no environment guard on the backend route (unlike the SPA's `/__spikes`, which is double-guarded).

**The escalation is concrete and needs no credentials:**

1. `GET /api/speeches/{id}` as an **invited-but-not-yet-accepted** reviewer returns `ulid` in the reduced tier — [`SpeechController.php:93`](api/app/Http/Controllers/Api/SpeechController.php#L93), directly beneath a comment promising *"No signed playback URL"* ([`:85-87`](api/app/Http/Controllers/Api/SpeechController.php#L85-L87)).
2. Media paths are deterministic: `speeches/{ulid}/{ulid}/720p.mp4`, `avatars/{userId}/{ulid}.jpg`.
3. `GET /api/spikes/presign?path=…` returns a working 10-minute signed URL **to anyone, authenticated or not**.

That bypasses `SpeechUploadController::authorizeGrantingAccess`, the sole playback gate. It is reachable by reviewers who declined, were revoked, or never accepted — the exact population §6.11 and STEP-05 exist to exclude. The controller's own docblock says it *"must not survive past S0 unauthenticated once real media/ownership checks exist."* Those checks landed in STEP-03/05; the route was never removed.

**There is no mitigating control anywhere in the chain — checked specifically.** `media_public` ([`filesystems.php`](api/config/filesystems.php)) is a plain S3 disk over a single bucket with no prefix restriction; `MediaUrlSigner::presign` passes the path straight to `Storage::temporaryUrl` with no validation; nginx proxies `/api/` wholesale. Videos, posters and avatars all share that bucket, so the scope is *any object in it* — though in practice only the video path is **guessable**: avatar filenames use a fresh `Str::ulid()` that is never exposed. The route is also unauthenticated **and unrate-limited**, making it a signing oracle.

**Fix before any nav work: delete the route, or gate it behind `auth:sanctum` plus an ownership-scoped path allow-list.** This is not sidebar scope — it is simply more important, and it was found while doing what was asked.

## P1 — Registration assigns no role, so every real user is invisible to the reviewer directory

[`CreateNewUser.php`](api/app/Actions/Fortify/CreateNewUser.php) contains no `assignRole` call, and neither does onboarding. Outside tests, the **only** role assignment in the codebase is the CLI `php artisan user:grant-role` ([`GrantRoleCommand.php:43`](api/app/Console/Commands/GrantRoleCommand.php#L43)) and the E2E seeder.

So every organically registered user has `roles: []`. And because `scopeReviewerCandidates` filters `role(['member','coach'])` ([`User.php:67`](api/app/Models/User.php#L67)), **a real registered user never appears in the reviewer directory and can never be found or invited** — a live product bug in the app's only discovery mechanism (§6.3), not merely a sidebar concern.

**Consequence for this plan (S3):** `roles: []` is the *normal* case, not an edge case.

## P2 — `ReviewPolicy::viewDirectory` is dead code

§7.1's matrix says an Admin may **not** browse the reviewer directory. The policy method exists and returns `! $user->hasRole('admin')` — but [`ReviewerDirectoryController::index`](api/app/Http/Controllers/Api/ReviewerDirectoryController.php) makes **no authorization call whatsoever**, and its docblock states the opposite: *"Every authenticated user may browse it."* The policy's own comment concedes it is *"Present for symmetry/future use."*

This is the one nav item with genuine role differentiation, and it is **currently unenforced**. See S4 — it must be wired before the sidebar hides it, or hiding becomes the only protection.

## P3 — `super_admin` is inert, and strictly weaker than `admin`

Every check in the codebase is `hasRole('admin')`; Spatie applies no hierarchy. A `super_admin` therefore gets **no admin powers at all** and behaves like a roleless user — it can even be invited and accept reviews, which §7.1 denies admins categorically. Do not branch sidebar logic on `super_admin`; treat it as `admin` for navigation, and note the underlying gap belongs to Step 12.

---

## ✅ What you can do when this is finished

> Every authenticated page carries the same header and the same left sidebar. The sidebar says where you can go; the header says who you are. **Every part of the app is now one click from every other part** — including `/profile`, which today is reachable from nowhere at all.

### Demo script

1. Log in. `/dashboard` now has a header (app name · bell · your name) and a left sidebar carrying **every** destination: **My speeches**, **My reviews**, **Upload a speech**, **Edit profile** — plus **Find reviewers** if S2's optional item shipped.
2. Walk the sidebar to every destination. Both header and sidebar are **identical on every page** and do not flicker or remount as you navigate. The current page is marked — and it is marked by more than colour.
3. Click **Edit profile**. You have just reached a fully-built page that, before this change, **had no link pointing at it anywhere in the application**.
4. Click your name. The menu opens with **the same destination list**, plus **Log out** — because below 1024px the menu is the only nav there is, so it must be complete, not a subset.
5. Drive the menu by keyboard alone: `Tab`, `Enter`, `↓`/`↑`, `Esc` closes **and returns focus to the trigger**.
6. Press `Tab` from a fresh page load. The **first** stop is "Skip to content", and it jumps focus past both header and sidebar into `<main>`.
7. Narrow the window below 1024px. The sidebar disappears; nothing becomes unreachable.
8. Click **Log out** → `/login`. Press **Back**. You stay logged out — no flash of the dashboard.
9. Take an account that is email-verified but has no role and an incomplete profile, and open `/dashboard`. The header shows **your email address** — not `null null` — and **the sidebar is fully populated** despite `roles: []`.
10. Open `/u/someone` in a private window, signed out. **You still see the profile.** You are not bounced to `/login`.
11. Open a **portrait** speech at `/speeches/{id}`. The player is capped in height and the **Commentary track** card is visible on the same screen — no scrolling. Open a **landscape** speech: it looks exactly as it did before (W2).

Steps 9 and 10 are not padding. Step 9 fails if role logic is written subtractively — every real user has `roles: []` (P1/S3). Step 10 fails if the shell is built the obvious way — see [D5](#d5--the-header-mounts-inside-the-authenticated-layout-only).

> **Why step 9 is worded so awkwardly.** The obvious phrasing — *"register a fresh account and stop halfway through onboarding"* — describes a state that **cannot see the shell at all**. `User` implements `MustVerifyEmail`, and all five layout routes sit behind `RequireVerified`, which redirects an unverified user to `/verify` — a route deliberately outside the layout. So a genuinely mid-onboarding user never reaches a page with a header or sidebar on it. The null-name and empty-roles cases are still real and still must be handled (a verified user can skip profile fields, and *every* user has `roles: []`), but they are **unit-test territory**, not a click-path. An earlier draft asserted this as a demo step without checking it was reachable.

### What this does *not* do

**It does not deliver visibly different navigation per role, because today there is nothing to differentiate.** Coach and Member have identical capabilities in code; there are no admin routes; and the one item §7.1 would gate (the reviewer directory, hidden from admins) is unenforced server-side. The role *mechanism* ships and is tested, so Step 12's admin portal and Coach application drop into it — but v1 honestly shows one tier to everyone. See "What RBAC actually is in this codebase".

## Why this needs a plan and not just a component

The work is already half-started in the working tree, in the shape that does not scale: `LogoutButton` is imported into [`Dashboard.tsx`](web/src/routes/Dashboard.tsx) and [`MySpeeches.tsx`](web/src/routes/MySpeeches.tsx) and nowhere else, so two of the five authenticated pages have a way out of the app and three do not. `NotificationBell` has the same problem one step further along — it exists only on `Dashboard`. The component file even documents the reason:

> *"Same standalone-widget precedent as `NotificationBell` (no shared header/nav exists yet — any authenticated page mounts what it needs)."*
> — [`LogoutButton.tsx:5-6`](web/src/components/layout/LogoutButton.tsx#L5-L6)

That precedent is what this plan retires. The interesting part is not the header markup; it is that three separate things in this codebase are load-bearing and will break quietly if the header is dropped in on top of them. They are D3, D5 and R1 below.

## What is actually there today

Verified against the working tree, not from memory.

| Fact | Evidence |
|---|---|
| Routes are flat — no layout route, no `<Outlet/>` | [`App.tsx:34-130`](web/src/App.tsx#L34-L130) |
| `RequireAuth` + `RequireVerified` are hand-duplicated on 5 routes | [`App.tsx:75-127`](web/src/App.tsx#L75-L127) |
| Every guard already calls `useGetMeQuery()` | [`AuthShell.tsx:26`](web/src/components/auth/AuthShell.tsx#L26), [`:59`](web/src/components/auth/AuthShell.tsx#L59), [`:77`](web/src/components/auth/AuthShell.tsx#L77) |
| `GET /api/me` eager-loads `profile` — no N+1 risk from adding a field | [`api.php:36-38`](api/routes/api.php#L36-L38) |
| `UserResource` carries **no avatar**, and `first_name`/`last_name`/`username` are all nullable | [`UserResource.php:20-30`](api/app/Http/Resources/UserResource.php#L20-L30), [`types.ts:12-23`](web/src/features/auth/types.ts#L12-L23) |
| `POST /logout` returns `200 {"message":"Logged out."}` — plain JSON, no redirect | [`LogoutResponse.php:12`](api/app/Http/Responses/Fortify/LogoutResponse.php#L12) |
| …but `POST /logout` returns **401 when already logged out** (it carries `Authenticate:web`) | verified live against the running app |
| `UserResource` exposes no `display_name`; only `PublicProfileResource` computes the fallback | [`PublicProfileResource.php:29`](api/app/Http/Resources/PublicProfileResource.php#L29) |
| `users.id` is a bigint → JSON **number**, but TS declares `string` | `$table->id()` in the users migration vs [`types.ts:13`](web/src/features/auth/types.ts#L13) |
| **`GET /api/me` has zero test coverage**, and no test in the suite asserts a 401 | `grep -rn "api/me" api/tests/` → nothing |
| Nothing server-side enforces onboarding or email verification — both are client-side gates | no `app/Http/Middleware/` directory exists |
| RTK Query never refetches: no `setupListeners`, no `refetchOnFocus`/`OnReconnect` | [`store.ts`](web/src/app/store.ts) |
| All five routes proposed for the layout share **identical** guards | [`App.tsx:75-127`](web/src/App.tsx#L75-L127) |
| `@base-ui/react@1.7.0` is installed and ships `menu` **and** `avatar` | `web/node_modules/@base-ui/react/`, [`alert-dialog.tsx:1`](web/src/components/ui/alert-dialog.tsx#L1) |
| `authApi` and `profileApi` are **separate `createApi` instances** with separate tag namespaces | [`authApi.ts:19`](web/src/features/auth/authApi.ts#L19), [`profileApi.ts:26`](web/src/features/profile/profileApi.ts#L26) |
| Any 401 from any endpoint broadcasts a global redirect-to-login event | [`baseQuery.ts:64-66`](web/src/lib/baseQuery.ts#L64-L66) |
| **`/profile` is reachable from nowhere** — zero links to it in the entire app | grep of every `Link`/`navigate`/`href` in `web/src` |
| Vitest mocks `fetch` directly (no MSW) and **throw on any unmocked URL** | `unexpected fetch` in 7+ test files |
| `PublicProfile.test.tsx` asserts the page contains **no `list` role** | [`PublicProfile.test.tsx:56`](web/src/routes/PublicProfile.test.tsx#L56) |
| `data-testid` **is** an established convention here — 20 of them in `web/src` | `STEP-15-accessibility.md:41` calls it "the curated `data-testid` module" |
| …but the **auth/login surfaces** carry none, and select by role | [`auth.setup.ts:14-16`](web/tests/auth.setup.ts#L14-L16) |
| `NotificationBell`'s panel is a bare `<div>` with a `<ul>` inside, no `role`, no Esc, no outside-click | [`NotificationBell.tsx:60-64`](web/src/components/layout/NotificationBell.tsx#L60-L64) |
| Posters already presign at **1 hour** for exactly the `<img>`-has-no-refresh reason | [`SpeechResource.php:95`](api/app/Http/Resources/SpeechResource.php#L95) |

### Two things about the baseline

**This plan's starting point is partly uncommitted.** `web/src/components/layout/LogoutButton.tsx` is untracked, and the `Dashboard.tsx` / `MySpeeches.tsx` edits that import it are unstaged. Build-order step 6 ("strip the ad-hoc widgets") operates on changes that exist only in the working tree — a `git stash` silently invalidates that step. Commit or stash deliberately before starting.

**This is not a numbered STEP.** [`STEPS.md`](STEPS.md) puts **Step 08 (the essay)** next. This is cross-cutting UI work that neither displaces 08 nor blocks it; it is small enough to land before 08 or alongside it. It does not change the critical path.

## What RBAC actually is in this codebase

You asked for navigation that varies by role. Here is what the roles genuinely do today — verified by reading every `hasRole` call site, not inferred from role names.

| Role | Enforced anywhere? | Evidence |
|---|---|---|
| `admin` | **Yes** — 11 checks. A *scoped* `Gate::before` with a `$mustFallThrough` list, plus explicit branches in `ReviewPolicy`/`AnnotationPolicy` | [`AppServiceProvider.php:102-120`](api/app/Providers/AppServiceProvider.php#L102-L120) |
| `coach` | **No.** There is no `hasRole('coach')` anywhere in `app/` | only `User.php:67,78`, as a directory *filter facet* |
| `member` | **No.** Same — a directory facet, never a capability | `User.php:67,78` |
| `super_admin` | **No.** Zero code paths (P3) | — |

**Not one route in `api/routes/api.php` is role-gated.** Every authorization decision is ownership- or relationship-based: `$request->user()`-scoped queries, inline owner checks, or the three policies. A member, a coach, and a roleless user have **byte-identical API reach**.

Two things follow, and they define the whole sidebar design:

1. **Coach and Member have identical capabilities today.** §7.1's matrix gives Coach exactly three differences — appear in the directory, attach a voice annotation (Step 10), apply to be a Coach (Step 12). Only the third is a *destination*, and it does not exist yet. A Coach's sidebar and a Member's sidebar are the same sidebar.
2. **Admin is defined by subtraction**, and its portal is not even in this app: §5.5/§12 put it in **Filament, server-rendered, on a separate prefix with 2FA** — so the eventual admin entry is *one link that leaves the SPA*, not a tree of in-app screens.

**The honest summary: today a role-aware sidebar has exactly one item to differentiate** — hiding "Find reviewers" from admins — and that one is unenforced server-side (P2). The mechanism is still worth building, because Step 12 makes it real. But this plan will not pretend v1 delivers visible role differentiation it cannot.

## Decisions

### D1 — One layout route, not a header import per page

Convert the five authenticated routes to children of a single layout route that renders the header once and an `<Outlet/>` beneath it. The guards move onto the layout route with them.

```tsx
<Route element={<RequireAuth><RequireVerified><AppLayout /></RequireVerified></RequireAuth>}>
  <Route path="/speeches"     element={<MySpeeches />} />
  <Route path="/speeches/new" element={<SpeechCreate />} />
  <Route path="/speeches/:id" element={<SpeechWatch />} />
  <Route path="/dashboard"    element={<Dashboard />} />
  <Route path="/profile"      element={<ProfileEdit />} />
</Route>
```

This deletes ten guard wrappers and keeps the header from remounting on navigation. It is not the *only* arrangement that avoids a remount — rendering `<AppHeader/>` once above `<Routes>` and path-gating it on `useLocation()` also works, with a smaller diff — but that alternative keeps a hand-maintained path list that will drift out of sync with the route table on the next route added. The layout route makes route membership and header presence the same fact.

All five routes carry **identical** guards (`RequireAuth` + `RequireVerified`, [`App.tsx:75-127`](web/src/App.tsx#L75-L127)), so hoisting them is safe — checked route by route, since a single differing guard would break this.

One honest limit: with the guards hoisted, `RequireAuth` renders `FullPageSpinner` *instead of the whole layout* while `/api/me` is in flight, so the header is absent for a beat on first paint. Demo-script step 2 (no flicker **between** routes) still holds; initial load is not header-first.

**The layout route is also what keeps the existing test suite green, so it is required rather than merely tidier.** Vitest mocks `fetch` directly — there is no MSW — and every mock ends in `throw new Error(\`unexpected fetch: ${url}\`)`. None of them stub `/api/me` for a header. Because `renderWithProviders` mounts the bare route component rather than `<App/>` ([`renderWithProviders.tsx:35-47`](web/src/test/renderWithProviders.tsx#L35-L47)), a header that lives in a **layout route** is invisible to them and they all keep passing. A header imported into each page component instead would make seven-plus existing test files throw. The cheap-looking option is the expensive one.

`/onboarding` keeps its own `RequireAuth` and stays outside this layout: it is `RequireAuth` **without** `RequireVerified`, and a half-onboarded user should not be offered "Edit profile" as an escape hatch from the form that is trying to create the profile.

### D2 — Base UI `menu`, zero new dependencies

`@base-ui/react@1.7.0` is already a dependency and ships a `menu` module. [`alert-dialog.tsx`](web/src/components/ui/alert-dialog.tsx) is the established pattern for wrapping it: a thin styling layer over the primitive, no logic. Add `web/src/components/ui/dropdown-menu.tsx` the same way.

There are **no Radix packages in this project** — reaching for `@radix-ui/react-dropdown-menu` out of shadcn muscle memory would add a second, redundant primitive library. Base UI gives focus trapping, roving tabindex, `Esc`-to-close and focus restoration for free, which is the whole of demo-script step 4.

### D3 — Initials, not a photo

**The trap:** `avatar_url` is a **presigned URL with a 10-minute TTL** — `MediaUrlSigner::DEFAULT_TTL_SECONDS`, sized for video playback under §9.3. That TTL is harmless on `PublicProfile` and `ProfileEdit`, which are short visits. A header is mounted **continuously for the whole session**. Cache `/api/me` behind a header, leave the tab open for eleven minutes, and the avatar 403s — a broken image on every page, on every route. This is the failure mode that makes "just add `avatar_url` to `UserResource`" wrong despite being a three-line change.

The obvious rebuttal — *"surely something refetches eventually"* — **does not hold here.** The app never calls `setupListeners`, and sets no `refetchOnFocus`, `refetchOnReconnect`, or `keepUnusedDataFor` anywhere ([`store.ts`](web/src/app/store.ts)). RTK Query defaults to refetching **never**, and a persistent header means the `getMe` subscription is never released. Nothing renews that URL short of a full page reload.

**Honest limit on that argument:** the stale URL does not necessarily produce a *visible* broken image. Because D1 guarantees the header never remounts, the `<img>` node persists with an already-decoded bitmap, and browsers do not re-request a painted image because its query string expired. The break needs a cache eviction or a re-render that remounts the node. So the failure is intermittent and hard to reproduce — which is an argument for avoiding it, not a reason to dismiss it, but the plan should not oversell it as certain.

**And the follow-up is smaller than "three parts" suggests:** the longer TTL is not a new idea to invent. [`SpeechResource.php:88-95`](api/app/Http/Resources/SpeechResource.php#L88-L95) already presigns posters at `3600` with a comment giving precisely this rationale — *"there is no seek-refresh mechanism behind an `<img>`"*. Avatars are the same case, so the follow-up is `presign($path, 3600)` plus an `onError` fallback.

**The strongest reasons to ship initials are the ones that survive all of the above:** most users have no avatar at all (§6.5 makes it skippable), `UserResource` genuinely carries no avatar field today, and adding one puts a SigV4 signing operation on `/api/me` — the hottest endpoint in the app, hit on every guarded page load.

> **⚠️ Contrast is a blocking open question, and the numbers are worse than they look.** `colorFromId` returns a fixed `55% 45%` across all 360 hues ([`colorFromId.ts:17`](web/src/lib/colorFromId.ts#L17)). Its existing use is a *decorative poster background*; this plan makes it a **text substrate**, a different bar — and [`STEP-15-accessibility.md:32`](STEP-15-accessibility.md) targets WCAG 2.2 AA.
>
> Computed, not estimated: `hsl(60 55% 45%)` — the yellow — has a relative luminance of 0.415, giving **2.26:1 against white**. AA needs 4.5:1. Roughly half the hue circle fails against white, and a different (smaller) share fails against black, so **no single fixed foreground colour passes at all 360 hues.**
>
> The options are: clamp lightness for the initials variant, choose the foreground per-hue from the computed luminance, or drop the colour and use a neutral chip. **Settle this before writing the component** — it changes the component's API, not just its CSS.

**v1 ships initials on a deterministic hue**, reusing [`colorFromId.ts`](web/src/lib/colorFromId.ts) — already tested, and already the precedent for §9.5's typographic placeholder on posterless speech cards. No new endpoint, no extra request, no expiry, and it renders correctly for a user who has no avatar at all (most of them, since §6.5 makes the avatar skippable).

> ⚠️ **`colorFromId(user.id)` is a trap — do not write it.** `colorFromId` was built for speech **ULIDs**, which are strings. `users.id` is a bigint (`$table->id()`), so `/api/me` emits it as a JSON **number** — even though [`types.ts:13`](web/src/features/auth/types.ts#L13) declares `id: string`. `hueFromId` computes `id.length`, which on a number is `undefined`, so the loop never executes, the hash stays `0`, and **every user in the system gets the identical hue.** Key the hue off `String(user.id)`, and fix the lying type while you are there.

**The display-name fallback chain is load-bearing, not cosmetic.** All three name fields are nullable and a mid-onboarding user has all three null:

```
display_name  →  `${first_name} ${last_name}`.trim()  →  username  →  email
```

Initials derive from the same chain, falling back to the first character of the email. Demo-script step 9 is the test for this.

**That first link in the chain is why this plan needs one backend line.** `profiles.display_name` is editable on the profile page, and [`PublicProfileResource.php:29`](api/app/Http/Resources/PublicProfileResource.php#L29) already computes `display_name ?: "first last"` — but `UserResource` exposes neither field. A header that derives a name from `first_name`/`last_name` alone will **disagree with the user's own profile page** for anyone who set a display name: "Mars Cheung" in the header, "Marsy" everywhere else. That is a correctness bug, not a nicety, and it is one line to avoid — see Backend below.

**If a real photo is wanted later** it is a follow-up, not this plan: add `avatar_url` to `UserResource`, give image presigns a TTL measured in hours rather than ten minutes, and give the `<img>` an `onError` fallback to the initials chip. All three parts are required — shipping only the first is the bug described above.

### D4 — Keep the full-page navigation on logout

[`LogoutButton.tsx:8-15`](web/src/components/layout/LogoutButton.tsx#L8-L15) already documents why a naive `navigate('/login')` loops, and it is right: `invalidatesTags: ['Me']` marks the cache stale but keeps serving the old value during revalidation, so `RequireGuest` sees a user and bounces. There is a second wrinkle it doesn't mention — `authApi` and `profileApi` are **separate `createApi` instances**, so `['Me']` cannot reach `profileApi`'s cached `PublicProfile` entries, leaving the previous user's name and bio in the store.

**A full page load is the blunt instrument that solves both, and it is what this plan keeps — but it is not the only correct fix, and the plan should not claim otherwise.** `dispatch(authApi.util.resetApiState())` plus the same on `profileApi` *removes* the entries rather than marking them stale, so `RequireGuest` sees `isLoading` and renders the spinner until the 401 arrives. Two dispatches, no white flash, no bundle re-download.

Keep `location.assign` for v1 on the grounds that it is one line, has no cache-coherence failure mode to reason about, and logout is not a hot path. Take the soft version only if the reload becomes a real annoyance.

Move the component into the menu as a menu item, and fix one real bug while moving it: `await logout().unwrap()` throws on a failed logout, and nothing catches it. A 419 that survives the single retry, or a network drop, currently produces an unhandled rejection and a button that silently does nothing.

**The tempting fix — "navigate to `/login` regardless of outcome" — is wrong, and it took a validation pass to see why.** `/login` is wrapped in `RequireGuest`, not `RequireAuth`, and `RequireGuest` redirects *authenticated* users onward:

```
AuthShell.tsx:66-69
  if (data) return <Navigate to={`/onboarding${suffix}`} replace />
```

If logout genuinely failed — a 419 that survived the retry means `AuthenticatedSessionController::destroy` never ran — **the session is still alive**. Hard-navigating to `/login` then hands the user to `RequireGuest`, which sees a live session and drops them into the onboarding wizard, still logged in. That is worse than the unhandled rejection it was meant to fix.

**So branch on the outcome. There are three, not two:**

| Outcome | Meaning | Action |
|---|---|---|
| `200` | Logged out | `window.location.assign('/login')` |
| `401` | **Already** logged out — the route carries `Authenticate:web`, so a double-click or a session that died in another tab lands here | Treat as success; same navigation |
| anything else (419, 5xx, network) | Still logged in | **Do not navigate.** Surface the failure in the menu and let them retry |

The third row is the one that matters: silently navigating on a real failure is what produces the `/onboarding` bounce. Telling the user "couldn't sign you out — try again" is both honest and correct.

**The 401 row has a race that must be handled explicitly.** [`baseQuery.ts:64-66`](web/src/lib/baseQuery.ts#L64-L66) dispatches `auth:unauthenticated` **synchronously, inside the failing request** — before the handler's own code runs. So `UnauthenticatedRedirect` client-side-navigates to `/login` while `Me` is *still cached*, `RequireGuest` sees `data`, and bounces to `/onboarding`: the exact flash D4 exists to prevent, arriving by a different road, and potentially painting before `window.location.assign` lands.

**Therefore, in the 401 branch, dispatch `authApi.util.resetApiState()` and `profileApi.util.resetApiState()` before navigating.** With the cache emptied, `RequireGuest` sees `isLoading` and renders the spinner rather than bouncing, and the hard navigation lands over the top of it. Without this, the "logging out twice" acceptance criterion passes while the user still sees an onboarding flash.

For completeness on the transport, all verified against the running stack: logout needs a valid `X-XSRF-TOKEN` (the SPA and API are different origins, so the same-origin CSRF short-circuit does not apply), `session()->invalidate()` plus `regenerateToken()` run server-side, and the response ships fresh `speechcoach_session` and `XSRF-TOKEN` cookies. [`csrf.ts`](web/src/lib/csrf.ts) already handles the token; nothing new is needed.

### D5 — The header mounts inside the authenticated layout only

The tempting version of this feature is a header on *every* page that swaps the identity chip for "Log in / Register" when signed out. **That breaks public profiles**, and the mechanism is worth stating precisely because it is invisible until it happens:

1. Header on `/u/someone` calls `useGetMeQuery()`.
2. Visitor is anonymous → `401`.
3. [`baseQuery.ts:64-66`](web/src/lib/baseQuery.ts#L64-L66) broadcasts `auth:unauthenticated` on **every** 401, from every endpoint, unconditionally.
4. [`UnauthenticatedRedirect.tsx:21`](web/src/components/auth/UnauthenticatedRedirect.tsx#L21) exempts only `/login`, `/register`, `/forgot-password`.
5. `/u/someone` is not on that list → the visitor is redirected to `/login`.

A public profile that ejects anonymous visitors is a worse regression than the one this plan fixes. So: `/`, `/u/:username`, `/login`, `/register`, `/verify`, `/reset-password/:token` keep exactly the chrome they have now.

`/onboarding` and `/verify` are excluded for a second, independent reason: a user on either has no name and no username (all three fields null), and `/profile` sits behind `RequireVerified`, so an "Edit profile" link from `/verify` is a dead end and a "Log out" mid-wizard invites abandoning a resumable flow.

A signed-in-aware public header is a legitimate follow-up, but it must land **after** `GUEST_PATHS` is widened to cover the public routes — that is its prerequisite, and it should be built with an E2E test for demo step 10 specifically.

> **A latent instance of this bug already exists**, which is why the mechanism above is described as fact rather than theory. [`VerifyEmail.tsx:27`](web/src/routes/VerifyEmail.tsx#L27) calls `useGetMeQuery()` on the unguarded `/verify` route, and the component has a whole *"you're not logged in on this device"* branch that is **unreachable in practice** — the 401 bounces the visitor to `/login` before they can read it. Worth fixing, but separately; it is not this plan's job.

### D6 — Moving the notification bell into the header changes its polling scope

`NotificationBell` currently lives only on `Dashboard`, and it polls: `useListNotificationsQuery(undefined, { pollingInterval: 30000 })` ([`NotificationBell.tsx:32`](web/src/components/layout/NotificationBell.tsx#L32)). Putting it in a global header is the obvious move — its own docblock anticipates it — but it silently promotes that poll from **one page** to **every authenticated page, for the entire session**, including the long-lived `SpeechWatch` surface where someone may sit for an hour.

On a self-hosted, zero-cost box that is a real change in steady-state load, not a detail. It is still the right move — a notification bell that only exists on one page is barely a feature — but take it **deliberately**, and if load is a concern the mitigation is `refetchOnFocus` plus a longer interval rather than dropping the bell.

Note also that `MySpeeches` already polls every 3 seconds ([`MySpeeches.tsx:22`](web/src/routes/MySpeeches.tsx#L22)), so this is not the app's first standing poll.

**The larger cost is not polling — it is that the bell is an incomplete disclosure widget, and this change makes it global.** Its trigger sets `aria-expanded` but has no `aria-haspopup` and no `aria-controls`; its panel is a bare `<div>` ([`NotificationBell.tsx:60`](web/src/components/layout/NotificationBell.tsx#L60)) with no `role`, no focus management, no `Esc` handler and no outside-click close. Promoting that from one page to every page multiplies the defect.

**So D6 carries a condition: bring the bell up to the same bar as the user menu in the same change**, or leave it on Dashboard. The cheapest route is to rebuild its panel on Base UI's `popover`, which supplies the roles, focus handling and dismissal for free, exactly as `menu` does for the user menu. That is a second wrapper file beyond D2's — no new dependency, but real work; budget for it or defer the bell.

### D7 — Markup and selector conventions

- **`<nav>` with links, not a `role="tablist"` widget.** The repo's stated convention, from [`MODERNIZATION_PLAN.md:1104`](MODERNIZATION_PLAN.md): *"routed `<nav>` + links, **not** a `role="tablist"` widget — these are URLs people share and go back to."* A `<ul>` inside that `<nav>` is fine; `NotificationBell` already renders one ([`NotificationBell.tsx:64`](web/src/components/layout/NotificationBell.tsx#L64)) and D6 brings it into the header, so a blanket "no `role=list` in the header" rule would be unsatisfiable anyway.
- **`data-testid` is allowed — it is this repo's convention.** There are 20 in `web/src`, and [`STEP-15-accessibility.md:41`](STEP-15-accessibility.md) calls it *"the curated `data-testid` module"*. The auth/login specs select by role because `Login.tsx` happens to carry no ids, which is a fact about that one file, not a repo-wide ban. Use roles where a real accessible name exists — and the menu trigger must have one (the display name, not an icon-only button) — and add a testid where a stable hook genuinely helps.
- **Never select on Tailwind classes** — [`STEP-15-accessibility.md:60`](STEP-15-accessibility.md) makes this an explicit review rule.
- **Keep the dropdown at `z-50` and verify empirically.** `alert-dialog`'s backdrop and popup and the toast viewport are all `z-50`, so at equal z-index **DOM order decides**, and both are portals appended at open time. There is no "correct by construction" guarantee here; open the menu over `SpeechWatch`'s clear-set dialog and look.
- **Pass `modal={false}` to the Base UI menu.** It defaults to modal, which applies a scroll-lock and blocks outside interaction — on `SpeechWatch` that freezes the page around a playing video every time the menu opens.

### D8 — What the header inherits, what it owes, and what it must not invent

**Theming is half-built, and the header should not pretend otherwise.** [`index.css`](web/src/index.css) defines **two different token families**, not one palette twice:

- `--color-bg` / `-fg` / `-muted` / `-border` / `-accent`, which flip under `@media (prefers-color-scheme: dark)` (`:71-82`)
- the shadcn set `--background` / `--foreground` / `--card` / `--muted`, which flip only under a `.dark` class (`:6`, `:135-167`)

**Nothing in the app ever applies `.dark`** — no `classList`, no `documentElement` write anywhere in `web/src`. So the shadcn tokens never respond to OS preference, and since `body` is `@apply bg-background text-foreground` (`:173-175`), the app is effectively **permanently light** while `color-scheme: light dark` (`:30`) tells the browser otherwise.

Use `--background`/`--foreground`/`--border`/`--muted-foreground` anyway, for consistency with every other component — but do so knowing the header will not go dark on its own, and **do not claim dark-mode support in the acceptance criteria**. Reconciling the two token families is real work that belongs in its own change.

**This feature triggers WCAG 2.4.1 Bypass Blocks (Level A), so the header ships with a skip link.** A repeated block of navigation across five pages is the canonical case for it, and [`STEP-15-accessibility.md`](STEP-15-accessibility.md) targets AA. Concretely: a visually-hidden "Skip to content" anchor as the first focusable element in the layout, targeting the `<main>` that `AppLayout` introduces. This is also the moment `<main>` first exists on an authenticated page — grep finds it today only on `Home`, `NotFound` and `Spikes` — so the landmark structure and the skip link land together or not at all.

**There is no responsive story to inherit.** The entire app uses **two** breakpoint utilities — `sm:grid-cols-2`, in `AnnotationEditor.tsx:82` and `MySpeeches.tsx:51` — and `index.css` contains **zero width-based media queries**; its only two `@media` rules are `prefers-color-scheme` and `prefers-reduced-motion`. The header is the first persistent chrome in the product and will be the first thing to break on a phone. Keep it narrow enough not to need a hamburger: app name, bell, identity chip — display name `truncate`d and hidden below `sm:`, leaving the initials circle as the trigger.

*(An earlier draft said "do not build a mobile nav drawer — there is no nav to put in one yet." The sidebar retires that reasoning. **S5 supersedes this**, and defers the drawer for a different and better reason: there is no mobile test coverage at all.)*

Two concrete narrow-viewport hazards to check at 375px: the bell's panel is `absolute right-0 z-10 mt-2 **w-72**` (288px, [`NotificationBell.tsx:60`](web/src/components/layout/NotificationBell.tsx#L60)) anchored to a wrapper that will now sit in a header flex row — it needs to not overflow the viewport; and [`MySpeeches.tsx:38-44`](web/src/routes/MySpeeches.tsx#L38-L44) already crowds four controls into one row, and this plan moves two of them into a header with *less* horizontal room, not more.

**Do not put a Coach badge in the header.** `roles: string[]` is on `/api/me`, but **no component in the app reads it** — and, more decisively, **no production code path ever assigns a role**, so there is no badge to show (P1). §12/Step 12 owns the badge, along with the admin approval flow that grants it, and §6.11 is explicit that the badge must be described accurately ("an administrator has reviewed submitted credentials"). Inventing a badge here would ship the claim without the process behind it. The menu shows who you are and where to go; it does not make credential assertions.

**Email verification is a client-side gate only.** Nothing server-side enforces it — there is no middleware directory at all, and `email_verified` on `/api/me` is informational. That makes a "verify your email" affordance in the header a *legitimate* future addition, but out of scope here: `RequireVerified` already redirects to `/verify`, so a user who needs it never reaches a page with the header on it.

## Sidebar decisions

### S1 — The sidebar is the app's navigation; the header stops pretending to be

D7 previously put "My speeches" and "My reviews" inside the user menu, for a stated reason: a header link named "My reviews" collides under Playwright strict mode with [`Dashboard.tsx:41`](web/src/routes/Dashboard.tsx#L41)'s `<h1>My reviews</h1>`. **The sidebar re-creates that collision deliberately**, because a nav item is where those links belong.

So: **the sidebar becomes the primary navigation** — but the user menu **keeps** the same links as a duplicate, because below `lg` the sidebar is hidden and the menu is the only nav left (S5). Losing navigation entirely on a phone would be a regression, not a simplification.

Header contents are unchanged: app name · bell · user menu.

The collision is handled by selecting precisely rather than by avoiding the design: scope to the nav landmark (`getByRole('navigation').getByRole('link', { name: 'My reviews' })`). Repo rules apply — never select on Tailwind classes ([`STEP-15-accessibility.md:60`](STEP-15-accessibility.md)), and `data-testid` is permitted (D7).

### S2 — What actually goes in it

Verified inventory of authenticated destinations that exist **today**:

| Item | Route | Notes |
|---|---|---|
| My reviews | `/dashboard` | the reviewer dashboard |
| My speeches | `/speeches` | |
| Upload a speech | `/speeches/new` | an action, but the plan's own demo scripts treat it as a destination |
| **Find reviewers** | *(new route needed)* | see below — the highest-value item here |
| Edit profile | `/profile` | currently reachable from **nowhere** — zero links in the app |

**"Find reviewers" is the reason this sidebar earns its place.** The reviewer directory is fully built but lives *only* inside `InviteReviewerDialog` — [`reviewApi.ts:56`](web/src/features/review/reviewApi.ts#L56) calls it "the only place reviewers can be found at all", while §6.3 calls the directory "the only discovery mechanism" and says to "budget the directory as a feature, not a list". A built feature is currently unreachable except mid-invite-flow. Surfacing it is real user value, not chrome.

⚠️ **It needs a new route and page** (`/reviewers`), which is genuine added scope beyond "add a sidebar". Either accept that scope or ship the sidebar with four items and add the fifth later — but do not add a sidebar link pointing at a route that does not exist.

**Ceiling check:** across all 16 steps the product tops out at ~7-9 primary destinations (adding Search at Step 09, Connections at 13, Become a Coach and Admin at 12). **One flat list, no nesting, ever.** Do not build a collapsible tree for nine items.

⚠️ **Delete `MySpeeches.tsx:39-42`'s "My reviews" and "Upload a speech" buttons in the same commit.** Keeping them creates two permanent Playwright strict-mode ambiguities that are *not* cosmetic: two real `<a>` elements with the same accessible name on `/speeches`, so `getByRole('link', { name: 'My reviews' })` matches twice forever. Sidebar links are always in the accessibility tree — unlike the header plan's closed menu, a sidebar cannot dodge this. Three further `getByText` ambiguities appear against `<h1>My reviews</h1>` ([`Dashboard.tsx:41`](web/src/routes/Dashboard.tsx#L41)), `<h1>My speeches</h1>` ([`MySpeeches.tsx:37`](web/src/routes/MySpeeches.tsx#L37)) and `<CardTitle>Upload a speech</CardTitle>` ([`SpeechCreate.tsx:88`](web/src/routes/SpeechCreate.tsx#L88)); those are handled by scoping selectors to the nav landmark, per S1.

**Never put a speech list in the sidebar.** `two-users.spec.ts:65,112` asserts on a speech title by text; a "Recent speeches" rail would double-match it. It would also globalise `MySpeeches`'s 3-second poll ([`MySpeeches.tsx:22`](web/src/routes/MySpeeches.tsx#L22)) to every page.

### S3 — Role logic is additive only, and `roles: []` is the default case

This is the rule that prevents the obvious catastrophic bug. Because registration assigns no role (P1), **every real user has an empty roles array.**

```
❌ if (roles.includes('member')) show(baselineItems)   // renders an EMPTY sidebar for every real user
✅ show(baselineItems)                                  // unconditional
✅ if (roles.includes('admin')) add(adminItems)         // roles only ever ADD
```

**Baseline items are shown to every authenticated user with no role check at all.** A role check may only *add* an item or *remove* the single item S4 covers. Write it so that an empty array yields a complete, working sidebar — and make that a test, because it is the state 100% of genuine users are in.

Treat `super_admin` as `admin` for navigation (P3). Do not branch on `coach` at all — there is nothing to branch on (§7.1 gives Coach no destinations until Step 12).

### S4 — The one genuinely role-differentiated item, and its precondition

§7.1's matrix denies Admins the reviewer directory: *"Browse the reviewer directory / invite someone specific — ❌ never."* That makes "Find reviewers" the only item today whose visibility legitimately varies by role.

**But it is unenforced server-side (P2).** If the sidebar hides it from admins while `ReviewerDirectoryController` still serves any authenticated caller, then **the hidden link is the only protection** — which is precisely the legacy pattern this entire modernization exists to delete:

> *"there is no ownership check anywhere: any authenticated user can enumerate `viewTopicVideo.php?topId=1,2,3…`"* — §16, on the legacy app

> *"an absent button proves the UI hides it. **It does not prove the server refuses.** Those are different claims, and only the second is a security property."* — [`CP-10-faking-devices.md:128`](CP-10-faking-devices.md)

**Wiring it takes three edits, not one — and doing only the obvious one inverts the control.**

A naive `Gate::authorize('viewDirectory')` in `ReviewerDirectoryController::index` produces **admins 200, everyone else 403** — precisely backwards. Two mechanisms conspire:

1. `viewDirectory` is **not** in `Gate::before`'s `$mustFallThrough` list ([`AppServiceProvider.php:107-117`](api/app/Providers/AppServiceProvider.php#L107-L117)), so for an admin the hook short-circuits to `true` and `ReviewPolicy::viewDirectory` never runs.
2. `viewDirectory` has **no `Gate::define`** ([the registrations are at `:69-93`](api/app/Providers/AppServiceProvider.php#L69-L93)) and `authorize('viewDirectory')` passes no model argument, so Laravel cannot reach `ReviewPolicy` by policy resolution either. Every non-admin hits an undefined ability and is denied.

**All three edits are required:**

```php
// 1. AppServiceProvider — register the ability
Gate::define('viewDirectory', [ReviewPolicy::class, 'viewDirectory']);

// 2. AppServiceProvider — add to $mustFallThrough, or admins bypass their own denial
'viewDirectory',

// 3. ReviewerDirectoryController::index
Gate::authorize('viewDirectory');
```

Then a Pest test asserting **admin → 403 and member → 200**, in that order — a test that only checks the 403 passes just as well when the ability is undefined and everyone is denied.

> The code comment at [`AppServiceProvider.php:98-101`](api/app/Providers/AppServiceProvider.php#L98-L101) warns about exactly this: *"revision 2's mistake… it omitted `user.delete` and let a destructive admin action skip its safeguards entirely."* An earlier draft of this plan quoted `$mustFallThrough` as evidence that admin is enforced and still prescribed the one-line fix. Adding an ability without adding it to the fall-through list is the repeatable mistake here.

If you would rather not touch the backend, **show the item to everyone.** An unenforced hide is worse than no hide, because it looks like a control and isn't.

### S5 — Hidden below `lg`, with the user menu as the mobile path — no drawer in v1

**Breakpoint: `lg` (1024px), and it is not a guess.** §6.7.4 sets the precedent for exactly this trade-off:

> *"The rail collapses at `lg` (1024 px), not `md` — between 768 and 1024 there is room for the 580 px feed but not for feed + rail + gap, and squeezing the feed costs the thing people came for."*

Every authenticated page is a centred `max-w-3xl` (48rem) column. A ~14rem sidebar beside it needs ~1280px before it stops squeezing content, so `lg` is the floor. **`md` is wrong** — and there is a concrete break to prove it: [`MySpeeches.tsx:51`](web/src/routes/MySpeeches.tsx#L51)'s `sm:grid-cols-2` fires on *viewport* width (640px), not content width, so at a 700px viewport with a sidebar you get two speech cards squeezed into ~430px.

**On the drawer, the two obvious positions are both wrong.** D8's original deferral reason — *"there is no nav to put in one yet"* — is genuinely retired by this change. But a *new* and better reason to defer has appeared: there is **zero mobile test coverage**. `Mobile Chrome` and `Mobile Safari` are commented out in `playwright.config.ts`, and CI runs `--project=chromium` only. A drawer would be a third new primitive wrapper (after `dropdown-menu` and `popover`) shipping onto a surface nothing tests.

**So v1: `hidden lg:flex` on the sidebar `<nav>` (S7), and the user menu carries the same nav links below `lg`** (S1). No drawer, no third wrapper, no untested surface — and mobile users still have every destination. Base UI *does* ship a purpose-built `drawer` module with swipe-dismiss and virtual-keyboard handling (verified in `@base-ui/react@1.7.0`, alongside `navigation-menu` and `unstable-use-media-query`), so this is a scope decision, not a capability limit.

**If a drawer is wanted, it lands with its tests**: uncomment `Mobile Chrome` in `playwright.config.ts` and add it to [`ci.yml:239`](.github/workflows/ci.yml#L239) in the same change, or it is untested forever.

**On `SpeechWatch` the sidebar is the same sidebar — no per-route variant.** The instinct to shrink it there is understandable: that screen carries the player, overlay stack, timeline strip, transcript list, composer and a permanently-visible track selector, with a `Notes | Essay` tab strip arriving at Step 08, and STEP-08 names three competing input surfaces as "a real information-architecture risk."

**But measure before reacting: the sidebar does not squeeze it.** Every layout page is capped at `max-w-3xl` (768px), and at 1024px viewport a `w-56` rail leaves exactly that after padding; wider viewports keep the cap. The watch column is the same width with and without the sidebar. A route-specific icons-only variant would therefore buy nothing while contradicting the "identical on every page" guarantee in demo step 2 — so don't build one.

### S6 — The sidebar is an affordance, never a gate

The plan permits role-conditional UI (§5.5 assumes "three role-gated areas plus an admin portal"). What it forbids is *relying* on it. Every destination the sidebar conditionally renders must independently 403/404 on direct navigation **and** at the API, and that server-side denial is what gets tested. Two of the product's formal acceptance criteria already say so in as many words — STEP-10's *"403 by direct API call, not just an absent button"* and STEP-12's *"asserted by direct API call, not just by an absent button"*.

One testing rule that follows, from [`CP-05-two-users-one-test.md:154`](CP-05-two-users-one-test.md): for any security assertion use **`toHaveCount(0)`**, never `not.toBeVisible()` — the latter passes when the data reached the browser and CSS merely hid it, which is "a fail dressed as a pass."

### S7 — Layout mechanics, and three traps

**Use the "T" arrangement** — header spans full width, sidebar sits below it. It is the smallest diff from D1 and composes with it; a full-height sidebar with the header only over the content column fights D1 and makes the app name appear twice.

**The element is `<nav>`, not `<aside>`.** `<aside>` maps to the `complementary` role, so an `<aside>`-wrapped sidebar would make `getByRole('navigation')` match nothing — breaking S1's entire selector-disambiguation strategy and two acceptance criteria at once. If a wrapping `<aside>` is wanted for styling, the `<nav>` must still be the labelled landmark inside it.

```tsx
<div className="min-h-svh flex flex-col">      {/* unchanged from D1 */}
  <SkipLink />
  <AppHeader />
  <div className="flex flex-1">                {/* new row wrapper */}
    <nav aria-label="Main" className="hidden lg:flex w-56 shrink-0 border-r border-sidebar-border bg-sidebar">…</nav>
    <main id="content" tabIndex={-1} className="flex-1 min-w-0">
      <Outlet />
    </main>
  </div>
</div>
```

**Trap 1 — `min-w-0` on `<main>` is mandatory, not stylistic.** Flex items default to `min-width: auto`, so one long unbreakable string in an annotation body would push the sidebar off-layout instead of wrapping. Nothing in the app relies on this today because nothing is a page-level flex row.

**Trap 2 — do not reach for `h-full` on the sidebar `<nav>`.** `index.css` sets no `height: 100%` on `html`/`body`; `#root` gets `min-height: 100svh`, which does not give percentage children a definite height. Use the default `align-items: stretch`, or `sticky top-0 h-svh`.

**Trap 3 — a live container-query bug, which the sidebar does *not* actually worsen.** `index.css:200` sets `.annotation-overlay { max-width: min(48ch, 90cqw) }`, but **the only `@container` in the codebase is `@container/card-header` on `CardHeader`** — a *sibling* of the chain `CardContent → div.relative → OverlayStack`, not an ancestor. With no query container, `cqw` resolves against the viewport rather than the video. That is a real bug and worth fixing.

**But the sidebar cannot trigger it, and an earlier draft claimed otherwise.** Every layout page is `mx-auto max-w-3xl px-4`, so the content column is capped at 768px. At 1024px viewport with a `w-56` rail, `<main>` is 800px and the content is exactly 768px — the cap, unchanged. Above that the cap binds regardless; below `lg` the sidebar is `display:none`. **The video is the same width with and without the sidebar at every viewport.** And `90cqw` only becomes the binding term below ~427px, where there is no sidebar at all.

So: fix it as **independent housekeeping**, not as a sidebar prerequisite, and do not write an acceptance criterion claiming to detect it — such a test passes identically before and after the fix. One caveat if you do apply `container-type: inline-size` to the player wrapper: it implies `contain: layout style inline-size`, creating a new stacking context and a containing block for fixed-position descendants, on the one surface R2 already calls delicate.

**Styling: the tokens already exist.** `index.css:61-68` defines the full `--sidebar-*` set (`--sidebar`, `-foreground`, `-primary`, `-accent`, `-border`, `-ring`), mirrored under `.dark` and mapped to Tailwind utilities at `:95-102`. **Nothing in `src/` uses them.** Use `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border`, `bg-sidebar-accent` — they were put there for exactly this. (D8's caveat still applies: `.dark` is never applied, so these won't switch on OS preference.)

**Icons:** `lucide-react@^1.28.0` is already a dependency with **zero imports** — every icon today is a hand-rolled SVG. Use lucide for the sidebar rather than hand-writing more.

**Mark the current page with `aria-current="page"`, not colour alone.** Use `NavLink` from react-router (already a dependency) — it sets `aria-current="page"` on the active link **automatically**, so do not set it by hand as well; style the active state with the `--sidebar-accent` token. A sidebar that indicates position only by background colour fails both WCAG 1.4.1 (use of colour) and every screen reader — and this is the first persistent nav in the product, so nothing establishes the pattern but this.

Watch the match semantics: `/speeches` would match `/speeches/new` and `/speeches/{id}` under `NavLink`'s default prefix matching, lighting up two items at once. Use `end` on the index-style links.

**During the `RequireAuth` probe there is no sidebar**, for the same reason D1 gives for the header: the guard renders `FullPageSpinner` *in place of* the whole layout while `/api/me` is in flight. That is acceptable and consistent, but it means the shell is absent for a beat on first paint — do not add a skeleton sidebar that would appear and then be replaced.

**Do not animate the sidebar's width.** [`TimelineStrip.tsx:89`](web/src/components/annotation/TimelineStrip.tsx#L89) captures `getBoundingClientRect()` **once at drag start** and divides by `rect.width` for the whole gesture. A width animation mid-drag would silently corrupt an annotation's retimed position. If a collapse toggle is ever added, either don't animate or disable collapse during a drag.

### S8 — Show real destinations; do not advertise unbuilt ones

The repo has a clear precedent for *features* inside a built screen: the essay tab **exists and is disabled**, restated in four places across two steps. It has **no** precedent for disabled *destinations*, and the two differ — a disabled tab sits beside the thing it will become and explains itself; a permanently disabled sidebar entry advertises a destination with no context, on every page, for months.

**v1 lists only routes that exist.** No "Search (coming in Step 09)", no greyed-out "Admin". When Step 12 lands, its entries appear with it.

The repo's empty-state instinct still applies *within* a destination — §6.7.4's "do not hide this — design for it", and STEP-05's honest *"Jordan hasn't left commentary yet"*. An empty **page** is fine and should be named accurately; an empty **promise** in the nav is not.

## Watch-screen decisions — the player is too tall

Reported symptom: on `/speeches/{id}` a **portrait** video fills the whole viewport, so the *Commentary track* card sits below the fold and cannot be seen without scrolling the player off-screen. Requirement: fit the player and the commentary on one screen **without compromising video quality**.

### W1 — Why it happens, and why the obvious fix does nothing

`fluid: true` is the **only** sizing option the app passes ([`videojs-adapter.ts:39`](web/src/shared/media/videojs-adapter.ts#L39)); [`VideoPlayer.tsx`](web/src/components/speech/VideoPlayer.tsx) adds no sizing classes. In video.js 8.23.9, `updateStyleEl_()` emits:

```css
.<id>-dimensions.vjs-fluid:not(.vjs-audio-only-mode) { padding-top: <height/width * 100>%; }
```

A **percentage padding resolves against the container's width**, so a 1080×1920 clip gets `padding-top: 177.78%`.

**The player column is 704px, not 768px** — `max-w-3xl` (768) minus the wrapper's `px-4` (32) minus `CardContent`'s `px-(--card-spacing)` (32, where `--card-spacing: --spacing(4)` = 16px). Measured in Chromium at that width: **704 × 1252**. That is the screenshot.

> ⚠️ **`max-height` cannot fix this, and reaching for it first is the trap.** Measured: a box with `padding-top: 177.78%` **and** `max-height` still renders **704 × 1252** — unchanged. `max-height` constrains the content box; padding is added outside it. The one-line fix silently does nothing.

**There is a second, related bug.** `updateStyleEl_` takes the ratio from `videoWidth():videoHeight()` — which is only known after metadata — and **defaults to `16:9` before that**. So a portrait video paints at ~396px tall, then jumps to 1252px. W4 removes this.

*(One thing not to chase: `updateStyleEl_` also injects a fixed `.<id>-dimensions { width: 300px; height: 168.75px }` rule and adds that class to the player root unconditionally, even under `fill`. It is inert — `.video-js.vjs-fill:not(.vjs-audio-only-mode)` has specificity (0,3,0) and outranks it (0,1,0) — and was confirmed present-but-overridden in all three engines.)*

### W2 — The fix: constrain the box by computed WIDTH, not by `max-height`

Two changes, and landscape video is provably unaffected.

**1. Switch `fluid: true` → `fill: true`.** `.video-js.vjs-fill { width:100%; height:100% }` — the player stops computing its own height and fills whatever box it is given. Safe from the app's side: nothing in `web/src` references `vjs-fluid` or any video.js layout class.

**2. Size the box by width.**

> ⚠️ **The elegant-looking version of this is wrong, and only cross-engine testing catches it.** The obvious CSS is `aspect-ratio` + `max-height`, leaning on CSS Sizing-4's *transferred max-size* to shrink the width. **WebKit does not implement it** — and this repo explicitly targets iOS ([`useIosFullscreenSubtitles.ts`](web/src/hooks/useIosFullscreenSubtitles.ts) exists for that reason), so Safari would keep the bug verbatim. Worse, adding `margin-inline: auto` to centre it collapses the box **to zero** — the wrapper is a flex item ([`SpeechWatch.tsx:98`](web/src/routes/SpeechWatch.tsx#L98) is `flex flex-col`), and auto inline margins suppress flex stretch.

Measured at the real 704px column, inside a real flex column, in all three engines:

| CSS | chromium | webkit | firefox |
|---|---|---|---|
| `aspect-ratio` + `max-height` | 349×620 ✓ | **704×620 ✗** | 349×620 ✓ |
| …plus `margin-inline:auto` (flex parent) | **0×0 ✗** | **0×0 ✗** | **0×0 ✗** |
| **`width: min(100%, calc(budget × ratio))`** | **349×620 ✓** | **349×620 ✓** | **349×620 ✓** |

So the rule that actually works everywhere:

```css
/* on SpeechWatch's `.relative` player wrapper — placement matters, see below */
width: min(100%, calc(var(--video-budget, 620px) * var(--video-ar, 1.7777778)));
aspect-ratio: var(--video-ar, 1.7777778);
margin-inline: auto;          /* safe here: the width is definite */
```

`--video-ar` is the width÷height decimal (portrait 1080×1920 → `0.5625`); `--video-budget` is the W3 cap. Set `--video-ar` as an inline style on that div, from the poster's dimensions on first render and from `loadedmetadata` thereafter (W4).

> ⚠️ **Both fallbacks are mandatory, and omitting them is a 0×0 collapse — the very failure this decision exists to avoid.** If `--video-ar` is unset, the `calc()` is invalid at computed-value time, the whole `width` declaration is dropped, `width` becomes `auto`, and `margin-inline: auto` then suppresses flex stretch. Measured with no fallback: **0×0 in chromium, webkit *and* firefox**. With fallbacks: **704×396** in all three. This is not a corner case — it is every speech that has no poster and no persisted dimensions, which W4 explicitly says must keep working.

**One variable, not two.** `aspect-ratio` accepts a bare number, so the same `--video-ar` drives both properties. An earlier draft used a separate `--video-aspect` ratio pair; two variables derived from one source is two chances to drift.

Portrait goes 704×1252 → tight and centred with no letterbox bars.

**Correction to an earlier claim: this is not "portrait-only".** The rule binds on anything taller than 16:9, on square video (704×704 → 558×558), **and on landscape at short viewports** — once `60svh × 1.778 < 704`, i.e. below a ~660px viewport, landscape starts shrinking too (measured 640×360 at a 600px viewport, identical in all three engines). Landscape is unchanged at *typical desktop* heights, which is the honest version of the claim.

**Placement: the box goes on [`SpeechWatch.tsx:104`](web/src/routes/SpeechWatch.tsx#L104)'s `.relative` div, not inside `VideoPlayer`.** That div is `OverlayStack`'s positioning context (`absolute inset-0`). Applied any deeper, `.relative` stays full-column-width while the video centres, and annotation overlays land ~180–195px to the left of the video (measured 195px at a 558px budget, 178px at 620px).

**`fill` also needs a height chain — and `height: 100%` is the wrong way to give it one.** `VideoPlayer` renders `<div data-vjs-player><div ref/></div>` and video.js builds its root inside the *inner* div, so `.vjs-fill { height:100% }` resolves against an auto height and collapses to **0**.

> ⚠️ **Second WebKit trap, same shape as the first.** Setting `height: 100%` on those two divs works in Chromium and Firefox and **fails in WebKit**, because WebKit does not treat an `aspect-ratio`-derived height as *definite* for percentage resolution. Measured with the box at 349×620: chromium `349×620`, firefox `349×620`, **webkit `349×0`**.

**Use absolute positioning instead**, which sidesteps percentage-height resolution altogether — the parent is already `position: relative`:

```css
[data-vjs-player],
[data-vjs-player] > div { position: absolute; inset: 0; }
```

Measured: **349 × 620 in chromium, webkit and firefox** (at a fixed 620px budget; at a 930px viewport the `60svh` term gives 558px and the box is ~314 × 558).

**Do not add `object-fit: contain`.** Measured as already the UA default for `<video>` in all three engines with no author rule — the line would be inert. (An earlier draft prescribed it.)

### W3 — What "fits on one page" can honestly mean

**It cannot mean the whole page never scrolls.** The transcript/annotation list grows with the number of notes; a fifty-annotation review will never fit a laptop screen. Promising that would be dishonest.

**It should mean: the player and the commentary controls are visible together, without scrolling.** That is the actual complaint.

**Note which control, because it differs by viewer** — [`SpeechWatch.tsx:143`](web/src/routes/SpeechWatch.tsx#L143) gates `TrackSelector` on `isOwner`. The **speaker** sees the "Commentary track" card (choose whose notes to watch); an **invited reviewer** sees "Your commentary" (`AnnotationComposerPanel`) instead. They are mutually exclusive, and both headings sit at the same height, so one budget serves both.

Fixed chrome above that heading totals ~**292px** with a 64px header: `header + py-10 (40) + card py (16) + CardHeader (42) + card gap (16) + [player] + CardContent gap (16) + PosterFramePicker (28) + card py (16) + wrapper gap (16) + card py (16) + title (22)`. Measured at 270px + the 22px title, in all three engines — the arithmetic holds.

> ⚠️ **But that 28px for `PosterFramePicker` assumes no sprite, and a portrait sprite is 324px.** Sprites are tiled at `scale=160:-2,tile=5x2` ([`FfmpegTranscoder.php:336`](api/app/Services/Transcoding/FfmpegTranscoder.php#L336)), so a 1080×1920 source yields **160×284** cells. Measured chrome jumps 270px → **566px**, and the Commentary track heading lands ~216px below a 930px fold **even with the player capped**. The player fix alone does not close the reported bug for a portrait speech that has a sprite.
>
> This compounds with the gating oddity in W5: `PosterFramePicker` is **not** `isOwner`-gated ([`SpeechWatch.tsx:128`](web/src/routes/SpeechWatch.tsx#L128)), so it costs reviewers the same 324px for a control they should not have at all.
>
> **Fix the gate as part of this work** — it is one condition, it removes 324px from the reviewer's budget entirely, and it corrects a real permissions leak. For the owner, either cap the strip's height with `overflow-x-auto` (it is already a horizontal scroller) or collapse it behind a disclosure. Do not simply hope no sprite exists.

At the reported ~930px viewport that leaves roughly **640px** for the player — ~615px if the description line should also show, ~570px if the first radio button should. Express it viewport-relative so it adapts:

```css
--video-budget: min(60svh, 620px);   /* feeds W2's width calc — NOT a max-height */
```

`svh` (not `vh`) matters on mobile — it is the *small* viewport height, so the box does not jump when browser chrome retracts. A portrait video then goes from **1252px → 620px**, which is the ~630px it needs to shed.

Note this is a **length fed into W2's `calc()`**, not a `max-height` declaration — W2 explains why `max-height` is the one form that does not work.

**The `60svh` term is load-bearing, not decorative.** When the column is narrower than the computed width, `min()` clamps to `100%` and the height then follows from the aspect ratio — which can *exceed* the budget. Measured at a 343px column with a fixed 620px budget: portrait renders **343 × 610**, taller than intended. With `min(60svh, 620px)` on a ~660px-viewport phone the `svh` term wins (396px), giving ~223 × 396 instead. Drop the `svh` term and mobile portrait regresses.

Behaviour across shapes, measured in chromium and webkit (identical in both):

| Column | square 1:1 | landscape 16:9 | portrait 9:16 |
|---|---|---|---|
| 704px, 620px budget | 620 × 620 | **704 × 396** (unchanged from today) | 349 × 620 |
| 343px, 620px budget | 343 × 343 | 343 × 193 | 343 × 610 → budget-limited once `svh` applies |

**Two existing scroll behaviours are worth knowing before adding another:** `Transcript` already caps itself at `max-h-80` with `overflow-y-auto` ([`Transcript.tsx:119`](web/src/components/annotation/Transcript.tsx#L119)) — and its auto-scroll deliberately scrolls only its own container, never ancestors, a comment that already anticipated this problem. But `AnnotationList`'s `<ol>` is **unbounded** ([`AnnotationList.tsx:112`](web/src/components/annotation/AnnotationList.tsx#L112)); at STEP-07's 200-annotation cap that is roughly 10,000px on the reviewer path. Capping it is a reasonable companion change, though not required to fix the reported bug.

### W4 — Kill the layout shift with a genuinely small backend change

The 16:9→9:16 jump happens because the browser learns the ratio only at `loadedmetadata`. The app *could* know it up front — and there are **two** sources, one of which costs nothing.

**Source 1, free: the poster's dimensions.** Posters are scaled with ffmpeg's `scale='min(W,iw)':-2` ([`FfmpegTranscoder.php:292`](api/app/Services/Transcoding/FfmpegTranscoder.php#L292)), where `-2` derives the height from the source and rounds to an even number — so **poster dimensions preserve the video's aspect ratio**, to within a pixel of rounding that is irrelevant at layout scale. `speech.poster.width/height` is already persisted, already typed ([`types.ts:32-37`](web/src/features/speech/types.ts#L32-L37)), and already used for exactly this purpose at [`SpeechPoster.tsx:44`](web/src/components/speech/SpeechPoster.tsx#L44). The poster pipeline runs after every successful remux ([`FfmpegTranscoder.php:177`](api/app/Services/Transcoding/FfmpegTranscoder.php#L177)), so most speeches have one. **Seed `--video-ar` from the poster when present — zero backend change.**

**But posters are explicitly best-effort.** §9.5 says *"no poster is a designed state, not a broken image"*, and the pipeline is wrapped so a failure never fails the transcode ([`:172-179`](api/app/Services/Transcoding/FfmpegTranscoder.php#L172-L179)). A speech with no poster falls back to `16/9` and jumps. That is why source 2 is still worth doing:

**Source 2, reliable: persist the video's own dimensions.** The pieces are nearly all in place:

- `speech_assets` **already has `width`/`height` columns** (migration `2026_08_08_160001`).
- `SpeechAssetResource` **already exposes them** ([`:31-32`](api/app/Http/Resources/SpeechAssetResource.php#L31-L32)), and the frontend type already declares `width: number | null` ([`types.ts:17-18`](web/src/features/speech/types.ts#L17-L18)).
- The **video** asset just never gets them written. `writeFinalStatus` sets status/disk/path/byte_size/duration_seconds only ([`FfmpegTranscoder.php:188-194`](api/app/Services/Transcoding/FfmpegTranscoder.php#L188-L194)). Poster variants *do* get dimensions ([`:312`](api/app/Services/Transcoding/FfmpegTranscoder.php#L312)), which is why the columns exist.
- The `ffprobe` call already requests **`height`** (for the ≤1080p compliance check) but **not `width`** ([`:535-541`](api/app/Services/Transcoding/FfmpegTranscoder.php#L535-L541)).

So the change is: add `width` to the `-show_entries` stream list, and persist `width`/`height` in `writeFinalStatus`. Then the page sets `--video-ar` from the asset and reserves the correct box on **first paint**.

> ⚠️ **Source 2 is wrong for rotated phone video — the single most common portrait source — unless rotation is handled.** `ffprobe -show_entries stream=…` returns **coded** dimensions, and the remux path is `-c copy`, so an iPhone clip stored 1920×1080 with a rotate-90 display matrix keeps that matrix. ffprobe reports 1920×1080 (landscape) while the browser reports `videoWidth/Height` as 1080×1920 (portrait). Persisting the coded values would reserve a **landscape** box for a portrait video — reintroducing exactly the jump W4 exists to remove, while a "dimensions are non-null" test passes happily. The class docblock already records that rotation was never positively verified.
>
> So Source 2 must also read the rotation side data (`-show_entries stream_side_data=rotation`, or `stream_tags=rotate`) and swap the axes, and should account for non-1:1 SAR (anamorphic) sources. **This is why the preference order above is Source 1 first**: posters go through a filtergraph, where ffmpeg autorotates, so poster dimensions are already display-correct. That ordering was accidental in an earlier draft; it is deliberate now.

**This is not a new technique in this codebase — it is an existing one, applied to the video for the first time.** [`SpeechPoster.tsx:44`](web/src/components/speech/SpeechPoster.tsx#L44) already sets `style={{ aspectRatio: \`${poster.width} / ${poster.height}\` }}` from persisted poster dimensions, precisely to reserve layout before the image loads. W4 gives the video element the same treatment the poster already gets.

*(Adjacent, not in scope: [`NoPosterPlaceholder.tsx:15`](web/src/components/speech/NoPosterPlaceholder.tsx#L15) hardcodes `aspect-video` (16:9), so a portrait speech's placeholder card on `/speeches` is the wrong shape. Once video dimensions are persisted, that placeholder could use them too.)*

**Fallback is required regardless**, because every video uploaded before this change has null dimensions: `var(--video-ar, 1.7777778)` for the initial box, then the real ratio from `loadedmetadata`. W2 shows why omitting that fallback is a 0×0 collapse, not a cosmetic default. Existing rows can be backfilled later or simply left to the fallback — no migration needed for correctness.

### W5 — Four test constraints, none of which block the fix

**No test asserts the player's box size or the page's vertical structure**, so the cap itself is free. But four things must not change while making it:

- **`PosterFramePicker` must stay a named export of `@/routes/SpeechWatch`.** `SpeechWatch.test.tsx` never renders the page — it imports and renders only that component from that path. Extracting it to its own file breaks the import.
- **Do not add a second list element inside `Transcript`.** `Transcript.test.tsx:38` asserts `getByRole('list').tagName === 'OL'`, and `getByRole` throws on multiple matches. A plain `<div>` scroll wrapper is fine — including moving `max-h-80 overflow-y-auto` onto it.
- **`TrackSelector` must stay unconditionally rendered and visible for the owner.** `two-users.spec.ts` requires the radiogroup and both radios present and visible. Playwright's `toBeVisible()` does *not* require in-viewport, so below-the-fold currently passes — but `display:none`, a collapsed accordion, or lazy rendering would break it. **Do not "solve" the height problem by hiding the commentary controls.**
- `TimelineStrip.test.tsx` mocks `getBoundingClientRect` to a fixed 1000×24, so it is insensitive to real CSS and unaffected.

One pre-existing oddity noticed while mapping the page, unrelated to height: **`PosterFramePicker` is not `isOwner`-gated** ([`SpeechWatch.tsx:128`](web/src/routes/SpeechWatch.tsx#L128)) while every other owner control is, so a non-owner reviewer sees a "Use current frame" button for someone else's speech. Out of scope here; worth a separate look.

### W6 — Quality is not affected, and here is why

Worth stating plainly because it was the stated constraint: **shrinking the player does not reduce video quality.**

- STEP-03 is **remux-only** (`-c copy`), so the stored file is the original upload at its original resolution. Nothing is re-encoded, and this change touches no encoding path.
- CSS size controls how many **CSS pixels** the box occupies. The decoder still emits full-resolution frames, and the browser downscales for display.
- On a HiDPI display (the screenshot's device is one), a 349 CSS-px-wide box is ~698 device pixels — and a 1080-wide source still has more pixels than that.
- The only real trade-off is **apparent size**, not fidelity: a portrait video shown at 349px wide is smaller on screen. If that feels too small, raise the `max-height` cap — the quality never changed, only the framing.

Fullscreen remains the full-resolution escape hatch and is unaffected.

## Backend

**Almost none — one line of production code, plus the tests that should already exist.**

**1. Add `display_name` to `UserResource`** ([`UserResource.php:20-30`](api/app/Http/Resources/UserResource.php#L20-L30)), reusing the expression `PublicProfileResource` already has, so the header and the profile page cannot disagree about a user's name:

```php
'display_name' => $this->profile?->display_name
    ?: trim("{$this->first_name} {$this->last_name}"),
```

N+1-safe: `/api/me` already calls `->load('profile')`. Add the field to [`types.ts`](web/src/features/auth/types.ts) in the same change.

**2. Do *not* add `avatar_url`.** Per D3 it is incomplete without a longer image TTL and an `onError` fallback; shipping the field alone creates the broken-image bug. Deferred deliberately, not overlooked.

**3. Fix the `id` type — server-side, by casting to string.** `UserResource` emits a JSON number while [`types.ts:13`](web/src/features/auth/types.ts#L13) claims `string`.

**Cast in the resource: `'id' => (string) $this->id`. Do not "fix" the TypeScript type to `number` instead** — that breaks the build. [`SpeechWatch.tsx:168`](web/src/routes/SpeechWatch.tsx#L168) passes `me?.user.id` into `AnnotationComposerPanel`'s `userId: string | undefined` ([`AnnotationComposerPanel.tsx:48`](web/src/components/annotation/AnnotationComposerPanel.tsx#L48)), which flows on into `useAutoPausePreference`. The server-side cast satisfies both sides at once, and `SpeechWatch.tsx:64`'s `Number(me.user.id)` keeps working across it.

This matters beyond tidiness: D3's identical-hue bug is a direct consequence of nobody noticing the mismatch.

**4. Backend tests — this is the real work.** `GET /api/me` is the single most important endpoint for the header and it has **zero test coverage** (`grep -rn "api/me" api/tests/` returns nothing). Neither does any test assert a 401 anywhere in the suite, and logout is covered only by a bare `assertOk()` in `E2ESeederRolesTest`. Add, beside the existing `tests/Feature/Auth/` files:

- the `/api/me` contract, field by field, including a mid-onboarding user with `first_name`/`last_name`/`username` all null and `roles: []`
- `GET /api/me` unauthenticated → `401 {"message":"Unauthenticated."}`
- `POST /logout` → `200 {"message":"Logged out."}`, and **`POST /logout` when already logged out → 401**, the D4 case

**5. If the sidebar hides "Find reviewers" from admins, wire `viewDirectory` first (S4).** `Gate::authorize('viewDirectory')` in `ReviewerDirectoryController::index`, plus a Pest test asserting an admin gets 403 and a member gets 200. The policy method already exists and is dead code (P2). Without this, the hidden link is the only protection.

**6. Persist video dimensions (W4).** Add `width` to the `ffprobe` `-show_entries` stream list ([`FfmpegTranscoder.php:540`](api/app/Services/Transcoding/FfmpegTranscoder.php#L540)) and write `width`/`height` in the video asset's `writeFinalStatus` ([`:188-194`](api/app/Services/Transcoding/FfmpegTranscoder.php#L188-L194)). Columns and API field already exist; this removes the portrait layout shift. Add a `FfmpegTranscoderTest` assertion that a ready video asset has non-null dimensions.

**7. P0/P1/P3 are separate changes, not this one** — but P0 (the unauthenticated presign route) should land *before* this plan, not after.

### One trap to route around

`PUT /user/profile-information` is **live** — `Features::updateProfileInformation()` is enabled — and while the action has been touched, its **validation rule is still the Fortify stub**: `'name' => ['required', ...]`, against a schema this app split into `first_name`/`last_name`, leaving `users.name` vestigial. On an email change it also nulls `email_verified_at` and re-sends verification. Nothing in the SPA calls it. An "edit profile" feature is precisely where someone would reach for it by name.

**Edit-profile routes through `PATCH /api/profile` and nowhere else.** Removing `Features::updateProfileInformation()` from [`config/fortify.php`](api/config/fortify.php) is the right cleanup but belongs in its own change — it is not this plan's scope, and `PUT /user/password` (which *is* correctly wired) rides the same feature flag.

## Frontend

- `components/ui/dropdown-menu.tsx` — thin Base UI `menu` wrapper, matching [`alert-dialog.tsx`](web/src/components/ui/alert-dialog.tsx)'s pattern exactly.
- `components/layout/UserMenu.tsx` — the identity chip and its menu. Reads `useGetMeQuery()`; **no props**, so it cannot be passed a stale user.
- `components/layout/AppHeader.tsx` — `<header>` landmark, app name (link to `/dashboard`), `NotificationBell`, `UserMenu`. **No `<nav>` and no header links** — see the nav decision below.
- `components/layout/AppLayout.tsx` — `min-h-svh flex flex-col`, a visually-hidden skip link as the first focusable element (D8), the header, then a `flex flex-1` row wrapper holding the sidebar `<nav>` and `<main id="content" tabIndex={-1} className="flex-1 min-w-0">` around the `<Outlet/>`. **`min-w-0` is mandatory** (S7, trap 1). **The `tabIndex={-1}` is required, not decorative:** a bare `href="#content"` scrolls the page but does not move `document.activeElement`, so without it the skip link is theatre and any focus assertion fails.
- `components/ui/popover.tsx` + `components/layout/NotificationBell.tsx` — the bell rebuilt on Base UI's `popover` so it stops being a non-conformant disclosure widget before D6 makes it global. Note this is a **second** primitive wrapper alongside `dropdown-menu.tsx`, not a free ride on D2 — `popover` ships in `@base-ui/react@1.7.0` (verified), so still no new dependency, but it is another file to write.
- `components/layout/AppSidebar.tsx` — the `<nav>` landmark, `hidden lg:flex`, `bg-sidebar`/`border-sidebar-border`, lucide icons. Reads `useGetMeQuery()` for roles — **no new fetch**, RTK Query dedupes with the guards.
- `lib/roles.ts` — `hasRole(me, name)` plus the nav-item list and its role predicates, as one tested pure module. Follows the codebase's existing derive-a-boolean pattern (`SpeechWatch.tsx:63-64`'s `isOwner`), not a new context or provider. **Unit-test the `roles: []` case explicitly** (S3) — it is the state every real user is in.
- `routes/ReviewerDirectory.tsx` + a `/reviewers` route — only if S2's "Find reviewers" item ships in v1.
- `shared/media/videojs-adapter.ts` — `fluid: true` → `fill: true` (W2). One line, and the whole reason the height becomes controllable.
- `routes/SpeechWatch.tsx` — the W2 box on the `.relative` player wrapper (**not** inside `VideoPlayer`, or the overlays misalign), setting `--video-ar` as an inline style — seeded from the poster's dimensions when present, corrected from `loadedmetadata` on load.
- `components/speech/VideoPlayer.tsx` — `position:absolute; inset:0` on both wrapper divs so `vjs-fill` has a resolvable height in WebKit (W2). No `object-fit` rule — it is already the UA default.
- `lib/displayName.ts` — the fallback chain and initials derivation from D3, as one tested pure function. One implementation, not one per call site; [STEP-07's retrospective](STEP-07-RETROSPECTIVE.md) records three separate near-duplicates of a sort comparator that disagreed with each other, and this is the same shape of risk.
- `App.tsx` — the D1 route restructure.
- `LogoutButton.tsx` — becomes a menu item; keeps the hard navigation, gains the error handling from D4.
- **Remove** the ad-hoc `LogoutButton` imports from `Dashboard.tsx` and `MySpeeches.tsx`, and the `NotificationBell` from `Dashboard.tsx` (D6 — note the polling-scope consequence). **delete** `MySpeeches`'s "My reviews" and "Upload a speech" buttons outright (S2) — the sidebar and the user menu both carry those destinations now.
- **Remove `min-h-svh`** from exactly the sites R1 names: two wrappers (`SpeechCreate.tsx:63,85`, `ProfileEdit.tsx:133`) and four loading states (`ProfileEdit.tsx:126`, `Dashboard.tsx:27`, `MySpeeches.tsx:26`, `SpeechWatch.tsx:78`). **Not five of each, and not `Onboarding.tsx`** — R1 explains why.

### Where the navigation links live

**The sidebar is the nav landmark; the header carries none.** Header = app name · bell · user menu. The user menu duplicates the sidebar's destinations so that navigation survives below `lg`, where the sidebar is hidden (S1, S5).

This was decided twice, and the second answer overrides the first. A header-only plan put those links *only* in the user menu, specifically to dodge a Playwright strict-mode ambiguity with [`Dashboard.tsx:41`](web/src/routes/Dashboard.tsx#L41)'s `<h1>My reviews</h1>` — a closed menu keeps its labels out of the accessibility tree. **A sidebar cannot dodge it**: its links are always in the tree. So the collision is now accepted deliberately and handled by scoping selectors to the nav landmark, and by deleting the duplicate in-page buttons at `MySpeeches.tsx:39-42` (S2).

## Deliberately stubbed

No Coach badge (D8 — Step 12 owns it, along with the process the badge asserts). No mobile nav drawer (**S5** — deferred for lack of any mobile test coverage, not for lack of nav). No avatar photo (D3). No signed-in-aware header on public routes (D5). No "verify your email" affordance (D8). No password-change entry point — `PUT /user/password` is correctly wired but uncalled, and belongs on the profile page rather than in a menu.

## Risks

### R1 — `min-h-svh` on page wrappers is a double-scrollbar bug

[`SpeechCreate.tsx:63,85`](web/src/routes/SpeechCreate.tsx#L85) and [`ProfileEdit.tsx:133`](web/src/routes/ProfileEdit.tsx#L133) set `min-h-svh` **and** `justify-center` on the page wrapper — each is already a full viewport tall. Stack a header above one and the document becomes `header + 100svh`: a permanent scrollbar and "centered" content pushed below the fold.

**Scope precisely — this is narrower than it looks, and over-applying it breaks a page.**

**There are exactly seven `min-h-svh` sites in the layout group. Change all seven** — earlier drafts said "two" and "five" and both were wrong:

| Site | Kind |
|---|---|
| [`SpeechCreate.tsx:63`](web/src/routes/SpeechCreate.tsx#L63) | wrapper (post-create branch — easy to miss) |
| [`SpeechCreate.tsx:85`](web/src/routes/SpeechCreate.tsx#L85) | wrapper (form branch) |
| [`ProfileEdit.tsx:133`](web/src/routes/ProfileEdit.tsx#L133) | wrapper |
| [`ProfileEdit.tsx:126`](web/src/routes/ProfileEdit.tsx#L126) | loading state |
| [`Dashboard.tsx:27`](web/src/routes/Dashboard.tsx#L27) | loading state |
| [`MySpeeches.tsx:26`](web/src/routes/MySpeeches.tsx#L26) | loading state |
| [`SpeechWatch.tsx:78`](web/src/routes/SpeechWatch.tsx#L78) | loading state |
- **Leave alone:** the `Dashboard.tsx:39`, `MySpeeches.tsx:35` and `SpeechWatch.tsx:85` *content* wrappers — none of them has `min-h-svh` in the first place.
- **⚠️ Do NOT touch [`Onboarding.tsx:45,54`](web/src/routes/Onboarding.tsx#L54).** `/onboarding` is deliberately **outside** the layout group (D1), so it keeps owning its own viewport. Removing its `min-h-svh` would break the centring on a page the header never appears on.
- `FullPageSpinner` in [`AuthShell.tsx:5-11`](web/src/components/auth/AuthShell.tsx#L5-L11) is shared by guarded *and* unguarded routes — leave it full-height; per D1 it renders in place of the layout, not inside it.

**The layout owns the viewport; pages fill what is left.** `AppLayout` is `min-h-svh flex flex-col` with `<main className="flex-1 min-w-0">`.

⚠️ **The wrappers drop `min-h-svh` for `flex-1` (with `<main>` as a flex column) — not for `h-full`.** S7's trap 2 is exactly this: nothing sets `height: 100%` on `html`/`body`, so a percentage height has no definite parent to resolve against, silently falls back to `auto`, and `justify-center` becomes a no-op — leaving the cards pinned to the top and failing this plan's own centring criterion. `min-h-full` is the other safe form. An earlier draft said `h-full` here while warning against it thirty lines away.

### R2 — The header must not be sticky over the player

`SpeechWatch` is a video surface. A `sticky`/`z-index` header will fight fullscreen and the timeline strip. **v1 header is static, not sticky.** Revisit only with a real scroll complaint, and check it against fullscreen on iOS ([`useIosFullscreenSubtitles.ts`](web/src/hooks/useIosFullscreenSubtitles.ts) exists because that surface is already delicate).

### R3 — Unit-test blast radius is small **only because of D1**; E2E is where this gets caught

Route tests mount route components directly rather than the whole `App`, so the layout restructure does not touch them — see D1 for why that stops being true if the header is imported per-page. **No vitest file imports `App` at all**; the only importer is [`main.tsx:4`](web/src/main.tsx#L4). (An earlier draft claimed `Onboarding.test.tsx` referenced it — that "App" is a PHP namespace inside a docblock, `App\Support\Onboarding`. The restructure is safer than first assessed, but the claim was asserted before it was checked.)

The real coverage is Playwright: CI runs only `tests/speech-create.spec.ts` today ([`ci.yml:239`](.github/workflows/ci.yml#L239)), so a new spec must be **added to that command** or it will not run.

Two Playwright details worth knowing before writing it. First, strict mode: there is **no "My reviews" collision today** — `Dashboard` has only the `<h1>` ([`Dashboard.tsx:41`](web/src/routes/Dashboard.tsx#L41)) and `MySpeeches` only the button, and no page renders both. Putting that link in persistent header chrome would **create** a permanent one on `/dashboard`; an earlier header-only draft kept those links inside the closed user menu to avoid it. **S1/S2 reverse that**: the sidebar accepts the collision deliberately and handles it by scoping selectors to the nav landmark and deleting the duplicate buttons at `MySpeeches.tsx:39-42`. Second, the `setup` project itself depends on a `warmup` project ([`playwright.config.ts:54-56`](web/playwright.config.ts#L54-L56)), so R4's chain is two stages, not one — a warmup failure takes down setup, which takes down all three browsers.

### R4 — The Playwright auth setup is a single point of failure

[`auth.setup.ts:31`](web/tests/auth.setup.ts#L31) uses `waitForURL(\`${APP_URL}/onboarding\`)` as its login-success signal, for all three fixture users. It is a `setup` project that every browser project depends on. **If this work changes where login lands, all three setups fail and every E2E project fails to start** — which looks like a total CI collapse rather than a one-line redirect change. This plan does not touch `Login.tsx`; keep it that way, and if a follow-up adds an "already onboarded → dashboard" redirect, `auth.setup.ts` must change in the same commit.

One more E2E trap, for whoever writes the new spec: `getByText` is a case-insensitive **substring** match, and the fixture usernames overlap (`e2e-coach-b` contains `e2e-coach`). `two-users.spec.ts:121-123` gets this right by only asserting absence in the safe direction. Do not write the mirror-image assertion.

## Acceptance

- [ ] The header renders on all five authenticated routes, with exactly **one** `<header>` and **one** `<main>` landmark per page
- [ ] ⚠️ **`Tab` from page load reaches a working "Skip to content" link** that moves focus into `<main>` — WCAG 2.4.1 (D8)
- [ ] The initials chip meets **4.5:1** at every hue — **sample the full 360, not a few**; `hsl(60 55% 45%)` is the known worst case at 2.26:1 against white, so this criterion is unsatisfiable until D3's open question is closed with clamping or per-hue foreground
- [ ] `NotificationBell` closes on `Esc` and on outside click, and its trigger exposes `aria-haspopup` — the D6 precondition
- [ ] At **375px** nothing in the header row overflows, and the bell's panel stays inside the viewport
- [ ] Navigating between two authenticated routes does **not** remount the header — asserted by a stable DOM node or a `useGetMeQuery` call-count spy
- [ ] The menu opens with `Enter`, moves with `↓`/`↑`, closes with `Esc`, **and returns focus to the trigger**
- [ ] ⚠️ **A user with `first_name`, `last_name` and `username` all `null` renders their email** — the mid-onboarding case, unit-tested against `displayName.ts` directly
- [ ] ⚠️ **An anonymous visitor loads `/u/{username}` and stays there** — the D5 regression, as a Playwright spec, wired into `ci.yml`'s Playwright command
- [ ] Log out returns to `/login`; pressing Back does not show authenticated content
- [ ] ⚠️ **A 419-failed logout does NOT navigate** — it surfaces the failure and leaves the user where they are, rather than bouncing them into `/onboarding` still logged in (D4)
- [ ] ⚠️ **Logging out twice does not surface an error** — the second call 401s and that is success (D4)
- [ ] Two users with different ids get **visibly different** initial hues — the D3 `String(id)` trap
- [ ] A user who has set a `display_name` sees **the same name** in the header and on `/profile`
- [ ] New Pest tests cover the `/api/me` contract, its 401, and both logout outcomes
- [ ] No page has two scrollbars; `SpeechCreate` and `ProfileEdit` still center their cards in the space below the header, and **`Onboarding` is unchanged** — it has no header (D1/R1)
- [ ] The menu trigger has a real accessible name — the display name, not "button" (D7)
- [ ] A toast raised while the menu is open renders **above** it — the reachable half of the `z-50` question. (The alert-dialog case is *not* testable by hand: Base UI's `AlertDialog` is modal, so the header trigger is inert while it is open, and only the dialog-appended-later order can occur, which passes trivially.)
- [ ] Opening the menu on `SpeechWatch` does **not** scroll-lock or freeze the page around a playing video (`modal={false}`, D7)
- [ ] ⚠️ **All three Playwright auth-setup projects still pass** — the R4 canary; run the full suite, not just the new spec
### Sidebar

- [ ] ⚠️ **A user with `roles: []` sees the complete baseline sidebar** — unit-tested directly against `lib/roles.ts`. This is the state 100% of real users are in (P1/S3); if it renders empty, the role logic was written subtractively
- [ ] The sidebar makes `/profile` reachable by clicking — it is currently reachable from **nowhere** in the entire app
- [ ] `MySpeeches`'s "My reviews" and "Upload a speech" buttons are **gone**, and `getByRole('link', { name: 'My reviews' })` matches exactly once on `/speeches` (S2)
- [ ] Exactly one `<nav>` landmark; the skip link jumps past **both** header and sidebar into `<main>`
- [ ] The current page carries `aria-current="page"`, and **at most one item** is marked on any route — note `/speeches/{id}` correctly marks *none*, since no sidebar entry represents a detail page (S7)
- [ ] At 1023px the sidebar is absent and every destination is still reachable from the user menu (S5); at 1024px+ it is present
- [ ] `<main>` has `min-w-0` — verified by putting a 200-character unbroken string in an annotation body and confirming the sidebar does not move (S7)
- [ ] Dragging a timeline marker while the sidebar is present retimes correctly (S6a — no width animation)
- [ ] ⚠️ **If "Find reviewers" is hidden from admins: an admin gets 403 AND a member gets 200 from `GET /api/reviewers`** — both directions, by direct API call, not by an absent link (S4/S6). Testing only the 403 passes just as well when the ability is undefined and *everyone* is denied, which is the exact failure S4 describes. If that pair of assertions does not hold, the item must be visible to everyone
- [ ] Any security assertion in a Playwright spec uses `toHaveCount(0)`, never `not.toBeVisible()` (S6)

### Watch screen

- [ ] ⚠️ **A portrait (9:16) video and the "Commentary track" heading are visible together, no scrolling**, at a 930px viewport — the reported bug. **Test with a speech that has a sprite**, since the sprite strip adds ~324px and is what makes this fail (W3)
- [ ] **A landscape (16:9) video is unchanged at desktop heights** — assert 704 × 396 at a ≥660px viewport. Below that it legitimately shrinks (640×360 @600px), so do **not** assert the fix is portrait-only
- [ ] A portrait video's box is **~314 × 558** at a 930px viewport (where `min(60svh,620px)` = 558px), down from 704 × 1252. It is ~349 × 620 only at viewport heights ≥ 1033px, where the 620px term binds
- [ ] `PosterFramePicker` is still a named export of `@/routes/SpeechWatch`; `Transcript` still renders exactly one `list` role; the `TrackSelector` radiogroup is still rendered and visible for the owner (W5 — the commentary controls must not be hidden to buy height)
- [ ] The portrait box has **no letterbox bars** — tight around the video, not a wide box with black sides
- [ ] Annotation overlays still land on the video, not beside it, at the new box size
- [ ] Fullscreen still fills the screen, and iOS fullscreen subtitles still behave ([`useIosFullscreenSubtitles.ts`](web/src/hooks/useIosFullscreenSubtitles.ts))
- [ ] Timeline-strip drag still retimes correctly at the new width (it captures `getBoundingClientRect` once at drag start)
- [ ] After W4, a portrait video **does not visibly jump** from 16:9 to its real ratio on load — seeded from the poster where present, from persisted video dimensions otherwise; a speech with neither still renders correctly via the `16 / 9` fallback
- [ ] ⚠️ **Verified in WebKit, not just Chromium — twice over.** *Two* independent parts of this fix pass in Chromium and Firefox and fail in WebKit: the `aspect-ratio`+`max-height` sizing, and `height:100%` on the player wrappers. A Chromium-only check would have shipped iOS broken either way. Measure the box **and** the player inside it in all three engines (W2)
- [ ] ⚠️ **A speech with no poster and no persisted dimensions still renders** — the missing-`--video-ar` path. Without the `calc()` fallbacks this is 0×0 in all three engines (W2)
- [ ] Annotation overlays align to the video, not offset left — i.e. the box was applied to `SpeechWatch`'s `.relative`, not inside `VideoPlayer` (W2)

- [ ] `npx tsc`, `npx eslint .`, `npx vitest run` and `./vendor/bin/pest` all clean, with **no existing test modified to accommodate the shell** (if one needs changing, D1 was not followed)

## Build order

0. Backend: `display_name` on `UserResource`, the `id` type fix, and the four Pest tests. Independently shippable, and everything below reads the field it adds.
1. `lib/displayName.ts` + its unit test — pure, no dependencies, and the thing every other piece reads.
2. `ui/dropdown-menu.tsx` — the primitive wrapper.
3. `UserMenu` → `AppHeader` → `AppLayout`, bottom-up.
4. `App.tsx` restructure — the single riskiest commit; everything above it is inert until this lands.
5. R1's `min-h-svh` sweep — **the two wrappers named there, not all five** — immediately after step 4, same commit or the next. Between those two points those pages have two scrollbars.
6. Strip the ad-hoc widgets from `Dashboard` and `MySpeeches` (mind the uncommitted baseline above).
7. The `NotificationBell` a11y rebuild — D6's precondition. Do it before or with the move, not after.
8. The Playwright spec, and wire it into `ci.yml`'s Playwright command.

9. `lib/roles.ts` + its unit tests (including the `roles: []` case), then `AppSidebar.tsx` into the layout's row wrapper.
10. Delete `MySpeeches.tsx:39-42`'s two buttons — same commit as step 9, or the strict-mode ambiguity exists in between.
11. Optional housekeeping, unrelated to the sidebar: the `90cqw` container-query fix on `SpeechWatch` (S7, trap 3).
12. **The watch-screen player fix (W2)** — `fill: true` in `videojs-adapter.ts`, the width-calc box on `SpeechWatch.tsx`'s `.relative`, `position:absolute;inset:0` on `VideoPlayer`'s two divs, and the `PosterFramePicker` gate/height fix from W3. **Independent of the shell above** and can ship first if the player height is the more urgent annoyance. Do it *after* the shell only if you want the header's real height when picking the `max-height` figure (W3).
13. W4's dimension persistence — backend, removes the layout shift, and is the only part of W that needs a queue worker run to take effect.
14. Optional, and genuinely extra scope: the `/reviewers` page, and `viewDirectory` wiring if the item is role-hidden (S4).

**Four decisions to settle before step 1, because they change the code you write:**

1. The initials-chip contrast approach (D3).
2. Whether D6's bell rebuild is in scope, or the bell stays on Dashboard.
3. **Whether "Find reviewers" ships in v1.** It is the highest-value item here — a fully built feature currently reachable only mid-invite-flow — but it needs a new route and page, which is real scope beyond "add a sidebar."
4. **Whether P0 blocks this work.** My recommendation: fix the unauthenticated presign route first. It is unrelated to navigation and takes minutes.
