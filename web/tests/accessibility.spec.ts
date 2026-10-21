import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { API_URL, APP_URL, FIXTURE_PASSWORD, USERS, VOICE } from './fixtures.js'

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
  const editButton = page.getByRole('button', { name: 'Edit' }).first()
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
async function isolateWorkspaceAxeApi(context: BrowserContext) {
  // Optional delivery of the exact current build avoids Vite cold-module
  // failures without starting a server or manufacturing product markup.
  const builtRoot = process.env.WORKSPACE_USE_BUILT_ASSETS === '1'
    ? await realpath(fileURLToPath(new URL('../dist/', import.meta.url)))
    : null
  context.setDefaultNavigationTimeout(120_000)
  let authenticated = false
  const unexpected: string[] = []
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
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === new URL(APP_URL).origin) {
      if (!builtRoot) return route.continue()
      // Fail closed for non-GET requests and for traversal, symlinks outside
      // dist, directories, or missing build assets. Documents always use the
      // build's own index.html so the real frontend router handles the URL.
      if (!['GET', 'HEAD'].includes(request.method())) {
        unexpected.push(`${request.method()} ${url.pathname}`)
        return route.abort('blockedbyclient')
      }
      try {
        const candidate = resolve(builtRoot, request.isNavigationRequest()
          ? 'index.html'
          : '.' + decodeURIComponent(url.pathname))
        if (!candidate.startsWith(builtRoot + sep)) throw new Error('Path outside build root')
        const canonical = await realpath(candidate)
        if (!canonical.startsWith(builtRoot + sep) || !(await stat(canonical)).isFile()) {
          throw new Error('Not a bounded build file')
        }
        const mime: Record<string, string> = {
          '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
          '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
        }
        return route.fulfill({ status: 200, body: await readFile(canonical), headers: {
          'content-type': mime[extname(canonical)] ?? 'application/octet-stream', 'cache-control': 'no-store',
        } })
      } catch {
        unexpected.push(`Missing or unsafe build asset: ${url.pathname}`)
        return route.abort('blockedbyclient')
      }
    }
    if (url.origin !== new URL(API_URL).origin) {
      unexpected.push(request.url())
      return route.abort('blockedbyclient')
    }
    const headers = { 'access-control-allow-origin': APP_URL, 'access-control-allow-credentials': 'true' }
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body })
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-xsrf-token, accept' } })
    }
    if (url.pathname === '/sanctum/csrf-cookie') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/login' && request.method() === 'POST') {
      authenticated = true
      return json({ user })
    }
    if (request.method() === 'GET') {
      switch (url.pathname) {
        case '/api/me': return json(authenticated ? { user } : { message: 'Unauthenticated.' }, authenticated ? 200 : 401)
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
      }
    }
    unexpected.push(`${request.method()} ${url.pathname}`)
    return json({ message: 'Unmapped accessibility request blocked.' }, 500)
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
