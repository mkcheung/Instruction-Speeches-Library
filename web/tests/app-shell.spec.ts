import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { API_URL, APP_URL, USERS } from './fixtures.js'
import type { CurrentUser } from '../src/features/auth/types.js'
import type { Review, ReviewSections } from '../src/features/review/types.js'

/**
 * PLAN-APP-HEADER.md's shell — header + sidebar on every authenticated
 * route, and the one regression the plan calls out by name (D5): the
 * public profile must stay reachable by an anonymous visitor. R3 wires
 * this into `ci.yml`'s Playwright command; R4's canary (all three
 * auth-setup projects still passing) is covered by CI running this
 * alongside the existing `speech-create.spec.ts`, not by anything in this
 * file specifically.
 *
 * Requires the fixture data from `api/database/seeders/E2ESeeder.php`, same
 * as `two-users.spec.ts`:
 *   docker compose exec app php artisan db:seed --class=Database\\Seeders\\E2ESeeder
 */

test.describe('authenticated shell', () => {
  test('the header and sidebar render on an authenticated route, and the skip link reaches <main>', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await page.goto(`${APP_URL}/dashboard`)

    // One <header> and one <main> landmark.
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByRole('main')).toBeVisible()

    // S7: the sidebar is a <nav> landmark, not an <aside> (which would
    // make this selector match nothing).
    //
    // The rail is `hidden md:flex` by design, so its visibility is a
    // function of viewport width, not a constant. Asserting it visible
    // unconditionally made this test fail on the `mobile-webkit` project
    // (iPhone 13, 390px) for a layout that is behaving correctly — a
    // failure CI never saw, because ci.yml runs this file with
    // `--project=chromium` only. Assert the actual responsive contract
    // instead: the rail above `md`, and `UserMenu` carrying the same
    // destinations below it (S1's reason for duplicating the list).
    const sidebar = page.getByRole('navigation', { name: 'Main' })
    const width = page.viewportSize()?.width ?? 0

    if (width >= 768) {
      await expect(sidebar).toBeVisible()
      await expect(sidebar.getByRole('link', { name: 'Edit profile' })).toBeVisible()
    } else {
      // Below `md` the rail collapses and `UserMenu` carries these
      // destinations instead — asserted in its own test below rather than
      // here, because opening that menu leaves focus on its trigger and
      // would break the Tab-from-the-top assertion that follows.
      await expect(sidebar).toBeHidden()
    }

    // D8 — Tab from a fresh load reaches "Skip to content" first, and it
    // moves focus into <main> (not just scrolls to it).
    // D1: `RequireAuth` renders `FullPageSpinner` in place of the whole
    // layout while `/api/me` is in flight, so the skip link isn't in the
    // DOM yet the instant `goto` resolves — the `expect(...).toBeVisible()`
    // calls above already waited that race out for us. Pressing `Tab`
    // before that would land on nothing (reproduced: `document.activeElement`
    // stayed on the spinner's `<body>`), which is what made this flaky in
    // WebKit specifically — its render is slower to win the race locally,
    // not a WebKit keyboard-focus quirk.
    //
    // Guarded to non-touch projects: `devices['iPhone 13']` emulates a
    // touch phone, where sequential Tab traversal is not a real user flow
    // and WebKit does not focus links on Tab by default. The skip link's
    // behaviour is identical on every desktop project, so this loses no
    // real coverage.
    if (!test.info().project.use.hasTouch) {
      await page.keyboard.press('Tab')
      await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('#content')).toBeFocused()
    }

    await context.close()
  })

  test('/profile is reachable by clicking the sidebar — previously reachable from nowhere', async ({ browser }) => {
    // The rail is `hidden md:flex`; below `md` there is no sidebar to
    // exercise and `UserMenu` carries these destinations instead (asserted
    // in the first test above). Skipping is the honest outcome here —
    // the previous unconditional assertion simply failed on `mobile-webkit`.
    test.skip((test.info().project.use.viewport?.width ?? 1280) < 768, 'sidebar is hidden below md')

    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await page.goto(`${APP_URL}/dashboard`)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Edit profile' }).click()
    await expect(page).toHaveURL(`${APP_URL}/profile`)

    await context.close()
  })

  test('the "My reviews" link in the nav landmark matches exactly once on /speeches (S2 strict-mode fix)', async ({
    browser,
  }) => {
    // The rail is `hidden md:flex`; below `md` there is no sidebar to
    // exercise and `UserMenu` carries these destinations instead (asserted
    // in the first test above). Skipping is the honest outcome here —
    // the previous unconditional assertion simply failed on `mobile-webkit`.
    test.skip((test.info().project.use.viewport?.width ?? 1280) < 768, 'sidebar is hidden below md')

    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await page.goto(`${APP_URL}/speeches`)
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My reviews' }),
    ).toHaveCount(1)

    await context.close()
  })
})

/**
 * The collapsed-rail half of the responsive nav contract. S1 duplicates
 * the sidebar's destinations into `UserMenu` precisely so that navigation
 * survives below `md`; nothing asserted that until the rail's breakpoint
 * moved, so this pins it.
 */
test.describe('collapsed navigation below md', () => {
  test('the user menu carries the sidebar destinations when the rail is hidden', async ({
    browser,
  }) => {
    test.skip(
      (test.info().project.use.viewport?.width ?? 1280) >= 768,
      'rail is visible at this width; covered by the sidebar tests above',
    )

    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await page.goto(`${APP_URL}/dashboard`)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()

    await page.getByRole('button', { name: USERS.speaker.name }).click()
    for (const label of ['My reviews', 'My speeches', 'Edit profile', 'Account & privacy']) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible()
    }

    await page.getByRole('menuitem', { name: 'Edit profile' }).click()
    await expect(page).toHaveURL(`${APP_URL}/profile`)

    await context.close()
  })
})

test.describe('D5 — public profile stays public', () => {
  test('an anonymous visitor loads /u/{username} and stays there, without being bounced to /login', async ({
    page,
  }) => {
    // Deliberately no storageState override — `page` here is a fresh,
    // unauthenticated context. The bug this guards: any 401 (including
    // one from an unguarded route's own `useGetMeQuery()`) broadcasts a
    // global `auth:unauthenticated` event, and `UnauthenticatedRedirect`
    // exempts only `/login`, `/register`, `/forgot-password` — a public
    // profile page that called `useGetMeQuery()` would eject the visitor.
    await page.goto(`${APP_URL}/u/${USERS.speaker.username}`)

    await expect(page).toHaveURL(`${APP_URL}/u/${USERS.speaker.username}`)
    // `@username` always renders regardless of whether display_name is
    // set (`PublicProfile.tsx` falls back to it in the heading too, so
    // `.first()` avoids a strict-mode double match either way) — the
    // safer assertion than asserting a specific display name.
    await expect(page.getByText(`@${USERS.speaker.username}`).first()).toBeVisible()
  })
})

/**
 * Frontend-only presentation evidence against the real Vite app. Every API
 * request is intercepted in a fresh context (including CSRF/login); no stored
 * session, database, fixture seeding or setup-project dependency is needed.
 * Run safely without the real-stack setup:
 *   npx playwright test tests/app-shell.spec.ts --grep 'option C presentation' --no-deps --project=chromium
 * To render the exact existing dist artifact without relying on Vite delivery,
 * prefix WORKSPACE_USE_BUILT_ASSETS=1. Finish the frontend build before running;
 * do not replace dist while browser requests are being served from it.
 * These checks do not establish backend credentials, MFA or real media playback.
 */
// The dev-server cold module budget matches existing browser art waits.
const presentationExpect = expect.configure({ timeout: 30_000 })
const presentationName = 'Morgan ' + 'LongAccountName'.repeat(5)
const presentationUser: CurrentUser = {
  id: 'presentation-member', email: 'presentation@example.test', first_name: 'Morgan', last_name: 'Member',
  username: 'presentation-member', display_name: presentationName, email_verified: true,
  roles: [], onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 0,
  quota_bytes: 1_000_000, uploads_in_flight: 0,
}
const presentationTitle = 'Presentation ' + 'LongUnbrokenSpeechTitle'.repeat(8)
const presentationNote = 'Please review my opening and pacing. ' + 'UnbrokenInvitationMessage'.repeat(12)
const presentationDate = '2026-10-01T12:00:00Z'
function presentationReview(id: number, status: Review['status']): Review {
  return {
    id, status, invitation_message: presentationNote, allow_preview: false, prior_commentary_shared: false,
    invited_at: presentationDate, responded_at: presentationDate, first_published_at: presentationDate,
    last_published_at: presentationDate, last_transition_at: presentationDate,
    revoked_at: null, revocation_reason: null,
    speech: { id: 9, ulid: 'presentation-speech', title: presentationTitle, owner_name: presentationName },
  }
}
const presentationSections: ReviewSections = {
  invited: [presentationReview(1, 'invited')],
  in_progress: [presentationReview(2, 'in_progress')],
  published: [presentationReview(3, 'published')],
  revoked: [{ ...presentationReview(4, 'accepted'), revoked_at: presentationDate, revocation_reason: 'Access withdrawn by speaker.' }],
}

async function interceptPresentationApi(context: BrowserContext, initiallyAuthenticated = true, notebook?: NotebookFixtureOptions) {
  // Optional delivery of the exact current build avoids Vite cold-module
  // failures without starting a server or manufacturing product markup.
  const builtRoot = process.env.WORKSPACE_USE_BUILT_ASSETS === '1'
    ? await realpath(fileURLToPath(new URL('../dist/', import.meta.url)))
    : null
  context.setDefaultNavigationTimeout(120_000)
  context.on('requestfailed', (request) => console.log('[option-C presentation/requestfailed]', request.url(), request.failure()?.errorText))
  context.on('page', (page) => page.on('pageerror', (error) => console.log('[option-C presentation/pageerror]', error.message)))
  let authenticated = initiallyAuthenticated
  const loginBodies: unknown[] = []
  const unexpected: string[] = []
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    // WebKit routes native Blob URL reads (captions/cropper) through this
    // callback. Permit only this page origin's exact browser-memory UUIDs;
    // HTTP UUID paths and foreign Blob origins retain fail-closed handling.
    const blobPrefix = `blob:${new URL(APP_URL).origin}/`
    if (request.url().startsWith(blobPrefix)
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.url().slice(blobPrefix.length))) {
      return route.continue()
    }
    if (notebook && url.origin === new URL(APP_URL).origin && ['/__notebook/speech.mp4', '/__notebook/voice.m4a'].includes(url.pathname)) return notebookMediaResponse(route, notebook)
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
    // Fail closed: no API, media, or unexpected external request reaches a server.
    if (url.origin !== new URL(API_URL).origin) {
      unexpected.push(request.url())
      return route.abort('blockedbyclient')
    }
    const headers = { 'access-control-allow-origin': APP_URL, 'access-control-allow-credentials': 'true' }
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body })
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS', 'access-control-allow-headers': 'content-type, x-xsrf-token, accept' } })
    }
    if (url.pathname === '/sanctum/csrf-cookie') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/login' && request.method() === 'POST') {
      loginBodies.push(request.postDataJSON())
      authenticated = true
      return json({ user: presentationUser })
    }
    if (notebook) {
      const response = notebookResponse(url, request.method(), notebook, request.method() === 'PATCH' ? request.postDataJSON() as Record<string, unknown> : undefined)
      if (response) return json(response.body, response.status ?? 200)
    }
    if (request.method() !== 'GET') {
      unexpected.push(`${request.method()} ${url.pathname}`)
      return json({ message: 'Unexpected presentation mutation blocked.' }, 500)
    }
    switch (url.pathname) {
      case '/api/me': return json(authenticated ? { user: notebook ? notebookUser(notebook) : presentationUser } : { message: 'Unauthenticated.' }, authenticated ? 200 : 401)
      case '/api/reviews': return json(presentationSections)
      case '/api/notifications': return json({ notifications: [1, 2].map((id) => ({
        id: `presentation-notification-${id}`, type: 'review.invited', read_at: null, created_at: presentationDate,
        data: { type: 'review.invited', actor_name: 'Avery Speaker', speech_title: presentationTitle, url: `${APP_URL}/dashboard` },
      })), unread_count: 2 })
      case '/api/connections': return json({ connections: [{ id: 1, state: 'pending', peer: { name: 'Avery Speaker', username: 'avery' } }] })
      case '/api/speeches': return json({ speeches: [], meta: { current_page: 1, last_page: 1, total: 0 } })
      case '/api/reviewers': return json({ reviewers: [], meta: { current_page: 1, last_page: 1, total: 0 } })
      case '/api/speeches/search': return json({ results: [{
        id: 9, ulid: 'presentation-speech', user_id: 1, title: 'A clear voice', description: 'A speech about confidence.',
        delivered_on: null, change_note: null, created_at: presentationDate, captions_enabled: true, primary_video: null,
        search_match: {
          title: [{ text: 'A clear ', matched: false }, { text: 'voice', matched: true }],
          description: [{ text: 'A speech about confidence.', matched: false }],
          transcript_excerpt: { truncated_before: true, truncated_after: true, parts: [{ text: 'Find your ', matched: false }, { text: 'voice', matched: true }] },
        },
      }] })
      case '/api/queue/transcode-depth': return json({ depth: 0 })
      case '/api/speeches/9': return json({ message: 'Speech not found.' }, 404)
      default:
        unexpected.push(`${request.method()} ${url.pathname}`)
        return json({ message: 'Unmapped presentation API request blocked.' }, 500)
    }
  })
  return { loginBodies, unexpected }
}

async function expectNoPageOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll('body *')).filter((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.width && bounds.right > window.innerWidth + 1
    }).slice(0, 8).map((element) => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width })),
  }))
  presentationExpect(geometry.page, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport + 1)
}

async function expectTargetSizes(page: Page, selector: string) {
  const targets = await page.locator(selector).evaluateAll((elements) => elements
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => ({ label: element.textContent || element.getAttribute('aria-label'), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })))
  presentationExpect(targets.length).toBeGreaterThan(0)
  for (const target of targets) {
    presentationExpect(target.width, `${target.label}: target width`).toBeGreaterThanOrEqual(44)
    presentationExpect(target.height, `${target.label}: target height`).toBeGreaterThanOrEqual(44)
  }
}

test.describe('option C presentation (isolated frontend)', () => {
  test.setTimeout(120_000)

  test('guest login retains labels, validation, remember default and local mocked submission', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const mocked = await interceptPresentationApi(context, false)
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/login?verified=1`)
      await presentationExpect(page.getByRole('heading', { level: 1 })).toHaveText('Log in')
      await presentationExpect(page.getByText('Welcome back.', { exact: true })).toBeVisible()
      await presentationExpect(page.getByText('Email verified — log in to continue.')).toBeVisible()
      await presentationExpect(page.getByRole('checkbox', { name: 'Remember me' })).not.toBeChecked()
      await presentationExpect(page.getByRole('textbox', { name: 'Email' })).toHaveAttribute('autocomplete', 'email')
      await presentationExpect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveAttribute('autocomplete', 'current-password')
      await presentationExpect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
      await presentationExpect(page.getByRole('link', { name: 'Register', exact: true })).toHaveAttribute('href', '/register')
      await presentationExpect(page.locator('[data-workspace-scene="welcome"] [data-workspace-art]')).toBeVisible()
      await page.screenshot({ path: test.info().outputPath('option-c-login-desktop.png'), fullPage: true })
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await presentationExpect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true')
      presentationExpect(mocked.loginBodies).toEqual([])
      await page.getByRole('textbox', { name: 'Email' }).fill(presentationUser.email)
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('preview-password')
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await presentationExpect(page).toHaveURL(`${APP_URL}/dashboard`)
      await presentationExpect(page.getByRole('heading', { name: 'My reviews', exact: true })).toBeVisible()
      presentationExpect(mocked.loginBodies).toEqual([{ email: presentationUser.email, password: 'preview-password', remember: false }])
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  test('login reflows at 320 through 1440 and stays paper colored in system and explicit dark modes', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const mocked = await interceptPresentationApi(context, false)
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/login`)
      await presentationExpect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page)
        await expectTargetSizes(page, '.workspace-login input:not([type="checkbox"]), .workspace-login .workspace-button, .workspace-login .workspace-link')
        if (width < 1024) await presentationExpect(page.locator('.workspace-login-welcome')).toBeHidden()
        else await presentationExpect(page.locator('.workspace-login-welcome')).toBeVisible()
        await presentationExpect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
        if (width === 375) await page.screenshot({ path: test.info().outputPath('option-c-login-mobile.png'), fullPage: true })
      }
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
        for (const explicitDark of [false, true]) {
          await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), explicitDark)
          await presentationExpect(page.locator('.workspace-login-card')).toHaveCSS('background-color', 'rgb(255, 253, 246)')
          await presentationExpect(page.locator('#email')).toHaveCSS('background-color', 'rgb(255, 253, 246)')
          await presentationExpect(page.getByRole('button', { name: 'Log in', exact: true })).toHaveCSS('background-color', 'rgb(15, 107, 102)')
        }
      }
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  test('dashboard preserves four sections, real action names, long content and responsive rail geometry', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const mocked = await interceptPresentationApi(context)
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/dashboard?verified=1`)
      for (const name of ['Invitations awaiting response', 'In progress', 'Published work', 'Revoked']) {
        await presentationExpect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible()
      }
      await presentationExpect(page.getByText(presentationNote, { exact: true })).toBeVisible()
      for (const name of ['Accept', 'Decline', 'Withdraw', 'Abandon']) await presentationExpect(page.getByRole('button', { name, exact: true })).toBeVisible()
      await presentationExpect(page.getByRole('link', { name: 'Watch', exact: true })).toHaveCount(2)
      await presentationExpect(page.getByText('This speech isn’t available to open.')).toBeVisible()
      await presentationExpect(page.getByText(/Started .*2026/)).toBeVisible()
      await presentationExpect(page.getByText(/Published .*2026/)).toBeVisible()
      await presentationExpect(page.getByText(/Revoked .*2026/)).toBeVisible()
      const rail = page.getByRole('navigation', { name: 'Main' })
      await presentationExpect(rail.getByRole('link')).toHaveCount(9)
      await presentationExpect(rail.getByRole('link', { name: 'My reviews', exact: true })).toHaveAttribute('aria-current', 'page')
      await presentationExpect(rail.getByRole('link', { name: 'My reviews', exact: true })).toHaveCSS('background-color', 'rgb(138, 23, 32)')
      await presentationExpect(page.locator('.workspace-scene--sidebar[data-workspace-scene="reviews"] [data-workspace-pose="seated-reading"]')).toBeVisible({ timeout: 30_000 })
      await page.screenshot({ path: test.info().outputPath('option-c-dashboard-desktop.png'), fullPage: true })
      for (const width of [320, 375, 767, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page)
        await presentationExpect(page.getByRole('banner')).toHaveCSS('height', '56px')
        await expectTargetSizes(page, '.workspace-header-actions > button, .workspace-dashboard .workspace-notebook-control')
        await presentationExpect(page.getByRole('button', { name: presentationName, exact: true })).toBeVisible()
        await presentationExpect(page.getByRole('button', { name: 'Notifications (2 unread)', exact: true })).toBeVisible()
        await presentationExpect(page.getByRole('button', { name: 'Connection requests (1 pending)', exact: true })).toBeVisible()
        if (width < 768) await presentationExpect(rail).toBeHidden()
        else {
          await presentationExpect(rail).toBeVisible()
          await presentationExpect(rail).toHaveCSS('width', width >= 1280 ? '256px' : '224px')
          await expectTargetSizes(page, '.workspace-sidebar-link')
        }
        if (width === 375) await page.screenshot({ path: test.info().outputPath('option-c-dashboard-mobile.png'), fullPage: true })
      }
      for (const height of [640, 719, 720, 900]) {
        await page.setViewportSize({ width: 1024, height })
        const scene = page.locator('.workspace-scene--sidebar[data-workspace-scene="reviews"]')
        if (height < 720) await presentationExpect(scene).toBeHidden()
        else {
          await presentationExpect(scene).toBeVisible()
          await presentationExpect(scene).toHaveCSS('width', '184px')
          await presentationExpect(scene).toHaveCSS('height', '176px')
          const bounds = await scene.boundingBox()
          presentationExpect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height)
        }
        await rail.getByRole('link', { name: 'Become a Coach', exact: true }).scrollIntoViewIfNeeded()
        await presentationExpect(rail.getByRole('link', { name: 'Become a Coach', exact: true })).toBeInViewport()
      }
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  test('mobile menu remains complete and portals and avatar retain their own theme', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 900 } })
    const mocked = await interceptPresentationApi(context)
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/dashboard`)
      await presentationExpect(page.getByRole('heading', { name: 'My reviews', exact: true })).toBeVisible()
      const account = page.getByRole('button', { name: presentationName, exact: true })
      const avatar = account.locator('span[aria-hidden="true"]')
      const avatarPair = await avatar.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color }))
      presentationExpect(avatarPair.background).not.toBe('rgba(0, 0, 0, 0)')
      presentationExpect(avatarPair.foreground).not.toBe(avatarPair.background)
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        for (const explicitDark of [false, true]) {
          await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), explicitDark)
          await presentationExpect(page.locator('.workspace-dashboard')).toHaveCSS('background-color', 'rgb(255, 245, 230)')
          await presentationExpect(page.locator('.workspace-dashboard .workspace-notebook-panel').first()).toHaveCSS('background-color', 'rgb(255, 253, 246)')
          await presentationExpect(page.locator('.workspace-header-actions [data-slot="badge"]').first()).toHaveCSS('background-color', 'rgb(185, 28, 28)')
          await presentationExpect(page.locator('.workspace-header-actions [data-slot="badge"]').first()).toHaveCSS('color', 'rgb(255, 253, 246)')
          await account.click()
          await presentationExpect(account).toHaveAttribute('aria-expanded', 'true')
          await presentationExpect(account).toHaveCSS('background-color', 'rgb(248, 236, 218)')
          for (const name of ['My reviews', 'My speeches', 'Find reviewers', 'Upload a speech', 'Search', 'Your profile', 'Edit profile', 'Account & privacy', 'Become a Coach', 'Log out']) {
            await presentationExpect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
          }
          const popup = page.getByRole('menu')
          presentationExpect(await popup.evaluate((element) => Boolean(element.closest('.workspace-header, .workspace-sidebar, .workspace-dashboard, .workspace-login')))).toBe(false)
          presentationExpect(await popup.evaluate((element) => getComputedStyle(element).getPropertyValue('--workspace-paper'))).toBe('')
          presentationExpect(await avatar.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color }))).toEqual(avatarPair)
          await page.keyboard.press('Escape')
        }
      }
      await account.click()
      await page.getByRole('menuitem', { name: 'Search', exact: true }).click()
      await presentationExpect(page).toHaveURL(`${APP_URL}/search`)
      await presentationExpect(page.getByRole('heading', { name: 'Search your speeches', exact: true })).toBeVisible()
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  test('real routes, direct visits, history and watch omission agree with selected sidebar links', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
    const mocked = await interceptPresentationApi(context)
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/dashboard`)
      const rail = page.getByRole('navigation', { name: 'Main' })
      await presentationExpect(page.locator('.workspace-scene--sidebar[data-workspace-scene="reviews"]')).toBeVisible({ timeout: 30_000 })
      await rail.getByRole('link', { name: 'My speeches', exact: true }).click()
      await presentationExpect(page.locator('.workspace-scene--sidebar[data-workspace-scene="speeches"]')).toBeVisible()
      await rail.getByRole('link', { name: 'Search', exact: true }).click()
      await presentationExpect(page.locator('.workspace-scene--sidebar[data-workspace-scene="search"]')).toBeVisible()
      await page.goBack()
      await presentationExpect(page.locator('.workspace-scene--sidebar[data-workspace-scene="speeches"]')).toBeVisible()
      await page.goForward()
      await presentationExpect(page.locator('.workspace-scene--sidebar[data-workspace-scene="search"]')).toBeVisible()
      await page.getByRole('textbox', { name: 'Search text' }).fill('voice')
      await presentationExpect(page.getByText('Transcript excerpt', { exact: true })).toBeVisible()
      await presentationExpect(page.locator('mark')).toHaveCount(2)
      presentationExpect(await page.locator('mark').first().evaluate((element) => Boolean(element.closest('.workspace-dashboard')))).toBe(false)
      for (const [path, scene] of [['/SEARCH?q=voice#results', 'search'], ['/speeches/new/', 'upload'], ['/reviewers', 'reviewers']] as const) {
        await page.goto(`${APP_URL}${path}`)
        await presentationExpect(page.locator(`.workspace-scene--sidebar[data-workspace-scene="${scene}"]`)).toBeVisible()
        await presentationExpect(rail.locator('[aria-current="page"]')).toHaveCount(1)
      }
      await page.goto(`${APP_URL}/speeches/`)
      await presentationExpect(rail).toBeVisible()
      await presentationExpect(rail.locator('[aria-current="page"]')).toHaveCount(0)
      await presentationExpect(rail.locator('[data-workspace-scene]')).toHaveCount(0)
      await page.goto(`${APP_URL}/speeches/9`)
      await presentationExpect(rail).toBeVisible()
      await presentationExpect(rail.locator('[aria-current="page"]')).toHaveCount(0)
      await presentationExpect(rail.locator('[data-workspace-scene]')).toHaveCount(0)
      // Deliberately a mocked unavailable speech, not media/playback proof.
      await presentationExpect(page.getByRole('main')).toBeVisible()
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  test('forced colors hide art and keyboard skip navigation survives', async ({ browser, browserName }) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' })
    const mocked = await interceptPresentationApi(context)
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/dashboard`)
      await presentationExpect(page.getByRole('heading', { name: 'My reviews', exact: true })).toBeVisible()
      // macOS Safari defaults Tab to controls; Option+Tab includes links.
      const nextLinkKey = process.platform === 'darwin' && browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
      await page.keyboard.press(nextLinkKey)
      await presentationExpect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
      await page.keyboard.press('Enter')
      await presentationExpect(page.getByRole('main')).toBeFocused()
      await presentationExpect(page.locator('.workspace-scene--sidebar[data-workspace-scene="reviews"]')).toBeVisible({ timeout: 30_000 })
      await page.emulateMedia({ forcedColors: 'active' })
      await presentationExpect(page.locator('.workspace-scene--sidebar[data-workspace-scene="reviews"]')).toBeHidden()
      await presentationExpect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My reviews', exact: true })).toBeVisible()
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })
})

// Test-local wire fixtures only. Every response follows the current API slice;
// unknown requests still fail closed in the surrounding interceptor.
interface NotebookFixtureOptions {
  reviewer?: boolean
  feedback?: boolean
  playbackMode?: 'all' | 'written' | 'voice' | 'off'
  notReady?: boolean
  portrait?: boolean
  mode?: 'ready' | 'empty' | 'error'
  media?: Buffer
  coachStatus?: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn'
}
const notebookDate = '2026-10-01T12:00:00Z'
const notebookTitle = 'Finding a clear voice ' + 'LongSpeechTitle'.repeat(12)
function notebookUser(options: NotebookFixtureOptions) {
  return { id: options.reviewer ? '2' : '1', email: 'notebook@example.test', first_name: 'Morgan', last_name: 'Member',
    username: 'notebook-member', display_name: 'Morgan Member', roles: [], email_verified: true,
    onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 120_000, quota_bytes: 5_000_000, uploads_in_flight: 0 }
}
function notebookSpeech(options: NotebookFixtureOptions) {
  return { id: 9, ulid: 'notebook-speech', user_id: 1, title: notebookTitle,
    description: 'A rehearsal about confidence, opening clearly and connecting with the audience.',
    delivered_on: null, change_note: null, created_at: notebookDate, captions_enabled: true,
    primary_video: { id: 90, kind: 'video', status: options.notReady ? 'processing' : 'ready', failure_code: null, duration_seconds: '3',
      width: options.portrait ? 360 : 640, height: options.portrait ? 640 : 360, poster_time_seconds: null } }
}
function notebookReview(options: NotebookFixtureOptions) {
  return { id: 22, status: 'in_progress', invitation_message: 'Please consider my opening.', allow_preview: false,
    prior_commentary_shared: false, invited_at: notebookDate, responded_at: notebookDate,
    first_published_at: options.feedback ? notebookDate : null, last_published_at: options.feedback ? notebookDate : null, last_transition_at: notebookDate, revoked_at: null, revocation_reason: null,
    speech: { id: 9, ulid: 'notebook-speech', title: notebookTitle, owner_name: 'Morgan Member' },
    reviewer: { id: options.reviewer ? 2 : 3, username: 'avery-reviewer', name: 'Avery Reviewer' } }
}
function notebookResponse(url: URL, method: string, options: NotebookFixtureOptions, body?: Record<string, unknown>): { body: unknown; status?: number } | undefined {
  const path = url.pathname
  if (method === 'PATCH' && /^\/api\/me\/preferences\/commentary-playback\/9$/.test(path)) {
    // State-changing requests stay entirely within this browser fixture.
    if (['all', 'written', 'voice', 'off'].includes(String(body?.mode))) options.playbackMode = body!.mode as NotebookFixtureOptions['playbackMode']
    return { body: { commentary_playback: { speech_id: 9, mode: options.playbackMode ?? 'all', source: 'saved' } } }
  }
  if (method === 'PUT' && path === '/api/speeches/9/essay') return { body: { essay: {
    essay_html: '<p><strong>A clear opening.</strong></p>', essay_text: 'A clear opening.', essay_words: 4,
    essay_published_at: null, essay_updated_at: notebookDate, essay_lock_version: 1,
  } } }
  if (method === 'POST' && path === '/api/speeches') return { body: { speech: notebookSpeech(options) }, status: 201 }
  if (method !== 'GET') return undefined
  const handled = ['/api/speeches', '/api/reviewers', '/api/speeches/search', '/api/u/notebook-member',
    '/api/privacy/exports', '/api/coach-applications/me', '/api/speeches/9', '/api/speeches/9/assets/90/playback-url',
    '/api/speeches/9/captions', '/api/speeches/9/transcript', '/api/speeches/9/reviews', '/api/speeches/9/review-roster',
    '/api/speeches/9/annotations', '/api/speeches/9/annotations/notebook-voice/voice-playback-url', '/api/speeches/9/essay', '/api/me/preferences/commentary-playback/9',
    '/api/me/preferences/voice-commentary/9']
  if (!handled.includes(path)) return undefined
  if (options.mode === 'error') return { status: 500, body: { message: 'Presentation fixture failure.' } }
  const speech = notebookSpeech(options), review = notebookReview(options), empty = options.mode === 'empty'
  switch (path) {
    case '/api/speeches': return { body: { speeches: empty ? [] : [speech], meta: { current_page: 1, last_page: 1, total: empty ? 0 : 1 } } }
    case '/api/reviewers': return { body: { reviewers: empty ? [] : [
      { id: 3, name: 'Avery Reviewer', username: 'avery-reviewer', credential: 'coach', avatar_url: null },
      { id: 4, name: 'Jamie Member', username: 'jamie-member', credential: 'member', avatar_url: null },
    ], meta: { current_page: 1, last_page: 1, total: empty ? 0 : 2 } } }
    case '/api/u/notebook-member': return { body: { profile: { id: options.reviewer ? 2 : 1, username: 'notebook-member',
      display_name: 'Morgan Member', bio: 'Practising a clear opening.', pronouns: 'they/them', location: 'Rehearsal room', avatar_url: null } } }
    case '/api/privacy/exports': return { body: { exports: [] } }
    case '/api/coach-applications/me': return { body: { coachApplication: { id: 7, status: options.coachStatus ?? 'draft',
      statement: 'I want to help speakers practise.', decision_reason: 'Please add supporting experience.', submitted_at: null,
      decided_at: null, documents: [{ id: 1, original_filename: 'Certificate' + 'LongFileName'.repeat(10) + '.pdf', status: 'clean', created_at: notebookDate }] } } }
    case '/api/speeches/search': return { body: { results: empty ? [] : [{ ...speech, search_match: {
      title: [{ text: 'Finding a clear ', matched: false }, { text: 'voice', matched: true }],
      description: [{ text: speech.description, matched: false }], transcript_excerpt: { truncated_before: true, truncated_after: true,
        parts: [{ text: 'Find your ', matched: false }, { text: 'voice', matched: true }, { text: ' and connect with the audience.', matched: false }] },
    } }] } }
    case '/api/speeches/9': return { body: { speech } }
    case '/api/speeches/9/assets/90/playback-url': return { body: { url: `${APP_URL}/__notebook/speech.mp4` } }
    case '/api/speeches/9/captions': return { body: { captions: { status: 'ready', asset_id: 91, failure_code: null, updated_at: notebookDate,
      revision: 'notebook-revision', vtt: 'WEBVTT\n\n00:00.000 --> 00:03.000\nFind your voice.\n' } } }
    case '/api/speeches/9/transcript': return { body: { transcript: { body: 'Find your voice.', segments: [{ start: 0, end: 3, text: 'Find your voice.' }],
      word_count: 3, words_per_minute: 60, language: 'en', model: 'fixture', source: 'whisper', updated_at: notebookDate, caption_revision: 'notebook-revision' } } }
    case '/api/speeches/9/reviews': return { body: { reviews: [review] } }
    case '/api/speeches/9/review-roster': return { body: { reviews: [{ ...review, annotations_count: options.feedback ? 2 : 0, published_annotations_count: options.feedback ? 2 : 0, revoked_by_is_self: false }] } }
    case '/api/speeches/9/annotations': return { body: { review_id: Number(url.searchParams.get('review_id')), reviewer: review.reviewer, annotations: options.feedback ? [
      { id: 'notebook-written', timing_type: 'range', start_seconds: 0, duration_seconds: .8, kind: 'observation', topic: null,
        body: 'Pause briefly before the opening sentence.', lock_version: 1, client_uuid: 'notebook-written', voice: null },
      { id: 'notebook-voice', timing_type: 'point', start_seconds: 1.2, duration_seconds: 10, kind: 'observation', topic: null,
        body: 'Your opening sounds warm and confident.', lock_version: 1, client_uuid: 'notebook-voice',
        voice: { asset_id: 92, audio_status: 'ready', transcript_status: 'ready', failure_code: null } },
    ] : [] } }
    case '/api/speeches/9/annotations/notebook-voice/voice-playback-url': return { body: { audio: { url: `${APP_URL}/__notebook/voice.m4a`, expires_at: '2030-01-01T00:00:00Z' } } }
    case '/api/speeches/9/essay': return { body: { essay: { essay_html: '<p>A clear opening.</p>', essay_text: 'A clear opening.', essay_words: 4,
      essay_published_at: null, essay_updated_at: notebookDate, essay_lock_version: 0 } } }
    case '/api/me/preferences/commentary-playback/9': return { body: { commentary_playback: { speech_id: 9, mode: options.playbackMode ?? 'all', source: 'saved' } } }
    case '/api/me/preferences/voice-commentary/9': return { body: { voice_commentary: { speech_id: 9, mode: 'auto', experienced: true } } }
  }
}
async function notebookMediaResponse(route: import('@playwright/test').Route, options: NotebookFixtureOptions) {
  const voice = new URL(route.request().url()).pathname === '/__notebook/voice.m4a'
  const bytes = voice ? await readFile(fileURLToPath(new URL('../../api/tests/fixtures/whisper-smoke/spoken-fixture.m4a', import.meta.url)))
    : options.media ?? await readFile(fileURLToPath(new URL('../../api/tests/fixtures/e2e-captions/caption-fixture.mp4', import.meta.url)))
  if (!['/__notebook/speech.mp4', '/__notebook/voice.m4a'].includes(new URL(route.request().url()).pathname) || !['GET', 'HEAD'].includes(route.request().method())) return route.abort('blockedbyclient')
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
  return route.fulfill({ status: range ? 206 : 200, body: bytes.subarray(start, end + 1), headers: {
    'content-type': voice ? 'audio/mp4' : 'video/mp4', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1),
    ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}),
  } })
}

const notebookRoutes = [
  ['/dashboard', 'My reviews', 'reviews'], ['/speeches', 'My speeches', 'speeches'],
  ['/reviewers', 'Find reviewers', 'reviewers'], ['/speeches/new', 'Upload a speech', 'upload'],
  ['/search', 'Search your speeches', 'search'], ['/profile', 'Edit profile', 'edit'],
  ['/account', 'Account & privacy', 'account'], ['/become-a-coach', 'Become a Coach', 'coach'],
  ['/speeches/9', notebookTitle, 'reviews'],
] as const

/** Native browser encoding of visible moving footage, not a mocked video API.
 * Actual recording/microphone, object storage and transcode services are outside
 * this isolated presentation lane. No codec, dependency or service is installed. */
async function createNotebookMedia(browser: Browser, portrait: boolean): Promise<Buffer> {
  const page = await browser.newPage()
  try {
    const base64 = await page.evaluate(async (isPortrait) => {
      const canvas = document.createElement('canvas')
      canvas.width = isPortrait ? 360 : 640
      canvas.height = isPortrait ? 640 : 360
      const ctx = canvas.getContext('2d')!
      let frame = 0
      const draw = () => {
        const w = canvas.width, h = canvas.height
        ctx.fillStyle = '#fff5e6'; ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#8a1720'; ctx.fillRect(0, 0, w / 8, h); ctx.fillRect(w * 7 / 8, 0, w / 8, h)
        ctx.fillStyle = '#0f6b66'; ctx.fillRect(w * .35, h * .48, w * .3, h * .52)
        ctx.fillStyle = '#e9b949'; ctx.beginPath(); ctx.arc(w / 2 + Math.sin(frame++ / 3) * 12, h * .35, w * .09, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#2b211b'; ctx.fillRect(w * .47, h * .33, 4, 4); ctx.fillRect(w * .53, h * .33, 4, 4)
      }
      draw()
      const stream = canvas.captureStream(10)
      const mime = ['video/mp4;codecs=avc1.42E01E', 'video/mp4'].find((candidate) => MediaRecorder.isTypeSupported(candidate))
      if (!mime) throw new Error('Installed browser has no native MP4 recorder; media evidence cannot be claimed.')
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
      recorder.start()
      const timer = window.setInterval(draw, 100)
      await new Promise((resolve) => window.setTimeout(resolve, 3100))
      recorder.stop(); window.clearInterval(timer); await stopped
      stream.getTracks().forEach((track) => track.stop())
      const bytes = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer())
      return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    }, portrait)
    return Buffer.from(base64, 'base64')
  } finally { await page.close() }
}

async function expectNotebookScene(page: Page, scene: string | null) {
  const visible = page.locator('.workspace-scene--sidebar:visible, .workspace-scene--compact:visible')
  await presentationExpect(visible).toHaveCount(scene ? 1 : 0)
  if (scene) {
    await presentationExpect(visible).toHaveAttribute('data-workspace-scene', scene)
    await presentationExpect(visible.locator('[data-workspace-art]')).toBeVisible()
  }
}

test.describe('notebook presentation (isolated frontend)', () => {
  test.setTimeout(240_000)
  for (const width of [375, 1440]) {
    test(`all nine working pages retain real content and notebook panels at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const mocked = await interceptPresentationApi(context, true, {})
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        for (const [path, title, scene] of notebookRoutes) {
          await page.goto(`${APP_URL}${path}`)
          await presentationExpect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
          await presentationExpect(page.getByRole('main')).toHaveCount(1)
          await presentationExpect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
          await presentationExpect(page.locator('.workspace-notebook-page')).toHaveCSS('background-color', 'rgb(255, 245, 230)')
          await expectNotebookScene(page, scene)
          await expectNoPageOverflow(page)
          if (path === '/speeches') {
            await presentationExpect(page.getByRole('link', { name: 'Watch', exact: true })).toBeVisible()
            await presentationExpect(page.locator('.workspace-notebook-poster-card > [data-slot="card-header"]')).toHaveCSS('border-left-width', '0px')
          }
          if (path === '/reviewers') {
            await presentationExpect(page.getByText('Avery Reviewer', { exact: true })).toBeVisible()
            await presentationExpect(page.getByRole('button', { name: 'Coaches', exact: true })).toHaveAttribute('aria-pressed', 'false')
            await page.getByRole('button', { name: 'Coaches', exact: true }).click()
            await presentationExpect(page.getByRole('button', { name: 'Coaches', exact: true })).toHaveAttribute('aria-pressed', 'true')
          }
          if (path === '/speeches/new') {
            await presentationExpect(page.getByLabel('This replaces an earlier attempt')).toBeVisible()
            await page.getByLabel('This replaces an earlier attempt').selectOption('9')
            await presentationExpect(page.getByLabel('What did you change?')).toBeVisible()
          }
          if (path === '/search') {
            await page.getByRole('textbox', { name: 'Search text' }).fill('voice')
            await presentationExpect(page.getByText('Transcript excerpt', { exact: true })).toBeVisible()
            await presentationExpect(page.locator('mark')).toHaveCount(2)
            const matchColor = await page.locator('mark').last().evaluate((element) => {
              const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
              const ctx = canvas.getContext('2d')!; ctx.fillStyle = getComputedStyle(element).backgroundColor; ctx.fillRect(0, 0, 1, 1)
              return Array.from(ctx.getImageData(0, 0, 1, 1).data)
            })
            presentationExpect(matchColor[0]).toBeGreaterThan(200); presentationExpect(matchColor[1]).toBeGreaterThan(180); presentationExpect(matchColor[2]).toBeLessThan(190)
          }
          if (path === '/account') {
            await presentationExpect(page.getByRole('button', { name: 'Request export', exact: true })).toHaveCount(2)
            await presentationExpect(page.getByRole('button', { name: 'Delete my account', exact: true })).toHaveCSS('color', 'rgb(185, 28, 28)')
            await presentationExpect(page.locator('.workspace-notebook-danger')).toHaveCSS('box-shadow', 'none')
          }
          if (path === '/profile') await presentationExpect(page.getByLabel('Bio', { exact: true })).toHaveValue('Practising a clear opening.')
          if (path === '/become-a-coach') await presentationExpect(page.getByText(/CertificateLongFileName/)).toBeVisible()
          if (path === '/speeches/9') {
            await presentationExpect(page.getByRole('tablist', { name: 'Speech tools' })).toBeVisible()
            await presentationExpect(page.locator('.video-js [data-workspace-scene]')).toHaveCount(0)
            await presentationExpect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]')).toHaveCount(0)
          }
          await page.screenshot({ path: test.info().outputPath(`notebook-${path.replaceAll('/', '-')}-${width}.png`), fullPage: true })
        }
        presentationExpect(errors).toEqual([])
        presentationExpect(mocked.unexpected).toEqual([])
      } finally { await context.close() }
    })
  }

  test('breakpoints, maximum navigation, sticky rail, compact exclusivity and forced colors preserve reflow', async ({ browser, browserName }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    const mocked = await interceptPresentationApi(context, true, {})
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/dashboard`)
      await presentationExpect(page.getByRole('heading', { name: 'My reviews', exact: true })).toBeVisible()
      const rail = page.getByRole('navigation', { name: 'Main' })
      await presentationExpect(rail.getByRole('link')).toHaveCount(9)
      for (const width of [320, 375, 767, 768, 1024, 1279, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(() => window.scrollTo(0, 0))
        await expectNoPageOverflow(page)
        await presentationExpect(page.getByRole('banner')).toHaveCSS('height', '56px')
        await expectTargetSizes(page, '.workspace-header-actions > button, .workspace-dashboard .workspace-notebook-control')
        if (width < 768) await presentationExpect(rail).toBeHidden()
        else await presentationExpect(rail).toHaveCSS('width', width >= 1280 ? '256px' : '224px')
        await expectNotebookScene(page, width < 360 ? null : 'reviews')
      }
      for (const height of [640, 719, 720, 900]) {
        await page.setViewportSize({ width: 1024, height })
        await page.evaluate(() => window.scrollTo(0, 0))
        const large = rail.locator('.workspace-scene--sidebar')
        if (height < 720) await presentationExpect(large).toBeHidden()
        else {
          await presentationExpect(large).toHaveCSS('width', '184px')
          await presentationExpect(large).toHaveCSS('height', '176px')
        }
        await expectNotebookScene(page, 'reviews')
        await rail.getByRole('link', { name: 'Become a Coach', exact: true }).scrollIntoViewIfNeeded()
        await presentationExpect(rail.getByRole('link', { name: 'Become a Coach', exact: true })).toBeInViewport()
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.evaluate(() => window.scrollTo(0, 600))
      const sticky = await rail.locator('.workspace-scene--sidebar').boundingBox()
      presentationExpect(sticky!.y).toBeGreaterThanOrEqual(15)
      await presentationExpect(rail.locator('.workspace-scene--sidebar')).toHaveCSS('position', 'sticky')
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      const contained = await rail.locator('.workspace-scene--sidebar').boundingBox(), railBounds = await rail.boundingBox()
      presentationExpect(contained!.y + contained!.height).toBeLessThanOrEqual(railBounds!.y + railBounds!.height + 1)
      await page.goto(`${APP_URL}/dashboard`)
      await presentationExpect(page.getByRole('heading', { name: 'My reviews', exact: true })).toBeVisible()
      await page.keyboard.press(process.platform === 'darwin' && browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
      await presentationExpect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
      await page.keyboard.press('Enter')
      await presentationExpect(page.getByRole('main')).toBeFocused()
      await page.emulateMedia({ forcedColors: 'active' })
      await expectNotebookScene(page, null)
      await page.setViewportSize({ width: 375, height: 640 })
      await expectNotebookScene(page, null)
      await presentationExpect(page.locator('.workspace-notebook-panel').first()).toHaveCSS('box-shadow', 'none')
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  test('dark modes keep fields, selected filters, destructive actions and portal menus readable', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 900 } })
    const mocked = await interceptPresentationApi(context, true, {})
    const page = await context.newPage()
    try {
      for (const colorScheme of ['light', 'dark'] as const) for (const explicitDark of [false, true]) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
        await page.goto(`${APP_URL}/reviewers`)
        await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), explicitDark)
        const field = page.getByRole('textbox', { name: 'Search by name or username' })
        await presentationExpect(field).toHaveCSS('background-color', 'rgb(255, 253, 246)')
        await presentationExpect(field).toHaveCSS('color', 'rgb(43, 33, 27)')
        await field.focus()
        await presentationExpect(field).toBeFocused()
        await page.getByRole('button', { name: 'Coaches', exact: true }).click()
        await presentationExpect(page.getByRole('button', { name: 'Coaches', exact: true })).toHaveCSS('background-color', 'rgb(11, 86, 82)')
        await presentationExpect(page.getByRole('button', { name: 'Members', exact: true })).toHaveCSS('background-color', 'rgb(255, 253, 246)')
        await page.getByRole('button', { name: 'Morgan Member', exact: true }).click()
        const popup = page.getByRole('menu')
        await presentationExpect(popup).toBeVisible()
        presentationExpect(await popup.evaluate((element) => Boolean(element.closest('.workspace-notebook-surface, .workspace-notebook-page')))).toBe(false)
        presentationExpect(await popup.evaluate((element) => getComputedStyle(element).getPropertyValue('--workspace-paper'))).toBe('')
        await page.keyboard.press('Escape')
        await page.goto(`${APP_URL}/account`)
        await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), explicitDark)
        await presentationExpect(page.getByRole('button', { name: 'Delete my account', exact: true })).toHaveCSS('color', 'rgb(185, 28, 28)')
        await presentationExpect(page.getByRole('button', { name: 'Request export', exact: true }).first()).toHaveCSS('color', 'rgb(43, 33, 27)')
      }
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  test('safe empty/error/coach decision states and upload phase stay honest', async ({ browser }) => {
    for (const mode of ['empty', 'error'] as const) {
      const context = await browser.newContext({ viewport: { width: 375, height: 900 } })
      const mocked = await interceptPresentationApi(context, true, { mode })
      const page = await context.newPage()
      try {
        for (const path of ['/speeches', '/reviewers', '/search', '/become-a-coach', '/speeches/9']) {
          await page.goto(`${APP_URL}${path}`)
          if (path === '/search') await page.getByRole('textbox', { name: 'Search text' }).fill('voice')
          await presentationExpect(page.locator('.workspace-notebook-page')).toBeVisible()
          if (mode === 'error' && path === '/speeches') {
            // Existing route conflates failed GET with empty; preserve that
            // limitation instead of changing its data behavior for styling.
            await presentationExpect(page.getByText('No speeches yet.', { exact: true })).toBeVisible()
          } else if (mode === 'error') await presentationExpect(page.getByRole('alert').first()).toBeVisible()
          else if (path === '/speeches') await presentationExpect(page.getByText(/No speeches|haven.t uploaded|Upload your first/i)).toBeVisible()
          else if (path === '/reviewers') await presentationExpect(page.getByText(/No reviewers|Nobody matched|No matches/i)).toBeVisible()
          await expectNoPageOverflow(page)
          await page.screenshot({ path: test.info().outputPath(`notebook-${mode}-${path.replaceAll('/', '-')}.png`), fullPage: true })
        }
        presentationExpect(mocked.unexpected).toEqual([])
      } finally { await context.close() }
    }
    for (const coachStatus of ['submitted', 'under_review', 'approved', 'rejected', 'withdrawn'] as const) {
      const context = await browser.newContext({ viewport: { width: 375, height: 900 } })
      const mocked = await interceptPresentationApi(context, true, { coachStatus })
      const page = await context.newPage()
      try {
        await page.goto(`${APP_URL}/become-a-coach`)
        await presentationExpect(page.getByRole('heading', { level: 1, name: 'Become a Coach', exact: true })).toBeVisible()
        await presentationExpect(page.locator('[data-slot="card-title"]').filter({ hasText: coachStatus === 'approved' ? "You're a coach" : 'Your application' })).toBeVisible()
        await expectNoPageOverflow(page)
        presentationExpect(mocked.unexpected).toEqual([])
      } finally { await context.close() }
    }
    const context = await browser.newContext({ viewport: { width: 375, height: 900 } })
    const mocked = await interceptPresentationApi(context, true, {})
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/speeches/new`)
      await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Notebook upload example')
      await page.getByRole('button', { name: 'Continue to upload' }).click()
      await presentationExpect(page.getByText(/Drop files here|Browse files|browse files/).first()).toBeVisible()
      await expectNoPageOverflow(page)
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  test('profile cropper retains full 288px viewport at 320px', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 900 } })
    const mocked = await interceptPresentationApi(context, true, {})
    const page = await context.newPage()
    try {
      await page.goto(`${APP_URL}/profile`)
      const image = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#0f6b66'; ctx.fillRect(0, 0, 400, 400)
        return canvas.toDataURL('image/png').split(',')[1]
      })
      await page.getByLabel('Profile photo').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') })
      const cropping = page.locator('.workspace-notebook-photo-panel--cropping')
      await presentationExpect(cropping).toBeVisible()
      const cropViewport = cropping.getByRole('img', { name: 'Avatar preview, drag to reposition' }).locator('..')
      await presentationExpect(cropViewport).toHaveCSS('width', '288px')
      await presentationExpect(cropViewport).toHaveCSS('height', '288px')
      await expectNoPageOverflow(page)
      await page.screenshot({ path: test.info().outputPath('notebook-profile-cropper-320.png'), fullPage: true })
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })

  for (const reviewer of [false, true]) {
    test(`${reviewer ? 'reviewer' : 'owner'} tabs change only companion context and preserve actual drafts/player`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
      const mocked = await interceptPresentationApi(context, true, { reviewer })
      const page = await context.newPage()
      try {
        await page.goto(`${APP_URL}/speeches/9`)
        const tabs = page.getByRole('tablist', { name: reviewer ? 'Your feedback' : 'Speech tools' })
        await presentationExpect(tabs).toBeVisible()
        await expectNotebookScene(page, 'reviews')
        const video = page.locator('video[data-testid="speech-video"]')
        await presentationExpect(video).toBeVisible()
        const original = await video.elementHandle()
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = .5 })
        const rail = page.getByRole('navigation', { name: 'Main' })
        await presentationExpect(rail.locator('[aria-current="page"]')).toHaveCount(0)
        let draft: import('@playwright/test').Locator | undefined
        if (reviewer) {
          draft = page.getByRole('textbox', { name: 'Commentary', exact: true })
          await draft.fill('A deliberately unsaved notebook draft.')
          await presentationExpect(page.getByRole('button', { name: 'Record', exact: true })).toHaveCount(0)
        } else {
          await tabs.getByRole('tab', { name: 'Reviewers', exact: true }).click()
          await expectNotebookScene(page, 'reviewers')
          await page.getByRole('textbox', { name: 'Search the reviewer directory' }).fill('Avery')
          await page.getByRole('button', { name: /Avery Reviewer/ }).click()
          draft = page.getByRole('textbox', { name: 'Message (optional)' })
          await draft.fill('Keep this invitation while I check another section.')
        }
        for (const [tab, scene] of [['Notes', 'reviews'], ['Essay', 'edit'], ['Transcript', 'search']] as const) {
          await tabs.getByRole('tab', { name: tab, exact: true }).click()
          await expectNotebookScene(page, scene)
          if (tab === 'Transcript') {
            await presentationExpect(page.locator('.workspace-notebook-reading button').first()).toBeVisible()
            await expectTargetSizes(page, '.workspace-notebook-reading button')
          }
          await presentationExpect(tabs.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
          presentationExpect(await video.evaluate((element, old) => element === old, original)).toBe(true)
          presentationExpect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(.45)
          if (reviewer && tab === 'Essay') {
            const editable = page.getByTestId('essay-editor-content').locator('[contenteditable="true"]')
            await editable.click()
            await editable.press('ControlOrMeta+A')
            const bold = page.getByRole('button', { name: 'Bold', exact: true })
            await bold.click()
            await presentationExpect(bold).toHaveAttribute('aria-pressed', 'true')
            await presentationExpect(bold).toHaveCSS('background-color', 'rgb(11, 86, 82)')
            await presentationExpect(bold).toHaveCSS('color', 'rgb(255, 253, 246)')
            await presentationExpect(page.getByTestId('essay-autosave-state')).toHaveAttribute('data-state', 'saved')
            await expectTargetSizes(page, '.workspace-notebook-toolbar [data-slot="button"]')
          }
        }
        await tabs.getByRole('tab', { name: reviewer ? 'Notes' : 'Reviewers', exact: true }).click()
        await presentationExpect(draft!).toHaveValue(reviewer ? 'A deliberately unsaved notebook draft.' : 'Keep this invitation while I check another section.')
        await page.setViewportSize({ width: 375, height: 900 })
        await expectNotebookScene(page, reviewer ? 'reviews' : 'reviewers')
        await presentationExpect(page.locator('.video-js [data-workspace-scene]')).toHaveCount(0)
        await expectNoPageOverflow(page)
        presentationExpect(mocked.unexpected).toEqual([])
      } finally { await context.close() }
    })
  }

  for (const portrait of [false, true]) {
    test(`native ${portrait ? 'portrait' : 'landscape'} footage decodes, plays/seeks with unchanged frame/token boundaries`, async ({ browser }) => {
      const media = await createNotebookMedia(browser, portrait)
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const mocked = await interceptPresentationApi(context, true, { portrait, media, feedback: true })
      const page = await context.newPage()
      try {
        await page.goto(`${APP_URL}/speeches/9`)
        const video = page.locator('video[data-testid="speech-video"]')
        await presentationExpect(video).toBeVisible()
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => [element.videoWidth, element.videoHeight])).toEqual(portrait ? [360, 640] : [640, 360])
        await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play() })
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(.1)
        await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 1 })
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(.95)
        const decoded = await video.evaluate((element: HTMLVideoElement) => {
          const canvas = document.createElement('canvas'); canvas.width = element.videoWidth; canvas.height = element.videoHeight
          const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0)
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set<string>()
          for (let i = 0; i < pixels.length; i += 400) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
          const host = element.closest('.video-js')!, frame = host.closest('[style*="--video-budget"]')!
          const rect = frame.getBoundingClientRect(), css = getComputedStyle(host), root = getComputedStyle(document.documentElement)
          const tokens = ['--background', '--foreground', '--color-bg', '--color-fg'].map((token) => ({ token, host: css.getPropertyValue(token), baseline: root.getPropertyValue(token) }))
          return { colors: colors.size, width: rect.width, height: rect.height, aspect: element.videoWidth / element.videoHeight,
            filter: getComputedStyle(frame).filter, transform: getComputedStyle(frame).transform, tokens,
            decoratedAncestor: Boolean(element.closest('.workspace-notebook-surface')), artInsidePlayer: host.querySelectorAll('[data-workspace-scene]').length }
        })
        presentationExpect(decoded.colors).toBeGreaterThan(3)
        presentationExpect(decoded.width / decoded.height).toBeCloseTo(decoded.aspect, 2)
        presentationExpect(decoded.height).toBeLessThanOrEqual(541)
        presentationExpect(decoded.filter).toBe('none'); presentationExpect(decoded.transform).toBe('none')
        presentationExpect(decoded.decoratedAncestor).toBe(false); presentationExpect(decoded.artInsidePlayer).toBe(0)
        for (const token of decoded.tokens) presentationExpect(token.host, token.token).toBe(token.baseline)
        const captions = page.getByTestId('captions-toggle')
        await presentationExpect(captions).toBeVisible()
        if (await captions.getAttribute('aria-pressed') !== 'true') await captions.click()
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => Array.from(element.textTracks).some((track) => track.mode === 'showing'))).toBe(true)
        const playback = page.getByRole('radiogroup', { name: 'Commentary playback' })
        const transcript = page.getByRole('list', { name: 'Commentary transcript', exact: true })
        await presentationExpect(transcript.getByText('Pause briefly before the opening sentence.', { exact: true })).toBeVisible()
        await presentationExpect(transcript.getByText('Your opening sounds warm and confident.', { exact: true })).toBeVisible()
        await expectTargetSizes(page, '.workspace-notebook-surface ol[aria-label="Commentary transcript"] > li > button')
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = .3 })
        await presentationExpect(page.getByTestId('overlay-notebook-written')).toHaveAttribute('data-visible', 'true')
        await presentationExpect(page.getByTestId('overlay-notebook-written')).toHaveCSS('opacity', '1')
        await playback.getByText('Written notes only', { exact: true }).click()
        await presentationExpect(playback.getByRole('radio', { name: 'Written notes only', exact: true })).toBeChecked()
        await presentationExpect(transcript.getByText('Pause briefly before the opening sentence.', { exact: true })).toBeVisible()
        await presentationExpect(transcript.getByText('Your opening sounds warm and confident.', { exact: true })).toHaveCount(0)
        await playback.getByText('Audio only', { exact: true }).click()
        await presentationExpect(playback.getByRole('radio', { name: 'Audio only', exact: true })).toBeChecked()
        await presentationExpect(transcript.getByText('Your opening sounds warm and confident.', { exact: true })).toHaveCount(0)
        await presentationExpect(transcript.getByText('Voice commentary · Ready', { exact: true })).toBeVisible()
        await playback.getByText('Off', { exact: true }).click()
        await presentationExpect(playback.getByRole('radio', { name: 'Off', exact: true })).toBeChecked()
        await presentationExpect(page.getByText('Commentary is off.', { exact: true })).toBeVisible()
        await presentationExpect(page.getByRole('list', { name: 'Commentary transcript', exact: true })).toHaveCount(0)
        await playback.getByText('Text + audio', { exact: true }).click()
        await presentationExpect(playback.getByRole('radio', { name: 'Text + audio', exact: true })).toBeChecked()
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = .9 })
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
        // The genuine controller crosses the marker, pauses the speech and
        // decodes/plays the existing AAC fixture through its native Audio.
        await page.locator('.vjs-play-control').click()
        await presentationExpect(page.getByText('Playing voice commentary', { exact: true })).toBeVisible()
        await presentationExpect(page.getByTestId('overlay-notebook-voice')).toHaveAttribute('data-visible', 'true')
        await presentationExpect(page.getByTestId('overlay-notebook-voice')).toHaveText('Your opening sounds warm and confident.')
        await page.getByRole('button', { name: 'Pause commentary', exact: true }).click()
        await presentationExpect(page.getByText('Voice commentary paused', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Resume commentary', exact: true }).click()
        await presentationExpect(page.getByText('Playing voice commentary', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Skip commentary', exact: true }).click()
        await presentationExpect(page.getByText('Playing voice commentary', { exact: true })).toHaveCount(0)
        await video.evaluate((element: HTMLVideoElement) => { element.pause() })
        const capabilities: Record<string, unknown> = {}
        await page.locator('.vjs-fullscreen-control').click()
        await page.waitForFunction(() => Boolean(document.fullscreenElement), undefined, { timeout: 1500 }).catch(() => undefined)
        const enteredFullscreen = await page.evaluate(() => Boolean(document.fullscreenElement))
        capabilities.fullscreenEntered = enteredFullscreen
        if (enteredFullscreen) {
          await presentationExpect(page.locator(':fullscreen [data-workspace-scene]')).toHaveCount(0)
          await page.evaluate(async () => { await document.exitFullscreen() })
        }
        capabilities.pip = await video.evaluate(async (element: HTMLVideoElement) => {
          if (!document.pictureInPictureEnabled || !element.requestPictureInPicture) return { supported: false }
          try {
            await element.requestPictureInPicture()
            const entered = document.pictureInPictureElement === element
            await document.exitPictureInPicture()
            return { supported: true, entered }
          } catch (error) { return { supported: true, denied: String(error) } }
        })
        const capabilityPath = test.info().outputPath('native-media-capabilities.json')
        await writeFile(capabilityPath, JSON.stringify(capabilities, null, 2))
        await test.info().attach('native-media-capabilities', { path: capabilityPath, contentType: 'application/json' })
        await page.screenshot({ path: test.info().outputPath(`notebook-native-${portrait ? 'portrait' : 'landscape'}.png`), fullPage: true })
        await presentationExpect(page.locator('.video-js [data-workspace-scene], .owner-commentary-host [data-workspace-scene]')).toHaveCount(0)
        presentationExpect(mocked.unexpected).toEqual([])
      } finally { await context.close() }
    })
  }
})
