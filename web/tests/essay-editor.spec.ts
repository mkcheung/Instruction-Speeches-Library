import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import {
  API_URL,
  APP_URL,
  ESSAY_COACH_A_TEXT,
  REVIEW_COACH_A_ID,
  REVIEW_COACH_B_ID,
  SHARED_SPEECH_ID,
  USERS,
} from './fixtures.js'

/**
 * CP-08 — driving the REAL TipTap editor.
 *
 * `EssayEditorPanel.test.tsx` mocks `@tiptap/react` wholesale (a fake
 * `useEditor`/`EditorContent`) so its unit tests can stay focused on this
 * codebase's own autosave/conflict/blocker logic instead of fighting
 * ProseMirror under jsdom. That is the right call for a unit test and it
 * leaves exactly one thing unproven: that any of it works against a real
 * contenteditable in a real browser. This file is that proof, and nothing
 * here may mock the editor.
 *
 * Requires the fixture data from `api/database/seeders/E2ESeeder.php`:
 *   docker compose exec app php artisan db:seed --class=Database\\Seeders\\E2ESeeder
 *
 * ⚠️ And requires the app image to be current — `api/` is COPYed into the
 * image, not bind-mounted, so a seeder edit is invisible until
 * `docker compose build app && docker compose up -d app`.
 *
 * Fixture split (E2ESeeder): reviewer A's essay is seeded PUBLISHED and is
 * only ever READ here; reviewer B's is seeded empty and is the only row
 * this file writes to. Neither half can disturb the other.
 *
 * ON CP-08's OWN WORKED EXAMPLES: several do not match what Step 08 built,
 * and were corrected against the running app rather than copied. See
 * CP-08-BUILD-PLAN.md's correction table. The load-bearing ones:
 *   - the testids are `essay-editor-content` (a WRAPPER; the contenteditable
 *     is `.tiptap` inside it) and `essay-autosave-state`, not the names
 *     CP-08 guesses;
 *   - in-app navigation raises an in-app AlertDialog via `useBlocker`, NOT a
 *     native `beforeunload` dialog — `page.on('dialog')` never fires for it;
 *   - `fill()` is not the silent no-op CP-08 promises. See the first test.
 *
 * ON CP-08's XSS REQUIREMENT: its "layer 2" — a hostile payload written
 * STRAIGHT to `reviews.essay_html`, then fetched, proving read-time
 * sanitization independently of the write-time pass — is deliberately not
 * duplicated here. It already exists and passes as a backend test:
 * `api/tests/Feature/Essay/EssayHttpTest.php` — "neutralizes a stored-XSS
 * payload on read even when it bypassed the write-time sanitizer", which
 * UPDATEs the column directly and then GETs it. Layer 1 through
 * this UI is not worth writing either, and CP-08's own "you will hit this"
 * section says why: StarterKit ships no Image extension, so a typed
 * `<img onerror>` is inert TEXT and `locator('img[onerror]')` is 0 before
 * any sanitizer runs. Reaching the write-time sanitizer from a browser
 * needs a synthetic paste event, which is out of scope here.
 */

const SPEECH_URL = `${APP_URL}/speeches/${SHARED_SPEECH_ID}`

/**
 * Both headers are mandatory and each one fails silently in its own way,
 * per `two-users.spec.ts`'s longer treatment: without `Accept`, Laravel
 * redirects 302 → /login and Playwright follows it, so an assertion passes
 * against the login page; without `Origin`, Sanctum refuses to upgrade the
 * session cookie and everything comes back 401. Either way a test goes
 * green while proving nothing.
 */
const JSON_HEADERS = {
  Accept: 'application/json',
  Origin: APP_URL,
} as const

/**
 * ⚠️ Every navigation in this file waits for `domcontentloaded`, not the
 * default `load`. This is a direct consequence of the fixture, and worth
 * the paragraph so nobody "fixes" it back.
 *
 * `E2ESeeder` seeds a `ready` video asset with no object behind it (the
 * only way to open the reviewer's tab strip — see the seeder's docblock).
 * Its presigned URL is cross-origin plain `http://localhost:8333/...` on an
 * `https://` page, so the request is blocked and the `<video>` lands in
 * `networkState: 3` / `error.code: 4`.
 *
 * What was actually measured, and nothing beyond it: `page.reload()` on the
 * default `waitUntil: 'load'` fails to resolve on this page — it was given
 * 12s and blew it every time — while the same reload under
 * `domcontentloaded` returns in ~98ms and the page then reaches
 * `readyState: 'complete'` with its `load` handler having run. The most
 * likely mechanism is the dead <video> holding the document's
 * delay-the-load-event flag at the moment the wait is armed, but that was
 * not instrumented, so treat it as the symptom rather than the diagnosis.
 * The first `goto` of a cold page happens not to hit it, which makes this
 * fail only on reload — exactly where it is most confusing.
 *
 * `domcontentloaded` is the right signal for a SPA regardless: nothing here
 * is asserting on media, and every assertion below auto-waits anyway.
 */
const DOM_READY = 'domcontentloaded' as const

/**
 * Navigation gets far longer than Playwright's default, for the reason
 * `warmup.setup.ts` documents at length: nginx proxies this host to a
 * host-run Vite DEV server that transforms unbundled modules on demand,
 * single-threaded, and a parallel cold load intermittently stalls ~30s.
 * `warmup` pays that cost once up front but does not immunise a whole run
 * — while building this spec the stall was observed three times, twice on
 * files this change never touched (`auth.setup.ts`, and a bare `goto` in an
 * unrelated probe), which is how it was pinned as pre-existing rather than
 * anything to do with the editor.
 *
 * Retrying would hide it; a longer budget absorbs it and still fails
 * honestly if navigation is genuinely broken. `warmup.setup.ts` reaches for
 * exactly the same lever (120s), so this is the established answer here,
 * not a new one. The real fix, per that same docblock, is to point E2E at
 * the production build.
 *
 * 120s rather than 60s because 60s was measurably not enough: a run with
 * `--retries=3` still lost all four attempts of one test to a stalled
 * second navigation. Tests that navigate twice pay the dice roll twice,
 * which is why TEST_TIMEOUT is more than 2× NAV_TIMEOUT.
 */
const NAV_TIMEOUT = 120_000
const TEST_TIMEOUT = 240_000

/**
 * Both unsaved-changes guards arm only while `autosaveState` is literally
 * `'dirty'` — `EssayEditorPanel.tsx`'s `useBlocker(… === 'dirty')` and its
 * `beforeunload` listener both test that exact string. At t+750ms the
 * debounce fires, the state becomes `'saving'`, and both guards disarm.
 *
 * Racing that window from the test side does not work: an earlier revision
 * typed and then clicked as fast as it could, and still lost the race often
 * enough to fail a full run. Playwright's clock API removes the race
 * instead of narrowing it — with timers paused the debounce never fires, so
 * the editor stays `'dirty'` for as long as the test needs and the guard is
 * observed deterministically rather than opportunistically.
 *
 * Only `setTimeout`/`setInterval`/`Date` are faked; React's scheduler uses
 * `MessageChannel`, so the UI stays responsive, and Playwright's own
 * assertion polling runs on the test process's real clock.
 */
const CLOCK_START = new Date('2026-06-01T12:00:00Z')

interface EssayPayload {
  essay: {
    essay_html: string
    essay_text: string | null
    essay_published_at: string | null
    essay_words: number
    essay_lock_version: number
  }
}

/** Reads the essay straight from the API — CP-08's "assert on the server,
 * not on the editor's DOM", which is the whole point: the rendered markup
 * is an output of ProseMirror's model, not the thing that got saved. */
async function serverEssay(page: Page, reviewId: number): Promise<EssayPayload['essay']> {
  const res = await page.request.get(
    `${API_URL}/api/speeches/${SHARED_SPEECH_ID}/essay?review_id=${reviewId}`,
    { headers: JSON_HEADERS },
  )
  expect(res.status(), 'reading back the essay must succeed').toBe(200)
  return ((await res.json()) as EssayPayload).essay
}

/**
 * Polls the server until the essay satisfies `check`.
 *
 * ⚠️ Use this, not the autosave badge, for anything after the FIRST save of
 * a test. The badge is a single element that keeps whatever it last said,
 * so `toHaveAttribute('data-state', 'saved')` following a second edit
 * matches instantly against the PREVIOUS save and asserts nothing — a
 * green test that would stay green if the second save never happened at
 * all. Waiting on 'dirty' first would be a race against the 750ms
 * debounce; waiting on the server is neither vacuous nor racy, and it is
 * the thing CP-08 says to assert on anyway.
 */
async function expectServerEssay(
  page: Page,
  reviewId: number,
  check: (essay: EssayPayload['essay']) => void,
): Promise<void> {
  await expect(async () => check(await serverEssay(page, reviewId))).toPass({ timeout: 15_000 })
}

/** Opens the reviewer's Essay tab and returns the REAL contenteditable.
 *
 * `data-testid` lands on `EditorContent`'s wrapper div (that's where
 * @tiptap/react spreads unknown props), so the testid alone is the wrong
 * target: `pressSequentially` focuses first, `focus()` on a non-focusable
 * div is a spec no-op, and the keystrokes then go wherever focus already
 * was — silently. Descend to `.tiptap`, which is the class @tiptap/core
 * puts on ProseMirror's editable node. */
async function openEssayEditor(page: Page, opts: { freezeTimers?: boolean } = {}) {
  if (opts.freezeTimers) await page.clock.install({ time: CLOCK_START })
  await page.goto(SPEECH_URL, { waitUntil: DOM_READY, timeout: NAV_TIMEOUT })
  await page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Essay' }).click()
  const editable = page.locator('[data-testid="essay-editor-content"] .tiptap')
  await expect(editable).toBeVisible()
  await expect(editable).toHaveAttribute('contenteditable', 'true')
  // Freeze AFTER the editor exists, so the load path gets a normal clock
  // and only the debounce is held. Nothing is typed yet, so no pending save
  // is skipped over by the fast-forward.
  if (opts.freezeTimers) await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000))
  return editable
}

function autosaveBadge(page: Page) {
  return page.getByTestId('essay-autosave-state')
}

/**
 * `page.request` carries the context's cookies but does NOT set the CSRF
 * header the way the app's own client does (`lib/baseQuery.ts`), so a bare
 * PUT is rejected. Laravel's cookie is URL-encoded; the header must not be.
 */
async function xsrfHeader(context: BrowserContext): Promise<Record<string, string>> {
  const cookie = (await context.cookies(API_URL)).find((c) => c.name === 'XSRF-TOKEN')
  expect(cookie, 'no XSRF-TOKEN cookie — has the session gone stale?').toBeTruthy()
  return { 'X-XSRF-TOKEN': decodeURIComponent(cookie!.value) }
}

/**
 * Resets reviewer B's essay to the seeded empty draft.
 *
 * Same `execSync` + raw psql route `onboarding.spec.ts`/`speech-create.spec.ts`
 * already use for cleanup, and for the same reason: there is no HTTP path
 * that can un-publish an essay or wind `essay_lock_version` back, and a
 * test that cannot restore its own preconditions is a test that passes
 * once. Container name is hardcoded exactly as those specs hardcode it.
 */
function resetReviewerBEssay(): void {
  execSync(
    'docker exec instruction-speeches-library-postgres-1 psql -U speechcoach -d speechcoach -c ' +
      `"update reviews set essay_html = null, essay_text = null, essay_published_at = null, ` +
      `essay_updated_at = null, essay_words = 0, essay_lock_version = 0 where id = ${REVIEW_COACH_B_ID}"`,
    { stdio: 'ignore' },
  )
}

/* ------------------------------------------------------------------ *
 * The write path — reviewer B types into a real contenteditable.
 * ------------------------------------------------------------------ */

test.describe('the real TipTap editor — write path', () => {
  /**
   * ⚠️ Serial, and chromium-only. Both are about ONE shared row.
   *
   * `playwright.config.ts` sets `fullyParallel: true` and runs every spec
   * under chromium, firefox AND webkit. Three browsers typing into review
   * 9202 at once, against `essay_lock_version`'s optimistic locking, means
   * the first save bumps 0→1 and the other two 409 into the conflict
   * banner — so every `data-state="saved"` assertion flakes, locally only,
   * because CI is `workers: 1` and chromium-only. Serial mode fixes the
   * within-project half; the browserName guard fixes the across-project
   * half. Seeding a third and fourth empty draft would need a third and
   * fourth reviewer (one review per reviewer per speech is a unique index),
   * which is a lot of fixture for a question the read-path block below
   * already answers cross-browser.
   *
   * To check contenteditable behaviour on another engine, re-seed and run
   * `--project=webkit` by hand; the guard is the only thing in the way.
   */
  test.describe.configure({ mode: 'serial', timeout: TEST_TIMEOUT })
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'writes to one shared review row; see the comment above',
  )

  // ⚠️ `beforeEach` only — deliberately NOT `afterAll`.
  //
  // `test.skip(({ browserName }) => …)` is classified as a `beforeAll`
  // modifier, because `browserName` is a worker-scoped fixture. Playwright
  // registers the suite as active BEFORE evaluating it, and skips the
  // fast-skip path when the suite owns an `afterAll` — so an `afterAll`
  // here would still execute in the firefox and webkit workers, which skip
  // every test in microseconds. Those two workers would then fire this psql
  // reset at an arbitrary moment during chromium's multi-minute run,
  // rewinding `essay_lock_version` under a live editor and 409-ing it into
  // the conflict banner. `beforeEach` does not run for skipped tests, so it
  // has no such reach. Re-seeding is the way to leave 9202 clean.
  test.beforeEach(() => resetReviewerBEssay())

  test('fill() reaches ProseMirror\'s model here — pinning the behaviour CP-08 predicts the opposite of', async ({
    browser,
  }) => {
    // CP-08 §"Watch fill() fail" says to try this deliberately and watch it
    // do nothing: "It sets `value`, and there isn't one." That is not what
    // happens with @tiptap/react 3.x under Playwright 1.62 — `fill()`
    // dispatches input events that ProseMirror's MutationObserver picks up,
    // so the model updates and the text really does persist.
    //
    // This test exists so that if a TipTap or Playwright upgrade ever DOES
    // make `fill()` a silent no-op, something goes red here instead of the
    // coverage quietly rotting. It is not an endorsement of `fill()` — the
    // rest of this file types for real, which is what a user does.
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()
    const editable = await openEssayEditor(page)

    await editable.fill('Filled rather than typed.')

    await expect(autosaveBadge(page)).toHaveAttribute('data-state', 'saved')
    const essay = await serverEssay(page, REVIEW_COACH_B_ID)
    expect(essay.essay_text, 'if this is empty, CP-08 has become right and the note above is stale').toBe(
      'Filled rather than typed.',
    )

    await context.close()
  })

  test('typing persists to the server and survives a reload', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()
    const editable = await openEssayEditor(page)

    const sentence = 'Your opening was strong and the pacing held.'
    await editable.click()
    await editable.pressSequentially(sentence)

    // The autosave word is the documented E2E hook (§10.2: "render the
    // autosave state as ONE WORD… that attribute is also the primary E2E
    // test hook"). `data-state` rather than the text so whitespace can
    // never matter.
    await expect(autosaveBadge(page)).toHaveAttribute('data-state', 'saved')

    // The assertion that counts. The editor's DOM showing the sentence
    // proves only that ProseMirror rendered its own model; this proves the
    // bytes reached Postgres.
    const essay = await serverEssay(page, REVIEW_COACH_B_ID)
    expect(essay.essay_text).toBe(sentence)
    expect(essay.essay_words).toBe(8)
    expect(essay.essay_lock_version, 'a save must bump the lock version').toBeGreaterThan(0)

    // And that it comes back. `openEssayEditor` navigates to the speech URL
    // afresh, which discards every scrap of in-memory editor state and RTK
    // Query cache — the difference between "saved" and "still held in a JS
    // object". (An explicit `page.reload()` first would be dead weight: the
    // navigation below already does the job.)
    const afterReload = await openEssayEditor(page)
    await expect(afterReload).toContainText(sentence)

    await context.close()
  })

  test('toolbar formatting reaches the stored HTML', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()
    const editable = await openEssayEditor(page)

    await editable.click()
    await editable.pressSequentially('bold me')
    await expect(autosaveBadge(page)).toHaveAttribute('data-state', 'saved')

    const bold = page.getByRole('button', { name: 'Bold' })

    // ⚠️ `aria-pressed` is NOT reliable immediately after a toolbar click
    // with an empty selection — measured as "false" in that case. `useEditor`
    // runs without `shouldRerenderOnTransaction`, so the component re-renders
    // only via `onUpdate`, which fires only when the DOCUMENT changes; a
    // stored mark on a collapsed cursor is not a document change. Selecting
    // first makes the toggle a real document change, so the re-render (and
    // this assertion) is sound.
    await page.keyboard.press('ControlOrMeta+a')
    await bold.click()
    await expect(bold).toHaveAttribute('aria-pressed', 'true')

    // Assert on the stored markup, not on the editor's DOM: STEP-08's
    // sanitizer allowlist is the real contract, and CP-08 is explicit that
    // asserting editor markup breaks on a library swap for no functional
    // reason. `<strong>` is in the allowlist; `<b>` is not.
    await expectServerEssay(page, REVIEW_COACH_B_ID, (essay) => {
      expect(essay.essay_html).toContain('<strong>')
      expect(essay.essay_text).toBe('bold me')
    })

    await context.close()
  })

  test('the Link button\'s native prompt must be answered, or it silently does nothing', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()
    const editable = await openEssayEditor(page)

    await editable.click()
    await editable.pressSequentially('see the notes')
    await expect(autosaveBadge(page)).toHaveAttribute('data-state', 'saved')

    // THIS is CP-08's native-dialog lesson, landing on the control that
    // actually has one: `EssayToolbar`'s link command calls `window.prompt`.
    // Playwright auto-dismisses dialogs, so without this handler `prompt`
    // returns null, the command early-returns, and the button does nothing
    // at all — a test would then "pass" against an unchanged essay.
    // Register BEFORE the click; afterwards is too late.
    let promptSeen: string | null = null
    page.on('dialog', async (dialog) => {
      promptSeen = dialog.type()
      await dialog.accept('https://example.com/notes')
    })

    await page.keyboard.press('ControlOrMeta+a')
    await page.getByRole('button', { name: 'Link' }).click()

    await expectServerEssay(page, REVIEW_COACH_B_ID, (essay) => {
      expect(essay.essay_html).toContain('href="https://example.com/notes"')
      // §6.6 forces these on output regardless of what the editor sent —
      // the sanitizer is the security boundary, the toolbar is only UX.
      expect(essay.essay_html).toContain('rel="noopener noreferrer nofollow"')
    })
    expect(promptSeen, 'the Link button should have raised a native prompt').toBe('prompt')

    await context.close()
  })

  test('in-app navigation while dirty raises the in-app dialog, not a native one', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()
    // Frozen clock — see CLOCK_START. Without it this test races the 750ms
    // debounce and loses often enough to fail a full run.
    const editable = await openEssayEditor(page, { freezeTimers: true })

    // If CP-08's worked example were right, this handler would fire. It
    // does not: `useBlocker` intercepts client-side route changes before
    // the browser is ever involved, so there is no native dialog to catch.
    let nativeDialogFired = false
    page.on('dialog', async (dialog) => {
      nativeDialogFired = true
      await dialog.dismiss()
    })

    await editable.click()
    await editable.pressSequentially('unsaved words')

    // The precondition, asserted rather than assumed: a disarmed guard and
    // a broken guard look identical from here, so if this ever reads
    // anything but 'dirty' the test must fail loudly instead of quietly
    // proving nothing.
    await expect(autosaveBadge(page)).toHaveAttribute('data-state', 'dirty')

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My reviews' }).click()

    // `toBeVisible`, never `.count()`: count does not auto-wait, and the
    // dialog renders through a portal a tick after the click. Asserting on
    // count here returns 0 and reads exactly like a missing feature.
    await expect(page.getByTestId('essay-unsaved-changes-dialog')).toBeVisible()
    expect(new URL(page.url()).pathname, 'navigation must be held while the dialog is up').toBe(
      `/speeches/${SHARED_SPEECH_ID}`,
    )

    await page.getByRole('button', { name: 'Stay' }).click()

    // ⚠️ `data-closed`, not `toBeHidden()`. base-ui keeps the popup mounted
    // through an exit ANIMATION and only then removes it — and this test
    // runs with timers frozen, so that animation never finishes and the
    // node stays "visible" forever. (Observed exactly that: the element was
    // sitting there with `data-closed=""` and `data-ending-style=""` while
    // `toBeHidden` timed out.) `data-closed` is the state we actually care
    // about — the blocker was reset — and whether the fade has finished is
    // base-ui's business, not this test's.
    await expect(page.getByTestId('essay-unsaved-changes-dialog')).toHaveAttribute('data-closed', '')
    expect(new URL(page.url()).pathname).toBe(`/speeches/${SHARED_SPEECH_ID}`)

    expect(nativeDialogFired, 'an in-app route change must not raise a browser dialog').toBe(false)

    await context.close()
  })

  test('closing the tab while dirty raises the real native beforeunload dialog', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()
    const editable = await openEssayEditor(page, { freezeTimers: true })

    // The other half of the guard, and the one place CP-08's dialog snippet
    // is exactly right: `useBlocker` cannot see a real unload, so
    // `EssayEditorPanel` registers a `beforeunload` listener for it.
    let dialogType: string | null = null
    page.on('dialog', async (dialog) => {
      dialogType = dialog.type()
      await dialog.dismiss()
    })

    await editable.click()
    await editable.pressSequentially('words the browser should warn about')
    await expect(autosaveBadge(page)).toHaveAttribute('data-state', 'dirty')

    // `runBeforeUnload` is the documented way to let the handler run;
    // a plain close() tears the page down without firing it.
    await page.close({ runBeforeUnload: true })
    await expect(() => expect(dialogType).toBe('beforeunload')).toPass({ timeout: 5_000 })

    await context.close()
  })

  test('a conflict banners the editor and never discards what was typed', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()
    const editable = await openEssayEditor(page)

    // Order matters, and getting it wrong lands in the wrong branch.
    // `useEssayEditor` splits on whether the editor is CLEAN at the moment
    // the 409 resolves: clean → silently adopt the server's copy, no banner;
    // dirty → banner. So bump the server version FIRST, while the editor is
    // still untouched, and only then type — that leaves the editor holding
    // a stale lock_version AND unsaved text, which is the banner branch.
    const theirs = '<p>Saved from somewhere else entirely.</p>'
    // Read the current version rather than assuming 0. The preceding tests
    // end with a dirty editor, so `context.close()` fires `pagehide` → the
    // keepalive beacon → one more PUT, which can land AFTER this test's
    // `beforeEach` reset and leave `essay_lock_version` at 1. Hardcoding 0
    // would then 409 here and fail this test for a reason that has nothing
    // to do with conflicts.
    const current = await serverEssay(page, REVIEW_COACH_B_ID)
    const bump = await page.request.put(`${API_URL}/api/speeches/${SHARED_SPEECH_ID}/essay`, {
      headers: { ...JSON_HEADERS, ...(await xsrfHeader(context)) },
      data: { html: theirs, lock_version: current.essay_lock_version },
    })
    expect(bump.status(), 'the out-of-band write must land, or there is no conflict to find').toBe(200)

    const mine = 'Text I must not lose to a conflict.'
    await editable.click()
    await editable.pressSequentially(mine)

    await expect(page.getByTestId('essay-conflict-banner')).toBeVisible()
    await expect(autosaveBadge(page)).toHaveAttribute('data-state', 'conflict')

    // The product promise: "Your text is safe." A conflict that quietly
    // replaced the user's words with the server's would be worse than the
    // conflict.
    await expect(editable).toContainText(mine)

    await page.getByRole('button', { name: 'Use theirs' }).click()
    await expect(page.getByTestId('essay-conflict-banner')).toBeHidden()
    await expect(editable).toContainText('Saved from somewhere else entirely.')

    await context.close()
  })

  test('publishing is what makes the essay readable by the speaker', async ({ browser }) => {
    const reviewer = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const reviewerPage = await reviewer.newPage()

    const speaker = await browser.newContext({ storageState: USERS.speaker.storageState })
    const speakerPage = await speaker.newPage()

    // Before anything is published, the speaker is served an empty essay.
    // Asserted against the API rather than the UI on purpose, twice over:
    // it is the real SERVER gate (`EssayController` nulls `essay_html` for
    // a non-author while `essay_published_at` is null, returning 200 with
    // an empty body rather than 403), so it proves the thing that actually
    // protects the draft — and it costs no page load. This test already
    // navigates twice, and on a stalling dev server every extra navigation
    // is another chance to fail for reasons having nothing to do with
    // publishing.
    const beforePublish = await serverEssay(speakerPage, REVIEW_COACH_B_ID)
    expect(beforePublish.essay_published_at, 'fixture must start unpublished').toBeNull()
    expect(beforePublish.essay_html, 'an unpublished draft must not reach the speaker').toBe('')

    const essayText = 'Publishing this makes it visible to the speaker.'
    const editable = await openEssayEditor(reviewerPage)
    await editable.click()
    await editable.pressSequentially(essayText)
    await expect(autosaveBadge(reviewerPage)).toHaveAttribute('data-state', 'saved')

    // Exact name: the label walks Publish → Publishing… → Published, so a
    // substring locator would keep matching and assert nothing.
    await reviewerPage.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(reviewerPage.getByRole('button', { name: 'Published', exact: true })).toBeVisible()

    const published = await serverEssay(reviewerPage, REVIEW_COACH_B_ID)
    expect(published.essay_published_at).not.toBeNull()

    // And now the speaker's one page load — the essay is beside the video,
    // through the real read-only panel, for a reviewer whose draft was
    // invisible to them a moment ago.
    await openSpeakerEssayFor(speakerPage, USERS.reviewerB.name)
    await expect(speakerPage.getByTestId('essay-readonly-content')).toContainText(essayText)

    await reviewer.close()
    await speaker.close()
  })

  test('a tab switch mid-debounce must not throw away what was typed', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()
    // ⚠️ LIVE clock here, unlike the two guard tests above — and the reason
    // is worth the paragraph, because the obvious "fix" breaks this test
    // silently.
    //
    // Freezing timers looks right: the bug only exists while a debounced
    // save is pending, so a frozen debounce should pin the test to that
    // branch. It does the opposite. base-ui's Tabs panel unmounts its
    // content through an ANIMATED exit, so with timers frozen the panel
    // never unmounts at all — measured: the editor node was still in the
    // DOM after switching tabs, and zero PUTs were issued, versus one PUT
    // and a removed node on a live clock. No unmount means the cleanup
    // never runs, which means the test exercises none of the fix while
    // looking like it does.
    //
    // So: live clock, and guard the branch explicitly instead. The two
    // assertions before the click prove the debounce has NOT fired yet —
    // if it had, this would fail loudly rather than pass down the branch
    // where an ordinary autosave already saved the text.
    const editable = await openEssayEditor(page)

    const puts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/essay')) puts.push(r.url())
    })

    // The base-ui Tabs panel unmounts its content when inactive, and
    // `useEssayEditor`'s unmount cleanup used to clear the pending debounce
    // WITHOUT flushing it. `useBlocker` does not fire (no route change) and
    // `pagehide` does not fire (no unload), so the words simply vanished —
    // from the server and from the editor both. Found by this test; the fix
    // is the flush-on-unmount in `useEssayEditor.ts`.
    const sentence = 'This sentence must survive a tab switch.'
    await editable.click()
    await editable.pressSequentially(sentence)

    // Branch guard: still dirty, and nothing saved yet. Both must hold, or
    // the tab click below lands after an ordinary autosave and proves
    // nothing about the unmount path.
    await expect(autosaveBadge(page)).toHaveAttribute('data-state', 'dirty')
    expect(puts, 'the debounce must not have fired yet, or this tests the wrong branch').toHaveLength(0)

    await page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Notes' }).click()

    await expect(async () => {
      const essay = await serverEssay(page, REVIEW_COACH_B_ID)
      expect(essay.essay_text).toBe(sentence)
    }).toPass({ timeout: 15_000 })

    // Exactly one PUT, and it came from the unmount — not from a debounce
    // that beat us to it.
    expect(puts, 'the save must have come from the unmount flush').toHaveLength(1)

    // And it is still on screen when the user comes back — which is a
    // second, independent assertion, not a restatement of the first. It is
    // what catches the unmount flush going out through a path that skips
    // RTK Query's cache invalidation: the words would be safe on the server
    // and still missing from the editor for the next 60 seconds.
    const back = await openEssayTabAgain(page)
    await expect(back).toContainText(sentence)

    await context.close()
  })
})

/* ------------------------------------------------------------------ *
 * The read path — reviewer A's published essay. Read-only, so this half
 * is safe to run on all three browser engines.
 * ------------------------------------------------------------------ */

test.describe('a published essay — read path', () => {
  test.describe.configure({ timeout: TEST_TIMEOUT })

  test('the speaker can read the published essay beside the video', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await openSpeakerEssayFor(page, USERS.reviewerA.name)
    await expect(page.getByTestId('essay-readonly-content')).toContainText(ESSAY_COACH_A_TEXT)

    await context.close()
  })

  test('a second reviewer on the same speech cannot reach it by any route', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const page = await context.newPage()

    // STEP-08's acceptance list asks for this to be "verified by direct API
    // call" — the absence of a button in the UI is not evidence the
    // endpoint is closed.
    const peer = await page.request.get(
      `${API_URL}/api/speeches/${SHARED_SPEECH_ID}/essay?review_id=${REVIEW_COACH_A_ID}`,
      { headers: JSON_HEADERS },
    )
    expect(peer.status(), "reviewer B must not read reviewer A's essay").toBe(403)

    // The vacuity guard, in the shape `two-users.spec.ts` established: a
    // world where every essay read 403s would satisfy the assertion above
    // while proving nothing at all.
    const own = await page.request.get(
      `${API_URL}/api/speeches/${SHARED_SPEECH_ID}/essay?review_id=${REVIEW_COACH_B_ID}`,
      { headers: JSON_HEADERS },
    )
    expect(own.status(), 'reviewer B must still read their own').toBe(200)

    await context.close()
  })
})

/** The speaker's route to an essay is two clicks and the order is forced:
 * `EssayReadOnlyPanel` is passed the commentary track's selected review, so
 * until a reviewer is picked it renders "Pick a reviewer to see their
 * essay." and never fetches. */
async function openSpeakerEssayFor(page: Page, reviewerName: string) {
  await page.goto(SPEECH_URL, { waitUntil: DOM_READY, timeout: NAV_TIMEOUT })
  await page
    .getByRole('radiogroup', { name: 'Choose commentary track' })
    .getByRole('radio', { name: reviewerName })
    .click()
  await page.getByRole('tablist', { name: 'Reviewer feedback' }).getByRole('tab', { name: 'Essay' }).click()
}

/** Re-opens the Essay tab without a page load — the panel unmounts when
 * inactive, so the editor is a genuinely new instance on the way back. */
async function openEssayTabAgain(page: Page) {
  await page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Essay' }).click()
  const editable = page.locator('[data-testid="essay-editor-content"] .tiptap')
  await expect(editable).toBeVisible()
  return editable
}
