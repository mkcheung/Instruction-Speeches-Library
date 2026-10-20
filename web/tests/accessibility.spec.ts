import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { APP_URL, FIXTURE_PASSWORD, USERS, VOICE } from './fixtures.js'

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
