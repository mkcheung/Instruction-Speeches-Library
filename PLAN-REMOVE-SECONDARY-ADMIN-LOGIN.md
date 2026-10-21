# Remove the secondary admin credential page

Status: implementation and validation completed on `feat/unified-admin-login` on 2026-10-20. Changes remain uncommitted and have not been deployed to the running development stack. Sections 1–12 retain the reviewed requirements and planning history; section 13 records execution and its validation boundaries.

Prepared 2026-10-20 against commit `bcc54c3` on branch `development`.
Revision 3, final planning review: two sequential explorer reports reconciled with application and installed vendor source; four initial adversarial findings and one final completeness finding verified and incorporated. That planning review preceded implementation; subsequent execution is recorded in section 13.

## 1. Desired experience and scope

Everyone enters email and password at the React application's `/login` page. A normal member/coach login reaches the existing onboarding/dashboard destination. A normal admin/super-admin login reaches the existing Filament control panel, with the appropriate role permissions. An explicit SPA destination continues to take precedence, as it does today.

Remove the separate Filament email/password form. Retain `/control-panel/login` as a temporary-redirect entry point with the existing route name. This route compatibility is necessary for Filament's guest handling, logout response, existing bookmarks, and safe post-login continuation.

This removes a duplicate credential interface, not admin MFA. If MFA is required, the existing enrollment/challenge screens remain in the flow. No second password entry is needed. Admin and super-admin use the same control-panel application; their permissions determine what they may access.

The implementation includes two narrowly related parity/recovery changes:

1. Make the generic 403 page's Sign out action work for a member signed into the wrong account. This is an existing defect, not a defect caused by removing the login page.
2. Preserve the old form's Remember me capability on the shared form, whose schema and backend already accept that option.

No database migrations, fixture resets, role reassignment, media changes, queue changes, credential changes, or session-store/cookie-domain changes are needed. Do not enable Fortify MFA, remove Filament MFA, redesign admin dashboards, or broaden admin/API access as part of this work.

## 2. Review process and validation boundary

The requested sequence has been followed for discovery:

1. Explorer `/root/secondary_login_explorer` completed a read-only dependency map.
2. Only after it completed, explorer `/root/secondary_login_impact` examined those reported dependencies and recommended concrete changes.
3. The coordinating agent checked the reports against current application code and installed Filament/Laravel/Fortify code, inspected the actual route table in an isolated testing environment, and ran existing isolated baseline tests.
4. Independent read-only reviewer `/root/secondary_login_plan_challenge` challenged revision 1 against application and installed vendor code. All four actionable findings were verified by the coordinating agent and incorporated in revision 2. The reviewer rechecked revision 2 and found no remaining blocking contradiction, with one minor Horizon parent-route omission. The coordinator verified and included it in revision 3; section 12 records the corrections.

At the end of planning, all implementation acceptance checks below were future work; the baseline alone did not prove the proposed removal worked. No browser session or development database was changed during planning. Section 13 records the subsequently authorized implementation and checks.

## 3. Explorer 1 results: what the secondary page touches

| Dependency | Current behavior and code evidence | Consequence for removal |
|---|---|---|
| Panel configuration | `api/app/Providers/Filament/AdminPanelProvider.php:88` uses `->login(PanelLogin::class)` and the `web` guard. | Replace the configured action; preserve the guard and login registration. |
| Custom page | `api/app/Filament/Auth/PanelLogin.php:33` routes authenticated visitors; `:50` authenticates credentials and stamps only after the vendor MFA gate succeeds. | Retire both the credential UI and its credential-authentication method. Retain MFA proof through the existing dedicated challenge. |
| Named route | `api/vendor/filament/filament/routes/web.php:36` registers GET `/control-panel/login` as `filament.admin.auth.login` when `hasLogin()` is true. | Keep the URI and name; avoid duplicate route registration. |
| Vendor action contract | `api/vendor/filament/filament/src/Panel/Concerns/HasAuth.php:205` accepts a general route action. `:380` and `:625` expose the login URL and registration flag. | An invokable controller can replace the Livewire page without vendor edits. |
| Component discovery | `api/vendor/filament/filament/src/Panel/Concerns/HasComponents.php:590` registers the login action as Livewire only if it subclasses `Component`. | A plain controller is supported; no fake Livewire page is needed. |
| Guest access | `api/vendor/filament/filament/src/Http/Middleware/Authenticate.php:15` uses the panel login URL for unauthenticated browser requests. | `->login(null)` or deleting the route would damage the guest path. Preserve protected JSON 401 behavior too. |
| Shared credentials | `web/src/routes/Login.tsx:31`, `api/app/Http/Responses/Fortify/LoginResponse.php:17`, and `api/app/Providers/FortifyServiceProvider.php:74` authenticate through Fortify and return user JSON. | Keep one credential endpoint and its lifecycle checks. JSON login does not itself consume Laravel's intended URL. |
| Role destinations | `web/src/lib/roles.ts:200` centralizes plain-login destinations and explicit SPA `from` precedence. | Admin continuation needs one deliberately selected intermediate destination; member/coach destinations stay intact. |
| Other destination callers | `web/src/components/auth/AuthShell.tsx:65` and `web/src/routes/Home.tsx:36` use that same helper for already-authenticated visitors. | A fix only in the login submit handler is incomplete. |
| API login alias | `api/routes/web.php:20` has a separate named GET `login` redirect to the frontend; POST `/login` is Fortify's endpoint. | Preserve both; do not confuse this existing alias with the secondary Filament credential page. |
| Shared session | `api/config/session.php`, `api/config/fortify.php:18`, `api/bootstrap/app.php:40`, and `web/src/lib/baseQuery.ts` provide the shared cookie/session, Sanctum, and credentialed CSRF requests. | Do not introduce another guard, token scheme, or cookie arrangement. |
| MFA enforcement | `api/app/Http/Middleware/RequireFilamentMfaChallenge.php:44`, `api/app/Filament/Auth/MfaChallenge.php:64`, and the panel provider's route/persistent middleware enforce enrollment and session proof. | Preserve the challenge, recovery codes, throttle, replay checks, and Livewire enforcement. |
| MFA lifecycle | `api/app/Support/FilamentMfaStamp.php:28` binds proof to the user; `api/app/Providers/AppServiceProvider.php:481` clears proof on a new `web` login. | Do not stamp on shared password login or in the redirect controller. Keep clear-on-login. |
| Enrollment | Vendor `Auth/MultiFactor/Pages/SetUpRequiredMultiFactorAuthentication.php:21` and `:83` return through the intended destination. | Preserve enrollment and the subsequent existing challenge; enrollment alone does not write the custom MFA stamp. |
| Panel logout | Vendor `Auth/Http/Controllers/LogoutController.php:10` invalidates the session; vendor `Auth/Http/Responses/LogoutResponse.php:15` redirects to the panel login URL. | Keeping the alias lets existing admin logout lead to the shared login without replacing teardown. |
| Wrong-account page | `api/resources/views/errors/403.blade.php:25` chooses a logout route; its HTML form appears around `:201`. | Its member account-switching path is already broken; see section 7. |
| Authorization and account state | `api/app/Models/User.php:258`, `api/app/Http/Middleware/EnsureUserIsAdmin.php:33`, `api/app/Http/Middleware/CheckUserIsActive.php:114`, and Fortify's credential callback deny inappropriate roles/inactive accounts. | Keep both admin tiers and lifecycle enforcement, including outside `local`. |
| Horizon | `api/config/horizon.php:94` uses the same MFA middleware; `api/app/Providers/HorizonServiceProvider.php:40` defines the admin-tier gate. Installed `api/vendor/laravel/horizon/src/HorizonApplicationServiceProvider.php:28` also permits `local` independently of that gate. | Preserve environment-specific behavior: anonymous/non-admin denial outside local; existing vendor exception in local. Do not broaden or silently remove that exception in this task. |

Two historical comments are not current behavior: old planning documents still describe previously fixed MFA bypasses, and some provider comments claim `User` does not implement `FilamentUser`. Current executable code and the route table take precedence.

## 4. Explorer 2 results: recommended design and consequences

The second explorer independently checked the first report's areas, including installed vendor contracts. Its recommendation is a controller-backed compatibility/continuation route, rather than removing login registration or redirecting every visitor unconditionally to React.

Key findings:

- Keeping the route preserves vendor guest/logout behavior and existing URLs while removing the form itself.
- Changing only the plain-admin branch of the shared frontend destination helper covers fresh login, `RequireGuest`, and `Home`. A query-marker design would require additional plumbing in all three and is unnecessary.
- A naive redirect to React followed by the panel root can overwrite the requested resource URL when MFA stores `url.intended`. Preserving a bookmarked admin resource requires an authenticated continuation step before entering protected content.
- The controller must not duplicate MFA branching. Sending an authenticated admin to an actual protected content URL naturally invokes the existing role, lifecycle, enrollment, challenge, and local-bypass checks.
- The vendor Remember me field would disappear unless it is made available in the shared form; the existing request contract already supports it.
- A member cannot use the 403 page's current panel logout action, because that route requires admin authorization before its logout controller runs. The existing root logout is usable by all authenticated roles, but currently always returns JSON. Both the form target and HTML response must be adjusted together.
- Existing browser helpers assume the old Filament form labels and an inline challenge at the login URL. Those assumptions must be replaced, not merely renamed.

Costs and limits: one additional invisible server redirect on plain admin entry; a small destination-validation helper/controller; a shared Remember me field; focused account-switching repair; test/helper updates. There is no schema or data conversion. This is not a global authentication rewrite or a capacity/scalability change.

## 5. Core design: keep the route, remove the form

### 5.1 Backend compatibility and continuation action

Introduce an application-owned invokable controller, provisionally `api/app/Http/Controllers/AdminLoginRedirectController.php`. Configure it through `AdminPanelProvider`'s existing `login(...)` API. Keep the existing slug and route name.

Do not patch vendor code, introduce a competing route with the same URI/name, use `->login(null)`, or make the alias a permanently cached redirect. Its destination depends on authentication and session state. Use temporary redirects and prevent responses from being stored by shared/browser caches (explicit private/no-store response policy).

Controller contract, using the existing panel session middleware:

| Caller | Result |
|---|---|
| Guest | Temporary redirect to `FrontendUrl::to('/login')`. Leave `url.intended` untouched. |
| Active authenticated member/coach/non-admin | Existing HTML 403; no elevated access and no redirect loop through React's guest guard. |
| Active authenticated admin or super-admin | Pull the pending intended destination once, validate it, and temporarily redirect to that content URL or the panel root reconstructed on the configured trusted API origin. |
| Authenticated suspended/deleted/anonymized account | Existing activity middleware evicts/rejects it before the action; do not bypass this stack. |

For the guest branch, do not use `redirect()->guest()` (it can overwrite the original target with the alias) or `redirect()->intended()` (it consumes the target before authentication). Do not read a `next`/`return` query parameter. Generate the frontend URL through the existing helper.

For the admin branch, enforce role eligibility before pulling/using the target. Do not write an MFA stamp, grant roles, authenticate credentials, or send the caller directly to a hand-selected MFA screen. The actual protected destination must run its normal middleware.

### 5.2 Frontend continuation

Add a separately named admin-login continuation URL in `web/src/lib/roles.ts`, built from `API_URL` and `/control-panel/login`.

- Keep `ADMIN_PANEL_ITEM.to` as `/control-panel`; the visible navigation link should still point to the panel itself.
- Change only the plain admin/super-admin default branch of `getPostLoginDestination()` to the continuation URL, with `external: true`.
- Preserve the existing explicit SPA `from` rule and member/coach/onboarding rules.
- Retain full browser navigation (`window.location.replace`) for the cross-origin destination. React Router must not navigate to a panel path on the SPA host.
- Verify `Login`, `RequireGuest`, and `Home`; no separate redirect algorithm should be added to those three callers.

Normal flow:

```text
React /login -> Fortify POST /login -> authenticated admin
             -> API /control-panel/login (redirect only)
             -> requested admin content or control-panel root
             -> existing MFA/enrollment checks if required
             -> authorized content
```

The extra URL hop is not a second user-facing login page.

### 5.3 Intended destination policy

Use a small testable application helper, provisionally `api/app/Support/AdminLoginDestination.php`, rather than blindly passing session content to `redirect()->intended()`.

The validated value may be a root-relative URL beginning with one slash, or an absolute URL with the exact configured API origin (scheme, hostname, effective port). Derive that origin specifically from validated `config('app.url')`, which is the API origin in this project, or an explicitly configured trusted panel origin if one is introduced. If that configuration is invalid, fail visibly as a configuration error; do not fall back to the request host.

Generated absolute panel URLs are not trusted configuration: Filament's `HasRoutes::getUrl()` uses Laravel `url()`/`route()`, and `UrlGenerator::formatRoot()` normally adopts the current request's root. Generate only relative panel route paths, then reconstruct both accepted destinations and the panel-root fallback from the validated configured origin. A spoofed Host header must affect neither. This helper is not a global trusted-host configuration change.

Allow only actual admin content targets:

- The panel root and panel content below the `/control-panel/` segment boundary.
- The configured Horizon UI root/content routes on that same trusted origin, using the explicit UI patterns below. Discover its configured path; do not hardcode a different deployment's origin or assume prefix matches are sufficient.
- Preserve legitimate resource query strings, including filters and pagination. Fragments, if retained, must be a validated inert fragment, not part of origin/path decisions.

Reject or fall back to the panel root for:

- Missing, empty, non-string, malformed, external, protocol-relative, userinfo-bearing, or different-origin/port values.
- Login, logout, MFA challenge, enrollment, authentication/password/reset/verification routes, Livewire endpoints, static assets, and unknown/non-content routes.
- Prefix lookalikes such as `/control-panel-other`, controls, literal backslashes, traversal, encoded forward-slash separators, double-encoded/ambiguous paths, and encoded authentication-route tricks. Opaque Horizon parameters have the carefully restricted encoded-backslash exception below.
- A stale/unregistered panel destination. Match GET routes in the current route collection, restricted to actual panel page/resource route names/actions, rather than accepting every panel-prefixed route. Match metadata only: do not execute middleware, bindings, or controllers during validation. Per-record existence/permissions remain the destination's responsibility and may legitimately yield 404/403.

Horizon needs more than server route matching. Its installed `routes/web.php:47` maps any UI suffix through the catch-all route `horizon.index`, so that name alone also matches nonexistent UI paths. Restrict Horizon continuation to the following installed `resources/js/routes.js` patterns relative to `config('horizon.path')`:

| UI path | Parameter handling |
|---|---|
| `/`, `/dashboard` | No parameters. |
| `/monitoring`, `/monitoring/:tag`, `/monitoring/:tag/jobs`, `/monitoring/:tag/failed` | Treat `tag` as one encoded opaque parameter, including the valid parent content route. |
| `/metrics`, `/metrics/jobs`, `/metrics/queues`, `/metrics/:type/:slug` | Treat type/slug as encoded parameters; retain the installed router's valid values. |
| `/jobs/:type`, `/jobs/:type/:jobId` | Preserve supported job categories and identifier parameters. |
| `/failed`, `/failed/:jobId` | Identifier parameter. |
| `/batches`, `/batches/:batchId` | Identifier parameter. |

Verify the UI pattern table against installed vendor routes when implementing; it is a deliberate small allowlist, not a generic acceptance of every `horizon.*` route. Exclude the configured Horizon `/api` subtree even when an unknown API URL falls through to `horizon.index`; exclude real API route names/actions too. Unknown UI suffixes fall back to the trusted panel root.

Horizon monitoring tags and metric job slugs can contain namespaced classes. Preserve valid encoded backslashes such as `App%5CJobs%5CTranscodeSpeechAsset` only inside a verified opaque UI parameter: decode once, validate against controls/traversal/delimiter ambiguity, and re-encode the parameter as data while keeping it inside the already approved path/origin. Never accept a literal path/origin backslash or allow a parameter to become an origin/path separator. Test class-name parameters and query strings; do not blanket-reject legitimate parameters while claiming deep-link parity. Inputs with ambiguous/double encoding or encoded forward slashes still fall back safely; that conservative fallback is an explicit limitation for unusual tag names, not a promise that every possible tag is preserved.

Pull `url.intended` once for the authenticated eligible caller, including when its value is rejected. Never leave rejected values queued for another visit. A valid URL is not an authorization grant: normal target middleware and policies still decide access.

MFA ordering matters. The alias consumes the old target and redirects to the validated protected URL. If the session is unstamped, that target's existing MFA middleware records the same protected URL again before sending the browser to challenge/enrollment. MFA completion then consumes it. Do not send everyone to the root before this step.

This policy covers continuations through the new alias. It does not claim to harden every historical `url.intended` consumer: direct visits to existing challenge/enrollment retain their present behavior. One browser session still has one intended slot; parallel flows in multiple tabs remain last-writer-wins.

## 6. Preserve MFA, session, and authorization behavior

Keep the following mechanisms and test their composition, not just their declarations:

- Same `web` guard, shared session cookie, Sanctum stateful configuration, HTTPS/origin settings, and frontend credentialed CSRF requests.
- Fortify's existing JSON login response, rate limits, password-reset/email-verification behavior, session regeneration, and inactive-account credential rejection.
- `FilamentMfaStamp` user binding and clear-on-every-new-`web`-login listener. A successful shared password login remains unstamped.
- Recoverable TOTP configuration, the manually registered authenticated challenge route, enrollment, code validation, replay prevention, and throttling.
- Both the route-level and Livewire persistent MFA registration. A protected page's GET passing is not proof that its later `/livewire/update` actions are protected.
- Both `admin` and `super_admin`; no assumption that super-admin holds an additional `admin` role.
- `User::canAccessPanel()`, `EnsureUserIsAdmin`, activity enforcement, resource authorization, and current Horizon role/MFA behavior. Horizon's installed vendor authorization has a separate `local` exception; the anonymous/non-admin denial checks must run outside `local`. This is separate from the application's admin MFA bypass flag.
- The existing local-only MFA bypass, without broadening its environment condition or changing its configured value.

Enrollment's Continue action does not stamp this application's session. Preserve the current sequence: protected resource -> enrollment -> Continue -> resource -> challenge -> resource. Avoid treating enrollment as proof or silently marking it complete in the new controller.

Retire `api/app/Filament/Auth/PanelLogin.php` only after provider references, tests, and comments are adjusted. Do not leave an obsolete credential-authenticating Livewire subclass registered. Coordinate backend rollout so stale old-page snapshots cannot remain a supported alternate login path; expired/stale pages should recover through the shared login.

Known scope boundary: Fortify's SPA login currently has no second factor, and this task does not extend MFA to every admin-capable API route. Preserve the current panel/Horizon protection without describing the change as closing all possible API MFA concerns.

## 7. Account recovery and feature parity

### 7.1 Wrong-account sign-out: targeted companion repair

Current source defect: the generic panel 403 page posts Sign out to `filament.admin.auth.logout`. That route sits inside Filament's authenticated admin middleware, which denies a member before logout can execute. Existing browser coverage only checks that the button is visible, not that clicking it succeeds.

Plan the minimal repair:

1. Point the generic HTML 403 form to the existing named root Fortify `logout` route, irrespective of whether the denied page was in the panel. Keep POST and CSRF.
2. Extend `api/app/Http/Responses/Fortify/LogoutResponse.php` to return the exact existing 200 JSON contract for requests that want JSON, and a temporary redirect to the shared frontend login for ordinary HTML form requests. Its declared response type must permit both response kinds.
3. Keep Fortify's existing logout/session invalidation/CSRF regeneration. Do not weaken panel authorization or replace vendor admin logout.
4. Test the real button click and session teardown for a member/coach denied panel entry, followed by successful admin login through the shared form.

Without step 2, changing the form target logs out but strands the user on raw JSON. Without step 1, changing the response alone leaves the member unable to execute logout.

Panel admin logout remains the existing vendor route/teardown; its redirect reaches the retained alias and then the shared login. JSON SPA logout and its already-logged-out 401 contract remain unchanged. Do not add GET logout.

### 7.2 Remember me

The vendor form has a Remember me checkbox; the shared React form does not render one. `web/src/lib/validation.ts:42` and `web/src/features/auth/types.ts:58` already accept `remember?: boolean` and Fortify supports it.

Expose the existing option in the shared form with an accessible label, default false, and payload tests for checked/unchecked states. Use existing/native UI conventions without a new package. Do not alter cookie/session settings or use remembered authentication to restore an MFA stamp. A remembered login must still encounter the normal admin MFA checks.

## 8. Expected behavior matrix

| Scenario | Expected visible result |
|---|---|
| Guest visits old admin login URL | Shared React email/password form; no Filament credential form. |
| Guest requests panel root | Shared login, then panel root through alias and required MFA. |
| Guest requests admin resource with query filters | Shared login, then original resource/query after required MFA. |
| Plain admin or super-admin shared login | Appropriate existing control panel; no second credential form. |
| Already-authenticated admin visits shared `/login` or SPA `/` | Same continuation path; no login/guest-guard loop. |
| Eligible admin visits alias with no intended value | Panel root subject to existing MFA. |
| Eligible admin has a valid stamp | Requested content without another MFA prompt. |
| Enrolled admin has no stamp | Existing dedicated code challenge, then requested content. |
| Admin is not enrolled | Existing enrollment and subsequent challenge behavior, then requested content. |
| Local bypass is enabled | Target's normal bypass behavior; do not send directly to the challenge from alias. |
| Same bypass flag outside local | No bypass. |
| Member/coach uses shared login | Existing dashboard/onboarding; no admin access. |
| Signed-in member/coach directly visits alias/panel | Existing informative 403 and a working Sign out action. |
| Explicit SPA speech destination exists | Existing `from` precedence is retained, including for an admin. |
| Intended target is invalid, unsafe, or authentication-related | Safe panel-root fallback; no external redirect or authentication loop. |
| Admin lacks permission for a valid content target | Existing destination's 403; validation never elevates permissions. |
| Session expires while in panel/challenge | Shared credential login on re-entry; MFA remains necessary when configured. |
| Admin logs out from panel | Session invalidated, alias redirects to shared login. |
| Browser posts generic HTML logout | Session invalidated, redirect to shared login. |
| SPA posts JSON logout | Exact existing JSON success / anonymous 401 behavior. |
| Anonymous/member visits Horizon outside `local` | Existing 403 denial; no new guest access. |
| Anonymous/member visits Horizon in `local` | Existing vendor local access exception; unchanged and explicitly outside any claim of production denial. |
| New password login after an earlier stamped session | Prior stamp cleared; old proof cannot transfer to the new login/user. |

## 9. Proposed implementation sequence and file inventory

All steps in this section are proposed work only.

### Phase 1: establish behavioral regression coverage

- Add focused backend coverage for the alias contract, route name/action, intended validation, role boundaries, inactive accounts, and middleware composition.
- Put new bridge coverage in `api/tests/Feature/Admin/AdminLoginRedirectTest.php`, with destination cases there or in a focused helper test. These are proposed new files, not existing tests already run.
- Adapt, rather than discard, the old `PanelLogin` tests in `api/tests/Feature/Admin/MfaStepUpTest.php:56` and `:281`. Replace inline panel credential authentication with shared Fortify login -> no stamp -> dedicated challenge -> stamp.
- Preserve existing recovery/replay/throttle/stamp lifecycle/Horizon/Livewire POST tests and `DashboardPageTest` production-like role checks.
- Add current-defect coverage for wrong-account HTML logout and Remember me parity before implementing their repairs.

### Phase 2: implement compatible backend entry

| File | Proposed change |
|---|---|
| New `api/app/Http/Controllers/AdminLoginRedirectController.php` | Role-aware temporary redirect action; session-safe guest behavior; no credentials/MFA proof. |
| New `api/app/Support/AdminLoginDestination.php` | Centralized safe continuation normalization/allowlist using trusted configuration and route collection. |
| `api/app/Providers/Filament/AdminPanelProvider.php` | Configure controller action through `login(...)`; preserve all other panel auth registration. |
| `api/app/Filament/Auth/PanelLogin.php` | Retire obsolete custom credential component once nothing references it. |
| `api/app/Support/FilamentMfaStamp.php` | Correct documentation of remaining stamp writers; preserve behavior. |
| `api/app/Providers/AppServiceProvider.php` | Correct comments referring to retired inline authentication; preserve login-event listener. |

### Phase 3: connect the shared frontend and preserve parity

- `web/src/lib/roles.ts`: separate continuation constant and admin default destination; preserve visible nav URL/from precedence.
- `web/src/routes/Login.tsx`: Remember me control using the already supported field; preserve cross-origin redirect branch.
- Inspect `web/src/components/auth/AuthShell.tsx` and `web/src/routes/Home.tsx`; change source only if needed for the shared helper contract, not to duplicate it.
- Update `web/src/lib/roles.test.ts`, `web/src/routes/Login.test.tsx`, and `web/src/routes/Home.test.tsx`. Add focused `RequireGuest` integration coverage in an appropriately named test file; no existing `AuthShell.test.tsx` at that path was found.

### Phase 4: make wrong-account recovery usable

- `api/resources/views/errors/403.blade.php`: use root Fortify logout for its generic browser form and remove inaccurate route-selection comments.
- `api/app/Http/Responses/Fortify/LogoutResponse.php`: preserve JSON and add HTML redirect response.
- `api/tests/Feature/Auth/LogoutTest.php` and focused admin access tests: verify real teardown/role recovery, JSON/HTML distinction, and CSRF.

### Phase 5: update browser coverage and documentation

- Rewrite credential navigation in `web/tests/panel-auth.ts:124` to traverse the old alias/shared form, using current labels `Email`, `Password`, and `Log in`.
- Keep TOTP generation and next-window retry for seeded-account code reuse. MFA is at its dedicated route. Leaving `/control-panel/login` is no longer a success condition; assert the expected protected target content/URL and that challenge/enrollment is absent after completion.
- Update `web/tests/admin-panel.spec.ts:116` guest destination and old login asset assumptions. Move the Filament CSS/JS asset smoke to an actual retained challenge/dashboard page, and keep response-error assertions.
- Extend the existing shared-login step-up browser scenario rather than replacing it with mocked auth. Cover admin/super-admin, a resource deep link with query, account switching, and real logout.
- Update stale helper comments in `web/tests/fixtures.ts` and historical-plan references that would otherwise instruct someone to use the removed form. Preserve historical findings as history; do not rewrite them as current vulnerabilities.
- `.github/workflows/ci.yml:319` currently omits `admin-panel.spec.ts` from its selected Chromium specs. Add the relevant admin suite to the established E2E gate or add an explicit equivalent gate; do not claim the existing command already runs it.

## 10. Validation plan and actual baseline

### 10.1 Checks already executed for this plan

The worktree was clean before planning. Source was checked at `bcc54c3` on `development`.

Read-only route discovery succeeded using explicit `APP_ENV=testing`, `DB_CONNECTION=sqlite`, `DB_DATABASE=:memory:`, array session/cache, synchronous queues, and disabled telemetry. The route collection confirms:

- GET/HEAD `control-panel/login` -> `PanelLogin`, name `filament.admin.auth.login`, with panel session middleware but outside the authenticated/MFA-required group.
- Dashboard/resources retain authenticated admin and custom MFA middleware.
- POST `control-panel/logout` is inside the authenticated admin group.
- Enrollment/challenge are authenticated admin routes outside the middleware that would gate themselves.

Existing backend baseline: **41 tests passed, 116 assertions** across `MfaStepUpTest`, `DashboardPageTest`, `LoginThrottleTest`, `LogoutTest`, `SessionRegenerationTest`, and `SuspendedLoginTest`. The database was explicitly an isolated in-memory SQLite database, not development PostgreSQL.

Existing frontend baseline: **38 tests passed** across `roles.test.ts`, `Login.test.tsx`, and `UnauthenticatedRedirect.test.tsx`.

These prove only the existing baseline. No new browser flow, new controller, or removal behavior has been implemented/tested.

### 10.2 Backend acceptance checks after implementation

- Route name/URI remain; route action is the new controller; `hasLogin()` and generated login URL remain valid. Route caching must succeed in a disposable test environment without editing vendor files.
- Guest alias preserves the exact pending intended value; guest alias with no intended value does not manufacture a login-loop target.
- Full HTTP shared login flow regenerates the session and clears prior MFA proof; alias does not authenticate credentials or write a stamp.
- Both admin-tier roles work with MFA enabled in a production-like environment, including an account holding only `super_admin`.
- Enrolled/unenrolled/stamped/unstamped/mismatched-user stamps and local-only bypass cases match sections 6 and 8.
- Intended destination tests cover valid root/relative/absolute content URLs and resource queries; invalid type, wrong scheme/host/effective port, protocol-relative/userinfo/encoded/traversal/auth-target/prefix-lookalike/unknown-route inputs fall back. A forged request Host must not change the trusted origin or fallback. Invalid origin configuration must not quietly adopt that Host.
- Horizon tests distinguish explicit UI patterns from its server catch-all, reject known and unknown `/api` suffixes, reject unknown UI pages, and preserve safe encoded namespaced job/tag parameters. Test configured Horizon path changes rather than only the default `/horizon`.
- Known valid content with insufficient role permission still denies; resource existence remains a target-level concern.
- Every redirect chain reaches a terminal form/content/403 in a bounded number of hops. Assert status/Location for intermediate hops and exact final content, not just absence of the old form.
- Preserve real Livewire POST MFA enforcement, recovery consumption, replay prevention, and challenge throttling. Assert Horizon guest/non-admin denial in a production-like environment and characterize its existing vendor `local` exception separately; do not confuse that exception with `DISABLE_ADMIN_MFA`.
- Warm the old Filament component cache in a disposable environment, apply the proposed deployment/cache refresh, and verify the retired `PanelLogin` alias is absent. Submit a captured old login-page Livewire snapshot after rollout: it must not authenticate or stamp MFA. A controlled expired-page failure requiring a reload is acceptable; a silent alternate credential path is not.
- Wrong-account sign-out invalidates session and permits a fresh admin login. HTML logout redirects; JSON logout remains 200 with the existing body and anonymous JSON remains 401.
- CSRF remains enforced for logout and credential submission. Default framework feature tests often disable CSRF; use explicit middleware-enabled coverage and real-browser verification rather than claiming a default feature test proves it.
- Suspended/deleted/anonymized credentials and existing sessions remain denied; restore/unsuspend does not revive invalidated credentials automatically.
- Remember me checked/unchecked behavior preserves the existing Fortify option without bypassing MFA when the session is re-established.

### 10.3 Frontend and browser acceptance checks

Run targeted tests for changed auth/role/home behavior, then TypeScript, ESLint, and a production frontend build. Verify actual external navigation in both fresh submit and already-authenticated guest/home paths.

Run the updated real-stack admin browser suite with MFA enabled, including actual TOTP and recovery flow, role-specific final content, logout/account-switching, and retained Filament assets. Never use the local MFA bypass as the only evidence that the unified flow works. Check desktop and an established secondary browser where available; report physical-device limitations honestly.

Use CI or a disposable isolated environment for browser mutations. The existing harness `scripts/e2e-stack.sh` uses its own Compose project but fixed ports 443/5433/8333, and `web/tests/fixtures.ts` hardcodes the app/API origins. It deliberately fails if the development stack owns those ports. Do not invent unsupported E2E origin overrides, stop the user's development stack, reset its data, or re-seed it to make the browser suite run. Do not run destructive fresh/cleanup modes against user data. Capture any environment limitation as an unmet check rather than treating source review or SQLite tests as browser proof.

### 10.4 Suggested commands for future validation

These commands are an implementation checklist, not a record that the change has been executed. Run backend checks only with an explicit isolated testing configuration; do not inherit development database/session/cache connections.

```sh
# From api/, in the isolated testing environment described in 10.1:
APP_ENV=testing CACHE_STORE=array SESSION_DRIVER=array DB_CONNECTION=sqlite DB_DATABASE=:memory: QUEUE_CONNECTION=sync PULSE_ENABLED=false TELESCOPE_ENABLED=false NIGHTWATCH_ENABLED=false php -d memory_limit=512M vendor/bin/pest --compact tests/Feature/Admin tests/Feature/Auth

# From web/:
npm test -- --run src/lib/roles.test.ts src/routes/Login.test.tsx src/routes/Home.test.tsx src/components/auth
npm run typecheck
npm run lint
npm run build

# From web/, only against the dedicated, MFA-enabled disposable E2E stack:
npx playwright test tests/admin-panel.spec.ts --project=chromium
```

Include newly introduced helper/unit tests as well. The existing E2E override uses `APP_ENV=e2e`, so local-only MFA bypass does not apply even if a developer's environment file contains the flag. The published CI selection must include the updated admin suite.

## 11. Rollout and rollback

No data migration or data rollback is required. Publish the backend route/action and matching frontend continuation change together. The same named URL remains usable by bookmarks and vendor logout.

Before rollout, record the current application/frontend build identifiers and retain the known working artifacts. Ensure the replacement action is included before refreshing route caches through the existing deployment process. Also refresh Filament's distinct component cache in this application's deployed environment: the installed command is `php artisan filament:clear-cached-components`; if the deployment normally caches components, rebuild with `php artisan filament:cache-components` under the new artifact. Do not remove broad cache directories manually or clear unrelated application's caches.

This matters because `HasComponents.php:762` restores a cached `livewireComponents` map independently of route caching. Do not publish a new controller route while keeping a cached registration of the retired credential component. Check both cold and warmed component-cache cases. Deploy consistent application code so no old container continues serving the retired credential component. Verify the named route and shared-login journey before declaring completion.

Smoke checks: anonymous alias -> shared login; admin/super-admin -> actual panel; MFA-enabled login -> code challenge -> content; member denied panel -> working Sign out -> shared login; panel logout -> shared login. Do not create or delete user speeches for these checks.

Rollback is restoring the prior backend and frontend artifacts/configured route action together, then refreshing both route and Filament component caches for the restored artifact through the established deployment process. No database restore, role reset, session-table deletion, or media cleanup belongs in rollback. Active sessions remain governed by the existing user-bound MFA stamp and logout behavior; do not mass-invalidate user sessions as a shortcut.

## 12. Adversarial review and revision record

Reviewer `/root/secondary_login_plan_challenge` completed a read-only source review of revision 1 and reported four actionable findings. The coordinating agent independently read the cited installed code and accepted all four:

| Finding | Verified evidence | Revision 2 correction |
|---|---|---|
| Medium: generated panel URLs can inherit an untrusted request root. | `api/vendor/filament/filament/src/Panel/Concerns/HasRoutes.php:182` and `api/vendor/laravel/framework/src/Illuminate/Routing/UrlGenerator.php:644`. | Section 5.3 now requires a validated configured API origin, relative route generation, and trusted reconstruction of both accepted URLs and fallback. Added forged-Host/configuration-error tests. |
| Medium: Horizon's GET route is a catch-all, so route matching cannot reject unknown UI/API paths. Blanket separator rejection can also lose legitimate namespaced tags. | `api/vendor/laravel/horizon/routes/web.php:47`, `api/vendor/laravel/horizon/resources/js/routes.js`, and `api/vendor/laravel/horizon/resources/js/screens/monitoring/index.vue:154`. | Added explicit UI patterns, API exclusions, parameter-aware encoding, conservative-fallback limitation, and corresponding validation tests. |
| Medium: route-cache refresh alone can leave the old Livewire component registered. | `api/vendor/filament/filament/src/Panel/Concerns/HasComponents.php:762`; installed `filament:clear-cached-components` and `filament:cache-components` command classes. | Added application-scoped component cache refresh/rebuild to forward and rollback procedures, warm-cache coverage, and stale-snapshot authentication/stamp checks. |
| Low: Horizon guest/non-admin denial is environment-specific. | `api/vendor/laravel/horizon/src/HorizonApplicationServiceProvider.php:28` authorizes the gate OR `local`. | Qualified dependency map, behavior matrix, preservation rules, and denial tests by environment. Preserve the existing local exception without broadening this task. |

The reviewer found no further blocking issue in the controller action contract, retained named alias, shared helper continuation, MFA lifecycle, paired HTML-logout repair, or Remember me parity. That is a source-review result, not proof of runtime behavior or a guarantee that all regressions are impossible.

The reviewer completed its final read-only recheck of revision 2 and found no remaining blocking design contradiction. It identified one low-severity omission: `/monitoring/:tag` is itself a valid Horizon parent content route, not just a prefix for `/jobs` and `/failed`. The coordinator checked `api/vendor/laravel/horizon/resources/js/screens/monitoring/tag.vue` and `resources/js/routes.js`, then added the parent route to the table in revision 3 to preserve that deep link.

At the end of the planning turn, coordinating validation checked all current path references and line-anchor bounds, the document's formatting, and the worktree. Only the new Markdown plan was changed at that point. Application implementation and runtime acceptance checks were still unexecuted. Subsequent implementation is recorded separately below.

## 13. Implementation execution record

The user authorized implementation on a new branch, exclusive worker file ownership, sequential execution of dependent work, and an independent read-only review after workers finish. The filename containing an accidental backtick in the request was resolved to this existing root plan.

Branch: `feat/unified-admin-login`, created from `bcc54c3`. The pre-existing untracked plan was preserved. No development deployment, database reset, role change, or media mutation is part of this branch work.

### Worker ownership and order

| Task | Exclusive files | Dependency/order |
|---|---|---|
| A — backend continuation | Controller/destination helper; panel provider; retired `PanelLogin`; stamp/listener comments; `MfaStepUpTest`; new bridge, helper, and component-cache tests. Reviewer follow-up also owns the existing identity test's logout-contract assertion. | Independent of B/C implementation; completed before D. |
| B — shared frontend | `roles.ts`, `Login.tsx`, their tests, `Home.test.tsx`, new `AuthShell.test.tsx`. Existing `Home`/`AuthShell` source needed no change. | Independent of A/C implementation; completed before D. |
| C — logout recovery | Generic 403 view, Fortify logout response, `LogoutTest`, new `WrongAccountLogoutTest`. | Independent of A/B implementation; completed before D. |
| D — browser/CI/docs | `panel-auth.ts`, `admin-panel.spec.ts`, fixture comments, CI selected spec list, short historical-plan status notes. | Started after A/B/C completed. |
| E — approved E2E asset repair | Only `docker/nginx/e2e.conf`. | Started after the existing asset mismatch was reported and the user explicitly approved this additional file. |
| Coordinator | This execution record and temporary isolated validation infrastructure only. | No overlap with worker-owned source files. |

Workers were instructed to stop and report source/plan mismatches, make no unrelated edits, and avoid development data. Backend source matched the intended contracts; frontend and logout workers also reported no implementation-source mismatch.

### Checks completed before independent review

- Backend worker: **302 tests / 1,207 assertions passed** across Admin/Auth and destination-helper checks; Pint passed. This includes actual shared login/TOTP chains, explicit CSRF, environment-specific Horizon behavior, user-bound stamps, safe return destinations, and disposable cache tests.
- Backend retirement evidence: a pre-retirement captured credential-page snapshot was submitted after removal and returned controlled 419 without authenticating or stamping MFA. An obsolete component map was cleared/rebuilt only in disposable storage. Disposable route cache boot used the new controller successfully.
- Frontend worker: **54 targeted tests passed**, TypeScript and focused ESLint passed. Navigation and Remember me request behavior were covered.
- Logout worker: **8 tests / 68 assertions passed**, including actual rendered form submission and teardown, then fresh shared admin login with MFA still required. Regression-first tests reproduced the original response/form defects before the repair.
- Browser worker source/list/type/lint checks passed. Full browser results are recorded separately after final reruns below.

### Isolated browser environment and scope mismatch

The development stack owns the fixed E2E ports. To avoid stopping it, a temporary Compose override creates project/network `speechcoach-unified-login-i10opc`, unique database/media volumes, and loopback nginx port 19443. A loopback-only CONNECT proxy sends only the three existing test hostnames to that isolated web container; the test origins, cookies, signed URLs, and TLS hostnames remain unchanged. This is temporary validation configuration, not an application/E2E origin contract change. The existing generated Playwright auth files were backed up before browser checks.

Only this disposable database was migrated and seeded. The development containers and database were not restarted, migrated, seeded, or otherwise changed.

Pre-existing source mismatch discovered during validation: `docker/nginx/e2e.conf` has no static Filament asset-serving block, while the production/development nginx configuration has one. An isolated request to `/css/filament/filament/app.css` returned 404. The original plan assumes these existing assets can be tested on retained panel pages; adding `admin-panel.spec.ts` to CI exposes this defect.

The coordinator reported the mismatch and requested explicit permission to adjust that additional file. The user approved the narrow E2E asset fix. Worker E added the exact existing production/development asset rule to the API vhost, changed no other file, and passed `nginx -t`. Reloading only the disposable web container made both CSS and JavaScript asset probes return 200. No production/development configuration, ports, or containers were changed.

### Independent review findings and repairs

The requested read-only reviewer started after A–D finished. Its first full run found **905 backend tests passed, 1 failed, 2 skipped**: `api/tests/Feature/Identity/E2ESeederRolesTest.php` still expected HTML logout to return 200. Worker A changed that loop to `postJson('/logout')`, preserving its existing purpose and the planned JSON contract. This is a directly related test-contract repair, not an additional application behavior change.

Real-browser validation also exposed an existing missing registration for the manually routed MFA challenge. Full-page GET accepted its class, but a fresh Livewire POST could not resolve snapshot alias `app.filament.auth.mfa-challenge`, yielding `LivewireReleaseTokenMismatchException`/419. The coordinator reproduced the exact error with the actual challenge snapshot, and the reviewer independently confirmed the fresh-registry failure. Class-driven prior tests had masked the missing alias.

Worker A registered `MfaChallenge` through the installed `Panel::livewireComponents(...)` API in the existing provider, preserving the manual route and all MFA/auth middleware. It added a fresh-registry actual snapshot POST regression. The same browser hydration probe now returns 200. Additional composition tests exercise the actual vendor enrollment action and Continue journey, and authentication restoration from the real Remember me cookie without inheriting MFA proof.

The read-only reviewer independently rechecked those repairs and the approved nginx change, found no remaining source defect, and reran the suites:

- **Backend: 909 passed, 2 skipped, 4,720 assertions.** The skips are the existing dedicated-container real Whisper/voice integration smoke tests; no authentication check was skipped.
- **Frontend: 626 passed across 92 files.**
- Scoped Pint, TypeScript, ESLint, production frontend build, and diff whitespace checks passed. Five existing ESLint warnings and the existing bundle-size warning remain.

The browser worker reported three stale test-only assumptions during the first full browser run: the existing root Back-to-app URL includes its canonical trailing slash; the step-up scenario needs the same 120-second budget as other callers to accommodate its intentional next-TOTP-window retry; and Filament canonicalizes the Users page query order. The bookmark fixture now starts with that canonical order while retaining both query values and an exact final URL assertion. Those narrow corrections retain the assertions and real replay protection. A subsequent run interrupted by the usage-limit pause completed with 21 passed and one account-switch TOTP timeout; its 987-second wall time included the suspension. The fresh uninterrupted runs below passed, including that account-switch scenario.

The read-only reviewer completed a final source recheck of all three browser-test corrections after work resumed. It confirmed the assertions were not weakened, both deep-link query values remain required, the main shared login and account-switch journeys remain covered, and final file scope matches the plan plus the approved E2E configuration adjustment. It found no remaining defect and made no edits.

### Final browser and recovery acceptance

- **Chromium: 22/22 passed in 2.8 minutes.**
- **WebKit: 22/22 passed in 3.4 minutes.**
- Each full, unfiltered run includes 17 admin regression tests and five setup checks, with no skips or flaky results. Both use actual shared credentials and TOTP with MFA enabled. They verify admin/super-admin content, the retained alias, shared entry, exact protected resource/query continuation, panel logout, wrong-account logout and account switching, member/coach destinations, Filament assets, responsive layout, and navigation.
- **Real recovery-code browser check passed:** shared login → dedicated challenge → valid recovery code → protected Dashboard; logout → fresh shared login → the same consumed code is rejected and the challenge remains visible. Codes were generated and saved through the installed provider only for the disposable E2E admin. No development account, MFA secret, production fixture, or rate limiter was changed.
- Initial scratch recovery probes clicked Confirm immediately after filling the input and did not reach the dashboard. The final probe explicitly awaited the recovery field's successful Livewire blur update before confirming. Its synchronization and authentication POSTs returned 200, and both success and consumed-code rejection were observed. This required only a temporary probe correction, not an application or vendor change.

Browser reports are retained at `/private/tmp/unified-admin-login.I10Opc/playwright-chromium-final.json` and `/private/tmp/unified-admin-login.I10Opc/playwright-webkit-final.json`; temporary probe/configuration files remain in that directory for inspection. The three generated Playwright authentication snapshots were restored from their pre-run copies and byte-verified after testing. Only the disposable validation containers/proxy were stopped; their named volumes and the development stack were preserved.

All planned implementation tasks and automated acceptance checks are complete. The two existing real Whisper/voice smoke skips remain outside authentication validation. Desktop WebKit is browser-engine evidence, not a physical iPhone check. Production/development deployment and the cache-refresh rollout in section 11 were not executed; deployment should publish the matching backend/frontend artifacts and refresh both scoped caches as documented.
