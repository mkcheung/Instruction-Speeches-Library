# CP-08 build plan — real-browser coverage of the real TipTap editor

**Implements:** [CP-08](CP-08-testing-rich-text.md) · **After:** [Step 08](STEP-08-essay.md) (done, commit `243f5d4`) · **Closes:** [STEP-08-RETROSPECTIVE.md](STEP-08-RETROSPECTIVE.md)'s largest open gap · **Optional:** [Step 09](STEP-09-captions.md) does not depend on this

> ### ✅ What you can do when this is finished
>
> A Playwright spec drives the **actual** TipTap contenteditable — clicks into it, types with real key events, formats with the real toolbar, watches the real autosave word change, provokes a real 409 conflict banner, triggers *both* unsaved-changes guards (the in-app one and the native `beforeunload` one), publishes, and then proves from a second browser context that the speaker can read it and a peer reviewer cannot. No `vi.mock('@tiptap/react')` anywhere in sight.

---

## ⚠️ Read this first: three things blocked this before a line of test code was written

All three were found by running against the live stack, not by reading. Each one would have produced a confusing failure hours into writing the spec.

### 1. The running `app` container was a stale baked image

`compose.yaml`'s `app` service builds from the `Dockerfile` with `target: runtime` and **`COPY`s `api/` into the image — there is no bind mount** (`docker inspect` → `Mounts: []`). The container had been up 36 hours, predating all of STEP-08:

```
$ docker compose exec app php artisan route:list | grep -i essay
NO ESSAY ROUTES IN RUNNING CONTAINER
$ docker compose exec app ls app/Http/Controllers/Api/ | grep -i essay
NO EssayController IN CONTAINER
$ docker compose exec app php artisan migrate:status | grep -i essay
(nothing — 2026_08_16_100001_add_essay_columns_to_reviews_table not even listed as Pending)
```

Editing `api/` on the host does **nothing** until the image is rebuilt. Any seeder change, any controller fix, any migration: rebuild first, or the command succeeds against the old code and you debug a ghost.

```bash
docker compose build app && docker compose up -d app queue-worker
docker compose exec app php artisan migrate --force
```

Already done for this plan — `2026_08_16_100001_add_essay_columns_to_reviews_table` is now `Ran`, and the three essay routes are live. **Re-do it after every `api/` edit below.**

### 2. The reviewer's Essay tab does not render for the seeded fixture — at all

`web/src/routes/SpeechWatch.tsx:244` gates the whole reviewer tab strip:

```tsx
{!isOwner && myReview && asset?.status === 'ready' && initialUrl && (
```

`api/database/seeders/E2ESeeder.php:166-170` seeds **no `speech_assets` row**, deliberately, and says so. So `asset` is `undefined`, the speech renders "Not ready to play yet.", and there is no Notes tab, no Essay tab, and no editor. Probed as reviewer A against the live app:

```
reviewer tab strip count: 0
Essay tab count: 0
not-ready text visible: 1
```

**This is the hard blocker.** The good news, verified: `SpeechUploadController::playbackUrl` (`api/app/Http/Controllers/Api/SpeechUploadController.php:193-199`) only checks `status === 'ready'` and then presigns — SigV4 is pure signature math and **never verifies the object exists**. A fixture row alone is enough. After inserting one (`kind='video'`, `is_primary=true`, `status='ready'`), the same probe returned:

```
primary_video: {"id":9301,"kind":"video","status":"ready", ...}
Essay tab count: 1
```

The `<video>` element fails to load its bogus URL. That is fine and must be stated in the seeder comment: CP-08 tests rich text, not playback.

Note the gate is **asymmetric** — the speaker's tab strip (`SpeechWatch.tsx:212`) is gated on `isOwner` only, no asset required. The read-only half of this plan works on today's fixture.

### 3. Re-seeding does not reset essay state, so publish is a one-way door

`E2ESeeder.php:200-217`'s `Review::updateOrCreate` names none of the six `essay_*` columns, so they survive every re-seed. Confirmed: after one probe run, review 9201 sat at `essay_lock_version: 2` with content still in it, and re-running `db:seed --class=E2ESeeder` did not clear it.

`EssayEditorPanel.tsx:105` computes `isPublished` from `initial.essay_published_at` and `:208` disables the button on it. **A publish test passes exactly once and then fails forever** until someone hand-runs an `UPDATE`. Phase 1 fixes this at the seeder.

---

## What's already been proven, so you don't have to wonder

Every row below was executed against the live stack (Chromium, Playwright 1.62.1, real Vite dev server, real Laravel API). The scratch spec used to prove them was deleted; the outputs are verbatim.

| Claim | Status |
|---|---|
| The real contenteditable is reachable | ✅ `[data-testid="essay-editor-content"] .tiptap`, `contenteditable="true"`, count 1 |
| `pressSequentially` types into the real model | ✅ server stored `<p>Your opening was strong.</p>`, `essay_words: 4` |
| Autosave word flips on a real save | ✅ `data-state` `dirty` → `saved` |
| Toolbar formatting works via role+name | ✅ `Bold` click on a selection → server stored `<strong>…</strong>` |
| Content survives a real reload | ✅ `SURVIVED RELOAD` |
| In-app nav shows the **in-app** dialog | ✅ `essay-unsaved-changes-dialog` visible, URL held at `/speeches/9101`, `Leave` → `/dashboard` |
| Browser close while dirty fires the **native** dialog | ✅ `page.close({runBeforeUnload:true})` → `dialog.type() === 'beforeunload'` |
| Baseline suite is green apart from one known red | ✅ 18 passed, 1 failed (`speech-create.spec.ts`, see "Out of scope") |
| Baseline unit suite | ✅ 29 files, 156 tests, all passing |

And two results that change what gets written:

| Finding | Consequence |
|---|---|
| 🔴 **`fill()` is NOT a silent no-op here** — it reaches ProseMirror's model and persists | CP-08's headline lesson is wrong for this stack. See corrections below. |
| 🔴 **Typing then switching Essay → Notes within 750 ms silently destroys the text** | A real data-loss bug that the mocked unit tests structurally cannot see. Phase 4. |

---

## ⚠️ CP-08's own worked examples are wrong in five places

[CP-08-testing-rich-text.md](CP-08-testing-rich-text.md) was written before Step 08 existed, against an imagined implementation. It is still right about *why* rich text is hostile to automation; it is wrong about *this* codebase. Do not copy its snippets.

| CP-08 says | What is actually true here | Evidence |
|---|---|---|
| `page.getByTestId('essay-editor')` | The testid is **`essay-editor-content`**, and `@tiptap/react`'s `EditorContent` spreads it onto a **wrapper div** — the contenteditable is `.tiptap` *inside* it | `EssayEditorPanel.tsx:194`; the sibling `[&_.tiptap]:min-h-40` on `:195` |
| `getByTestId('essay-save-status')` | The testid is **`essay-autosave-state`**, and it carries a `data-state` attribute as well as the text | `EssayEditorPanel.tsx:122-137` |
| `getByTestId('nav-dashboard')` | **Does not exist.** No `nav-*` testid anywhere in `web/src`. The `/dashboard` link's accessible name is **"My reviews"** | `web/src/lib/roles.ts:42`; `AppSidebar.tsx:22-23` |
| Clicking a nav link fires a native `beforeunload` dialog handled by `page.on('dialog')` | **It does not.** In-app navigation is intercepted by `useBlocker` and renders a **React** `AlertDialog`. `page.on('dialog')` never fires. The native dialog is real but only for reload/close | `EssayEditorPanel.tsx:88` + `:216-251`; both probed |
| "`fill()` silently does nothing" | **False.** `fill()` on this contenteditable dispatches input events ProseMirror's `MutationObserver` picks up, the badge goes `dirty` → `saved`, and the server stores `<p>FILLED VIA FILL</p>` | probed directly |

That last one deserves the deliberate thirty seconds CP-08 asks for — just with the opposite conclusion. The spec should keep a test that **pins `fill()`'s real behaviour**, so that if a TipTap or Playwright upgrade ever does make it a silent no-op, something goes red instead of the coverage quietly rotting.

---

## Phase 1 — Fixture: make the editor reachable and re-seedable *(35 min)*

**File:** `api/database/seeders/E2ESeeder.php`

1. **Add a `ready` primary video asset** on speech 9101, id `9301`, written the same fixed-id `updateOrCreate` way as everything else in the file. Required columns (from the live schema): `speech_id`, `kind='video'`, `format='mp4'`, `rendition='source'`, `disk='media'`, `path`, `mime_type`, `byte_size`, `duration_seconds`, `status='ready'`, `is_primary=true`, `width`, `height`.

   ⚠️ `SpeechAsset` blocks mass assignment of `id` — `updateOrCreate(['id' => 9301], [...])` throws `MassAssignmentException`. Use the query builder (`DB::table('speech_assets')->updateOrInsert(...)`), matching how the row was proven, or add `id` handling explicitly.

   Comment must say plainly: **no object is uploaded to SeaweedFS; the presign is pure signature math and never checks; the `<video>` will fail to load and that is deliberate** — this fixture exists to unlock the tab strip, not to test playback.

2. **Reset all six `essay_*` columns explicitly** in the existing `Review::updateOrCreate` attribute list, so re-seeding is a genuine reset. For review **9202** (reviewer B): all null / `0` — the empty draft to type into. For review **9201** (reviewer A): a **published** essay (`essay_html`, `essay_text`, `essay_words`, `essay_published_at`, `essay_lock_version`) — the fixture the speaker reads and the peer-isolation test targets.

   Splitting the two roles this way is what keeps the specs independent: the typing/publish spec mutates only 9202, the read/isolation spec only reads 9201.

3. **Do not touch `status`** — `api/tests/Feature/Review/E2ESeederSharedSpeechTest.php:42` asserts both reviews are `'accepted'`, and `:51-53` asserts idempotent row counts. Run that test after the change.

4. **Update the two now-stale comments** that assert no asset is seeded: `E2ESeeder.php:166-170` and `web/tests/two-users.spec.ts:62-64`.

**Then, mandatorily:** `docker compose build app && docker compose up -d app && docker compose exec app php artisan db:seed --class=E2ESeeder`.

## Phase 2 — ~~Warm the TipTap module subgraph~~ **CUT: the premise was false** *(0 min)*

**Planned change:** add a hop to `web/tests/warmup.setup.ts` that clicks into the Essay tab, on the reasoning that `@tiptap/react` + `@tiptap/pm` + `@tiptap/starter-kit` is a large subgraph reached only by that click, and therefore not covered by the existing `/login` + `/speeches/9101` warmup. Both the infra review and this plan's first draft asserted it.

**Measured instead of assumed, by counting module requests matching `/tiptap|prosemirror/`:**

```
tiptap/prosemirror modules after /login only: 2
after loading the speech page:                4 (+2)
after clicking the Essay tab:                 4 (+0)
```

**Zero new modules on the click.** `web/src/App.tsx` uses no `lazy()`/`Suspense` — every route is a static import, so `SpeechWatch` → `EssayEditorPanel` → TipTap is in the single graph pulled on *any* page load. The existing warmup already covers it, and half of it is warm from `/login` alone.

**No change made.** The two stalls hit while probing were the general dev-server stall the warmup docblock already documents — intermittent, not TipTap-specific, and reproduced again on an unrelated spec during this phase. Adding a hop justified by a false premise would have looked like diligence and bought nothing.

## Phase 3 — The spec *(75 min)*

**New file:** `web/tests/essay-editor.spec.ts`

Follow the *newer* convention era in `web/tests/` — no semicolons, 2-space indent, `${APP_URL}` from `./fixtures.js` (note the `.js` extension on the relative import), context-per-user, a docblock naming CP-08 and stating the seeding prerequisite verbatim.

Add to `web/tests/fixtures.ts`: `REVIEW_COACH_B_ID` already exists; add whatever essay fixture text constant the seeder writes so the two files cannot drift.

**⚠️ Serialize this file, and guard it by browser.** `playwright.config.ts:17` sets `fullyParallel: true` and three browser projects run every spec. Three browsers typing into **one** review row, against optimistic locking, means the first bumps `lock_version` 0→1 and the other two 409 into the conflict banner. Any `data-state="saved"` assertion flakes hard, locally only — CI masks it with `workers: 1` and chromium-only. So: `test.describe.configure({ mode: 'serial' })` for the within-project half, plus `test.skip(({ browserName }) => browserName !== 'chromium')` on the write block for the across-project half. The read-only block stays cross-browser.

**⚠️ And do not pair that guard with an `afterAll` that mutates fixture data.** `browserName` is a worker-scoped fixture, so the modifier is classified as `beforeAll`; Playwright marks the suite active before evaluating it and skips the fast-skip path when the suite owns an `afterAll`. The firefox and webkit workers — which skip every test in microseconds — would therefore still run that hook, firing a psql reset at an arbitrary point during chromium's multi-minute run and rewinding `essay_lock_version` under a live editor. Reset in `beforeEach` only; it does not run for skipped tests.

### The tests

1. **`fill()` reaches the model — pinned, not assumed.** Type via `fill()`, assert the badge reaches `saved`, assert the **server** stored it. A comment explaining that CP-08 predicts the opposite and this test exists to catch the day that becomes true.

2. **Typing persists — the CP-08 core.** `click()` the `.tiptap`, `pressSequentially()` a sentence, wait for `data-state="saved"`, then **assert on the server** via `page.request.get(.../essay?review_id=…)` with `JSON_HEADERS` — not on the editor DOM. Then `page.reload()`, re-open the Essay tab, and assert the text is still there.

   ⚠️ Both the `Accept: application/json` and `Origin: APP_URL` headers are mandatory, for the reasons `two-users.spec.ts:30-53` spells out: without `Accept`, Laravel 302s to `/login` and Playwright follows it, so the assertion passes against the login page; without `Origin`, Sanctum refuses to upgrade the cookie and everything is 401.

   ⚠️ Do **not** assert `saved` immediately after a second edit — the badge retains `saved` from the previous save and passes instantly against a stale value. Gate on `dirty` first, or wait on the PUT response.

3. **Toolbar formatting, by role and name.** Select all, click `Bold`, assert the **server** stored `<strong>`. The toolbar exposes `aria-label`s (`Bold`, `Italic`, `Strikethrough`, `Heading 2`, `Heading 3`, `Blockquote`, `Bullet list`, `Ordered list`, `Code`, `Link`) so no `Control+B`/`Meta+B` branching is needed at all — sidestepping CP-08's cross-platform-modifier worry entirely.

   ⚠️ **Do not assert `aria-pressed` right after a toolbar click with an empty selection.** Probed: it stays `"false"`. `useEditor` is called without `shouldRerenderOnTransaction`, so the component only re-renders via `onUpdate`, which fires only on a *document* change — a stored mark is not one. After typing, it correctly reads `"true"`.

4. **The Link button's native `prompt`.** `EssayToolbar.tsx:23` calls `window.prompt`. Playwright auto-dismisses it, so `prompt` returns `null`, `:24` early-returns, and **the button silently does nothing**. Register `page.on('dialog', d => d.accept('https://example.com'))` *before* the click, then assert the server stored an `<a href>` carrying the forced `rel="noopener noreferrer nofollow"`. This is CP-08's native-dialog lesson, landing on the control that actually has one.

5. **The unsaved-changes guard — the in-app half.** Type, assert the badge reads `dirty`, click the sidebar's **"My reviews"** link, `expect(getByTestId('essay-unsaved-changes-dialog')).toBeVisible()`, assert the URL has *not* changed, click `Stay` and assert it still hasn't, then repeat and click `Leave` and assert it lands on `/dashboard`.

   ⚠️ Use an awaited `expect(...).toBeVisible()`, never `.count()`. `count()` does not auto-wait; it returned `0` on the first probe purely because React had not rendered the portal yet — a false negative that looks exactly like a missing feature.

   ⚠️ Both guards arm only while `autosaveState === 'dirty'`, i.e. inside the 750 ms debounce window (`EssayEditorPanel.tsx:88`, `:92`). Clicking straight after `pressSequentially` lands well inside it, and did so reliably in probing — but do not insert any awaited step between the typing and the click.

6. **The unsaved-changes guard — the native half.** Type, then `page.close({ runBeforeUnload: true })` with a `page.on('dialog')` handler registered **first**, and assert `dialog.type() === 'beforeunload'`. Proven to fire. This is the one place CP-08's dialog snippet is genuinely right.

7. **The conflict banner, provoked for real.** Deterministic recipe, in this order:
   - Load the editor (it now holds `lock_version: N`).
   - `page.request.put` the essay directly from the same context, bumping the server to `N+1`. Needs `Accept`, `Origin`, **and `X-XSRF-TOKEN`** — `page.request` does not send the CSRF header automatically; read the `XSRF-TOKEN` cookie off the context and `decodeURIComponent` it.
   - *Then* type in the UI. The editor's version is now stale **and** the text is unsaved, which is what forces the dirty-editor branch (`useEssayEditor.ts:141-144`) rather than the silent-adopt one (`:130-139`).
   - Assert `essay-conflict-banner` is visible, that the local text is **still on screen** (the whole point — a conflict must never discard typing), then click `Use theirs` and assert the banner clears and the editor now shows the server's text.

   ⚠️ `Show both`'s accessible name flips to `Hide` when expanded — don't reuse one locator across the toggle.

8. **Publish, then the speaker reads it.** As reviewer B: type, wait for `saved`, click `Publish` (exact name — it becomes `Publishing…` then `Published`, so a non-exact locator substring-collides). Then, in a **separate context** as the speaker: open the speech, pick that reviewer's radio in the `Choose commentary track` radiogroup **first** (`EssayReadOnlyPanel` renders "Pick a reviewer to see their essay." until one is selected), click the Essay tab, and assert `essay-readonly-content` contains the text.

   ⚠️ Server-side, the speaker's pre-publish read is gated by `EssayController.php:64-73` nulling `essay_html` — so also assert the honest empty state ("… hasn't published an essay yet.") *before* publishing. That tests a real server gate, not just client rendering.

9. **Peer isolation — with a positive control.** As reviewer B, `page.request.get(.../essay?review_id=9201)` → **403**. Then, to prove the assertion is not vacuous, the same call for B's *own* review → **200**. This mirrors `two-users.spec.ts:84-105`'s explicit vacuity guard, which exists because a blanket-403 world would make the isolation assertion meaningless.

### What the spec deliberately does *not* do

- **It does not re-test read-time XSS sanitization.** CP-08 asks for a hostile payload written straight to the column; that already exists and passes — `api/tests/Feature/Essay/EssayHttpTest.php:131-154` `UPDATE`s `reviews.essay_html` directly and asserts the GET is clean. Duplicating it in Playwright would test less, more slowly. Cite it from the spec's docblock instead.
- **It does not type an XSS payload and assert `img[onerror]` has count 0.** That assertion passes trivially and proves nothing: StarterKit ships no Image extension, so `<img src=x onerror=…>` becomes literal *text* and is serialized escaped — CP-08's own "you will hit this" warning, which its worked example then walks into. If a UI-reachable write-layer test is wanted, it must go through **paste** (a synthetic `ClipboardEvent` carrying `text/html`), which is a bigger piece of work and is out of scope here.

## Phase 4 — Fix the data-loss bug the coverage exposes *(20 min)*

**File:** `web/src/hooks/useEssayEditor.ts`

The base-ui `TabsPanel` unmounts its content when inactive (`keepMounted` defaults false). `useEssayEditor`'s unmount cleanup clears the pending debounce **without flushing it**:

```ts
useEffect(() => {
  return () => { if (timerRef.current) clearTimeout(timerRef.current) }
}, [])                                        // useEssayEditor.ts:172-176
```

`useBlocker` does not cover a tab switch (no route change) and `pagehide` does not fire (no unload). Probed end to end:

```
badge right after typing: dirty
SERVER after tab switch:  "<p>FILLED VIA FILL</p>"     <- the new sentence never arrived
EDITOR after coming back: "FILLED VIA FILL"            <- and it is gone from the editor too
```

The user typed a sentence, clicked Notes, came back, and their words were gone from both the server and the screen. This is straightforward data loss, and it is the single most valuable thing this whole exercise found — the mocked unit tests structurally cannot see it, because they never unmount the panel.

**Order of work:** write the assertion first (type → switch to Notes → switch back → the text is still there, and the server has it), watch it fail, then fix. The fix is to flush rather than discard on unmount, mirroring what the `pagehide` handler already does for the tab-close case.

⚠️ The cleanup's dependency array is `[]`, so it closes over the first render's refs — the flush must go through the same `htmlRef`/`lockVersionRef` the beacon uses, not through stale state.

**As built:** the `pagehide` handler's body was extracted into a `beaconSave` callback held in a ref, and both the `pagehide` listener and the unmount cleanup now call it. One body for both, so a future fix to either cannot miss the other. The cleanup is gated on a pending timer (`timerRef.current`) and `beaconSave` is itself gated on `autosaveState === 'dirty'`, which keeps it from firing on a clean unmount or re-sending during an unresolved `conflict`. Confirmed red before and green after: the assertion failed on the run that introduced it and passes on the fix.

**Not being changed, deliberately:** the 750 ms guard window on `useBlocker`/`beforeunload`. Widening it to `saving` was considered and rejected — in-app navigation does not cancel an in-flight `fetch`, and a real unload is already covered by the `pagehide` keepalive beacon, so no data is actually at risk there. Document it; don't churn it.

## Phase 5 — CI *(10 min)*

`.github/workflows/ci.yml:244` names its specs explicitly:

```yaml
run: npx playwright test tests/speech-create.spec.ts tests/app-shell.spec.ts --project=chromium
```

with a comment recording that `testDir` alone is not enough — a lesson learned the hard way once already. **Add `tests/essay-editor.spec.ts` to that line**, or the entire deliverable is invisible to CI.

Also add `"e2e": "playwright test"` to `web/package.json`'s scripts. There is none today, and `npm test` runs **Vitest**, not Playwright — a genuinely confusing trap for anyone who assumes otherwise.

---

## Acceptance

- [ ] `npx playwright test tests/essay-editor.spec.ts --project=chromium` is green from a freshly re-seeded database, **twice in a row** (this is what proves Phase 1's reset actually resets)
- [ ] The whole suite is green on chromium, firefox and webkit, apart from the pre-existing `speech-create.spec.ts` red — **not achieved on this machine**, and not because of this spec: see the dev-server stall note under "out of scope"
- [x] `npx vitest run` still 156/156, `tsc -b` clean, `eslint .` clean
- [x] `./vendor/bin/pest` green — 174 tests / 1192 assertions, including `E2ESeederSharedSpeechTest` and `EssayHttpTest`; `pint --test` and `phpstan` clean
- [x] No `vi.mock('@tiptap/react')` anywhere in the new spec; the editor under test is the real one (grep: 0 hits in `web/tests/`)
- [x] The tab-switch data-loss assertion fails before the Phase 4 fix and passes after — and now runs on a frozen clock, so it can only pass down the branch that actually exercises the fix
- [x] `tests/essay-editor.spec.ts` appears in `ci.yml`'s explicit file list

### Understanding

- [ ] Why does `fill()` work here when CP-08 says it won't — and what would have to change for CP-08 to become right?
- [ ] Why assert on the server rather than the editor's DOM, when the DOM visibly contains the text?
- [ ] Why does `page.on('dialog')` never fire for an in-app link click, but does for `page.close({runBeforeUnload:true})`?
- [ ] Why is `aria-pressed` still `"false"` right after clicking Bold with an empty selection?
- [ ] Why would this spec flake across three browser projects but not in CI?
- [ ] Why is a UI-typed `<img onerror>` test worthless here, and what does `EssayHttpTest.php:131-154` prove that it can't?

---

## Build order

1. Phase 1 (fixture) — nothing else can run until the editor renders
2. ~~Phase 2 (warmup)~~ — cut; measure before you write it (see that section)
3. Phase 3 tests 1–3 (type, persist, format) — the core; stop here and you have already closed the retrospective's gap
4. Phase 4 (the data-loss assertion, red → fix → green)
5. Phase 3 tests 4–9 (link prompt, both guards, conflict, publish/read, isolation)
6. Phase 5 (CI + npm script)

## What changed against this plan while building it

Five things. Recorded because a plan that quietly rewrites itself to match the outcome is worth nothing next time. The last two were caught by the review pass rather than by anything going red, which is the case for running one.

1. **Phase 2 was cut outright** — the premise was false and measurement said so. Detail in that section.
2. **`web/tests/auth.setup.ts` needed a timeout raise that this plan never anticipated.** Not essay code, and not touched by anything else here, but it is a `dependencies: ['setup']` for every browser project, so its intermittent stall takes the whole suite down before a single essay test runs. Raised to warmup's own 120s nav / 180s test budget.
3. **A navigation-lifecycle trap that only the fixture makes reachable.** `page.reload()` on the default `waitUntil: 'load'` never resolves on the speech page, because Phase 1's deliberately-dead video is a cross-origin `http://` resource on an `https://` page. Under `domcontentloaded` the same reload returns in ~98ms. Every navigation in the spec uses `domcontentloaded`, with the measurement written down beside it and the mechanism flagged as un-instrumented rather than asserted.

4. **The two guard tests moved onto Playwright's clock API — and the data-loss test had to move straight back off it.** Both unsaved-changes guards arm only while the state is the literal string `'dirty'`, a 750ms window; racing it lost a full run, so `page.clock.pauseAt()` holds it open. Two things then went wrong, and both are worth knowing before reaching for that API:

   - **A frozen clock freezes base-ui's animated unmount.** The obvious move was to freeze the tab-switch test too — the bug only exists while a save is pending, so pinning the debounce should pin the branch. It does the reverse: base-ui's Tabs panel exits through an animation, so with timers frozen **the panel never unmounts at all**. Measured: editor node still in the DOM and **0** PUTs issued, against a removed node and **1** PUT on a live clock. No unmount, no cleanup, no fix exercised — the test looked green while proving nothing, which is exactly the failure the freeze was meant to prevent. It now runs on a live clock with an explicit branch guard: assert the badge reads `dirty` **and** that zero PUTs have gone out, then click; assert exactly one PUT afterwards. Verified red (`essay_text: null`) with the flush disabled, green with it restored.
   - **A frozen clock also freezes the dialog's exit animation.** `toBeHidden()` on the unsaved-changes dialog never resolves — the node sits there with `data-closed=""` and `data-ending-style=""`. Assert `data-closed` instead; whether the fade has finished is base-ui's business.

   General rule this produced: **`page.clock` is the right tool for holding a debounce open, and the wrong one whenever the assertion depends on an unmount or a disappearance.**

5. **The flush-on-unmount fix was wrong on its first cut.** It reused the `pagehide` beacon, which is `keepalive: true`. That caps a body at 64KB and *rejects* above it — so it would have silently dropped exactly the 30,000-word essays STEP-08's acceptance list names, and `try { void fetch() } catch {}` cannot catch a rejected promise. It also bypassed RTK Query, leaving a 60s window where returning to the tab re-seeded the editor from stale cache: words missing from the screen though safe on the server, and a stale `lock_version` that turns the next keystroke into a conflict banner about a conflict with yourself. Now calls `flush()`, which goes through the mutation and invalidates the cache. Also caught in review.

## Out of scope, and honest about it

- **The Vite dev-server stall is not fixed, only budgeted for.** On this machine a randomly-chosen login stalls in roughly two runs in five, for 60 s to over 4 minutes, and it can also strand a spec's own `goto`. Four hypotheses were tested and all four came back negative — it is not the `load` lifecycle trap, not dev-server age (a fresh `npm run dev` stalls at the same rate), not CP-08's new fixture video (the stall reproduces with that row deleted), and not stray browser processes or busy containers (every container idles below 0.5% CPU). It tracks the *host's* load, which on this box is the user's own desktop applications. That is the same conclusion `warmup.setup.ts` reached, and the same real fix it names: **point E2E at the production build instead of the dev server.** Until then, expect to need `--retries` locally.
- **`web/tests/speech-create.spec.ts` fails on the baseline** — 30 s timeout waiting for `getByRole('textbox', { name: 'First name' })` on the onboarding popup. Pre-existing, unrelated to essays, and the file's own header admits it was "**not run as part of this change** … unverified against a live backend." It is one of only two specs CI runs. Worth its own fix; not this plan's.
- **Firefox and WebKit never run in CI** — `ci.yml:169` installs chromium only and `:244` passes `--project=chromium`. Cross-browser remains a local-only claim, for this spec as for every other.
- **`trace: 'on-first-retry'` + `retries: 0` locally means no trace is ever captured locally.** For debugging contenteditable and selection behaviour that is the single most useful artifact. Run with `--trace on` while iterating; changing the default is a separate call.
- **Nothing here tests playback**, and the fixture asset deliberately points at bytes that do not exist.
- **No paste-path coverage**, so the write-time sanitizer is still only exercised by backend tests.
