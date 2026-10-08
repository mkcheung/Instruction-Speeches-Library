# Plan — Admin & Superadmin Dashboard

**Status:** draft for review (rev 2, post-validation) · **Date:** 2026-10-06 · **Do not execute without sign-off**

Built from a five-agent audit of backend, Filament surface, frontend, migrations and the media pipeline, then fact-checked and critiqued by two further agents. Rev 2 corrects seven factual errors in rev 1 — they are listed in §13 rather than silently patched, because two of them had already been used to justify a design decision.

Every claim was verified against real code, vendor source, or the live Postgres container (39 migrations applied, zero pending). Where this repo's docblocks state intent that was never built, that is called out rather than inherited.

**Stack note:** this is Laravel **13.24.0** (`laravel/framework: ^13.8`), not 12. Filament v4.12.6, Livewire 3.8.6, spatie/laravel-permission ^8.3.

---

## 0. Decisions taken, and one requirement that cannot be met as stated

| Question | Decision |
|---|---|
| Where the dashboard lives | **Extend the Filament panel** at `/control-panel`. Not React. |
| What `super_admin` gets that `admin` does not | Grant/revoke `admin` + `super_admin`; GDPR erase; audit log + system health |
| Destructive user actions | Suspend + soft-delete + restore (all reversible) |

### ⚠️ Q0 — "Promote users from member to coach" conflicts with an existing product rule

This was your first stated requirement, and **the plan cannot deliver it without you overriding a deliberate design decision.**

There is exactly one path to the `coach` role: `CoachApplicationDecisionService::approve()`, reached only from the coach-application queue. `UserResource.php:44-55` documents that a standalone "Grant coach" button **existed and was deliberately removed** by a `/code-review` pass, because `MODERNIZATION_PLAN.md` §6.8 requires certification review before promotion.

**Consequence: if a member never submits an application with certification PDFs, no admin can ever promote them.** Pick one:

- **(a) Keep the rule.** Admin promotion stays application-only. Your requirement is amended. *(Recommended — the rule exists for a reason and the audit trail depends on it.)*
- **(b) Admin creates an application on the member's behalf**, uploads documents received out-of-band, then approves it through the normal path. Preserves the audit trail and the document requirement.
- **(c) super_admin override** — direct grant with a mandatory reason, audited as a distinct action. Fastest, and punches a hole in the certification requirement.

Nothing else in this plan depends on the answer.

### Erase scope
The second decision puts GDPR erase under `super_admin`; the third scopes the dashboard to reversible actions. Resolved as: **admin** gets suspend / soft-delete / restore; **super_admin** additionally gets erase. But see §10 — erase is **cut from v1** regardless, because `PrivacyEraseCommand` already exists and a once-a-year irreversible action has the worst risk-to-value ratio in the plan.

---

## 1. Three findings that change the shape of the work

### 1.1 Suspension does nothing. "Kick people off the platform" is not implemented.

`UserDeletionService` stamps `users.suspended_at`, and **nothing reads it for access control.** Verified independently twice. The complete set of reads in `api/app/`:

| Site | Purpose |
|---|---|
| `UserResource.php:76, 115, 123` | display column + button label |
| `RoleAssignmentService.php:90` | admin-roster count |
| `UserDeletionService.php:52, 65` | the writes themselves |

`bootstrap/app.php:18-31` registers only `statefulApi()`, the `verified.api` alias, and `AssignCorrelationId`. There is no `authenticateUsing`, no `canAccessPanel`, no `validateCredentials`, no `addGlobalScope` anywhere in `app/`. `User` does not implement `FilamentUser`. `User::booted()` only creates a Profile.

**A suspended user keeps their session cookie and every Sanctum token and continues using the entire product indefinitely.** `UserDeletionService.php:16-19` claims "session dies within one request… the rest of the auth stack already checks" — it does not. Same for `deleted_at`: zero reads in `app/Http/` or `app/Providers/`, and `User` deliberately omits the `SoftDeletes` trait (`User.php:36`).

→ §5.1. This is a prerequisite, not a feature.

### 1.2 `super_admin` is a strict *subset* of `admin`, not a superset

`EnsureUserIsAdmin.php:39` admits `hasAnyRole(['admin','super_admin'])`. But `Gate::before` (`AppServiceProvider.php:240`) and every policy check test `hasRole('admin')` **exactly**. Spatie applies no hierarchy; the roles never stack (`GrantRoleCommand` and `E2ESeeder` both use `syncRoles`).

**Exactly 15 sites exclude `super_admin`** (verified count — rev 1 said 16):

`AppServiceProvider.php:240` *(the `Gate::before` bypass itself)* · `UserPolicy.php:49, 67, 78` · `AnnotationPolicy.php:47` · `Annotation.php:114` · `ReviewPolicy.php:35, 46, 57, 68, 84, 89, 125` · `ConnectionPolicy.php:31` · `EssayController.php:68`

**Three sites accept it for actor authorization:** `EnsureUserIsAdmin.php:39`, `HorizonServiceProvider.php:40`, `GrantsReviewWriteAccess.php:31` *(a denial — correct)*. Four more treat the two as one tier for *roster predicates about a target* rather than actor authz: `RoleAssignmentService.php:71, 87, 108`, `GrantRoleCommand.php:64` — so last-admin protection already knows super_admin counts as an admin.

Net effect: a `super_admin`-only account logs in, sees every table, and **every moderation button fails with a red toast.** `EnsureUserIsAdmin.php:37-38` asserts the opposite in a comment.

It is not *worse* only by accident: **no policy anywhere in `app/` defines `viewAny`.** Filament's chain is `Resource::canAccess()` → `canViewAny()` → `helpers.php:59-92`; `$isAuthorizationStrict = false` (`HasAuth.php:105`, never overridden) → `callBeforeCallbacks` returns `null` for super_admin → `if (! $response instanceof Response) return Response::allow()`. **Every resource is reachable by anyone clearing the middleware.** Adding a single `viewAny` policy method would silently lock super_admins out of that resource.

→ §5.2, and §8.2 for why super-admin-only surfaces must use `canAccess()`, never policies.

### 1.3 Taking down a speech leaves every byte in the bucket, permanently

`SpeechResource::takedown` calls `$record->delete()` — soft. `Speech` uses `SoftDeletes`, so `ON DELETE CASCADE` on `speech_assets` never fires. Every asset row and every byte survives.

All 21 `Storage::disk(...)->delete(...)` sites in `api/app/` were enumerated. **Only `AccountErasureService.php:304` ever deletes video/poster/sprite bytes** — GDPR self-erasure, never moderation.

> **Correction to rev 1.** Rev 1 claimed a taken-down speech's *source* still gets pruned. **That is backwards.** `MediaReconcileCommand.php:261` uses `Speech::query()`, and `SoftDeletes`' global scope **excludes** trashed speeches, so the `! $captionsEnabledBySpeech->has(...)` guard at line 282 fires and `continue`s. The source is **retained forever too.** The leak is worse than rev 1 described, not better — and the inverted mechanism would have sent a fix in the wrong direction.

`media:reconcile` has no speech soft-delete awareness at all. It *does* handle soft-deleted **annotations** (`MediaReconcileCommand.php:171-174`) — the precedent to copy rather than a pattern to invent.

Compounding it: the object path is `speeches/{ulid}/{ulid}/720p.mp4` — **deterministic from the ULID alone.** The intended `speeches/{ulid}/{playback_key}/video.mp4` was never built: `playback_key` has one write site in `app/` (`Speech.php:163`) plus three seeders, and **zero reads**. So "rotate `playback_key` to invalidate outstanding URLs" is architecturally unavailable, and "for immediate takedown, delete the object" is unimplemented.

And `MediaUrlSigner::presign()` enforces **no authorization** — a pure `(path, ttl) → URL` function. Any path yields a working URL, including for taken-down content.

→ §5.6 (purge moves into Phase 1) and §6.4.

---

## 2. Baseline

`/control-panel`, Filament v4.12.6, TOTP 2FA mandatory, exactly 9 routes. **`/control-panel` is a redirect, not a page** — `RedirectToHomeController` sends you to the first navigation item.

| Resource | Can do | Cannot do |
|---|---|---|
| **Users** | list, filter by role, search, revoke coach, suspend/unsuspend, bulk suspend (≤25) | delete, restore, erase, grant any role, detail view, storage |
| **Speeches** | list (incl. trashed), annotations by reviewer, take down | **watch video**, read transcript, **hear voice notes**, **read essays**, restore, search, filter |
| **Coach applications** | queue oldest-first, view PDFs sandboxed, approve, reject | see decided history — approved/rejected vanish |
| **Reports** | list, filter by state, resolve with note, dismiss | **see what was reported**, see `detail` (the reporter's free text), see who reported |
| **Connections** | list de-mirrored, filter, view pair | anything else (read-only by design) |

Never called on the panel: `->pages()`, `->widgets()`, `->navigation*()`, `->sidebarCollapsibleOnDesktop()`, `->errorNotifications()`. No resource sets `navigationIcon`, `navigationGroup`, `navigationSort`, or `canAccess`.

**`MostConnectionsWidget` is orphaned** — discovered and registered as a live Livewire component, but `Filament::getWidgets()` is rendered *only* by `Pages/Dashboard.php:49`, and no Dashboard is registered.

**Nothing in the SPA links to `/control-panel`** — zero hits across all of `web/`. `navItemsFor()` is subtractive-only for admins, so an admin's sidebar is strictly smaller than a member's with no path to their own panel.

---

## 3. Scope

**In (v1):** suspension enforcement · super_admin superset · 8 authorization holes · takedown byte purge · dashboard landing page · user delete/restore · admin video + transcript + **voice-note** playback · mandatory moderation reason · responsive tables · branded 403 · tests.

**Deferred (§10):** stat tiles beyond one, index migration, audit-log viewer, system-health page, GDPR erase UI, decided-application history, CSP.

**Out entirely:** React rebuild · `X-Accel-Redirect` per-request media authz · migrating object paths to `playback_key` · a custom Filament theme (§8.3) · force-directed connection graph (`MODERNIZATION_PLAN.md:1108` forbids it).

---

## 4. Role model

| Capability | member/coach | admin | super_admin |
|---|---|---|---|
| Reach `/control-panel` | ❌ 403 | ✅ | ✅ |
| All six resources | ❌ | ✅ | ✅ |
| Suspend / unsuspend / soft-delete / restore user | ❌ | ✅ | ✅ |
| Take down / restore speech | ❌ | ✅ | ✅ |
| Approve / reject coach application | ❌ | ✅ | ✅ |
| Resolve / dismiss report | ❌ | ✅ | ✅ |
| Watch video, hear voice notes, read transcripts/essays | ❌ | ✅ *(audited)* | ✅ *(audited)* |
| **Grant / revoke `admin`, `super_admin`** | ❌ | ❌ | ✅ |
| **GDPR erase** *(deferred to CLI in v1)* | ❌ | ❌ | ✅ |
| **Audit log / system health** *(deferred)* | ❌ | ❌ | ✅ |

---

## 5. Phase 1 — Correctness prerequisites

Every item is a defect in shipped code. This lands as one reviewed commit **including its tests** (see §5.8).

### 5.1 `CheckUserIsActive` — make suspension real

Checks `suspended_at` / `deleted_at` / `anonymized_at`; on hit: `Auth::logout()`, invalidate session, revoke Sanctum tokens, 403 (JSON) or redirect to a suspension notice (HTML). Exempt the logout route.

> **⚠️ Do not use `$middleware->append()`.** That registers *global* middleware, which runs **before `StartSession`** — so `$request->user()` resolves through `SessionGuard` with no session and returns `null`, and the middleware waves everyone through. `AssignCorrelationId` is appended globally and is fine because it needs no auth; this is not.
>
> It must go in **three** places:
> 1. the `api` group (after `statefulApi()`),
> 2. the `web` group (Fortify's root-mounted routes),
> 3. **`AdminPanelProvider::middleware([...])`** — the panel declares its own explicit list and does *not* use the `web` group. Without this, **a suspended admin keeps full `/control-panel` access** — an RBAC hole introduced by the fix for an RBAC hole.
>
> **The test must drive a real login** (`post('/login')`, then a follow-up request). `$this->actingAs($user)` sets the user directly on the guard, bypassing the session entirely — a test written that way is **green while production is unaffected.**

Also add `suspended_at` and `deleted_at` to `User::casts()` (`User.php:119-142` omits both), or `$user->suspended_at->diffForHumans()` throws. Filament's `->dateTime()` masks this only because it parses strings.

**Rollback note:** revoked Sanctum tokens are not un-revoked by `git revert`. Every suspended-then-unsuspended user must re-login. §0 calls suspend "reversible" — this is the asterisk.

### 5.2 Make `super_admin` a real superset

Change `hasRole('admin')` → `hasAnyRole([...])` at all 15 sites in §1.2.

> `ReviewPolicy.php:125` is `return ! $user->hasRole('admin');` — a **denial**. The mechanical change is still correct (it denies both tiers, aligning the backend with `roles.ts`, which already hides "Find reviewers" from super_admins), but flag it in review so a 15-site diff isn't skimmed.

Introduce `App\Support\Role` constants. Role names are bare string literals across **15 files** (25 non-comment lines, 35 occurrences) — exactly the drift that produced this split.

**Frontend needs only a docblock edit.** `roles.ts:20-22` *already* treats `super_admin` as `admin` and `roles.test.ts:15-17` pins it; only the "super_admin is otherwise inert" comment is now false.

### 5.3 Define the four phantom abilities
`user.erase`, `user.demote`, `role.grantSuperAdmin`, `role.revokeSuperAdmin` sit in `$mustFallThrough` (`AppServiceProvider.php:267-268`) but are never `Gate::define`d. They deny-by-default today (safe), but **there is no path to grant `super_admin` at all.**

> **⚠️ This breaks `AuthorizationScaffoldTest.php:47-49`**, which asserts `Gate::forUser($admin)->allows('user.erase')` is false **with no model argument**. Once the ability binds to a `(User $actor, User $target)` policy method, that call throws `ArgumentCountError` — it errors rather than failing an assertion. The file's own comment at lines 38-46 documents this exact precedent: `review.accept` was dropped from that list in STEP-05 and `user.delete` in STEP-12 for the identical reason. Drop `user.erase`/`user.demote` from the `foreach` and move coverage to model-bound assertions in `AdminAbilityDenialTest.php`.

### 5.4 Close eight authorization holes

| Hole | Location |
|---|---|
| `unsuspend` bypasses its Gate — the `if` routes around `Gate::authorize`, which sits only in the `else` | `UserResource.php:123` vs `:127` |
| **`takedown` has no `Gate::authorize` and no `speech.takedown` ability exists anywhere** — the only destructive verb on content, gated solely by `EnsureUserIsAdmin` | `SpeechResource.php:90-107` |
| Coach approve/reject have no `Gate::authorize` (audit *is* written by the service) | `CoachApplicationResource.php:103-118` |
| Report resolve/dismiss have **neither Gate nor audit** — `AuditLog` isn't even imported | `ReportResource.php:47-69` |
| `RoleAssignmentService::assign` has no self-check and no role allowlist — an admin can self-assign `super_admin`; `$actor` is accepted and discarded in both write methods | `RoleAssignmentService.php:51` |
| Annotation modal bypasses the read policy — no Gate, no `scopeVisibleTo`, no owner exclusion, so an admin who owns the speech reads their own coach's **unpublished drafts** | `SpeechResource.php:62-78` |
| Commentary audit fires on `action()` (submit), not `modalContent()` (open) — **open, read, close leaves no audit row** | `SpeechResource.php:51-89` |
| Live `assert()` → a dual-role admin gets **500 `AssertionError`, not 403**. No ini sets `zend.assertions`; `Dockerfile:119-120` copies only `opcache.ini` + `uploads.ini`, so the compiled default (enabled) applies | `AnnotationPolicy.php:48-50` |

Two notes: the allowlist must include `coach` (`CoachApplicationDecisionService::approve()` calls `assign(..., 'coach')`, pinned by `RoleAssignmentServiceTest.php:23`), and it **will not cover CLI** — `GrantRoleCommand.php:68` calls `syncRoles()` directly, bypassing the service.

> **Decide explicitly whether `revoke()` also gets a self-check.** If yes, `RoleAssignmentServiceTest.php:50-51` and `:65-66` break — both deliberately self-revoke to construct the last-admin scenario. **Recommend: no self-check on `revoke`**, preserving those tests; the last-admin guard already prevents the dangerous case. Verify `php -i | grep zend.assertions` in the container before writing the assert fix.

### 5.5 Mandatory moderation reason — *promoted from "nice to have"*
Takedown writes `metadata: []` (`SpeechResource.php:102`). No reason is captured and **nobody is ever notified** — not on takedown, not on suspension. A moderation system with no statement of reasons and no notice to the affected user is a product problem and, for a public platform, plausibly a compliance one (§11.1 legal groundwork is still unaddressed per project notes). A required reason field on takedown/suspend/delete plus a notification is ~10 lines and the cheapest high-value item in the plan.

### 5.6 Purge bytes on takedown — *moved into Phase 1*
This is a shipped defect of the same class as the other seven, and it is **decoupled from the quarantine-window question** (§11): enqueue a purge job now, decide the delay separately. Follow the claim-then-delete shape at `AccountErasureService.php:273-312`. Add a soft-deleted-speech sweep to `media:reconcile`, copying its existing annotation handling.

### 5.7 Audit plumbing
`RoleAssignmentService` writes **no audit at all** (`AuditLog` isn't imported) — audit is the caller's responsibility and `GrantRoleCommand` writes none, making CLI role changes unauditable. Four constants have no call site: `ROLE_ASSIGNED`, `USER_DELETED`, `USER_RESTORED`, `ADMIN_VIEWED_SPEECH`. **Reports need two new constants** — none covers resolution.

> **Standing rule.** `Gate::before` state 3 is *allow-by-default for admins on any unregistered ability string* (`AuthorizationScaffoldTest.php:24` asserts `allows('some.arbitrary.ability') === true`). Every new ability must be added to `$mustFallThrough` **in the same commit**, or it is an unconditional admin yes.

### 5.8 Phase 1 ships with its own tests
HTTP status tests for member/coach/anon/admin/**super_admin** against `/control-panel`; the real-login suspension test; the `AuthorizationScaffoldTest` repair. Phase 1's gate cannot live in Phase 4.

**Break-glass:** a `Gate::before` change that goes wrong locks the only operator out of their own panel. Document the recovery (`php artisan user:grant-role`) in the commit message.

---

## 6. Phase 2 — The dashboard

### 6.1 Landing page
`app/Filament/Pages/Dashboard.php` extending `Filament\Pages\Dashboard`. **Use directory discovery** — `discoverPages()` already points at `app_path('Filament/Pages')` (`AdminPanelProvider.php:77`) and the directory doesn't exist, so creating it is sufficient; no `->pages()` call, no provider edit. (`$routePath = '/'` is already the inherited default — nothing to set.)

No route conflict, for a version-specific reason worth recording: `vendor/filament/filament/routes/web.php:194` guards the home redirect with `if (! isset(Route::getRoutes()->…['GET'][$rootKey]))` on Laravel ≥13. This repo is on 13.24.0, so the Dashboard cleanly takes the root. On Laravel <13 the redirect registers unconditionally first.

**v1 carries one tile (open reports, served by `reports_state_created_at_index`) plus `MostConnectionsWidget`.** The rest of the tiles and the index migration are deferred — see §10.

`MostConnectionsWidget` runs a correlated subquery per user over the whole `users` table before `limit(25)`; fine at 15 users, revisit at ~10k. **`User` has no `SoftDeletes` trait, so every count must add `whereNull('deleted_at')` by hand.**

### 6.2 Users — finish the half-built surface
`softDelete` and `restore` are implemented and have **zero callers** — the cheapest real capability in the plan. Two caveats rev 1 got wrong: `softDeleteMany` has zero callers **and zero tests**, and `restore()` (`UserDeletionService.php:90-93`) is a bare `forceFill` with **no self-check and no roster lock** — it is *not* "guarded". Add guards before wiring a button to it.

Add: delete / restore row actions · a user detail page (speeches, reviews, connections, storage vs quota) · grant/revoke `admin`|`super_admin` (super_admin only, allowlisted) · storage and role columns.

> **`users.suspended_by_id` does not exist** — specified at `MODERNIZATION_PLAN.md:600`, deferred STEP-11 → STEP-12, never built. **Recommend: skip the column, read `audit_log`** (decided, not an open question).

### 6.3 Speeches — watch, hear, read, restore

**Transcript first — but it needs §5.2 landed.** `caption.readCaptions` is deliberately excluded from `$mustFallThrough` (`AppServiceProvider.php:193-200`, with the rationale that widening admin *read* is not the same failure mode as widening admin *write*), and `SpeechPolicyCaptionsTest.php:123` pins it. **An `admin` can already read any transcript today. A `super_admin` cannot** — `Gate::before` tests `hasRole('admin')` exactly. Rev 1's "no new authz at all" was true only for one of the two roles. A modal rendering `speech_transcripts.body` is a plain DB row — no storage round trip, no signed URL. Query `withTrashed()` directly; the API 410s on a trashed speech, exactly when a moderator most needs it.

**Voice notes and essays are v1, not nice-to-have.** `Report::REPORTABLE_TYPES` lets a user report a **Review** — so a moderator can receive a report about a coach's voice commentary and **have no way to hear it.** The annotations modal renders `{{ $annotation->body }}`, which is null for a voice note, and never shows `Review.essay_html`/`essay_text`. Same presign mechanic as video.

**Then video.** Follow the admin-PDF pattern's *authorization shape*, diverging on delivery:

| PDF precedent | Admin media |
|---|---|
| Authorize at **generation**, inside an `EnsureUserIsAdmin`-gated action | same |
| Audit written in `modalContent()`, not `action()` | same — note the `CoachApplicationResource.php:64-77` bug history, where a bare `->action()` audited a view the admin never saw |
| Gate on resource state at both ends | `kind='video' AND is_primary AND status='ready'`, **and `! trashed()`** |
| Proxy through Laravel, force `attachment` | **presign the bucket URL** |

> **⚠️ Correction to rev 1 — the security argument was wrong.** Rev 1 claimed the media host has "no admin session cookie scoped to it — origin separation is already structural." **False.** `.env.example:98` sets `SESSION_DOMAIN=.speechcoach.test` — **leading dot**, so the cookie is sent to every subdomain including `media.`; `config/session.php:202` sets `same_site: lax`, so media→api requests are same-site and carry credentials. In dev it's `localhost:8333`, sharing a cookie domain (cookies ignore ports). **Presigning is a pragmatic choice given no `X-Accel-Redirect`, not a safe-by-architecture one.**

Costs to accept explicitly, not hand-wave:
1. The URL is a **transferable bearer token**. Audit records "a URL was minted", not "this admin watched this speech" — a real downgrade in accountability versus the PDF proxy, for a surface whose justification *is* accountability.
2. It leaks further than browser history: the Livewire component payload (re-sent on every round-trip), the rendered DOM, nginx access logs on the media vhost, and potentially GlitchTip breadcrumbs (STEP-14 wired Sentry).
3. It keeps working after takedown, and §1.3 proves rotation is unavailable.
4. **"A video cannot execute script" is not format-universal.** The `kind='video'` CHECK admits `format IN ('mp4','hls')`. An HLS manifest is a text playlist referencing arbitrary URIs and needs a JS player. True for today's mp4; false for the schema's permitted set.
5. **Client-controlled Content-Type.** `CreateUploadRequest.php:27` validates `content_type` as `['required','string','max:255']` with **no mime allowlist**, and `MultipartUploadService.php:56` passes it straight through. A user can park an object the media host serves as `text/html`. Today's `kind='video'` gate excludes it — but the cases where an admin most needs to look (failed transcode) are exactly where only the `source` asset exists.
6. **No server-side refresh handler.** The React error-driven re-presign (`videojs-adapter.ts:98-131`) has no Blade equivalent, so a speech longer than the TTL breaks on seek. **Use a 1-hour TTL**, matching the existing precedent at `app/Http/Resources/SpeechResource.php:124` — note that is the **HTTP** resource, not the Filament one of the same basename.
7. `<track>`/`crossorigin` will fail silently — `media:configure-cors` builds `AllowedOrigins` from `config('cors.allowed_origins')` = `https://app.speechcoach.test` only. The panel is on `api.`. A plain `<video src>` is fine.

Also add: **restore (un-takedown)** · title search · state filter.

### 6.4 Reports — add the missing context
An admin sees `reportable_type` and **cannot tell which record was reported**, nor read `detail` (the reporter's free text, in `$fillable` but not in the columns — the single most useful field). Add `detail`, a reporter column, a deep link, and the Gate + audit from §5.4.

> ⚠️ `Report::REPORTABLE_TYPES` resolves only `Speech` and `Review`. **A user cannot be reported at all** — so abuse via connection requests, profile bio, username or avatar has no inbound signal, and "kick people off the platform" has no queue feeding it. Rev 1's §6.7 promised a deep link to "the reported speech/annotation/user" when two of those three cannot exist. Adding `User` as a reportable type is a small, high-value addition — see §12.

---

## 7. Phase 3 — Responsive & ergonomics

- **`->stackedOnMobile()` on all five resource tables** (rev 1 said six). Tables already scroll horizontally, but the vendor doc is explicit that this is insufficient: *"on mobile, the user is unable to see much information in a table row at once without scrolling."* One call per resource turns each row into a labelled card with a sort dropdown. Per-column: `->visibleFrom()` / `->hiddenFrom()`.
- **Dashboard grid**: `getColumns(): ['md' => 2, 'xl' => 4]`; widget `$columnSpan` likewise. A bare integer applies at `lg`+ only.
- **Navigation**: mobile overlay is automatic. Add `->sidebarCollapsibleOnDesktop()`, `navigationGroups` (*Moderation* / *People* / *System*), `navigationIcon`, `navigationSort` — none set today.
- **Modals at 390px** are the real gap. The video player and annotations modals are the densest surfaces in the panel, and §8.3 shows both existing modals currently render unstyled. "Filament handles it" is true for tables, false for these.
- **SPA entry point.** Not a simple list entry: `NavItem` renders `<NavLink to={...}>` (`AppSidebar.tsx:48-49`), a **client-side React Router link**, but `/control-panel` is a Laravel route on `api.speechcoach.test` while the SPA is on `app.`. It needs an external-link affordance on `NavItem` plus an absolute URL from `API_URL` (`web/src/lib/api.ts:2-3`) — a type change and a render change in both `AppSidebar` and `UserMenu`.

> **Correction to rev 1's Playwright warning.** Rev 1 said adding a nav item breaks Playwright. **Wrong** — `app-shell.spec.ts:142`'s label list is an *inclusion* check inside a `toBeVisible()` loop, and the spec runs as a non-admin anyway. No exhaustive nav assertion exists in `web/`. The real hazard is the reverse: **renaming or removing** one of those four labels breaks Playwright silently while vitest stays green.

---

## 8. Access Denied

### 8.1 Panel
`EnsureUserIsAdmin` calls `abort(403)`. With `shouldRenderJsonWhen(fn ($r) => $r->wantsJson())`, a browser navigation gets **Laravel's stock HTML 403** — no branding, no explanation. Filament ships no error views and `api/resources/views/errors/` does not exist.

Add `resources/views/errors/403.blade.php` **and** `->registerErrorNotification(…, 403)` — the Blade view covers direct URL hits, the notification covers denials raised during a Livewire request.

### 8.2 Super-admin-only surfaces
Override `canAccess()` explicitly — **never policies** (§1.2: no `viewAny` exists, framework fallback is `Response::allow()`).

- **Resource** → `canAccess()`, enforced on `mount` **and** `hydrate`.
- **Page** → `canAccess()`, defaults `true`.
- **Widget** → `canView()`, enforced at render-time filtering **and** by a `hydrate` guard — without the second, the component stays directly addressable.
- `shouldRegisterNavigation()` only hides the link. Vendor's own comment: *"Hiding a resource from navigation does NOT prevent direct URL access."*

### 8.3 Styling constraint — real, but not for rev 1's stated reason

> **Correction.** Rev 1 claimed `api/` has "no package.json, no vite.config, no tailwind config" and that a theme would mean *introducing* a node toolchain. **Wrong.** `api/package.json` declares `tailwindcss ^4.0.0`, `@tailwindcss/vite ^4.0.0`, `laravel-vite-plugin ^3.1`, `vite ^8.0.0`; `api/vite.config.js` wires `tailwindcss()` to `resources/css/app.css`, which contains `@import 'tailwindcss'`. (Tailwind v4 configures in CSS, so "no tailwind config file" was literally true and vacuous.)

What is actually true: there is no `api/node_modules`, no `api/public/build`, and the Dockerfile's `webbuild` stage (lines 44-58) builds **`web/` only**. So the scaffolding exists and is unused; enabling it costs `npm ci && npm run build` plus a Dockerfile stage — real work, but far less than rev 1 implied.

**The constraint that stands:** none of the 15 Tailwind utility classes used by the two existing blades (`space-y-2`, `rounded-lg`, `border-gray-200`, `hover:bg-gray-50`, `dark:border-gray-700`, …) exists as a selector in `filament/dist/theme.css`, `support/dist/index.css`, or `forms/dist/index.css`. **Both modals render fully unstyled today** (`coach-application-documents.blade.php:10,16`, `speech-annotations-by-reviewer.blade.php:9,11`).

*(Rev 1 also misreported the `fi-*` counts as "1 occurrence each" — `theme.css` is a single 613 KB line, so `grep -c` counted lines. Actual: 188/247/212.)*

**v1 decision:** build from Filament's own widgets and blade components (`x-filament::section`, `card`, `badge`, `empty-state`, `tabs`, `callout`) and fix the two broken modals the same way. Revisit the asset pipeline only if a surface genuinely cannot be expressed that way. Charts need no build change — Chart.js is bundled self-hosted (283,292 bytes) under `js/filament/widgets/`, already served by the nginx regex. A **rebuild** is required though: `filament:assets` runs at image build time and `api/` is baked into the image.

---

## 9. Testing

The panel has **never been exercised by a browser in CI**, and no test asserts `/control-panel` status codes. `STEP-12-RETROSPECTIVE.md:36` admits it.

| Layer | Add | Phase |
|---|---|---|
| **HTTP** | member/coach → 403; anon → login; admin → 200; **super_admin → 200** | **1** |
| **Middleware** | suspended user logged out — **via real login, not `actingAs()`** | **1** |
| **Gate** | follow `AdminAbilityDenialTest`'s "direct Gate assertions, not just an absent button"; repair `AuthorizationScaffoldTest:47-49` | **1** |
| **Media** | admin presign works for `ready` video; **refuses for a trashed speech** | 2 |
| **Livewire** | `Livewire::test(Dashboard::class)` + each widget; 403 for non-super_admin. Works today (`livewire/livewire 3.8.6` installed transitively); `pestphp/pest-plugin-livewire` would add the `livewire()` sugar | 2 |
| **E2E** | see caveat below | 3 |

> **The E2E cost is higher than rev 1 said.** `AdminPanelProvider` sets `multiFactorAuthentication(isRequired: true)` and `E2ESeeder` sets **no** `two_factor_secret`/`two_factor_confirmed_at` — a Playwright login as `admin@e2e.test` lands in Filament's mandatory TOTP **enrollment** flow. You need seeded secrets plus a TOTP generator, or an env-gated bypass: new seed data *and* new machinery. Also `auth.setup.ts:56` logs in against the SPA's React form; the panel login is a Filament Blade page on a different host with different locators, so it needs its own `authenticate()`.

`phpstan.neon` is **level 8** with `app/Filament/*` not excluded. Pass an explicit memory flag — the host `php.ini` 128 M cap crashes phpstan.

---

## 10. Sequencing, and what v1 actually is

This plan is large for a solo zero-cost project. **v1 is the non-negotiable list — it satisfies every stated requirement at roughly half the scope.**

| Phase | Content | Gate |
|---|---|---|
| **1** | §5.1–5.8 — suspension (3 stacks), super_admin superset, 4 abilities, 8 holes, reason field, byte purge, audit plumbing, **plus its own tests** | Suspension provably ends a *real session*; all tests green |
| **2a** | §6.1 Dashboard page + one tile + `MostConnectionsWidget`; §6.2 user delete/restore | Dashboard renders; widget visible |
| **2b** | §6.3 transcript → **voice notes + essays** → video; §6.4 report context | Admin can watch/hear; trashed speech refuses |
| **3** | §7 responsive · §8.1 403 page | Verified at 390 / 768 / 1280 px |
| **4** | §9 E2E incl. TOTP harness | CI green |

**Deferred out of v1, with reasons:**

| Cut | Why |
|---|---|
| 5 of 6 stat tiles + the index migration | users 15, speeches 4, `audit_log` 0 rows. Seven indexes for tables you can `SELECT *` in a millisecond. Add each index when the reader that needs it ships. (`audit_log(created_at DESC)` is also largely redundant — `(actor_id, created_at)` and `(action, created_at)` already serve the filters.) |
| Audit-log viewer (§6.5 rev 1) | A viewer for an empty table with 11 writers and 0 readers. Ship §5.7's *writes* in Phase 1; build the reader when there's something to read. |
| System-health page | Horizon exists, is already correctly gated, and has a better dashboard than we'd build. Ship a link. |
| GDPR erase UI | `PrivacyEraseCommand` exists. Irreversible, used ~twice a year, worst risk-to-value ratio in the plan. CLI is the right home. |
| Decided-application history | Low value until there are decisions to review. |
| CSP | Three environment-specific media origins (`localhost:8333`, `media.speechcoach.test`, prod) and a real chance of breaking the SPA. CSP also does **not** apply to top-level navigations to another origin — which is exactly how an admin opens a presigned URL — so it buys less here than rev 1 implied. Separate project. |

---

## 11. Questions for you

Rev 1 asked seven; four were already answered elsewhere in the document and have been folded in as decisions. Four genuine ones remain, plus Q0 in §0.

1. **Q0 (§0) — the member→coach promotion conflict.** (a) keep application-only, (b) admin-creates-application, or (c) super_admin override?
2. **Takedown purge window (§5.6).** Immediate hard delete, or quarantine for N days so a wrongful takedown is recoverable? **Recommend quarantine at 30 days**, matching user soft-delete. Note the compound effect: a 1-hour unrevocable bearer URL plus a 30-day quarantine means taken-down content stays retrievable for 30 days. Defensible, but it should be a stated choice.
3. **Suspended-user UX (§5.1).** Hard 403, or a dedicated "your account is suspended, contact X" page with an appeal route? Nothing exists today.
4. **Reportable users (§6.4).** Add `User` to `Report::REPORTABLE_TYPES`? Without it, profile/username/avatar/connection abuse has no inbound signal at all.

---

## 12. Functionality worth adding that you haven't asked for

Ranked by what this product actually does. The first four are closer to defects than features.

**Safety-critical**
1. **Reportable users** — see §11.4. Today abuse via bio, username, avatar or connection requests cannot be reported.
2. **Profile / avatar moderation** — `/u/{username}` is public (a D5 regression test guards exactly that). Avatars and bios are user-uploaded, publicly visible, and have zero admin surface.
3. **Admin 2FA recovery** — `isRequired: true` with no reset path. All 15 console commands touch `two_factor_*` not at all. For a solo operator who loses their phone, this is the **highest-probability outage in the system**.
4. **Sever / force-block a connection** — `ConnectionResource` is read-only by design. If A harasses B through the connection system, an admin can see it and do nothing.

**Operational**
5. **Retry a failed transcode** — §12 proposes *seeing* stuck pipelines; there's no verb. `media:reconcile` marks assets `failed` after 2h and nothing can un-fail them.
6. **Admin-initiated data export (DSAR)** — `GenerateDataExport` is self-service only. If a user emails asking for their data, there is no path. (We're adding admin-initiated *erasure* and skipping its sibling.)
7. **Clear a rate-limit lockout** — STEP-14 added rate limiting; nothing can clear a throttle.
8. **Storage pressure view** — `storage_bytes_used` / `quota_bytes` / `uploads_in_flight` already exist and are surfaced nowhere. Cheap, real operational value for self-hosted storage.
9. **Admin notes on a user** — moderation history distinct from `audit_log`'s machine events. Needs a new table.
10. **Admin impersonation ("view as user")** — most useful support tool, most dangerous. Needs its own audit action, a hard block on impersonating another admin, and a persistent banner. **Recommend: not v1**, but decide deliberately.
11. **Bulk takedown** — users have bulk suspend (≤25); speeches have no bulk anything.
12. **Email deliverability monitoring** — `MODERNIZATION_PLAN.md:1173` calls a verification email landing in spam "the feature most exposed to getting it wrong" and asks for bounce/complaint monitoring from day one. No surface exists.

*Demoted from rev 1's list:* audit-log CSV export (build the reader first — the table has 0 rows) and reserved-username management (a seeder edit plus redeploy is fine at this scale).

---

## 13. Corrections made in rev 2

Recorded rather than silently patched, because two had already been used to justify a design decision.

| # | Rev 1 claim | Reality |
|---|---|---|
| 1 | Media host has no session cookie — "origin separation is structural" | **False.** `SESSION_DOMAIN=.speechcoach.test` (leading dot) sends the cookie to every subdomain. Presigning is pragmatic, not safe-by-architecture. (§6.3) |
| 2 | A taken-down speech's source still gets pruned | **Inverted.** `SoftDeletes`' global scope excludes trashed speeches, so the source is retained forever too. Leak is worse, not better. (§1.3) |
| 3 | `api/` has no node toolchain; a theme means introducing one | **False.** `api/package.json` + `api/vite.config.js` declare Tailwind v4 + Vite. Unused, not absent. (§8.3) |
| 4 | Adding a nav item breaks Playwright | **Backwards.** Label assertions are inclusion checks. *Renaming/removing* is the silent breaker. (§7) |
| 5 | `SpeechResource.php:124` is the TTL precedent | Wrong file — it's `app/Http/Resources/SpeechResource.php:124`, not the 120-line Filament one. (§6.3) |
| 6 | 16 sites exclude `super_admin`; `fi-*` classes appear once each | 15 sites (table was right, prose wasn't); `fi-*` appear 188/247/212 — `theme.css` is one 613 KB line, so `grep -c` counted lines. (§1.2, §8.3) |
| 7 | `softDelete`/`restore` are "guarded and tested" | `softDeleteMany` has zero callers *and* zero tests; `restore()` is a bare `forceFill` with no self-check and no roster lock. (§6.2) |

Also added in rev 2: Q0 (the member→coach conflict rev 1 buried in a parenthetical), the global-middleware trap and its false-green test, the missing `takedown` Gate, the `AuthorizationScaffoldTest` breakage, voice-note/essay playback, the mandatory reason field, byte purge moved into Phase 1, and the v1/deferred split.
