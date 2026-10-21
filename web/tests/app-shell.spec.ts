import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
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

async function interceptPresentationApi(context: BrowserContext, initiallyAuthenticated = true) {
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
      return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-xsrf-token, accept' } })
    }
    if (url.pathname === '/sanctum/csrf-cookie') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/login' && request.method() === 'POST') {
      loginBodies.push(request.postDataJSON())
      authenticated = true
      return json({ user: presentationUser })
    }
    if (request.method() !== 'GET') {
      unexpected.push(`${request.method()} ${url.pathname}`)
      return json({ message: 'Unexpected presentation mutation blocked.' }, 500)
    }
    switch (url.pathname) {
      case '/api/me': return json(authenticated ? { user: presentationUser } : { message: 'Unauthenticated.' }, authenticated ? 200 : 401)
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
      await presentationExpect(page.locator('[data-workspace-scene="reviews"] [data-workspace-pose="seated-reading"]')).toBeVisible({ timeout: 30_000 })
      await page.screenshot({ path: test.info().outputPath('option-c-dashboard-desktop.png'), fullPage: true })
      for (const width of [320, 375, 767, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page)
        await presentationExpect(page.getByRole('banner')).toHaveCSS('height', '56px')
        await expectTargetSizes(page, '.workspace-header-actions > button, .workspace-dashboard .workspace-button')
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
        const scene = page.locator('[data-workspace-scene="reviews"]')
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
          await presentationExpect(page.locator('.workspace-panel').first()).toHaveCSS('background-color', 'rgb(255, 253, 246)')
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
      await presentationExpect(page.locator('[data-workspace-scene="reviews"]')).toBeVisible({ timeout: 30_000 })
      await rail.getByRole('link', { name: 'My speeches', exact: true }).click()
      await presentationExpect(page.locator('[data-workspace-scene="speeches"]')).toBeVisible()
      await rail.getByRole('link', { name: 'Search', exact: true }).click()
      await presentationExpect(page.locator('[data-workspace-scene="search"]')).toBeVisible()
      await page.goBack()
      await presentationExpect(page.locator('[data-workspace-scene="speeches"]')).toBeVisible()
      await page.goForward()
      await presentationExpect(page.locator('[data-workspace-scene="search"]')).toBeVisible()
      await page.getByRole('textbox', { name: 'Search text' }).fill('voice')
      await presentationExpect(page.getByText('Transcript excerpt', { exact: true })).toBeVisible()
      await presentationExpect(page.locator('mark')).toHaveCount(2)
      presentationExpect(await page.locator('mark').first().evaluate((element) => Boolean(element.closest('.workspace-dashboard')))).toBe(false)
      for (const [path, scene] of [['/SEARCH?q=voice#results', 'search'], ['/speeches/new/', 'upload'], ['/reviewers', 'reviewers']] as const) {
        await page.goto(`${APP_URL}${path}`)
        await presentationExpect(page.locator(`[data-workspace-scene="${scene}"]`)).toBeVisible()
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
      await presentationExpect(page.locator('[data-workspace-scene="reviews"]')).toBeVisible({ timeout: 30_000 })
      await page.emulateMedia({ forcedColors: 'active' })
      await presentationExpect(page.locator('[data-workspace-scene="reviews"]')).toBeHidden()
      await presentationExpect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My reviews', exact: true })).toBeVisible()
      presentationExpect(mocked.unexpected).toEqual([])
    } finally { await context.close() }
  })
})
