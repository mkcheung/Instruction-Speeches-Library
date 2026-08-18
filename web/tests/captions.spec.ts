import { test, expect, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { API_URL, APP_URL, CAPTIONS, USERS } from './fixtures.js'

/**
 * STEP-09-VERIFICATION-PLAN.md §5 — the real-browser captions spec.
 *
 * Requires `api/database/seeders/E2ECaptionsSeeder.php` to have been run
 * (after `E2ESeeder`) against the E2E stack:
 *   docker compose -p speechcoach-e2e -f compose.yaml -f compose.e2e.yaml \
 *     exec -T app php artisan db:seed --class=Database\\Seeders\\E2ECaptionsSeeder --force
 *
 * ⚠️ Whole file is Chromium-only and serial — §5's own instruction: "make
 * the entire first captions.spec.ts Chromium-only and serialize its
 * mutations. With fullyParallel, a read-only Firefox/WebKit test can
 * otherwise observe a Chromium reset." Scenarios B, D, E and F each mutate
 * a fixture row; A and C are read-only but share the file's serial mode
 * anyway per that same instruction.
 *
 * ⚠️ KNOWN, DOCUMENTED SUBSTITUTION (Scenario B/D): §4.1's projection
 * convergence token (`content_revision` / `caption_revision`) is NOT built
 * in this codebase yet — `CaptionResource`/`TranscriptResource` expose no
 * such field (verified against `api/app/Http/Resources/CaptionResource.php`
 * and `TranscriptResource.php`). Per this task's explicit instruction, the
 * closest honest, real signal is used instead: poll the canonical VTT via
 * `GET /captions`, then poll the transcript BODY via `GET /transcript`
 * until it contains the corrected/new text. This proves the same real
 * end-to-end pipeline (PUT -> CaptionService -> RederiveTranscript ->
 * speech_transcripts.body) without inventing a field that doesn't exist.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 })
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'mutates shared caption fixtures; see the file-level comment above',
)

const JSON_HEADERS = {
  Accept: 'application/json',
  Origin: APP_URL,
} as const

const DOM_READY = 'domcontentloaded' as const
const NAV_TIMEOUT = 120_000
const POLL_TIMEOUT = 25_000

interface CaptionsPayload {
  status: 'ready' | 'processing' | 'uploading' | 'failed' | 'unavailable'
  vtt: string | null
  failure_code: string | null
  asset_id: number | null
}

interface TranscriptPayload {
  body: string
  segments: Array<{ start: number; end: number; text: string }>
  source: string | null
  model: string | null
}

function speechUrl(id: number): string {
  return `${APP_URL}/speeches/${id}`
}

async function fetchCaptions(page: Page, speechId: number): Promise<CaptionsPayload> {
  const res = await page.request.get(`${API_URL}/api/speeches/${speechId}/captions`, { headers: JSON_HEADERS })
  if (!res.ok()) throw new Error(`GET captions ${speechId} failed: ${res.status()}`)
  return ((await res.json()) as { captions: CaptionsPayload }).captions
}

async function fetchTranscript(page: Page, speechId: number): Promise<TranscriptPayload> {
  const res = await page.request.get(`${API_URL}/api/speeches/${speechId}/transcript`, { headers: JSON_HEADERS })
  if (!res.ok()) throw new Error(`GET transcript ${speechId} failed: ${res.status()}`)
  return ((await res.json()) as { transcript: TranscriptPayload }).transcript
}

/**
 * `Reset the dedicated edit fixture` (§5, Scenario B step 1) — the caption
 * seeder is idempotent (its own docblock: "reset its mutable rows and
 * overwrite its media objects"), so re-running it undoes Scenario B's own
 * previous edit. Goes through the dedicated E2E compose project
 * (`speechcoach-e2e`, per `scripts/e2e-stack.sh`) from the repository
 * root — never a bare `docker compose` and never a hard-coded container
 * name, matching §3.1's "every test-side reset calls the same
 * harness/project."
 */
function resetCaptionFixtures(): void {
  const repoRoot = path.resolve(__dirname, '..', '..')
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'speechcoach-e2e',
      '-f',
      'compose.yaml',
      '-f',
      'compose.e2e.yaml',
      'exec',
      '-T',
      'app',
      'php',
      'artisan',
      'db:seed',
      '--class=Database\\Seeders\\E2ECaptionsSeeder',
      '--force',
    ],
    { cwd: repoRoot, stdio: 'ignore' },
  )
}

async function openSpeech(page: Page, id: number): Promise<void> {
  await page.goto(speechUrl(id), { waitUntil: DOM_READY, timeout: NAV_TIMEOUT })
}

/**
 * `tsconfig.node.json` (this test project) carries no DOM lib — Playwright
 * still runs `.evaluate()` callbacks in the real browser regardless, but
 * `HTMLVideoElement`/`TextTrack` aren't nameable TS types here. These
 * minimal duck-typed shapes stand in for them; the `as unknown as ...`
 * casts below are erased at compile time (never a runtime reference), so
 * the callback is still exactly what actually runs in the page.
 */
interface BrowserTextTrackCue {
  text: string
}
interface BrowserTextTrack {
  kind: string
  label: string
  language: string
  mode: string
  cues: ArrayLike<BrowserTextTrackCue> | null
}
interface BrowserVideoElement {
  readyState: number
  currentTime: number
  error: unknown
  textTracks: ArrayLike<BrowserTextTrack>
}

/** The real `<video>` — §5's `data-testid="speech-video"` seam
 * (`VideoPlayer.tsx`), waited to at least `HAVE_METADATA` so
 * `videoWidth`/`duration`/`textTracks` are populated. */
async function waitForVideo(page: Page): Promise<Locator> {
  const video = page.getByTestId('speech-video')
  await expect(video).toBeVisible()
  await expect
    .poll(async () => video.evaluate((el) => (el as unknown as BrowserVideoElement).readyState), {
      timeout: POLL_TIMEOUT,
      message: 'video never reached HAVE_METADATA',
    })
    .toBeGreaterThanOrEqual(1)
  return video
}

interface TextTrackInfo {
  kind: string
  label: string
  language: string
  mode: string
  cueCount: number
  cueTexts: string[]
}

async function textTracksInfo(video: Locator): Promise<TextTrackInfo[]> {
  return video.evaluate((el) =>
    Array.from((el as unknown as BrowserVideoElement).textTracks).map((t) => ({
      kind: t.kind,
      label: t.label,
      language: t.language,
      mode: t.mode,
      cueCount: t.cues ? t.cues.length : 0,
      cueTexts: t.cues ? Array.from(t.cues).map((c) => c.text) : [],
    })),
  )
}

async function setCaptionsShowing(page: Page, want: boolean): Promise<void> {
  const toggle = page.getByTestId('captions-toggle')
  await expect(toggle).toBeVisible()
  const pressed = (await toggle.getAttribute('aria-pressed')) === 'true'
  if (pressed !== want) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', String(want))
}

/** Excludes `overlay-stack`/`overlay-positioner` (both also match the
 * `^"overlay-"` prefix) — only per-annotation nodes are wanted. */
function annotationOverlay(page: Page, bodyText: string): Locator {
  return page
    .locator('[data-testid^="overlay-"]:not([data-testid="overlay-stack"]):not([data-testid="overlay-positioner"])')
    .filter({ hasText: bodyText })
}

/* ------------------------------------------------------------------ *
 * Scenario A — native captions and commentary are independent.
 * ------------------------------------------------------------------ */

test('Scenario A — native captions and annotations toggle independently', async ({ browser }) => {
  const context = await browser.newContext({ storageState: USERS.speaker.storageState })
  const page = await context.newPage()
  await openSpeech(page, CAPTIONS.displaySpeechId)

  const video = await waitForVideo(page)

  // Step 2: exactly one kind="captions" track, expected language/label,
  // non-null cues, seeded cue text — plus the real <track> element.
  const tracks = await textTracksInfo(video)
  const captionTracks = tracks.filter((t) => t.kind === 'captions')
  expect(captionTracks, 'exactly one captions track').toHaveLength(1)
  expect(captionTracks[0].label).toBe('English')
  expect(captionTracks[0].language).toBe('en')
  expect(captionTracks[0].cueCount).toBeGreaterThan(0)
  expect(captionTracks[0].cueTexts.join(' ')).toContain('welcome to the toastmasters showcase')

  const trackEl = page.locator('[data-testid="speech-video"] track[kind="captions"]')
  await expect(trackEl).toHaveCount(1)
  expect(await trackEl.evaluate((el) => el.hasAttribute('default')), 'track element must be default').toBe(true)

  // Step 3: toggle CC, assert BOTH aria-pressed and TextTrack.mode.
  const readCaptionMode = async () =>
    video.evaluate((el) => {
      const t = Array.from((el as unknown as BrowserVideoElement).textTracks).find((tt) => tt.kind === 'captions')
      return t?.mode
    })

  await setCaptionsShowing(page, true)
  expect(await readCaptionMode()).toBe('showing')
  await setCaptionsShowing(page, false)
  expect(await readCaptionMode()).toBe('disabled')
  await setCaptionsShowing(page, true)
  expect(await readCaptionMode()).toBe('showing')

  // Step 4: select reviewer A's commentary, seek into the overlapping
  // cue/annotation window (cue1 0.5-2.5, annotation 1.0-2.5).
  await page
    .getByRole('radiogroup', { name: 'Choose commentary track' })
    .getByRole('radio', { name: USERS.reviewerA.name })
    .click()
  await video.evaluate((el) => {
    ;(el as unknown as BrowserVideoElement).currentTime = 1.2
  })

  await expect
    .poll(async () => (await textTracksInfo(video)).some((t) => t.kind === 'metadata'), {
      timeout: POLL_TIMEOUT,
    })
    .toBe(true)

  const overlay = annotationOverlay(page, CAPTIONS.displayAnnotationBody)
  await expect(overlay).toBeVisible()
  // Step 5: require data-visible=true before measuring.
  await expect(overlay).toHaveAttribute('data-visible', 'true')

  // Step 5 (cont'd): with captions showing, geometry must be upper-half,
  // anchor=top.
  const positioner = page.getByTestId('overlay-positioner')
  await expect(positioner).toHaveAttribute('data-anchor', 'top')

  const positionerBoxTop = await positioner.boundingBox()
  const overlayBoxTop = await overlay.boundingBox()
  expect(positionerBoxTop, 'positioner must have a box').not.toBeNull()
  expect(overlayBoxTop, 'overlay must have a box').not.toBeNull()
  const stageMidYTop = positionerBoxTop!.y + positionerBoxTop!.height / 2
  const overlayCenterYTop = overlayBoxTop!.y + overlayBoxTop!.height / 2
  expect(overlayCenterYTop, 'overlay center must be in the upper half while captions show').toBeLessThan(
    stageMidYTop,
  )

  // Step 6: captions off — commentary stays, overlay moves to lower half.
  await setCaptionsShowing(page, false)
  await expect(positioner).toHaveAttribute('data-anchor', 'default')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('data-visible', 'true')

  const positionerBoxBottom = await positioner.boundingBox()
  const overlayBoxBottom = await overlay.boundingBox()
  expect(positionerBoxBottom).not.toBeNull()
  expect(overlayBoxBottom).not.toBeNull()
  const stageMidYBottom = positionerBoxBottom!.y + positionerBoxBottom!.height / 2
  const overlayCenterYBottom = overlayBoxBottom!.y + overlayBoxBottom!.height / 2
  expect(overlayCenterYBottom, 'overlay center must be in the lower half with captions off').toBeGreaterThan(
    stageMidYBottom,
  )

  // Step 7: captions on, then "No commentary" — annotation disappears,
  // caption track stays showing.
  await setCaptionsShowing(page, true)
  await page
    .getByRole('radiogroup', { name: 'Choose commentary track' })
    .getByRole('radio', { name: 'No commentary' })
    .click()
  await expect(overlay).toBeHidden()
  expect(await readCaptionMode()).toBe('showing')

  await context.close()
})

/* ------------------------------------------------------------------ *
 * Scenario B — edit, persist, and replace the native cue.
 * ------------------------------------------------------------------ */

test('Scenario B — editing a cue persists, re-derives, and survives reload', async ({ browser }) => {
  resetCaptionFixtures()

  const context = await browser.newContext({ storageState: USERS.speaker.storageState })
  const page = await context.newPage()
  await openSpeech(page, CAPTIONS.editSpeechId)

  await page.getByRole('tablist', { name: 'Reviewer feedback' }).getByRole('tab', { name: 'Transcript' }).click()

  const cueButton = page.getByTestId('caption-cue-cue-0')
  await expect(cueButton).toContainText(CAPTIONS.editUncorrectedPhrase)
  await cueButton.click()

  const textarea = page.getByTestId('caption-cue-input-cue-0')
  await expect(textarea).toBeVisible()
  // Accessible label including the cue's timestamp (§5's seam list).
  await expect(page.getByRole('textbox', { name: /Caption text at/ })).toBeVisible()

  const corrected = `${CAPTIONS.editUncorrectedPhrase.replace('toast masters', 'Toastmasters')} opening remarks`
  const putPromise = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && res.url().includes(`/api/speeches/${CAPTIONS.editSpeechId}/captions`),
  )
  await textarea.fill(corrected)
  await textarea.blur()

  const putResponse = await putPromise
  expect(putResponse.status(), 'the caption PUT must succeed').toBe(200)
  const putBody = (await putResponse.json()) as { captions: CaptionsPayload }
  expect(putBody.captions.vtt).toContain('Toastmasters')

  // Step 3: poll GET /captions until the canonical VTT has the correction,
  // then poll GET /transcript until its body reflects it too (the honest
  // substitute for the not-yet-built caption_revision — see file header).
  await expect
    .poll(async () => (await fetchCaptions(page, CAPTIONS.editSpeechId)).vtt, { timeout: POLL_TIMEOUT })
    .toContain('Toastmasters')

  await expect
    .poll(async () => (await fetchTranscript(page, CAPTIONS.editSpeechId)).body, { timeout: POLL_TIMEOUT })
    .toContain('Toastmasters')

  // Step 4: native cue text changes; still exactly one caption track.
  const video = await waitForVideo(page)
  await expect
    .poll(
      async () => {
        const tracks = await textTracksInfo(video)
        const captions = tracks.filter((t) => t.kind === 'captions')
        return captions.length === 1 ? captions[0].cueTexts.join(' ') : null
      },
      { timeout: POLL_TIMEOUT },
    )
    .toContain('Toastmasters')

  const tracksAfterEdit = (await textTracksInfo(video)).filter((t) => t.kind === 'captions')
  expect(tracksAfterEdit, 'still exactly one captions track after the edit').toHaveLength(1)

  // Step 5: reload to prove durability.
  await page.reload({ waitUntil: DOM_READY, timeout: NAV_TIMEOUT })
  await page.getByRole('tablist', { name: 'Reviewer feedback' }).getByRole('tab', { name: 'Transcript' }).click()
  await expect(page.getByTestId('caption-cue-cue-0')).toContainText('Toastmasters')

  const videoAfterReload = await waitForVideo(page)
  await expect
    .poll(
      async () => {
        const tracks = await textTracksInfo(videoAfterReload)
        const captions = tracks.filter((t) => t.kind === 'captions')
        return captions.length === 1 ? captions[0].cueTexts.join(' ') : null
      },
      { timeout: POLL_TIMEOUT },
    )
    .toContain('Toastmasters')

  await context.close()
})

/* ------------------------------------------------------------------ *
 * Scenario C — transcript click seeks the real video.
 * ------------------------------------------------------------------ */

test('Scenario C — clicking a transcript line seeks the real video', async ({ browser }) => {
  const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
  const page = await context.newPage()
  await openSpeech(page, CAPTIONS.reviewerAccessSpeechId)

  const video = await waitForVideo(page)

  await page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Transcript' }).click()

  const lines = page.getByRole('list', { name: 'Speech transcript' }).getByRole('button')
  await expect(lines).toHaveCount(2)
  // The second cue in `twoCueVtt('this is the second fixture speech',
  // 'click any line below to seek the video')` starts at 3.0s.
  await lines.nth(1).click()

  await expect
    .poll(async () => video.evaluate((el) => (el as unknown as BrowserVideoElement).currentTime), {
      timeout: POLL_TIMEOUT,
    })
    .toBeGreaterThanOrEqual(2.9)

  await context.close()
})

/* ------------------------------------------------------------------ *
 * Scenario D — PostgreSQL search, including asynchronous edit visibility.
 * ------------------------------------------------------------------ */

test('Scenario D — search scoping and pre-warmed cache convergence after an edit', async ({ browser }) => {
  const context = await browser.newContext({ storageState: USERS.speaker.storageState })
  const page = await context.newPage()

  await page.goto(`${APP_URL}/search`, { waitUntil: DOM_READY, timeout: NAV_TIMEOUT })
  const searchInput = page.getByLabel('Phrase')

  // Step 1: stable phrase scoping.
  await searchInput.fill(CAPTIONS.searchDistinctivePhrase)
  await expect(page.getByRole('link', { name: 'E2E search owner-match speech', exact: true })).toBeVisible({
    timeout: POLL_TIMEOUT,
  })
  await expect(page.getByRole('link', { name: 'E2E search owner-non-match speech', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'E2E search other-user-match speech', exact: true })).toHaveCount(0)

  // Step 2: the future corrected phrase, searched before the edit — must
  // be absent. Chosen to be distinctive and not present in any fixture's
  // seeded VTT.
  const futurePhrase = 'zephyrquartz melody'
  await searchInput.fill(futurePhrase)
  await expect(page.getByText(`No speeches matched "${futurePhrase}"`)).toBeVisible({ timeout: POLL_TIMEOUT })
  await expect(page.getByRole('link', { name: 'E2E search-edit speech', exact: true })).toHaveCount(0)

  // Navigate to the search-edit fixture via real in-app (client-side) Link
  // navigation — never `page.goto`/`page.reload`, which would tear down
  // the SPA and destroy the RTK Query cache this scenario is testing.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My speeches' }).click()
  await expect(page).toHaveURL(`${APP_URL}/speeches`)
  const card = page.locator('[data-slot="card"]').filter({ hasText: 'E2E search-edit speech' })
  await card.getByRole('link', { name: 'Watch' }).click()
  await expect(page).toHaveURL(speechUrl(CAPTIONS.searchEditSpeechId))

  await page.getByRole('tablist', { name: 'Reviewer feedback' }).getByRole('tab', { name: 'Transcript' }).click()
  const cueButton = page.getByTestId('caption-cue-cue-1')
  await expect(cueButton).toBeVisible()
  await cueButton.click()
  const textarea = page.getByTestId('caption-cue-input-cue-1')
  await expect(textarea).toBeVisible()

  const putPromise = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      res.url().includes(`/api/speeches/${CAPTIONS.searchEditSpeechId}/captions`),
  )
  await textarea.fill(`closing thoughts for today's meeting ${futurePhrase}`)
  await textarea.blur()
  const putResponse = await putPromise
  expect(putResponse.status()).toBe(200)

  // Step 3: wait for projection convergence (the same body-content
  // substitute as Scenario B), then return to the already-queried phrase
  // via client-side nav only, and require the edited speech to appear.
  await expect
    .poll(async () => (await fetchTranscript(page, CAPTIONS.searchEditSpeechId)).body, { timeout: POLL_TIMEOUT })
    .toContain(futurePhrase)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Search' }).click()
  await expect(page).toHaveURL(`${APP_URL}/search`)
  await page.getByLabel('Phrase').fill(futurePhrase)

  await expect(page.getByRole('link', { name: 'E2E search-edit speech', exact: true })).toBeVisible({
    timeout: POLL_TIMEOUT,
  })

  await context.close()
})

/* ------------------------------------------------------------------ *
 * Scenario E — processing and failure never block playback.
 * ------------------------------------------------------------------ */

test('Scenario E — processing and failed captions never block playback', async ({ browser }) => {
  const context = await browser.newContext({ storageState: USERS.speaker.storageState })
  const page = await context.newPage()

  // Step 1: processing fixture.
  await openSpeech(page, CAPTIONS.processingSpeechId)
  await waitForVideo(page)
  await expect(page.getByText('Captions processing…', { exact: false }).first()).toBeVisible()
  await expect(page.getByTestId('captions-toggle')).toHaveCount(0)

  await page.getByRole('tablist', { name: 'Reviewer feedback' }).getByRole('tab', { name: 'Transcript' }).click()
  await expect(page.getByText('Captions are still processing…')).toBeVisible()
  await expect(page.locator('[data-testid^="caption-cue-input-"]')).toHaveCount(0)

  // Step 2: failed fixture — same playable video, safe failure message,
  // Retry.
  await openSpeech(page, CAPTIONS.failedSpeechId)
  const video = await waitForVideo(page)
  await page.getByRole('tablist', { name: 'Reviewer feedback' }).getByRole('tab', { name: 'Transcript' }).click()
  await expect(page.getByRole('alert')).toContainText('Caption generation failed')
  const retryButton = page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  // Step 3: click Retry, wait for the real POST, poll failed -> processing.
  const before = await fetchCaptions(page, CAPTIONS.failedSpeechId)
  expect(before.status).toBe('failed')

  const postPromise = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/retry'),
  )
  await retryButton.click()
  const postResponse = await postPromise
  expect(postResponse.status()).toBe(200)

  await expect
    .poll(async () => (await fetchCaptions(page, CAPTIONS.failedSpeechId)).status, { timeout: POLL_TIMEOUT })
    .toBe('processing')

  // Playback stays usable throughout.
  expect(await video.evaluate((el) => (el as unknown as BrowserVideoElement).error)).toBeNull()

  await context.close()
})

/* ------------------------------------------------------------------ *
 * Scenario F — reviewer surface, authentication seam, and setting.
 * ------------------------------------------------------------------ */

test('Scenario F — reviewer read-only surface, auth seam, and owner off-switch', async ({ browser }) => {
  // Step 1: reviewer A on the reviewer-access speech — no editable caption
  // controls.
  {
    const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const page = await context.newPage()
    await openSpeech(page, CAPTIONS.reviewerAccessSpeechId)
    await waitForVideo(page)
    await page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Transcript' }).click()
    await expect(page.getByTestId('caption-settings-toggle')).toHaveCount(0)
    await expect(page.locator('[data-testid^="caption-cue-input-"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="caption-cue-cue-"]')).toHaveCount(0)
    await context.close()
  }

  // Step 2: direct authentication-seam check on the display speech —
  // reviewer B (invited, not accepted) denied; reviewer A (published)
  // allowed, as the vacuity guard.
  {
    const contextB = await browser.newContext({ storageState: USERS.reviewerB.storageState })
    const pageB = await contextB.newPage()
    const deniedCaptions = await pageB.request.get(
      `${API_URL}/api/speeches/${CAPTIONS.displaySpeechId}/captions`,
      { headers: JSON_HEADERS },
    )
    expect(deniedCaptions.status(), 'an invited-not-accepted reviewer must not read captions').toBe(403)
    const deniedTranscript = await pageB.request.get(
      `${API_URL}/api/speeches/${CAPTIONS.displaySpeechId}/transcript`,
      { headers: JSON_HEADERS },
    )
    expect(deniedTranscript.status(), 'an invited-not-accepted reviewer must not read the transcript').toBe(403)
    await contextB.close()

    const contextA = await browser.newContext({ storageState: USERS.reviewerA.storageState })
    const pageA = await contextA.newPage()
    const allowed = await pageA.request.get(`${API_URL}/api/speeches/${CAPTIONS.displaySpeechId}/captions`, {
      headers: JSON_HEADERS,
    })
    expect(allowed.status(), 'the vacuity guard: a published reviewer must still read captions').toBe(200)
    await contextA.close()
  }

  // Step 3: owner disables/re-enables automation on a ready speech.
  {
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()
    await openSpeech(page, CAPTIONS.displaySpeechId)
    await waitForVideo(page)
    await page.getByRole('tablist', { name: 'Reviewer feedback' }).getByRole('tab', { name: 'Transcript' }).click()

    const before = await fetchCaptions(page, CAPTIONS.displaySpeechId)
    expect(before.status).toBe('ready')
    const assetIdBefore = before.asset_id

    const toggle = page.getByTestId('caption-settings-toggle')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    // Reload to prove persistence and retained VTT/transcript.
    await page.reload({ waitUntil: DOM_READY, timeout: NAV_TIMEOUT })
    await page.getByRole('tablist', { name: 'Reviewer feedback' }).getByRole('tab', { name: 'Transcript' }).click()
    await expect(page.getByTestId('caption-settings-toggle')).toHaveAttribute('aria-pressed', 'false')
    const afterDisable = await fetchCaptions(page, CAPTIONS.displaySpeechId)
    expect(afterDisable.status, 'ready VTT must still be served while disabled').toBe('ready')
    expect(afterDisable.vtt).toContain('welcome to the toastmasters showcase')

    // Re-enable — the row must not be duplicated/reprocessed.
    await page.getByTestId('caption-settings-toggle').click()
    await expect(page.getByTestId('caption-settings-toggle')).toHaveAttribute('aria-pressed', 'true')

    await expect
      .poll(async () => (await fetchCaptions(page, CAPTIONS.displaySpeechId)).asset_id, { timeout: POLL_TIMEOUT })
      .toBe(assetIdBefore)
    const afterReenable = await fetchCaptions(page, CAPTIONS.displaySpeechId)
    expect(afterReenable.status, 're-enabling an already-ready speech must be an idempotent no-op').toBe('ready')

    await context.close()
  }
})
