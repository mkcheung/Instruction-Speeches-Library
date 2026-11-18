import { writeFile } from 'node:fs/promises'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { APP_URL, FIXTURE_PASSWORD, USERS, VOICE } from './fixtures.js'
import { installDeterministicRecorder } from './voice-test-helpers.js'
import { routeIsolatedFrontend } from './isolated-frontend.js'
import { notebookUser, type NotebookFixtureOptions, type ScrubWire } from './notebook-fixtures.js'

/**
 * STEP-15 / IMPLEMENTATION-PLANS.md §7.7.4, CP-15-accessibility-gates.md.
 *
 * The PERMANENT CI accessibility gate — distinct from the one-time
 * `_axe-baseline-capture.spec.ts` (deliberately excluded from CI, never add
 * it to ci.yml's explicit spec list; that file's only job was capturing
 * `accessibility-baseline/2026-10-17-baseline.json` against the code as it
 * stood before any §7.7 fix landed).
 *
 * Scans the same three screens the baseline capture did (plus the logged-out
 * landing page, added with its redesign; PLAN-LANDING-PAGE.md §1), with the same
 * `AxeBuilder({ page }).withTags(AXE_TAGS)` pattern and the same `.video-js`
 * exclusion (Video.js's own control surface — confirmed third-party, its
 * only two touch points in this codebase are a CSS import and a className
 * assignment in VideoPlayer.tsx; CP-15 §4: scope the scan around it rather
 * than disabling a rule globally).
 *
 * Gates on impact, not count (CP-15's own explicit instruction — "Gate on
 * what genuinely blocks someone... Don't gate on the violation count"):
 * only `critical`/`serious` fail the test. `moderate`/`minor` are logged
 * (so they're visible, not silently dropped) but never fail CI — gating on
 * every violation, including ones with no real-world blocking impact,
 * produces the same noise/decay problem as a flaky test.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const EXCLUDE_SELECTORS = ['.video-js']
const GATING_IMPACTS = new Set(['critical', 'serious'])

async function login(page: Page, email: string): Promise<void> {
  // dev-stack-staleness-and-vite-stall.md: the Vite dev server behind
  // app.speechcoach.test stalls 60s-4min intermittently under host load.
  // 120s nav timeouts, same budget auth.setup.ts / the baseline capture
  // spec use for the same reason.
  await page.goto(`${APP_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('textbox', { name: 'Email' }).fill(email, { timeout: 120_000 })
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(FIXTURE_PASSWORD, { timeout: 120_000 })
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 120_000 })
}

async function scanAndAssert(page: Page, screenLabel: string): Promise<void> {
  // Let finite colour transitions finish first: a button fading in is otherwise scanned at blended colours
  // (observed in CI as a 1.05:1 "violation" on `.workspace-notebook-control` that vanished on retry). Nothing
  // about the axe tags, exclusions or impact gate below changes.
  await page.evaluate(async () => {
    for (let round = 0; round < 3; round++) {
      const animations = document.getAnimations().filter((animation) => animation.playState === 'running'
        && Number.isFinite(animation.effect?.getComputedTiming().endTime))
      if (!animations.length) break
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
    }
  })
  const builder = new AxeBuilder({ page }).withTags(AXE_TAGS)
  for (const selector of EXCLUDE_SELECTORS) {
    builder.exclude(selector)
  }
  const results = await builder.analyze()

  const gating = results.violations.filter((v) => GATING_IMPACTS.has(v.impact ?? ''))
  const nonGating = results.violations.filter((v) => !GATING_IMPACTS.has(v.impact ?? ''))

  // Logged unconditionally (not just on failure) so a future moderate/minor
  // finding is visible in CI output without anyone having to go looking —
  // same "the failure message alone is unreadable" reasoning CP-15 gives
  // for logging before asserting.
  if (nonGating.length) {
    console.log(
      `[accessibility.spec.ts] ${screenLabel}: ${nonGating.length} non-gating (moderate/minor) violation(s), not failing CI:`,
      JSON.stringify(nonGating, null, 2),
    )
  }

  // The full violation list, not just a length, so a regression is
  // diagnosable from CI output alone — naming the rule, the impact, and
  // the element — without anyone needing to reproduce it locally first.
  if (gating.length) {
    console.log(
      `[accessibility.spec.ts] ${screenLabel}: ${gating.length} critical/serious violation(s):`,
      JSON.stringify(gating, null, 2),
    )
  }

  expect(gating, `${screenLabel}: critical/serious accessibility violations (see console output above)`).toEqual([])
}

test.describe.configure({ mode: 'serial' })

test('annotation (authoring) screen has no critical/serious accessibility violations', async ({ page }) => {
  await login(page, USERS.reviewerA.email)

  await page.goto(`${APP_URL}/speeches/${VOICE.coachSpeechId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await expect(page.getByTestId('speech-video')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('tablist', { name: 'Your feedback' })).toBeVisible({ timeout: 30_000 })

  // Scan once as the page loads (collapsed state)...
  await scanAndAssert(page, 'annotation/collapsed')

  // ...and again with an annotation's inline editor open — CP-15's "scan
  // more than once" nuance, since this screen's whole point is changing
  // over time (CP-06). Best-effort: which row is first depends on seed
  // order, same as the baseline capture script.
  // Saved notes starts folded; open it, then use the first text row's Edit
  // (accessible name "Edit, annotation at <time>"; voice rows say "Edit transcript").
  const savedToggle = page.getByRole('button', { name: /^Saved notes \(\d+\)$/ })
  await expect(savedToggle).toBeVisible({ timeout: 30_000 })
  await savedToggle.click()
  await scanAndAssert(page, 'annotation/saved-notes-open')
  const editButton = page.getByRole('button', { name: /^Edit, annotation at / }).first()
  if ((await editButton.count()) > 0) {
    await editButton.click()
    await expect(page.getByTestId('annotation-editor').last()).toBeVisible({ timeout: 10_000 })
    await scanAndAssert(page, 'annotation/editor-open')
  }
})

test('playback screen has no critical/serious accessibility violations', async ({ page }) => {
  await login(page, USERS.speaker.email)

  await page.goto(`${APP_URL}/speeches/${VOICE.coachSpeechId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await expect(page.getByTestId('speech-video')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('tablist', { name: 'Speech tools' })).toBeVisible({ timeout: 30_000 })

  await scanAndAssert(page, 'playback/default')
})

test('public profile/timeline screen has no critical/serious accessibility violations', async ({ page }) => {
  await login(page, USERS.reviewerA.email)

  await page.goto(`${APP_URL}/u/${USERS.speaker.username}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await expect(page.getByRole('heading', { name: USERS.speaker.name, level: 1 })).toBeVisible({ timeout: 30_000 })

  await scanAndAssert(page, 'profile-timeline/default')
})

test('landing page has no critical/serious accessibility violations', async ({ page }) => {
  // Act II's sticky notes slide in on scroll (a CSS scroll-driven animation),
  // so without scrolling they rest at opacity 0 and axe can only file their
  // colour contrast as "incomplete". Reduced motion renders them static and
  // fully visible, which is the state whose contrast actually matters.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Logged OUT: no login() call, and this file sets no storageState, so the
  // test's fresh context has no session and `/` renders the landing page
  // instead of redirecting. Same 120s 'domcontentloaded' budget as login(),
  // for the same Vite-stall reason.
  await page.goto(`${APP_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await expect(
    page.getByRole('heading', { level: 1, name: 'Instruction Speeches Library', exact: true }),
  ).toBeVisible({ timeout: 120_000 })

  // The scenes come from a lazy chunk. Scan only once both are in, so axe
  // sees the finished page (their role="img" names included), not the empty
  // frames that stand in while the chunk loads.
  await expect(
    page.getByRole('img', {
      name: 'A nervous speaker shakes behind a lectern, alone on a big empty stage in front of rows of empty seats',
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByRole('img', {
      name: 'The same speaker, now confident, shouts with both arms raised in a spotlight in the middle of a packed theater, with a cheering crowd on every side',
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 })

  await scanAndAssert(page, 'landing')
})

/**
 * Isolated frontend accessibility checks; no auth.setup, stored cookies or real
 * backend mutations. All API-origin traffic is fulfilled here, including login
 * and CSRF. This proves rendered frontend accessibility, not real authentication.
 * Run with --grep 'option C presentation' --no-deps on the desired browser.
 * Optional WORKSPACE_USE_BUILT_ASSETS=1 serves only the exact current dist
 * artifact. Complete the build first and keep dist unchanged throughout a run.
 */
async function isolateWorkspaceAxeApi(context: BrowserContext, notebook?: NotebookFixtureOptions) {
  const user = {
    id: 'workspace-axe-member', email: USERS.speaker.email, first_name: 'Morgan', last_name: 'Member',
    display_name: 'Morgan Member', username: 'workspace-axe-member', roles: [], email_verified: true,
    onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 0, quota_bytes: 1_000_000, uploads_in_flight: 0,
  }
  const review = {
    id: 1, status: 'invited', invitation_message: 'Please share your thoughts on my opening and pacing.',
    allow_preview: false, prior_commentary_shared: false, invited_at: '2026-10-01T12:00:00Z',
    responded_at: null, first_published_at: null, last_published_at: null,
    last_transition_at: '2026-10-01T12:00:00Z', revoked_at: null, revocation_reason: null,
    speech: { id: 9, ulid: 'workspace-axe-speech', title: 'Finding a clear voice', owner_name: 'Avery Speaker' },
  }
  const { unexpected } = await routeIsolatedFrontend(context, {
    notebook, initiallyAuthenticated: Boolean(notebook), loginUser: user,
    fallback: async ({ request, url, json, authenticated, unexpected }) => {
      if (request.method() === 'GET') {
        switch (url.pathname) {
          case '/api/me': return json(authenticated ? { user: notebook ? notebookUser(notebook) : user } : { message: 'Unauthenticated.' }, authenticated ? 200 : 401)
          case '/api/reviews': return json({
            invited: [review], in_progress: [{ ...review, id: 2, status: 'in_progress' }],
            published: [{ ...review, id: 3, status: 'published', last_published_at: '2026-10-01T12:00:00Z' }],
            revoked: [{ ...review, id: 4, revoked_at: '2026-10-01T12:00:00Z', revocation_reason: 'Review closed.' }],
          })
          case '/api/notifications': return json({ notifications: [{
            id: 'workspace-notification', type: 'review.invited', read_at: null, created_at: '2026-10-01T12:00:00Z',
            data: { type: 'review.invited', actor_name: 'Avery Speaker', speech_title: 'Finding a clear voice', url: `${APP_URL}/dashboard` },
          }], unread_count: 1 })
          case '/api/connections': return json({ connections: [{
            id: 1, state: 'pending', initiated_by_id: 2, note: null,
            requested_at: '2026-10-01T12:00:00Z', responded_at: null, connected_at: null,
            peer: { id: 2, name: 'Avery Speaker', username: 'avery-speaker', avatar_url: null },
          }], meta: { next_cursor: null } })
          case '/api/friends': return json(url.searchParams.get('view') === 'incoming'
            ? { friends: [{ connection_id: 1, person: { id: 2, name: 'Avery Speaker', username: 'avery-speaker', avatar_url: null },
              mutual_friends_count: 0, requested_at: '2026-10-01T12:00:00Z', connected_at: null, note: null }], meta: { total: 1, next_cursor: null } }
            : { friends: [], meta: { total: 0, next_cursor: null } })
          // The header's account chip reads its own public profile for the saved photo (UserMenu.tsx); no photo, so
          // it keeps the initials fallback these scans were written against.
          case '/api/u/workspace-axe-member': return json({ profile: {
            id: user.id, username: user.username, display_name: user.display_name, bio: null,
            location: null, avatar_url: null, credential: 'member',
          } })
          // The profile page's friends card (ProfileHome.tsx).
          case '/api/friends/sample': return json({ friends: [], meta: { total: 0 } })
        }
      }
      unexpected.push(`${request.method()} ${url.pathname}`)
      return json({ message: 'Unmapped accessibility request blocked.' }, 500)
    },
  })
  return unexpected
}

test.describe('option C presentation accessibility (isolated frontend)', () => {
  test.setTimeout(120_000)

  for (const width of [375, 1440]) {
    test(`fresh guest login before submission and authenticated dashboard axe at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const unexpected = await isolateWorkspaceAxeApi(context)
      const page = await context.newPage()
      try {
        // Do not invoke login() before this scan: RequireGuest would hide the
        // very form whose accessible labels and paper contrast we must check.
        await page.goto(`${APP_URL}/login?verified=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible({ timeout: 30_000 })
        await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
        if (width >= 1024) await expect(page.locator('[data-workspace-scene="welcome"] [data-workspace-art]')).toBeVisible()
        await scanAndAssert(page, `option-C/guest-login/${width}`)
        await login(page, USERS.speaker.email)
        for (const name of ['Invitations awaiting response', 'In progress', 'Published work', 'Revoked']) {
          await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible({ timeout: 30_000 })
        }
        await expect(page.getByText('Please share your thoughts on my opening and pacing.', { exact: true })).toBeVisible()
        await scanAndAssert(page, `option-C/dashboard/${width}`)
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await scanAndAssert(page, `option-C/dashboard/explicit-and-system-dark/${width}`)
        expect(unexpected).toEqual([])
      } catch (error) {
        const evidencePath = test.info().outputPath('workspace-rendered-header-actions.html')
        await writeFile(evidencePath, await page.locator('.workspace-header-actions')
          .evaluateAll((elements) => elements.map((element) => element.outerHTML).join('\n')))
        await test.info().attach('workspace-rendered-header-actions', {
          path: evidencePath,
          contentType: 'text/html',
        })
        throw error
      } finally { await context.close() }
    })
  }
})

// Wait for real finite UI transitions (including Base UI panel entry) to
// finish; scanning mid-fade measures blended transient colors. No styles,
// markup, axe tags, exclusions or impact gates are disabled or modified.
async function scanNotebookAndAssert(page: Page, label: string) {
  await page.evaluate(async () => {
    await document.fonts.ready
    for (let round = 0; round < 3; round++) {
      const animations = document.getAnimations().filter((animation) => animation.playState === 'running'
        && Number.isFinite(animation.effect?.getComputedTiming().endTime))
      if (!animations.length) break
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
    }
  })
  await scanAndAssert(page, label)
}

test.describe('notebook presentation accessibility (isolated frontend)', () => {
  test.setTimeout(360_000)
  for (const width of [375, 1440]) {
    test(`all nine notebook routes and actual feedback panels pass unchanged axe gate at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const unexpected = await isolateWorkspaceAxeApi(context, {})
      const page = await context.newPage()
      try {
        for (const path of ['/dashboard', '/speeches', '/reviewers', '/speeches/new', '/search', '/profile', '/account', '/become-a-coach', '/speeches/9']) {
          await page.goto(`${APP_URL}${path}`)
          await expect(page.locator('.workspace-notebook-page')).toBeVisible({ timeout: 30_000 })
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
          if (path === '/profile') await expect(page.getByRole('button', { name: /^Edit bio: Practising a clear opening\./ })).toBeVisible()
          if (path === '/search') {
            await page.getByRole('textbox', { name: 'Search text' }).fill('voice')
            await expect(page.getByText('Transcript excerpt', { exact: true })).toBeVisible()
          }
          if (path === '/speeches/9') {
            await expect(page.getByRole('tablist', { name: 'Speech tools' })).toBeVisible()
            // Caption readiness follows the tablist (the same lag the reviewer path below waits out). A toggle
            // that mounts, or flips to its pressed colours, after the transition wait is scanned mid-fade at
            // blended colours (1.69:1 in CI), so let the real pressed toggle arrive before scanning.
            await expect.poll(() => page.locator('video[data-testid="speech-video"]').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
            await expect(page.getByTestId('captions-toggle')).toHaveAttribute('aria-pressed', 'true')
          }
          await scanNotebookAndAssert(page, `notebook/${path}/${width}/light`)
          await page.emulateMedia({ colorScheme: 'dark' })
          await page.evaluate(() => document.documentElement.classList.add('dark'))
          await scanNotebookAndAssert(page, `notebook/${path}/${width}/explicit-and-system-dark`)
          if (path === '/speeches/9') for (const tab of ['Essay', 'Transcript', 'Reviewers']) {
            await page.getByRole('tablist', { name: 'Speech tools' }).getByRole('tab', { name: tab, exact: true }).click()
            await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
            await scanNotebookAndAssert(page, `notebook/owner-${tab}/${width}/explicit-and-system-dark`)
          }
          await page.emulateMedia({ colorScheme: 'light' })
          await page.evaluate(() => document.documentElement.classList.remove('dark'))
        }
        expect(unexpected).toEqual([])
      } finally { await context.close() }
      const reviewerContext = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const reviewerUnexpected = await isolateWorkspaceAxeApi(reviewerContext, { reviewer: true })
      const reviewerPage = await reviewerContext.newPage()
      try {
        await reviewerPage.goto(`${APP_URL}/speeches/9`)
        const tabs = reviewerPage.getByRole('tablist', { name: 'Your feedback' })
        await expect(tabs).toBeVisible({ timeout: 30_000 })
        // Caption readiness can follow the tabs. Let the real enabled toggle arrive before
        // scanNotebookAndAssert waits its finite color transition; do not scan a late mount mid-fade.
        await expect.poll(() => reviewerPage.locator('video[data-testid="speech-video"]').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
        await expect(reviewerPage.getByTestId('captions-toggle')).toHaveAttribute('aria-pressed', 'true')
        for (const tab of ['Notes', 'Essay', 'Transcript']) {
          await tabs.getByRole('tab', { name: tab, exact: true }).click()
          await expect(tabs.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
          await scanNotebookAndAssert(reviewerPage, `notebook/reviewer-${tab}/${width}`)
        }
        expect(reviewerUnexpected).toEqual([])
      } finally { await reviewerContext.close() }
    })
  }
})

test.describe('reviewer overlay presentation accessibility (isolated frontend)', () => {
  test.setTimeout(180_000)
  for (const width of [375, 1440]) {
    test(`populated reviewer Notes, live draft and kept-mounted tabs retain unchanged axe gate at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const unexpected = await isolateWorkspaceAxeApi(context, { reviewer: true, reviewerOverlay: true, feedback: true, missingCaptions: true })
      const page = await context.newPage()
      try {
        await page.goto(`${APP_URL}/speeches/9`)
        const tabs = page.getByRole('tablist', { name: 'Your feedback' })
        await expect(tabs).toBeVisible({ timeout: 30_000 })
        // Saved notes starts folded; open it so the populated list is part of every scan below.
        await page.getByRole('button', { name: 'Saved notes (2)', exact: true }).click()
        const list = page.getByRole('list', { name: 'Your commentary', exact: true })
        await expect(list).toHaveCount(1)
        await expect(list.getByText(/Pause briefly before the opening sentence/)).toBeVisible()
        const editor = page.getByRole('region', { name: 'New annotation', exact: true })
        await editor.getByRole('textbox', { name: 'Start', exact: true }).fill('1.5')
        await editor.getByRole('textbox', { name: 'End', exact: true }).fill('2.5')
        await editor.getByRole('textbox', { name: 'Commentary', exact: true }).fill('Private live reviewer draft for accessibility checks.')
        await expect(editor.getByRole('button', { name: 'Add annotation', exact: true })).toBeEnabled()
        const video = page.locator('video[data-testid="speech-video"]')
        await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
        await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 1.8 })
        const stack = page.getByTestId('reviewer-preview-target').getByTestId('overlay-stack')
        await expect(stack).toHaveAttribute('aria-hidden', 'true')
        await expect(stack.locator('.annotation-overlay[data-draft="true"]')).toHaveCSS('opacity', '1')
        // Keep WCAG tags, the third-party .video-js exclusion and the existing
        // critical/serious gate. The actual Notes/editor remain fully scanned.
        for (const dark of [false, true]) {
          await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
          await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark)
          for (const tab of ['Notes', 'Essay', 'Transcript', 'Notes']) {
            await tabs.getByRole('tab', { name: tab, exact: true }).click()
            await expect(tabs.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
            await expect(page.getByTestId('overlay-stack')).toHaveCount(tab === 'Notes' ? 1 : 0)
            await scanNotebookAndAssert(page, `reviewer-overlay/${tab}/${width}/${dark ? 'dark' : 'light'}`)
          }
        }
        await expect(list).toHaveCount(1)
        await expect(editor.getByRole('textbox', { name: 'Commentary', exact: true })).toHaveValue('Private live reviewer draft for accessibility checks.')
        await expect(list.getByRole('button', { name: 'Edit, annotation at 0 seconds', exact: true })).toBeVisible()
        expect(unexpected).toEqual([])
      } finally { await context.close() }
    })
  }
})

// Populated annotation notebook tools: exact built assets, fail-closed APIs and the review-22 identity
// with 13 saved mixed notes (see notebookToolsAnnotations). Same WCAG tags, same `.video-js` exclusion
// and the same serious/critical gate as every scan above; no rule is excluded or relaxed.
test.describe('annotation notebook tools', () => {
  test.setTimeout(360_000)
  const savedToggle = (page: Page) => page.getByRole('button', { name: 'Saved notes (13)', exact: true })
  async function openPopulated(browser: import('@playwright/test').Browser, width: number, dark: boolean, recorder = false) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' })
    const unexpected = await isolateWorkspaceAxeApi(context, { reviewer: true, reviewerOverlay: true, feedback: true, notebookTools: true, missingCaptions: true })
    const page = await context.newPage()
    if (recorder) await installDeterministicRecorder(page)
    await page.goto(`${APP_URL}/speeches/9`)
    await expect(page.getByRole('tablist', { name: 'Add commentary' })).toBeVisible({ timeout: 30_000 })
    await expect(savedToggle(page)).toBeVisible({ timeout: 30_000 })
    await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark)
    return { context, page, unexpected }
  }

  for (const width of [375, 1440]) {
    for (const dark of [false, true]) {
      test(`populated tools, folded and open Saved notes, pages, details and editing at ${width}px ${dark ? 'dark' : 'light'}`, async ({ browser }) => {
        const { context, page, unexpected } = await openPopulated(browser, width, dark)
        const label = (state: string) => `annotation-tools/${state}/${width}/${dark ? 'dark' : 'light'}`
        const tools = page.getByRole('tablist', { name: 'Add commentary' })
        const row = (id: string) => page.locator(`li[data-annotation-id="${id}"]`)
        const pager = page.getByRole('navigation', { name: 'Saved notes pages', exact: true })
        try {
          await scanNotebookAndAssert(page, label('folded/text-tool'))
          await tools.getByRole('tab', { name: /^Voice note/ }).click()
          await expect(page.getByRole('region', { name: 'Record a voice note', exact: true })).toBeVisible()
          await scanNotebookAndAssert(page, label('folded/voice-tool'))
          await savedToggle(page).click()
          await expect(page.getByRole('list', { name: 'Your commentary', exact: true })).toHaveCount(1)
          await scanNotebookAndAssert(page, label('open/voice-tool/page-1'))
          await tools.getByRole('tab', { name: /^Text note/ }).click()
          await expect(page.getByRole('region', { name: 'New annotation', exact: true })).toBeVisible()
          await scanNotebookAndAssert(page, label('open/text-tool/page-1'))

          // Page 1 detail variants: processing, failed (with retry) and erased-audio rows, plus a text row.
          await row('tools-text-01').getByRole('button', { name: 'Show details, annotation at 0 seconds', exact: true }).click()
          await row('tools-voice-processing').getByRole('button', { name: 'Show details, voice note at 0 seconds', exact: true }).click()
          await row('tools-voice-failed').getByRole('button', { name: 'Show details, voice note at 0 seconds', exact: true }).click()
          await row('tools-voice-erased').getByRole('button', { name: 'Show details, voice note at 1 second', exact: true }).click()
          await expect(row('tools-voice-failed').getByRole('button', { name: 'Retry transcript, voice note at 0 seconds', exact: true })).toBeVisible()
          await scanNotebookAndAssert(page, label('open/page-1/expanded-details'))

          await pager.getByRole('button', { name: 'Next', exact: true }).click()
          await expect(pager).toContainText('Notes 7–12 of 13 · Page 2 of 3')
          await scanNotebookAndAssert(page, label('open/page-2'))
          const voice = row('notebook-voice')
          await voice.getByRole('button', { name: 'Show details, voice note at 1 second', exact: true }).click()
          await voice.getByRole('button', { name: 'Preview audio, voice note at 1 second', exact: true }).click()
          await expect(voice.locator('audio[aria-label="Voice note audio"]')).toHaveCount(1)
          await scanNotebookAndAssert(page, label('open/page-2/expanded-voice-with-audio'))

          await pager.getByRole('button', { name: 'Previous', exact: true }).click()
          await row('tools-text-01').getByRole('button', { name: 'Edit, annotation at 0 seconds', exact: true }).click()
          await expect(page.getByRole('region', { name: 'Editing annotation', exact: true })).toBeVisible()
          await expect(pager).toContainText('Editing page held')
          await scanNotebookAndAssert(page, label('editing/held-page'))
          await page.getByRole('region', { name: 'Editing annotation', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click()
          await expect(page.getByRole('region', { name: 'Editing annotation', exact: true })).toHaveCount(0)
          await scanNotebookAndAssert(page, label('open/after-edit'))
          expect(unexpected).toEqual([])
        } finally { await context.close() }
      })
    }
  }

  test('live draft, requesting/recording lock and a stopped recording keep the unchanged axe gate', async ({ browser }) => {
    const { context, page, unexpected } = await openPopulated(browser, 1440, false, true)
    try {
      const tools = page.getByRole('tablist', { name: 'Add commentary' })
      const form = page.getByRole('region', { name: 'New annotation', exact: true })
      await form.getByRole('textbox', { name: 'Start', exact: true }).fill('2.45')
      await form.getByRole('textbox', { name: 'End', exact: true }).fill('3')
      await form.getByRole('textbox', { name: 'Commentary', exact: true }).fill('Draft with unsaved state for the scan.')
      await expect(tools.getByRole('tab', { name: 'Text note · Unsaved', exact: true })).toBeVisible()
      await scanNotebookAndAssert(page, 'annotation-tools/unsaved-text-draft')
      await tools.getByRole('tab', { name: /^Voice note/ }).click()
      const recorder = page.getByRole('region', { name: 'Record a voice note', exact: true })
      const video = page.locator('video[data-testid="speech-video"]')
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
      await video.evaluate((element: HTMLVideoElement) => { element.pause() })
      await recorder.getByRole('textbox', { name: 'Voice note position' }).fill('2.7')
      await recorder.getByRole('button', { name: /^Record/ }).click()
      await expect(recorder.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
      await expect(tools.getByRole('tab', { name: 'Voice note · Recording', exact: true })).toBeVisible()
      await scanNotebookAndAssert(page, 'annotation-tools/recording-lock')
      await recorder.getByRole('button', { name: 'Stop', exact: true }).click()
      await expect(recorder.getByLabel('Voice note preview')).toBeVisible()
      await expect(tools.getByRole('tab', { name: 'Voice note · Unsaved recording', exact: true })).toBeVisible()
      await scanNotebookAndAssert(page, 'annotation-tools/stopped-recording')
      expect(unexpected).toEqual([])
    } finally { await context.close() }
  })
})

// Populated owner timeline is below .video-js and is covered by every unchanged axe scan.
test.describe('owner video tools accessibility (isolated frontend)', () => {
  test.setTimeout(240_000)
  for (const width of [320, 375, 768, 1440]) {
    test(`both populated utility panels pass unchanged axe gate at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const unexpected = await isolateWorkspaceAxeApi(context, { ownerVideoTools: true, feedback: true, ownerWire: { posterRequests: [] } })
      const page = await context.newPage()
      try {
        await page.goto(`${APP_URL}/speeches/9`, { waitUntil: 'domcontentloaded' })
        await expect.poll(() => page.locator('video[data-testid="speech-video"]').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
        await expect(page.getByTestId('captions-toggle')).toHaveAttribute('aria-pressed', 'true')
        const tools = page.getByRole('tablist', { name: 'Video tools', exact: true })
        const timeline = page.locator('.owner-video-tools__timeline')
        await expect(timeline.getByTestId('range-marker-owner-a-text')).toBeVisible({ timeout: 30_000 })
        await expect(timeline.locator('.awt-marker')).toHaveCount(6)
        expect(await timeline.evaluate((node) => node.closest('.video-js') === null)).toBe(true)
        // Forced-colors geometry/keyboard remains covered in app-shell at all four widths.
        // WebKit's translucent system Highlight on Canvas flags the unchanged global header;
        // this populated utility scan keeps the existing light/dark axe matrix and full-page gate.
        for (const theme of ['light', 'system-dark', 'explicit-dark']) {
          await page.emulateMedia({ colorScheme: theme === 'system-dark' ? 'dark' : 'light', forcedColors: 'none', reducedMotion: 'reduce' })
          await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'explicit-dark')
          for (const label of ['Commentary timeline', 'Frame selector']) {
            await tools.getByRole('tab', { name: label, exact: true }).click()
            await expect(tools.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true')
            if (label === 'Commentary timeline') await expect(timeline.locator('.awt-marker')).toHaveCount(6)
            else await expect(page.getByRole('button', { name: 'Use current frame', exact: true })).toBeVisible()
            await scanNotebookAndAssert(page, `owner-video-tools/${width}/${theme}/${label}`)
          }
        }
        expect(unexpected).toEqual([])
      } finally { await page.close(); await context.close() }
    })
  }
})

// Both populated timeline callers retain the full-page axe gate; the real video chrome
// keeps its existing .video-js exclusion, while the new slider remains fully scanned.
test.describe('draggable timeline playhead accessibility (isolated frontend)', () => {
  test.setTimeout(180_000)
  for (const width of [375, 1440]) for (const reviewer of [false, true]) {
    test(`${reviewer ? 'reviewer Notes' : 'owner both panels'} populated slider passes unchanged axe at ${width}px`, async ({ browser }) => {
      const wire: ScrubWire = { reviewRequests: 0, playbackRequests: 0, voiceMediaRequests: 0, mutations: [] }
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const unexpected = await isolateWorkspaceAxeApi(context, { draggable: true, scrubWire: wire, reviewer, reviewerOverlay: reviewer,
        notebookTools: reviewer, ownerVideoTools: !reviewer, feedback: true, playbackMode: 'all' })
      const page = await context.newPage()
      try {
        await page.goto(`${APP_URL}/speeches/9`, { waitUntil: 'domcontentloaded' })
        await expect.poll(() => page.locator('video[data-testid="speech-video"]').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
        await expect(page.getByTestId('captions-toggle')).toHaveAttribute('aria-pressed', 'true')
        const slider = page.getByRole('slider', { name: 'Video position', exact: true })
        await expect(slider).toHaveAttribute('aria-disabled', 'false')
        const timeline = reviewer ? page.locator('.aw-root').getByTestId('timeline-strip') : page.locator('.owner-video-tools__timeline')
        await expect(timeline.locator('.awt-marker')).toHaveCount(reviewer ? 13 : 6)
        expect(await slider.evaluate((node) => node.closest('.video-js') === null)).toBe(true)
        if (reviewer) expect(wire.reviewRequests).toBe(2)
        // Forced-colors native geometry/focus is exercised at four widths in app-shell.
        // The existing shared-header system Highlight/Canvas limitation remains outside this scope.
        for (const theme of ['light', 'system-dark', 'explicit-dark']) {
          await page.emulateMedia({ colorScheme: theme === 'system-dark' ? 'dark' : 'light', reducedMotion: 'reduce' })
          await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'explicit-dark')
          const panels = reviewer ? ['Notes'] : ['Commentary timeline', 'Frame selector']
          for (const panel of panels) {
            await page.getByRole('tablist', { name: reviewer ? 'Your feedback' : 'Video tools' }).getByRole('tab', { name: panel, exact: true }).click()
            if (panel !== 'Frame selector') await expect(slider).toBeVisible()
            else await expect(slider).toBeHidden()
            await scanNotebookAndAssert(page, `draggable-playhead/${reviewer ? 'reviewer' : 'owner'}/${width}/${theme}/${panel}`)
          }
        }
        expect(wire.mutations).toEqual([])
        expect(unexpected).toEqual([])
      } finally { await page.close(); await context.close() }
    })
  }
})
