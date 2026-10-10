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

/**
 * STEP-09-VERIFICATION-PLAN.md §3.1 names this exact gap: onboarding.spec.ts,
 * speech-create.spec.ts, and essay-editor.spec.ts each `docker exec` a raw
 * `psql` cleanup straight against a hardcoded container name — which only
 * ever matches the DEV stack's Compose-derived name
 * (`instruction-speeches-library-postgres-1`, from the repo directory name
 * under a bare `docker compose up`), not the E2E harness's dedicated
 * `speechcoach-e2e` project (container `speechcoach-e2e-postgres-1`). The
 * plan's own preferred fix — routing through a real application reset
 * command via scripts/e2e-stack.sh — is a larger refactor than this line
 * accounts for; this is the minimal fix that unblocks CI now: the CI e2e
 * job's "Run Playwright" step sets `E2E_POSTGRES_CONTAINER` to the real
 * `speechcoach-e2e-postgres-1` name, and a bare local run against the dev
 * stack keeps working via the fallback below with no env var needed.
 */
export const POSTGRES_CONTAINER = process.env.E2E_POSTGRES_CONTAINER ?? 'instruction-speeches-library-postgres-1'

/** Every seeded fixture user shares this password (E2ESeeder). */
export const FIXTURE_PASSWORD = 'password'

export const AUTH_DIR = 'playwright/.auth'

export const USERS = {
  /**
   * PLAN-ADMIN-DASHBOARD.md §9. Seeded as ids 9001/9002 with real Spatie
   * roles since STEP-01 and used by NO test until `admin-panel.spec.ts` —
   * which is the single reason eight authorization holes and an
   * unreachable panel survived three steps.
   *
   * No `storageState`: these two do NOT go through `auth.setup.ts`. The
   * Filament panel login is a Blade page on the API origin behind a
   * mandatory TOTP challenge, and putting it in the shared `setup`
   * project — which every browser project declares a dependency on —
   * would mean a panel regression takes the entire suite down with it.
   * `admin-panel.spec.ts` signs in for itself; see `panel-auth.ts`.
   *
   * `totpSecret` must match `E2ESeeder::ADMIN_TOTP_SECRET` /
   * `SUPER_ADMIN_TOTP_SECRET` exactly. Drift fails loudly: the six digits
   * this generates stop matching the ones the panel computes and the
   * challenge rejects them.
   */
  admin: {
    email: 'admin@e2e.test',
    username: 'e2e-admin',
    name: 'Adam Admin',
    totpSecret: 'E2EADMINE2EADMIN',
  },
  /** §5.2's asymmetry, and §9's "the case nothing covers": before
   * `Role::ADMIN_TIER`, a super_admin cleared `EnsureUserIsAdmin` and was
   * then denied by everything inside the panel. */
  superAdmin: {
    email: 'super-admin@e2e.test',
    username: 'e2e-super-admin',
    name: 'Sadie Superadmin',
    totpSecret: 'E2ESUPERADMIN234',
  },
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

/**
 * STEP-10-VERIFICATION-PLAN.md §4. Seeded separately by
 * Database\\Seeders\\E2EVoiceAnnotationSeeder so the baseline auth fixtures
 * stay lightweight. Keep these literals in lockstep with that seeder; drift
 * is expected to fail loudly in the browser suite.
 */
export const VOICE = {
  coachSpeechId: 9601,
  memberReviewSpeechId: 9602,
  erasureSpeechId: 9603,
  coachReviewId: 9611,
  memberReviewId: 9612,
  erasureReviewId: 9613,
  peerDraftReviewId: 9614,
  firstVoiceAnnotationId: 9801,
  erasureVoiceAnnotationId: 9821,
  peerDraftVoiceAnnotationId: 9822,
  uploadClientUuid: '0e2e0000-0000-4000-8000-000000019601',
  pendingTranscript: 'Transcribing…',
  ordinaryText: 'Ordinary text remains visible.',
  fixturePathFromRepoRoot: 'api/tests/fixtures/whisper-smoke/spoken-fixture.m4a',
} as const
