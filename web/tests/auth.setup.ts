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
async function authenticate(
  page: import('@playwright/test').Page,
  email: string,
  storageState: string,
): Promise<void> {
  await page.goto(`${APP_URL}/login`)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()

  // Login.tsx navigates to /onboarding on success (there is no
  // already-onboarded redirect yet), so this URL is the success signal —
  // not a statement that these fixture users need onboarding. They don't;
  // E2ESeeder sets onboarding_completed_at.
  await page.waitForURL(`${APP_URL}/onboarding`)

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
