import { test, expect, type Page } from '@playwright/test'
import { USERS, VOICE } from './fixtures.js'
import { openSpeech } from './voice-test-helpers.js'

/**
 * IMPLEMENTATION-PLANS.md §7.7.6 — the real-browser half of
 * `useKeyboardShortcuts.ts`'s own unit tests. jsdom has no real focus
 * order, no video that actually plays, and no layout, which is exactly
 * why this needs Playwright: `Space`/`J`/`L`/`,`/`.` only mean anything
 * against a real `<video>` element actually advancing its `currentTime`,
 * and the typing guard only means anything against a real
 * `document.activeElement`.
 *
 * Reuses `VOICE.coachSpeechId`/`VOICE.coachReviewId` (`E2EVoiceAnnotationSeeder`)
 * rather than `SHARED_SPEECH_ID` — the latter's video asset is seeded with
 * no real object behind it (`essay-editor.spec.ts`'s docblock: cross-origin
 * `http://` on an `https://` page, `networkState: 3`/`error.code: 4`), so
 * `currentTime` never advances and `Space`/`J`/`L` would have nothing to
 * assert against. The VOICE fixture's video is real (6s, confirmed
 * playable by `voice-annotations.spec.ts`'s own `readyState`/`play()`
 * assertions), and reviewer A's review on it already carries 8 seeded
 * annotations spread across that 6s — enough to exercise `[`/`]` without
 * creating any.
 *
 * The explicit composer never sends HTTP on typing/capture. These checks
 * exercise native typing/navigation guards and C/Alt+C Start capture without
 * clicking Add annotation. They leave End blank and discard local drafts.
 */

async function expectCloseTo(actual: number, expected: number, tolerance = 0.2) {
  expect(Math.abs(actual - expected), `expected ${actual} to be within ${tolerance} of ${expected}`).toBeLessThanOrEqual(
    tolerance,
  )
}

/** Opens the Notes tab (the reviewer tab strip's default) with the video
 * actually decodable — `readyState >= 1` is what `voice-annotations.spec.ts`
 * itself waits for before trusting `currentTime`. */
async function openNotesTab(page: Page): Promise<void> {
  await openSpeech(page, VOICE.coachSpeechId)
  const video = page.getByTestId('speech-video')
  await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)
  // `[`/`]` seek relative to the SEEDED annotation set (8 rows — see the
  // seed-time comment on the `[`/`]` test below) — wait for ALL of them,
  // not just the first, before any test presses a key against the list.
  // `AnnotationComposerPanelInner` genuinely remounts a couple of times
  // while `useMyReviewForSpeech`/`useGetAnnotationsQuery` settle on initial
  // load (confirmed by instrumenting `useKeyboardShortcuts` directly: the
  // very first "visible" moment can catch a remount's fresh, momentarily-
  // empty `serverRows` before its own fetch resolves) — waiting for the
  // full known count, not just item #1, is what actually survives that.
  // The saved list is a folded, six-per-page disclosure now, so its rows are neither all in the
  // DOM-visible tree nor a count to assert. The disclosure's total is the complete dataset the
  // `[`/`]` navigation runs over; it is rendered only after the full annotation fetch settles.
  await expect(page.getByRole('button', { name: 'Saved notes (8)', exact: true })).toBeVisible()
  // Defaults to "notes" already (`SpeechWatch.tsx`'s `<Tabs defaultValue="notes">`)
  // — no click needed, and clicking a tab would itself leave focus on a
  // <button>, which is exactly the activation-target case `Space`'s own
  // test below needs to NOT be in.
  await (page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()))
}

async function videoCurrentTime(page: Page): Promise<number> {
  return page.getByTestId('speech-video').evaluate((el) => (el as HTMLVideoElement).currentTime)
}

async function videoPaused(page: Page): Promise<boolean> {
  return page.getByTestId('speech-video').evaluate((el) => (el as HTMLVideoElement).paused)
}

async function setVideoCurrentTime(page: Page, seconds: number): Promise<void> {
  await page.getByTestId('speech-video').evaluate((el, t) => {
    ;(el as HTMLVideoElement).currentTime = t
  }, seconds)
}

test.describe('keyboard shortcuts (§7.7.6)', () => {
  // Playwright requires the object-destructuring form for the fixtures
  // argument even when unused.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    // A keyboard-only spec has no business running against a
    // touch-emulated project — same guard `app-shell.spec.ts:72` uses for
    // its own Tab-focus assertion, applied to this whole file instead of
    // one branch of it.
    test.skip(testInfo.project.use.hasTouch === true, 'keyboard-only spec; no real focus order on a touch project')
  })

  test('Space toggles play/pause when focus is not on a button', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openNotesTab(page)

    expect(await videoPaused(page)).toBe(true)

    await page.keyboard.press('Space')
    await expect.poll(() => videoPaused(page)).toBe(false)

    await page.keyboard.press('Space')
    await expect.poll(() => videoPaused(page)).toBe(true)

    await context.close()
  })

  test('Space does NOT toggle play/pause when a tab button is focused', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openNotesTab(page)

    // The "Notes" tab button is a real <button role="tab"> — focusing it
    // (without clicking, so the panel stays on Notes) leaves focus there,
    // which is both a typing-guard-irrelevant and an activation-target
    // case: Space must do nothing.
    await page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Notes' }).focus()
    expect(await videoPaused(page)).toBe(true)

    await page.keyboard.press('Space')
    // Give a toggle every chance to have happened before asserting it didn't.
    await page.waitForTimeout(300)
    expect(await videoPaused(page)).toBe(true)

    await context.close()
  })

  test('J/L seek the video ∓5s', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openNotesTab(page)

    await setVideoCurrentTime(page, 5.0)
    await page.keyboard.press('j')
    await expect.poll(() => videoCurrentTime(page)).toBeLessThan(0.5) // clamped at 0, 5 - 5 = 0

    await setVideoCurrentTime(page, 1.0)
    await page.keyboard.press('l')
    const t = await videoCurrentTime(page)
    await expectCloseTo(t, 6.0) // clamped at duration (6s fixture)

    await context.close()
  })

  test(', and . step the video by one nominal frame (1/30s)', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openNotesTab(page)

    await setVideoCurrentTime(page, 3.0)
    await page.keyboard.press(',')
    let t = await videoCurrentTime(page)
    await expectCloseTo(t, 3.0 - 1 / 30, 0.05)

    await setVideoCurrentTime(page, 3.0)
    await page.keyboard.press('.')
    t = await videoCurrentTime(page)
    await expectCloseTo(t, 3.0 + 1 / 30, 0.05)

    await context.close()
  })

  test('[ and ] seek to the previous/next seeded annotation relative to the playhead', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openNotesTab(page)

    // Seeded by E2EVoiceAnnotationSeeder on VOICE.coachReviewId: starts at
    // 0.1, 0.75, 1.4, 2.05, 2.7, 3.35, 4.0, 4.65 (seconds).
    await setVideoCurrentTime(page, 1.0)
    await page.keyboard.press(']')
    let t = await videoCurrentTime(page)
    await expectCloseTo(t, 1.4)

    await page.keyboard.press('[')
    t = await videoCurrentTime(page)
    await expectCloseTo(t, 0.75)

    await context.close()
  })

  test('typing in the essay editor (contenteditable) does not trigger J/L/[/]/bare-C', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openNotesTab(page)

    await setVideoCurrentTime(page, 2.0)
    await page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Essay' }).click()
    const editable = page.locator('[data-testid="essay-editor-content"] .tiptap')
    await editable.click()

    const before = await videoCurrentTime(page)
    for (const key of ['j', 'l', '[', ']', 'c']) {
      await page.keyboard.press(key)
    }
    const after = await videoCurrentTime(page)
    await expectCloseTo(after, before, 0.01)

    // The essay IS a real text-input surface — a bare `c` there must
    // insert the letter, same as any other character. Typed last in the
    // loop above, so it's the only one that could have landed.
    await expect(editable).toContainText('c')
    // Clean up before any autosave debounce fires — see the file docblock.
    await page.keyboard.press('Backspace')
    await expect(editable).not.toContainText('c')

    await context.close()
  })

  test('the annotation composer textarea: bare c inserts the letter; J/L/[/] do not fire', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openNotesTab(page)

    const composer = page.getByTestId('annotation-editor').filter({ hasText: 'New annotation' })
    const textarea = composer.getByRole('textbox', { name: 'Commentary' })
    await textarea.click()

    await setVideoCurrentTime(page, 2.0)
    const before = await videoCurrentTime(page)
    // Typing these INTO a focused textarea must insert the literal
    // characters (that's what a textarea is for) — the guard's job is
    // only to stop them from ALSO seeking the video, never to swallow the
    // keystroke itself. Asserted together: the textarea ends up containing
    // all four literal characters, in order, AND the video never moved.
    for (const key of ['j', 'l', '[', ']']) {
      await page.keyboard.press(key)
    }
    await expect(textarea).toHaveValue('jl[]')
    const after = await videoCurrentTime(page)
    await expectCloseTo(after, before, 0.01)

    // Clear back to empty, then prove bare `c` ALSO just inserts the
    // letter (not a J/L/[/]-style silent no-op, and not a stamp either —
    // that's `Alt+C`'s job, covered by the next test).
    await textarea.fill('')
    await page.keyboard.press('c')
    await expect(textarea).toHaveValue('c')
    // Typing remains local until Add annotation is clicked.
    await page.keyboard.press('Backspace')
    await expect(textarea).toHaveValue('')

    await context.close()
  })

  test('Alt+C inside the composer captures Start without choosing End or submitting', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openNotesTab(page)

    const composer = page.getByTestId('annotation-editor').filter({ hasText: 'New annotation' })
    const startTimeInput = composer.getByRole('textbox', { name: 'Start', exact: true })
    await expect(startTimeInput).toHaveValue('')

    await setVideoCurrentTime(page, 3.3)
    const textarea = composer.getByRole('textbox', { name: 'Commentary' })
    await textarea.click()

    await page.keyboard.press('Alt+C')

    await expect(startTimeInput).toBeEnabled()
    const stamped = await startTimeInput.inputValue()
    expect(stamped).toMatch(/^0:03\.\d{3}$/)
    await expect(composer.getByRole('textbox', { name: 'End', exact: true })).toHaveValue('')
    await expect(composer.getByRole('button', { name: 'Add annotation' })).toBeDisabled()
    await composer.getByRole('button', { name: 'Discard new note' }).click()

    await context.close()
  })
})
