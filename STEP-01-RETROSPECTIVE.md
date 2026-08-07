# Step 01 retrospective — Account and identity

**Executed:** 2026-08-07 · **Against:** [STEP-01-identity.md](STEP-01-identity.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §12 S1 / §5.9 / §6.5 / §7
**Method:** two background subagents (backend, frontend) implementing in parallel, then a third, independent background subagent validating both against the live Docker stack. No code changes were needed at the validation pass — everything shipped by the first two passed on the first real run.

---

## What was accomplished

**`api/` — the full identity stack**, added beside Step 00's foundation:
- Migrations: `profiles`, `username_history`, `reserved_usernames`, identity columns on `users` (`first_name`, `last_name`, `username`, `username_changed_at`), Spatie's role/permission tables verbatim (no hand-written pivot). All bigint PKs.
- `App\Support\Username` — case *and accent* normalization (`Str::ascii()` + lowercase) done in **application code**, not database collation — see "Mistakes," below, on why the plan's MySQL-collation advice doesn't apply here.
- Fortify with every JSON contract hand-bound (`app/Http/Responses/Fortify/*`); `CreateNewUser` trimmed to email+password only, names/username deferred to onboarding step 1; `fortify.limiters.login` explicitly set to `'login'`; a `login` named route for the cross-device-verification redirect target.
- `App\Services\UsernameService` (30-day cooldown + `username_history` bookkeeping) and `App\Rules\UsernameIsAvailable` (format, reserved list, collation-independent collision).
- `App\Services\AvatarProcessor` — Intervention Image v4 + GD, full re-encode (not selective tag deletion) for EXIF stripping.
- `OnboardingController` / `ProfileController` / `AvatarController`, with `App\Support\Onboarding::currentStep()` deriving progress from which columns are already populated — no separate step-tracking column.
- `RoleSeeder`, `ReservedUsernameSeeder` (transcribed from the frontend's actual `App.tsx` route list), `E2ESeeder` (fixed ids 9001–9004, literal `2026-01-01` timestamps, one account per role), `user:grant-role` Artisan command.
- `Gate::before` scaffold (§7.2) and `Model::preventLazyLoading` wired from `AppServiceProvider::boot()`.
- 38 Pest tests, Pint, Larastan all green.

**`web/` — the auth shell and onboarding wizard**, added beside Step 00's Vite/React/Tailwind scaffold:
- RTK Query as the API/auth-state layer (`app/store.ts`, `lib/baseQuery.ts`, `lib/csrf.ts`) — the CSRF bootstrap, the **single-flight 419 retry**, and 401→`CustomEvent` broadcast, all real behavior confirmed by mocked-fetch unit tests: 419 retries exactly once after refetching the cookie; concurrent 419s trigger exactly one refetch, not one per caller; 401 never retries.
- `components/auth/AuthShell.tsx` (`RequireAuth`, `RequireGuest`, `RequireVerified`), wired into every route: `/register`, `/login`, `/forgot-password`, `/reset-password/:token`, `/verify`, `/onboarding`, `/profile`, `/u/:username`.
- The resumable onboarding wizard (`routes/Onboarding.tsx`) — reads onboarding progress on mount and renders whichever step the backend reports, rather than always starting at step 1; a hand-rolled canvas avatar cropper (~130 lines) instead of a library, since the crop is a fixed square.
- `lib/applyServerErrors.ts` — the one shared `{message, errors}` → `setError` helper every form uses.
- Own-profile edit and the public `/u/{username}` page.
- Package additions, all MIT/BSD, zero-cost: `@reduxjs/toolkit`, `react-redux`, `react-hook-form`, `zod`, `@hookform/resolvers`, `@testing-library/user-event`.
- 46 Vitest tests, `tsc -b`, ESLint all green.

**The demo script, walked live against the running stack**, not asserted from code review:
```
$ docker compose up -d && artisan migrate:fresh --seed
 ✔ postgres · seaweedfs · mailpit · app · web
```
- Registered a real account; pulled the verification link out of **Mailpit's HTTP API** and hit it with a fresh cookie jar (no prior session, simulating a different device) → `302` to `/login`, not a 500.
- Walked all three onboarding steps against the live endpoints, confirming each write landed in `profiles` **immediately** via an independent `psql` query between steps — not just after all three were submitted.
- Logged in as all four `E2ESeeder` role accounts; each returned `200` with the correct role, independently cross-checked against `model_has_roles`.
- `MarsDemo` vs. existing `marsdemo`, and an accent variant `märsdemo`, both refused with `422 "That username is already taken."` — not a 500.
- `admin` refused as reserved; the 21-row `reserved_usernames` table was diffed against `web/src/App.tsx`'s actual route list and confirmed to match.
- Six bad-password login attempts: `422` ×5, then a real `429 Too Many Attempts` with `X-RateLimit-Limit: 5`.
- A JPEG with a real GPS EXIF block (verified pre-upload with Pillow) was uploaded through the live avatar endpoint; the object pulled back from storage was independently re-checked with both PHP's `exif_read_data()` and Python Pillow — no GPS block in either.
- `session.cookie` confirmed live via `config:show` as the pinned `speechcoach_session`, not a framework default.
- The session cookie value changed before/after `/login` — session id regeneration confirmed by direct comparison, not assumed from Fortify's defaults.

---

## Difficulties encountered

1. **Two agents converged on the same two integration bugs independently**, which is worth noting as a confirmation that both were real rather than a story one agent told itself. Both the backend and frontend agents found: (a) nginx only proxying `/api` and `/up`, leaving Fortify/Sanctum's root-mounted routes (`/login`, `/register`, `/sanctum/csrf-cookie`) unreachable through the containerized single-origin build the frontend actually talks to; and (b) `Profile::firstOrCreate()` running in `User::booted()`'s `created` hook before `$user->id` was populated, 500ing every registration and leaving an orphaned `User` row with no `Profile`. The backend agent fixed both before the frontend agent needed to.
2. **nginx needed a GET-vs-POST split** for three paths that are simultaneously a backend route and a same-path React Router page (`/login`, `/register`, `/forgot-password`) — resolved with the `error_page`/named-location idiom, since `fastcgi_pass` cannot live inside an `if` block.
3. **The frontend agent started against a guessed Fortify-conventional API contract** before the backend agent's code existed, then had to reconcile against the real one once it landed: registration turned out to be email+password only (not names/username), `GET /api/me` not `/api/user`, `PATCH /api/profile` not `PUT`, `POST /api/avatar` not `/api/profile/avatar`, `GET /api/u/{username}` not `/api/users/{username}`, and `onboarding_step` as an integer rather than a nested object. All reconciled by reading the real controllers and confirming with `php artisan route:list` against the running container, not by guessing twice.
4. **`Profile`'s `#[Fillable]` list silently omitted `user_id`** — caught only by running a real insert against Postgres, not by static review; sqlite's looser type coercion had let a related bug (see Mistakes, below) pass silently in an earlier local run.
5. **`config/sanctum.php`'s stateful-domains default had a missing comma** in a `sprintf()` call, corrupting two of the configured domain entries, and was also missing `localhost:8080` for the containerized topology entirely — both invisible until a real cross-container request was attempted.

## Mistakes made

- **The plan's username-collation advice (`utf8mb4_0900_ai_ci`, accent- and case-insensitive) is MySQL-specific and does not apply** — this project runs Postgres, which is case-sensitive by default. STEP-01-identity.md's own "Watch for" section flagged this in advance, and the fix (normalize case *and* fold accents in application code via `Str::ascii()` before every write and every uniqueness check, never rely on DB collation) was built correctly the first time **because** the step file called it out ahead of implementation — the one place in this step where reading the warning up front avoided rediscovering it the hard way, unlike Step 00's Larastan-version and `tsc --noEmit` traps, which were both found only by running the tool.
- **`UsernameIsAvailable` had a stray `whereKey($normalized)`** comparing a bigint primary key column to a username string. This passed silently on sqlite (which coerces the comparison) and only threw `invalid input syntax for type bigint` once run against real Postgres — a second instance, alongside the `Profile` fillable bug, of a mistake that a lighter-weight local database would have hidden. Worth carrying forward as a standing rule for this project: **run tests against the real Postgres container, not sqlite, before treating a suite as trustworthy** — sqlite's type looseness is a false-negative machine here.
- **`bootstrap/app.php`'s `shouldRenderJsonWhen` was scoped to `api/*` only.** Because Fortify's routes are root-mounted (not under `/api`) to match how the frontend actually calls them, every Fortify validation failure was falling through to a session-redirect response instead of the `422` JSON contract the frontend's `applyServerErrors` helper depends on. Fixed by keying off `wantsJson()` instead of the path prefix — a reminder that "JSON API" and "under `/api`" are not the same test once a package (Fortify) insists on unprefixed routes.
- **`UsernameHistory`'s Eloquent default table name (`username_histories`) didn't match the migration's deliberately singular `username_history`** — caught immediately by the first test that touched it, but a reminder that a plan's schema names in prose need an explicit `protected $table` when they deviate from Eloquent's pluralization convention.

## Package surprises, in the same spirit as Step 00's Larastan/tsc findings

- **`intervention/image` installed as `^4.2`, not v3.** The plan and most public documentation assume v3's `read()` API; v4's is `decodePath()`/`decode()`. Verified against what actually installed, not assumed from the plan's wording — the same lesson Step 00 drew from "Larastan 5" not existing.
- **`laravel/fortify` `^1.37` hard-depends on `laravel/passkeys`**, which pulls in two-factor/passkey migrations that were not part of this plan. Left in place as harmless unused tables with the corresponding features left disabled in config, rather than fought — worth a note for whoever next touches `config/fortify.php` so the extra tables aren't mistaken for scope creep.

## What was not verified — and cannot be, from here

Identical in kind to Step 00's gap, and for the same underlying reason:

- **No GUI browser was available** to click through the React onboarding wizard, the avatar cropper's drag/zoom interaction, or the `setError` wiring as a human would actually experience it. This was substituted with passing Testing Library component tests (`Register.test.tsx`, `Onboarding.test.tsx`, `PublicProfile.test.tsx`) exercising the real components against a mocked HTTP layer, plus a direct API-level walkthrough of the same flow with `curl`. Both are real evidence, but neither is "a human watched the cropper crop."
- **Resumability was verified at the data layer, not at the literal 24-hour boundary** the demo script names ("close the tab halfway through, come back tomorrow"). Each onboarding step's write was confirmed to land immediately and independently via a `psql` query between steps — which proves the mechanism (server-side state, nothing held client-side) — but nobody actually waited a day.

These are the same class of gap Step 00 flagged: proven mechanically, not witnessed by a human in a browser. Closing them requires the same thing Step 00's did — a person, not an agent, at a keyboard.

---

## Next step

Per [STEPS.md](STEPS.md), **[Step 02 — Prove the domain layout, locally](STEP-02-first-deploy.md)** is next: `app.speechcoach.test` / `api.speechcoach.test` on `.test` hostnames with `mkcert`, proving the cookie-domain layout (`SESSION_DOMAIN=.speechcoach.test`, leading dot) that production will actually use, before Step 03 needs real uploads. It does not depend on the two visual gaps above — they should close by a human exercising the app before Step 01 is called *fully* finished, but they don't block starting Step 02.

**Concretely, before or alongside S2:**
1. Open the SPA in a real browser, register, and click through onboarding including the avatar cropper — the one thing no amount of `curl` or Testing Library substitutes for.
2. Confirm `git status`/`git diff` for both `api/` and `web/` are as expected, then commit Step 01's changes (nothing from this step has been committed yet — both implementation passes and the validation pass left everything in the working tree deliberately, for review).
3. Carry forward the "test against real Postgres, not sqlite" rule surfaced above — it caught two of this step's bugs and will keep catching this exact class of bug in every step that touches uniqueness or casting behavior.
