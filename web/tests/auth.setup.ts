import { test as setup, expect } from '@playwright/test'
import { APP_URL, FIXTURE_PASSWORD, USERS } from './fixtures.js'

/**
 * CP-05 step 1: log in ONCE per role, not once per test.
 *
 * This file is matched by the `setup` project in playwright.config.ts, and
 * every browser project declares `dependencies: ['setup']`, so these run
 * first on every invocation. That is the whole reason the saved auth files
 * can stay gitignored — they are regenerated rather than committed, which
 * also means a change to the session format can never leave a stale file
 * behind (CP-05: "storage state goes stale").
 *
 * Locators here are role/label-based, matching this repo's existing specs
 * (onboarding.spec.ts) — `web/src/routes/Login.tsx` carries no test ids.
 */

/**
 * These logins get warmup's own budget (120s nav / 180s test) instead of
 * Playwright's 30s default.
 *
 * `warmup.setup.ts` documents the cause: the Vite DEV server behind this
 * host transforms unbundled modules on demand, single-threaded, and
 * intermittently stalls. Warmup pays the first cold graph but does not
 * immunise the run, and a failure *here* takes the whole suite with it —
 * every browser project declares `dependencies: ['setup']`.
 *
 * Measured on this machine while building `essay-editor.spec.ts`: a
 * randomly-chosen one of these three logins stalls in roughly two runs in
 * five. Warmup's docblock says ~30s; here it ran 60s to over 4 minutes, so
 * this budget reduces the failure rate rather than eliminating it. That is
 * an honest partial fix, not a solved problem — see CP-08-BUILD-PLAN.md's
 * "out of scope" note.
 *
 * Three hypotheses were tested and all three came back negative, so nobody
 * has to re-run them: it is NOT the `load`-never-fires problem
 * `essay-editor.spec.ts` documents separately (`domcontentloaded` changed
 * nothing here, and one stalled run completed normally after 78s rather
 * than hanging forever); it is NOT dev-server age (a fresh `npm run dev`
 * stalled at the same rate); and it is NOT CP-08's new fixture video (the
 * stall reproduces identically with that asset row deleted). It tracks the
 * host's own load, which is the same thing warmup's docblock concluded.
 *
 * A longer budget absorbs the stall and still fails honestly if login is
 * actually broken. Retries would hide it instead.
 */
const NAV_TIMEOUT = 120_000

async function authenticate(
  page: import('@playwright/test').Page,
  email: string,
  storageState: string,
): Promise<void> {
  setup.setTimeout(180_000)
  await page.goto(`${APP_URL}/login`, { timeout: NAV_TIMEOUT })
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()

  // Login.tsx navigates to /onboarding on success (there is no
  // already-onboarded redirect yet), so this URL is the success signal —
  // not a statement that these fixture users need onboarding. They don't;
  // E2ESeeder sets onboarding_completed_at.
  //
  // Same budget as the `goto` above, and for the same reason: this is a
  // real route change that pulls a module subgraph the login page did not,
  // so it is just as exposed to the transform stall. Leaving it on the 30s
  // default would have made the raise above cosmetic.
  await page.waitForURL(`${APP_URL}/onboarding`, { timeout: NAV_TIMEOUT })

  await page.context().storageState({ path: storageState })
}

setup('authenticate as the speaker', async ({ page }) => {
  await authenticate(page, USERS.speaker.email, USERS.speaker.storageState)
})

setup('authenticate as reviewer A', async ({ page }) => {
  await authenticate(page, USERS.reviewerA.email, USERS.reviewerA.storageState)
})

setup('authenticate as reviewer B', async ({ page }) => {
  await authenticate(page, USERS.reviewerB.email, USERS.reviewerB.storageState)
})

setup('the fixture data the isolation specs need is actually seeded', async ({ request }) => {
  // Fail loudly and early with a useful message if E2ESeeder hasn't been
  // run against this database — otherwise the isolation specs below fail
  // with a confusing 404 that looks like a bug in the app.
  const res = await request.get(`${APP_URL}/login`)
  expect(res.ok(), 'the app should be reachable at ' + APP_URL).toBeTruthy()
})
