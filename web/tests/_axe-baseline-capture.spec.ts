import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_URL, FIXTURE_PASSWORD, USERS, VOICE } from './fixtures.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * STEP-15 / IMPLEMENTATION-PLANS.md §7.7.4 — Phase 0, baseline-only.
 *
 * ⚠️ NOT a CI gate. Deliberately named with a leading underscore so it is
 * excluded from every glob/explicit-list CI might use (confirmed by
 * reading .github/workflows/ci.yml: the e2e job names each spec file
 * explicitly — `tests/speech-create.spec.ts tests/app-shell.spec.ts
 * tests/essay-editor.spec.ts tests/captions.spec.ts
 * tests/voice-annotations.spec.ts` — so a file never named there is never
 * picked up, with or without the underscore; the underscore is belt-and-
 * suspenders against a future glob-based job).
 *
 * §7.7.4's sequencing trap: the moment the first accessibility fix lands,
 * the "before" number is unrecoverable. This script's ONLY job is to
 * capture that number against the CURRENT, unmodified code. It fixes
 * nothing.
 *
 * Run with (no project dependencies — this file does its own login, it
 * does not rely on auth.setup.ts's storageState files):
 *
 *   npx playwright test tests/_axe-baseline-capture.spec.ts --project=chromium --no-deps
 *
 * Fixture data required: E2ESeeder, E2ECaptionsSeeder,
 * E2EVoiceAnnotationSeeder (all already seeded before this was written —
 * see the artifacts/accessibility-baseline/ README for exact commands).
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

// Known third-party region: Video.js renders its own control surface and
// is not this codebase's code (CP-15-accessibility-gates.md §4 — "scope
// the scan rather than disabling the rule"). Confirmed third-party by
// grepping web/src: `video.js/dist/video-js.css` import + `className =
// 'video-js vjs-big-play-centered'` in VideoPlayer.tsx are its only two
// touch points in this codebase.
const EXCLUDE_SELECTORS = ['.video-js']

type NamedResults = {
  screen: string
  variant: string
  url: string
  loggedInAs: string | null
  excluded: string[]
  results: unknown
}

const allResults: NamedResults[] = []

async function login(page: Page, email: string): Promise<void> {
  // dev-stack-staleness-and-vite-stall.md: the Vite dev server behind
  // app.speechcoach.test stalls 60s-4min intermittently under host load.
  // 120s nav timeouts, same budget auth.setup.ts uses for the same reason.
  await page.goto(`${APP_URL}/login`, { timeout: 120_000 })
  await page.getByRole('textbox', { name: 'Email' }).fill(email, { timeout: 120_000 })
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(FIXTURE_PASSWORD, { timeout: 120_000 })
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 120_000 })
}

async function scan(page: Page, screen: string, variant: string, loggedInAs: string | null): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(AXE_TAGS)
  for (const selector of EXCLUDE_SELECTORS) {
    builder.exclude(selector)
  }
  const results = await builder.analyze()
  allResults.push({
    screen,
    variant,
    url: page.url(),
    loggedInAs,
    excluded: EXCLUDE_SELECTORS,
    results,
  })
}

test.describe.configure({ mode: 'serial' })

test('capture baseline: annotation (authoring) screen — reviewer A on speech 9601', async ({ page }) => {
  await login(page, USERS.reviewerA.email)

  await page.goto(`${APP_URL}/speeches/${VOICE.coachSpeechId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await expect(page.getByTestId('speech-video')).toBeVisible({ timeout: 30_000 })

  // Reviewer A holds a published review (9611) on this speech with 8
  // annotations seeded (mixed text/voice) — the "Your feedback" tablist
  // defaults to the Notes tab (SpeechWatch.tsx `<Tabs defaultValue="notes">`
  // at the !isOwner branch), which mounts AnnotationComposerPanel /
  // AnnotationList directly, no extra click needed.
  await expect(page.getByRole('tablist', { name: 'Your feedback' })).toBeVisible({ timeout: 30_000 })

  // Variant 1: list as it loads, nothing expanded.
  await scan(page, 'annotation', 'collapsed', USERS.reviewerA.email)

  // Variant 2: with one annotation's inline editor open — the DOM state
  // CP-15's "scan more than once" nuance calls for, since this screen's
  // whole point is changing over time. AnnotationRow.tsx's "Edit" button
  // mounts a per-row `AnnotationEditor` (`data-testid="annotation-editor"`)
  // in place; best-effort, since the exact first row depends on seed order.
  const editButton = page.getByRole('button', { name: 'Edit' }).first()
  if (await editButton.count() > 0) {
    await editButton.click()
    // Two matches, not one: the composer's own "New note" create-form
    // carries the same `data-testid="annotation-editor"` as the per-row
    // editor AnnotationRow.tsx mounts on "Edit" (both built on the same
    // <AnnotationEditor>) — assert on the one we just opened, not on
    // uniqueness of the testid across the panel.
    await expect(page.getByTestId('annotation-editor').last()).toBeVisible({ timeout: 10_000 })
    await scan(page, 'annotation', 'editor-open', USERS.reviewerA.email)
  } else {
    // Recorded rather than silently skipped — a future reader should know
    // why only one variant exists if the fixture ever changes shape.
    allResults.push({
      screen: 'annotation',
      variant: 'editor-open (SKIPPED — no Edit button found)',
      url: page.url(),
      loggedInAs: USERS.reviewerA.email,
      excluded: EXCLUDE_SELECTORS,
      results: null,
    })
  }
})

test('capture baseline: playback screen — speaker (owner) on speech 9601', async ({ page }) => {
  await login(page, USERS.speaker.email)

  await page.goto(`${APP_URL}/speeches/${VOICE.coachSpeechId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await expect(page.getByTestId('speech-video')).toBeVisible({ timeout: 30_000 })

  // Owner branch: "Speech tools" tablist, default Notes tab -> TrackSelector
  // + (per CP-15-accessibility-gates.md's own finding, §7.7.1) the
  // authoritative `<ol aria-label="Commentary transcript">` Transcript list.
  await expect(page.getByRole('tablist', { name: 'Speech tools' })).toBeVisible({ timeout: 30_000 })

  await scan(page, 'playback', 'default', USERS.speaker.email)
})

test('capture baseline: public profile/timeline screen — /u/e2e-member viewed by reviewer A', async ({ page }) => {
  await login(page, USERS.reviewerA.email)

  // Reviewer A (coach@e2e.test, id 9003) holds four reviews on the member's
  // (e2e-member, id 9004) speeches — confirmed via a direct DB read before
  // writing this spec (ids 9201, 9411, 9413, 9611; one published with 8
  // annotations, one with a published essay) — so the default `?tab=left`
  // timeline renders real commentary metadata, not a blank profile.
  await page.goto(`${APP_URL}/u/${USERS.speaker.username}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // Not `getByRole('main')` — the public profile page has no `<main>`
  // landmark at all (confirmed by running this: the page renders real
  // content, "Milo Member" heading, profile-sections nav, etc., but
  // `main` never matches). Itself a candidate finding worth flagging in
  // the baseline summary, not something to fix in this capture-only
  // phase. Wait on the heading that's actually there instead.
  await expect(page.getByRole('heading', { name: USERS.speaker.name, level: 1 })).toBeVisible({ timeout: 30_000 })

  await scan(page, 'profile-timeline', 'default', USERS.reviewerA.email)
})

test.afterAll(async () => {
  // NOT artifacts/accessibility-baseline/ — `artifacts/.gitignore` ignores
  // everything under it by design ("Never committed," STEP-09's bind-mount
  // scratch space for whisper-smoke diagnostics). §7.7.4 explicitly
  // requires this baseline to be COMMITTED as its own first step, or the
  // "before" number is unrecoverable the moment the first fix lands — a
  // gitignored directory would silently defeat that. Repo-root
  // `accessibility-baseline/` instead, alongside this repo's other
  // durable, committed planning docs.
  const outDir = path.resolve(dirname, '..', '..', 'accessibility-baseline')
  mkdirSync(outDir, { recursive: true })

  const today = new Date().toISOString().slice(0, 10)
  const outFile = path.join(outDir, `${today}-baseline.json`)

  writeFileSync(
    outFile,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        tool: {
          package: '@axe-core/playwright',
          packageVersion: '4.14.0',
          axeCoreVersion: '4.14.0',
        },
        axeTags: AXE_TAGS,
        excludedSelectors: EXCLUDE_SELECTORS,
        screens: allResults,
      },
      null,
      2,
    ),
  )

  // eslint-disable-next-line no-console
  console.log(`Baseline written to ${outFile}`)
})
