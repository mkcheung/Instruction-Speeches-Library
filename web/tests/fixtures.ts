/**
 * Shared constants for the E2E specs that run against the seeded fixture
 * data in `api/database/seeders/E2ESeeder.php`. Ids and emails are FIXED
 * there (9001–9005, 9101, 9201–9202) precisely so tests can reference them
 * literally instead of discovering them at runtime.
 *
 * Re-seed before running these:
 *   docker compose exec app php artisan db:seed --class=Database\\Seeders\\E2ESeeder
 */

export const APP_URL = 'https://app.speechcoach.test'
export const API_URL = 'https://api.speechcoach.test'

/** Every seeded fixture user shares this password (E2ESeeder). */
export const FIXTURE_PASSWORD = 'password'

export const AUTH_DIR = 'playwright/.auth'

export const USERS = {
  /** Owns the shared speech — the "speaker" in CP-05's terms. */
  speaker: {
    email: 'member@e2e.test',
    username: 'e2e-member',
    name: 'Milo Member',
    storageState: `${AUTH_DIR}/speaker.json`,
  },
  /** Reviewer A — has an accepted review on the shared speech. */
  reviewerA: {
    email: 'coach@e2e.test',
    username: 'e2e-coach',
    name: 'Cora Coach',
    storageState: `${AUTH_DIR}/reviewer-a.json`,
  },
  /** Reviewer B — also has an accepted review on the SAME speech. A must
   * never learn that B exists. */
  reviewerB: {
    email: 'coach-b@e2e.test',
    username: 'e2e-coach-b',
    name: 'Bram Bystander',
    storageState: `${AUTH_DIR}/reviewer-b.json`,
  },
} as const

export const SHARED_SPEECH_ID = 9101
export const REVIEW_COACH_A_ID = 9201
export const REVIEW_COACH_B_ID = 9202

/**
 * CP-08. Reviewer A's essay is seeded PUBLISHED; reviewer B's is seeded
 * empty. That split is deliberate and load-bearing: the write specs type
 * into B and the read/isolation specs read A, so neither can disturb the
 * other's fixture no matter what order they run in.
 *
 * This text must match `E2ESeeder::ESSAY_COACH_A_TEXT` exactly. There is no
 * mechanism keeping the two in sync — if the seeder's copy changes, the
 * speaker-read assertion fails loudly, which is the intended outcome.
 */
export const ESSAY_COACH_A_TEXT = 'The close landed better than the open.'

/**
 * STEP-09-VERIFICATION-PLAN.md §3.3 / `api/database/seeders/E2ECaptionsSeeder.php`.
 * A separate, later seed step from E2ESeeder above — run it explicitly
 * after E2ESeeder, never in place of it:
 *   docker compose exec app php artisan db:seed --class=Database\\Seeders\\E2ECaptionsSeeder
 *
 * These ids/strings must match the seeder's own constants exactly. There is
 * no mechanism keeping the two in sync beyond this comment — if the
 * seeder's copy changes, whichever spec reads the stale value here fails
 * loudly, which is the intended outcome (plan: "mirrored IDs/text ... so
 * drift fails loudly").
 */
export const CAPTIONS = {
  displaySpeechId: 9401,
  reviewerAccessSpeechId: 9402,
  editSpeechId: 9403,
  searchEditSpeechId: 9404,
  processingSpeechId: 9405,
  failedSpeechId: 9406,
  searchOwnerMatchSpeechId: 9407,
  searchOwnerNonMatchSpeechId: 9408,
  searchOtherUserMatchSpeechId: 9409,

  reviewDisplayCoachAId: 9411,
  reviewDisplayCoachBId: 9412,
  reviewAccessCoachAId: 9413,

  /** The uncorrected phrase Scenario B changes to "Toastmasters". */
  editUncorrectedPhrase: 'toast masters',
  editSecondStablePhrase: 'thank you for joining us today',

  displayAnnotationBody: 'Great energy in the opening — keep that pace.',

  searchDistinctivePhrase: 'quarterly toastmasters keynote address',

  /** Real media duration (seconds) of tests/fixtures/e2e-captions/caption-fixture.mp4. */
  mediaDurationSeconds: 6,
} as const
