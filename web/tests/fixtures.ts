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
