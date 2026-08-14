import { test, expect } from '@playwright/test'
import {
  API_URL,
  APP_URL,
  REVIEW_COACH_A_ID,
  REVIEW_COACH_B_ID,
  SHARED_SPEECH_ID,
  USERS,
} from './fixtures.js'

/**
 * CP-05 — two users in one test.
 *
 * Requires the fixture data from `api/database/seeders/E2ESeeder.php`:
 *   docker compose exec app php artisan db:seed --class=Database\\Seeders\\E2ESeeder
 *
 * Speech 9101 is owned by the speaker and has TWO accepted reviews on it —
 * reviewer A (9201) and reviewer B (9202). §7.3's requirement is that A
 * cannot read B's review *and cannot see that B exists*; even the count
 * leaks, because "three people are reviewing this" changes what a reviewer
 * writes.
 *
 * Note the context-per-user discipline throughout: two PAGES from one
 * context would be two tabs logged in as the same person, and the security
 * test below would pass for the wrong reason — which is worse than failing.
 */

const SPEECH_URL = `${APP_URL}/speeches/${SHARED_SPEECH_ID}`

/**
 * Laravel's auth middleware REDIRECTS (302 → /login) instead of returning
 * 401/403 unless the request actually asks for JSON, and Playwright's
 * `request` follows redirects by default — so a bare `request.get()`
 * reports the login page's 200 and a leak test silently passes while
 * asserting nothing.
 *
 * The real client always sends this header (`src/lib/baseQuery.ts`), so
 * sending it here is not a workaround: it is what makes these calls
 * equivalent to the ones the app makes.
 *
 * `Origin` matters for the same reason and is easier to miss. The session
 * cookie is scoped to `.speechcoach.test` and so reaches the API
 * subdomain on its own — but Sanctum only upgrades a cookie into a
 * SESSION login when the request's origin is in
 * `SANCTUM_STATEFUL_DOMAINS` (`app.speechcoach.test`). The browser sends
 * that header automatically on the app's real cross-subdomain fetches;
 * `page.request` does not. Without it every call here comes back 401,
 * which would make a leak test pass for entirely the wrong reason.
 */
const JSON_HEADERS = {
  Accept: 'application/json',
  Origin: APP_URL,
} as const

test('an accepted reviewer can reach the speech they were invited to', async ({ browser }) => {
  const reviewer = await browser.newContext({ storageState: USERS.reviewerA.storageState })
  const page = await reviewer.newPage()

  await page.goto(SPEECH_URL)

  // The grant is what's under test — reviewer A can load a speech they do
  // not own. (This fixture seeds no `ready` speech_asset, so the player
  // itself renders "Not ready to play yet."; playback needs a real
  // transcoded object in SeaweedFS and is not what CP-05 is proving.)
  await expect(page.getByText('E2E shared speech (two reviewers)')).toBeVisible()

  await reviewer.close()
})

test('a stranger cannot reach the speech at all', async ({ browser }) => {
  // Contrast case: without this, "reviewer A can load it" proves nothing,
  // because it might be loadable by anyone.
  const stranger = await browser.newContext() // no storageState — logged out
  const page = await stranger.newPage()

  const res = await page.request.get(`${API_URL}/api/speeches/${SHARED_SPEECH_ID}`, {
    headers: JSON_HEADERS,
  })
  expect(res.status(), 'a logged-out request must not be served the speech').toBe(401)

  await stranger.close()
})

test('the speaker DOES see both reviewers — so the leak assertions below are not vacuous', async ({
  browser,
}) => {
  // This is the guard against a false pass. If the commentary radiogroup
  // never rendered for anybody (a renamed component, a broken route), the
  // `toHaveCount(0)` assertions in the isolation test would pass while
  // proving nothing. Here we prove the leak surface genuinely exists and
  // genuinely lists both reviewers — for the one person entitled to see
  // them.
  const speaker = await browser.newContext({ storageState: USERS.speaker.storageState })
  const page = await speaker.newPage()

  await page.goto(SPEECH_URL)

  const radiogroup = page.getByRole('radiogroup', { name: 'Choose commentary track' })
  await expect(radiogroup).toBeVisible()

  await expect(radiogroup.getByRole('radio', { name: USERS.reviewerA.name })).toBeVisible()
  await expect(radiogroup.getByRole('radio', { name: USERS.reviewerB.name })).toBeVisible()

  await speaker.close()
})

test('reviewer A cannot see that reviewer B exists', async ({ browser }) => {
  const a = await browser.newContext({ storageState: USERS.reviewerA.storageState })
  const page = await a.newPage()

  await page.goto(SPEECH_URL)
  await expect(page.getByText('E2E shared speech (two reviewers)')).toBeVisible()

  // `toHaveCount(0)`, never `not.toBeVisible()`: the latter passes when the
  // element is in the DOM but hidden, which for a leak test is a fail
  // dressed as a pass — the data reached the browser and CSS is the only
  // thing withholding it.
  await expect(page.getByRole('radiogroup', { name: 'Choose commentary track' })).toHaveCount(0)

  // Not B's name, not B's username, not a count of reviewers.
  await expect(page.getByText(USERS.reviewerB.name)).toHaveCount(0)
  await expect(page.getByText(USERS.reviewerB.username)).toHaveCount(0)
  await expect(page.getByText(/2 reviewers/i)).toHaveCount(0)

  await a.close()
})

test('reviewer A cannot reach reviewer B commentary by URL either', async ({ browser }) => {
  const a = await browser.newContext({ storageState: USERS.reviewerA.storageState })
  const page = await a.newPage()

  // `page.request` carries this context's cookies, so these are authenticated
  // calls AS reviewer A — the point being that the absence of a button in
  // the UI is not itself proof the endpoint is closed.
  const bsAnnotations = await page.request.get(
    `${API_URL}/api/speeches/${SHARED_SPEECH_ID}/annotations?review_id=${REVIEW_COACH_B_ID}`,
    { headers: JSON_HEADERS },
  )
  expect(bsAnnotations.status(), "reviewer A must not read reviewer B's annotations").toBe(403)

  // A's own review, by contrast, is readable — otherwise a blanket 403 on
  // everything would make the assertion above meaningless. This also
  // proves the cookie really is travelling cross-subdomain to the API,
  // so the 403 above is a policy decision and not just an unauthenticated
  // request being turned away.
  const ownAnnotations = await page.request.get(
    `${API_URL}/api/speeches/${SHARED_SPEECH_ID}/annotations?review_id=${REVIEW_COACH_A_ID}`,
    { headers: JSON_HEADERS },
  )
  expect(ownAnnotations.status(), 'reviewer A must still read their own').toBe(200)

  // And the speech's review list is the speaker's, not a reviewer's.
  const reviewList = await page.request.get(
    `${API_URL}/api/speeches/${SHARED_SPEECH_ID}/reviews`,
    { headers: JSON_HEADERS },
  )
  expect(reviewList.status(), 'the reviewer roster is owner-only').toBe(404)

  await a.close()
})
