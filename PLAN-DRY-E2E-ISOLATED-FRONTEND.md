# Plan: one isolated-frontend harness for the two e2e specs that copy it

**Status:** rev 2, 2026-11-18. **Validated on a scratch copy; not implemented.**
**Scope:** `web/tests` only: `accessibility.spec.ts`, `app-shell.spec.ts`, and two new helper modules. No app code, no CI change, no test added, removed or reworded.
**Baseline:** `development` at `b2c5e8e`. Line numbers below refer to that commit.

## Goal

The isolated-frontend tests render the built app and answer every request from mocks. Two specs each carry a full copy of the machinery, about 300 lines between them:

| # | Duplication | One owner after |
|---|---|---|
| 1a | The notebook fixture family: `OwnerToolsWire`, `ScrubWire`, `NotebookFixtureOptions` and 12 fixture values and builders. They are byte-identical in `accessibility.spec.ts:378-586` and `app-shell.spec.ts:630-838` (209 lines). | `web/tests/notebook-fixtures.ts` |
| 1b | The request-routing skeleton: built-asset serving, blob passthrough, notebook media, fail-closed origins, CORS/OPTIONS/CSRF/login, and the notebook API branch. It appears in `isolateWorkspaceAxeApi` (`accessibility.spec.ts:186-336`) and `interceptPresentationApi` (`app-shell.spec.ts:217-371`). | `routeIsolatedFrontend()` in `web/tests/isolated-frontend.ts` |

Each spec keeps its own wrapper with the same name, signature and return value. The 7 `isolateWorkspaceAxeApi(...)` and 20 `interceptPresentationApi(...)` call sites stay as they are. Each spec's own GET route table moves into its wrapper verbatim.

## What the review established

**1a is a pure move.** `diff <(sed -n 378,586p accessibility.spec.ts) <(sed -n 630,838p app-shell.spec.ts)` is empty: 209 identical lines, from the comment `// Test-local wire fixtures only.` through the blank line after `notebookMediaResponse`. The next 3 comment lines (`accessibility.spec.ts:587-589`) belong to the next function, `scanNotebookAndAssert`, which stays put. The block starts with `OwnerToolsWire` (`accessibility.spec.ts:380-384` / `app-shell.spec.ts:632-636`). `NotebookFixtureOptions.ownerWire` references it, so it has to move too.
- The moved names are:
  - the types `OwnerToolsWire`, `ScrubWire` and `NotebookFixtureOptions`;
  - the values `notebookDate`, `notebookTitle`, `notebookUser`, `notebookSpeech`, `notebookToolsAudioIds`, `notebookToolsAnnotations`, `notebookReview`, `ownerToolsTracks`, `ownerToolsRows`, `ownerToolsResponse`, `notebookResponse` and `notebookMediaResponse`.
- These stay in their spec: `scanNotebookAndAssert` (accessibility) and `notebookRoutes` (`app-shell.spec.ts:839`, which only app-shell has).

**1b: the two routing functions share one skeleton.** `diff` of the two function bodies shows only these differences:

| # | `isolateWorkspaceAxeApi` (accessibility) | `interceptPresentationApi` (app-shell) |
|---|---|---|
| 1 | `(context, notebook?)`; `authenticated` starts as `Boolean(notebook)` | `(context, initiallyAuthenticated = true, notebook?)` |
| 2 | no request logging | `context.on('requestfailed' / 'page')` logging with the label `option-C presentation` |
| 3 | no `loginBodies` | records `POST /login` bodies in `loginBodies` |
| 4 | inline `user` and `review` fixtures; `POST /login` returns `{ user }` | module-level `presentationUser` and `presentationSections`; login returns `{ user: presentationUser }` |
| 5 | no reaction to a `401` | in the owner poster-frame `POST` branch, after `posterReply`: `if (notebook.draggable && status === 401) authenticated = false` (`app-shell.spec.ts:318`) |
| 6 | after the notebook branch: a GET `switch`, then a 500 `'Unmapped accessibility request blocked.'` fallthrough for anything unanswered (non-GET included) | after the notebook branch: non-GET gets a 500 `'Unexpected presentation mutation blocked.'`, then a GET `switch` with a 500 `default` |
| 7 | returns `unexpected` | returns `{ loginBodies, unexpected }` |

Everything before row 6's split is otherwise line-for-line the same, including the builtRoot logic, the 120 s navigation timeout and the fail-closed rules. The one exception is app-shell's comment `// Fail closed: no API, media, or unexpected external request reaches a server.`

**Row 5 is safe to share.** The line sits in the poster-frame branch. It can only fire when a test with `draggable` and `ownerVideoTools` has an `OwnerToolsWire.posterReply` that resolves `401`. App-shell's "owner poster session denial…" test (`app-shell.spec.ts:2312-2346`) does exactly that and asserts the redirect to `/login`. Accessibility never sets `posterReply`. Its only `ownerWire` is `{ posterRequests: [] }` (`accessibility.spec.ts:816`, in a test without `draggable`), and its draggable owner test (`accessibility.spec.ts:855`) sets no `ownerWire` at all. So the poster status there is always `200`.

**Safety of running these tests locally.**
- **They can run without the stack.** The suites say so themselves (`app-shell.spec.ts:178-187`): with `--no-deps`, no setup project and no stored session is needed.
- **But only with built assets.** Unless `WORKSPACE_USE_BUILT_ASSETS=1` is set, app-origin requests go through `route.continue()`, which hits the real dev server (`app.speechcoach.test`) instead of `dist/`. That means the developer's running stack.
- **With built assets, nothing reaches a server.** Every request is either served from `web/dist`, aborted (non-GET, unsafe paths, foreign origins), or answered by a mock. Same-origin `blob:` reads pass through, but they never leave the browser. `context.route` doesn't see WebSockets; the build's only `new WebSocket` is Uppy Companion's remote-upload socket, which these tests never open.
- **Browsers are installed** (`~/Library/Caches/ms-playwright`).
- **CI** runs both specs on the e2e stack (`.github/workflows/ci.yml:354`, `--project=chromium`), where `route.continue()` reaches the stack's frontend.

## Ground rules

- **Tests only.** Don't change app code, `playwright.config.ts` or `ci.yml`.
- **No test is added, removed, renamed or reworded.** Test titles and assertions stay byte-identical.
- **Preserve every response body, status, header and `unexpected` entry.** Each spec's route table moves verbatim, including its fallthrough messages.
- **Imports use the `.js` suffix**, as the specs already do (`./fixtures.js`). The new modules are covered by `tsconfig.e2e.json`; `tsc -b` type-checks them.
- **Never run the e2e specs without `WORKSPACE_USE_BUILT_ASSETS=1`, `--no-deps` and `--grep "isolated frontend"`.** Without the first, requests reach the developer's dev server. Without the second, the setup projects log in against it. Without the third, non-isolated tests need the e2e stack.
- **Playwright path filters are regular expressions.** Write `accessibility\.spec` and `app-shell\.spec`, not file paths.

## §1 Notebook fixtures → `web/tests/notebook-fixtures.ts` (do first)

1. Create `web/tests/notebook-fixtures.ts`. Copy `app-shell.spec.ts:630-837` into it byte for byte, adding `export` to each moved declaration (15 declarations, `OwnerToolsWire` included). Rev 1's range, `637-838`, fails `tsc -b` with `TS2304: Cannot find name 'OwnerToolsWire'`.
2. Add whatever imports the block needs; `tsc -b` names any that are missing. Validated: exactly three.
   - `readFile` from `node:fs/promises` and `fileURLToPath` from `node:url`, for `notebookMediaResponse`'s fixture media;
   - `APP_URL` from `./fixtures.js`, the only constant the block uses.

   No Playwright import is needed while the inline `import('@playwright/test').Route` type stays, and `Buffer` is a Node global. Keep that inline type or turn it into `import type { Route }`. Either is fine.
3. Watch the media paths. `notebookMediaResponse` reads `../../api/tests/fixtures/...` relative to `import.meta.url`. The new module sits in the same folder, `web/tests/`, so those URLs still resolve.
4. Delete `accessibility.spec.ts:378-586` and `app-shell.spec.ts:630-838`. Import only the names each spec still uses, because `noUnusedLocals` and eslint reject unused imports. Mark the type-only names `type`, or `verbatimModuleSyntax` fails tsc with TS1484.
   - Accessibility uses `notebookMediaResponse`, `notebookResponse`, `notebookReview`, `notebookSpeech`, `notebookUser`, `type NotebookFixtureOptions` and `type ScrubWire`. That list shrinks after §2. Don't import `notebookToolsAnnotations`: accessibility names it only in a comment (`accessibility.spec.ts:713`), so importing it fails tsc (TS6133) and eslint (`no-unused-vars`).
   - App-shell uses `notebookMediaResponse`, `notebookResponse`, `notebookReview`, `notebookSpeech`, `notebookTitle`, `notebookUser`, `type NotebookFixtureOptions`, `type OwnerToolsWire` and `type ScrubWire`.
   - Drop no other import yet. Both routing functions still use `readFile` and `fileURLToPath` until §2.
5. Run the §3 checks.

## §2 One routing skeleton → `web/tests/isolated-frontend.ts`

```ts
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Request } from '@playwright/test'
import { API_URL, APP_URL } from './fixtures.js'
import { notebookMediaResponse, notebookResponse, notebookReview, notebookSpeech, type NotebookFixtureOptions } from './notebook-fixtures.js'

export type IsolatedJson = (body: unknown, status?: number) => Promise<void>

export interface IsolatedFallback {
  request: Request
  url: URL
  json: IsolatedJson
  /** The current sign-in state (POST /login sets it; a draggable 401 clears it). */
  authenticated: boolean
  unexpected: string[]
}

export interface IsolatedFrontendOptions {
  notebook?: NotebookFixtureOptions
  initiallyAuthenticated: boolean
  /** The `user` that `POST /login` returns. */
  loginUser: unknown
  /** When set, logs `requestfailed` and `pageerror` as `[<label>/requestfailed]` and `[<label>/pageerror]`. */
  logLabel?: string
  /** Each spec's own answers for API requests the shared skeleton left unanswered. */
  fallback: (request: IsolatedFallback) => Promise<void>
}

/** Serves the built app and mocks every request; nothing reaches a server when WORKSPACE_USE_BUILT_ASSETS=1. */
export async function routeIsolatedFrontend(context: BrowserContext, options: IsolatedFrontendOptions): Promise<{ loginBodies: unknown[]; unexpected: string[] }> {
  // Body: app-shell's interceptPresentationApi from its first line through the end of its `if (notebook) { … }` block,
  // verbatim, with: notebook → options.notebook, initiallyAuthenticated → options.initiallyAuthenticated,
  // presentationUser → options.loginUser; the two context.on(...) logging lines wrapped in `if (options.logLabel)` and their
  // prefixes built from the label; then, after the notebook block:
  //   return options.fallback({ request, url, json, authenticated, unexpected })
  // and after the route registration: return { loginBodies, unexpected }
}
```

- **The skeleton is app-shell's version.** It is the superset: it has row 2's optional logging, row 3's `loginBodies` (unused by accessibility, which is harmless: `postDataJSON()` would throw on a non-JSON body, but the app's login form posts JSON), and row 5's `401` line (unobservable in accessibility, as shown above).
- **The log text stays the same.** App-shell passes `logLabel: 'option-C presentation'`, which produces the existing `[option-C presentation/requestfailed]` and `[option-C presentation/pageerror]` strings exactly.

**Accessibility wrapper** (replaces `accessibility.spec.ts:186-336`):
```ts
async function isolateWorkspaceAxeApi(context: BrowserContext, notebook?: NotebookFixtureOptions) {
  const user = { /* verbatim from the old body */ }
  const review = { /* verbatim */ }
  const { unexpected } = await routeIsolatedFrontend(context, {
    notebook, initiallyAuthenticated: Boolean(notebook), loginUser: user,
    fallback: async ({ request, url, json, authenticated, unexpected }) => {
      if (request.method() === 'GET') {
        switch (url.pathname) { /* verbatim, including '/api/me' with `notebook ? notebookUser(notebook) : user` */ }
      }
      unexpected.push(`${request.method()} ${url.pathname}`)
      return json({ message: 'Unmapped accessibility request blocked.' }, 500)
    },
  })
  return unexpected
}
```

**App-shell wrapper** (replaces `app-shell.spec.ts:217-371`):
```ts
async function interceptPresentationApi(context: BrowserContext, initiallyAuthenticated = true, notebook?: NotebookFixtureOptions) {
  return routeIsolatedFrontend(context, {
    notebook, initiallyAuthenticated, loginUser: presentationUser, logLabel: 'option-C presentation',
    fallback: async ({ request, url, json, authenticated, unexpected }) => {
      if (request.method() !== 'GET') { /* verbatim: unexpected.push(...); return json({ message: 'Unexpected presentation mutation blocked.' }, 500) */ }
      switch (url.pathname) { /* verbatim, including the default branch */ }
    },
  })
}
```

**Why the behavior is identical:**
- **Same request order.** Each request is handled in the same order as before: built assets, blob, notebook media, app origin, foreign origin, OPTIONS, CSRF, login, notebook branch, then that spec's own remainder.
- **`authenticated` is read at request time.** It lives inside `routeIsolatedFrontend` and is passed to `fallback` per request, so `/api/me` sees the same value at the same moment as before. The fifth mutation check proves it.
- **The same mutable `unexpected` array** reaches the spec, either directly (accessibility) or in the returned object (app-shell).

Then import `routeIsolatedFrontend` from `./isolated-frontend.js` in both specs, and drop the imports they no longer use. `tsc -b` names each one. The validated end state:
- **Accessibility:** `writeFile` is the only `node:fs/promises` import left. The `node:path` and `node:url` imports go, and so does `API_URL`. From `notebook-fixtures.js` it keeps `notebookUser`, `type NotebookFixtureOptions` and `type ScrubWire`.
- **App-shell:** the same three Node imports go the same way, but `API_URL` stays (`app-shell.spec.ts:1365`). From `notebook-fixtures.js` it keeps `notebookTitle`, `notebookUser`, `type NotebookFixtureOptions`, `type OwnerToolsWire` and `type ScrubWire`. The other `resolve` names in app-shell are local `deferred()` variables, not the `node:path` import.

## §3 Verification (run before any edit, after §1 and after §2, in a scratch copy)

**Static checks:**
1. In `web/`: `npx tsc -b && npx eslint .`. Baseline: tsc OK, eslint 0 errors / 5 warnings. Validated: the same after §1 and after §2, with the same 5 warnings.
2. The test inventory must be identical before and after. Run `npx playwright test --list --project=chromium --no-deps 'accessibility\.spec' 'app-shell\.spec'`. Diff it after stripping positions with `sed -E 's/\.ts:[0-9]+:[0-9]+/.ts/'`. Validated: 87 tests (69 `isolated frontend`, 9 `annotation notebook tools`, 9 real-stack), identical after §1 and after §2.

**Behavior check (real browser runs, offline):**
3. Build once: `npx vite build`, or `npm run build`, which also runs `tsc -b`. The app code doesn't change, so the same `dist/` serves every run.
   - **In a scratch copy whose `node_modules` is a symlink**, pass `--configLoader runner`. Vite 8's default loader writes and then deletes a temporary config file under the nearest `node_modules`, which through the symlink is the real repo's `web/node_modules/.vite-temp`. Rev 2's build did this; the folder was left empty.
4. Run the isolated suites, saving the JSON report for each run:
   ```
   WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test 'accessibility\.spec' 'app-shell\.spec' --project=chromium --no-deps --grep "isolated frontend" --reporter=json > <run>.json
   ```
   Validated: 69 tests on 7 workers, 66 s at baseline, 69 s after §1, 70 s after §2. `accessibility.spec.ts` is file-serial (`test.describe.configure({ mode: 'serial' })`, line 95), so its 14 tests share one worker, and its first failure skips the rest of its selection. Test `console.log` output is captured inside the JSON, so the file stays valid.
5. **Pass bar:** the after-runs have the same test titles with the same outcomes as the baseline, compared per test. Rerun any test that fails in only one run once. A test that passes on the baseline but fails after a step is a blocker.
   Validated: 69/69 passed in all three runs, with identical per-test outcomes and no flaky, skipped or retried test. The captured `[option-C presentation/requestfailed]` lines keep their exact text. Their count (40, 40, 38) varies only in `net::ERR_ABORTED` aborts at teardown, which already differ between the baseline and §1 runs, where the routing code is identical. Net change: 4 files, +442/−706 lines.

**Coverage gap.** Both specs' `annotation notebook tools` describes (`accessibility.spec.ts:715`, 5 tests; `app-shell.spec.ts:1494`, 4 tests) call the same wrappers but lack the `(isolated frontend)` suffix, so the grep above skips them. They are isolated by construction: `openPopulated` and `openTools` call the wrappers, and `createNotebookMedia` records on `about:blank`. `--grep "isolated frontend|annotation notebook tools"` adds exactly these 9 and is just as safe. Use it for the pass bar.
   - **Validated after rev 2:** `WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test 'accessibility\.spec' 'app-shell\.spec' --project=chromium --no-deps --grep "annotation notebook tools"` passed 9/9 on the baseline specs (19.1 s) and 9/9 after §2 (18.4 s).
   - Each of the 9 opens a fresh `browser.newContext` with no stored session and routes through a wrapper before navigating.
   - So all 78 tests that go through the shared harness keep identical outcomes.

**Mutation checks** (prove both specs use the shared code; run each with the narrow `--grep` given, then revert and confirm `git diff` is empty). Rev 2 ran all five, with these results:
- Change the profile bio `'Practising a clear opening.'` in `notebookResponse` (`notebook-fixtures.ts`). Grep: `"notebook presentation.*isolated frontend"` (12 tests, 36 s). Red: accessibility's "all nine notebook routes…" at 375px (serial mode skips its 1440px twin) and app-shell's "all nine working pages…" at 375px and 1440px, all on the `Edit bio: Practising a clear opening.` button. Rev 1 changed `notebookTitle` here, which stays green (69/69 passed): app-shell's only title assertion reads the same imported constant through `notebookRoutes`, and no accessibility test asserts the title.
- Return `{ user: {} }` from the shared `POST /login`. Grep: `"option C presentation.*isolated frontend"` (8 tests, 33 s). Red: app-shell's guest-login test (`app-shell.spec.ts:399`), which lands on `/dashboard?verified=1`, and accessibility's option-C login test at 375px, whose dashboard headings never render.
- Delete `loginBodies.push(...)` in the shared skeleton. Same grep (6 s). Red: only app-shell's guest-login test, on its final `loginBodies` assertion.
- Skip the notebook branch's `notebookResponse` return. Grep: `"notebook presentation.*isolated frontend"` (12 tests). It takes 242 s, because "profile cropper…" runs into its 240 s test timeout. Red: accessibility 1 failed and 1 skipped, app-shell 10 of 10.
- Pass `authenticated: options.initiallyAuthenticated` to `fallback` instead of the live value. Grep: `"isolated frontend.*(poster session denial|guest login)"` (4 tests, 36 s). Red: app-shell's guest-login and "owner poster session denial…" tests, and accessibility's option-C login test. That proves `/api/me` reads `authenticated` per request and that row 5's line is live.

## §4 Out of scope

- **The two specs' presentation fixtures** (users, reviews, notifications, titles) differ on purpose, because different tests assert different data. Don't unify them.
- **Other e2e duplication:**
  - the `docker compose … db:seed` reset helpers in `voice-test-helpers.ts` and `captions.spec.ts`;
  - the constants shared by `two-users.spec.ts` and `essay-editor.spec.ts`;
  - the `verify-postgres-*.sh` preamble.
- **CI wiring:** unchanged.

## §5 Review log

- rev 1 (2026-11-18): drafted from `diff` of both copies at `b2c5e8e` and a read of both routing functions, the safety notes in `app-shell.spec.ts:178-187`, and the Playwright config's setup projects.
- rev 2 (2026-11-18): adversarial validation. The plan was applied as written to a scratch copy of `web/` at `b2c5e8e`, step by step, with CI's static commands and offline built-asset runs (chromium only). With the fixes below, every §3 check passes, and the 69 isolated tests keep identical per-test outcomes (69/69 at baseline, after §1 and after §2). Findings and fixes:
  - BLOCKER: §1's range left out `OwnerToolsWire` and its 2-line header comment (`accessibility.spec.ts:378-384` / `app-shell.spec.ts:630-636`), which `NotebookFixtureOptions.ownerWire` references. As written, `tsc -b` fails in the new module (TS2304). After the deletions, accessibility's leftover copy fails TS6196 and eslint. Fixed: the ranges are 378-586 / 630-838, the module exports `OwnerToolsWire`, and app-shell imports it.
  - MAJOR: §1's accessibility import list included `notebookToolsAnnotations`, which accessibility names only in a comment, so the import fails TS6133 and eslint. Removed. Both import lists, at both steps, are now spelled out, with `type` on type-only names (TS1484).
  - MAJOR: the `notebookTitle` mutation can't go red (69/69 stayed green), because app-shell's expected title is the same imported constant. Replaced with a profile-bio mutation, validated red in both specs. The other three checks now carry their greps, results and timings, and a fifth check covers the per-request `authenticated`.
  - MAJOR (verification gap): the `isolated frontend` grep skips both specs' `annotation notebook tools` describes (9 tests), though they call the shared wrappers. §3 now names them and a grep that includes them. Closed after rev 2: the lead ran them, 9/9 at baseline and 9/9 after §2.
  - MINOR: row 5 put the `401` line in the draggable reviews branch, keyed to `ScrubWire.reviewReply`. It is in the owner poster-frame branch, keyed to `OwnerToolsWire.posterReply`. The conclusion holds, because accessibility never sets `posterReply`; the reasoning is rewritten.
  - MINOR: §2 named neither the new `routeIsolatedFrontend` import nor all the leftovers (`readFile`, accessibility's `API_URL`, four fixture names). The end state is now explicit, including that app-shell keeps `API_URL`.
  - NIT: there are 7 and 20 call sites, not 8 and 21 (rev 1 counted the definitions). The CI step is `ci.yml:354`, not 348. The safety note now covers `blob:` reads and WebSockets, and the `loginBodies` note covers `postDataJSON()`.
  - Unverified: the CI e2e-stack run (`WORKSPACE_USE_BUILT_ASSETS` unset, so `route.continue()` reaches the stack's frontend), and firefox, webkit and mobile-webkit.
- rev 2 addendum (2026-11-18), lead's check:
  - **The 9 `annotation notebook tools` tests were run offline in the same scratch copy** (built assets, `--no-deps`, chromium): against the baseline specs (`git checkout ed2fa22 -- tests/…`), then against the §2 specs. 9/9 passed both times.
  - **§3 step 3 now warns about Vite 8's temp-config write** through a symlinked `node_modules`.
