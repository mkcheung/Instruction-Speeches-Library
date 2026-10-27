import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { API_URL, APP_URL, USERS } from './fixtures.js'
import { installDeterministicRecorder } from './voice-test-helpers.js'
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
    // instead: the rail above `md`, and the separate main navigation menu
    // carrying primary destinations below it.
    const sidebar = page.getByRole('navigation', { name: 'Main' })
    const width = page.viewportSize()?.width ?? 0

    if (width >= 768) {
      await expect(sidebar).toBeVisible()
      await expect(sidebar.getByRole('link', { name: 'My speeches', exact: true })).toBeVisible()
      await expect(sidebar.getByRole('link', { name: 'Edit profile' })).toHaveCount(0)
    } else {
      // Below `md` the rail collapses and the main navigation menu carries these
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

  test('/profile is reachable through the account dropdown at every viewport', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await page.goto(`${APP_URL}/dashboard`)
    await page.getByRole('button', { name: USERS.speaker.name, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    await expect(page).toHaveURL(`${APP_URL}/profile`)

    await context.close()
  })

  test('the "My reviews" link in the nav landmark matches exactly once on /speeches (S2 strict-mode fix)', async ({
    browser,
  }) => {
    // The rail is `hidden md:flex`; below `md` there is no sidebar to
    // exercise and the main navigation menu carries these destinations instead (asserted
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

/** The collapsed sidebar uses its own menu, separate from account settings. */
test.describe('collapsed navigation below md', () => {
  test('separate main and account menus preserve navigation when the rail is hidden', async ({
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

    await page.getByRole('button', { name: 'Main navigation', exact: true }).click()
    for (const label of ['My reviews', 'My speeches', 'Search']) {
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('menuitem', { name: 'Edit profile' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: USERS.speaker.name, exact: true }).click()
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
      'Your profile', 'Edit profile', 'Account & privacy', 'Log out',
    ])

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
    // one from an unguarded route's own `useGetMeQuery()`) is treated by
    // `UnauthenticatedRedirect` as an expired session unless the route is
    // classified guest/public (`classifyRoute`) — a public profile page that
    // called `useGetMeQuery()` would otherwise eject the visitor.
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
    if (notebook && url.origin === new URL(APP_URL).origin && ['/__notebook/speech.mp4', '/__notebook/voice.m4a'].includes(url.pathname)) {
      if (notebook.draggable && url.pathname === '/__notebook/voice.m4a' && notebook.scrubWire) notebook.scrubWire.voiceMediaRequests += 1
      return notebookMediaResponse(route, notebook)
    }
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
      if (notebook.draggable && notebook.scrubWire) {
        const wire = notebook.scrubWire
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) wire.mutations.push(`${request.method()} ${url.pathname}`)
        if (request.method() === 'GET' && url.pathname === '/api/reviews') {
          wire.reviewRequests += 1
          const status = await wire.reviewReply?.(wire.reviewRequests) ?? 200
          // Real ReviewResource list rows omit reviewer, including reviewer.id.
          const review = Object.fromEntries(Object.entries(notebookReview(notebook)).filter(([key]) => key !== 'reviewer'))
          return json(status === 200 ? { invited: [], in_progress: [review], published: [], revoked: [] }
            : { message: 'Isolated review validation failure.' }, status)
        }
        if (request.method() === 'GET' && url.pathname === '/api/speeches/9/assets/90/playback-url') {
          wire.playbackRequests += 1
          await wire.playbackReply?.(wire.playbackRequests)
        }
      }
      if (notebook.ownerVideoTools && url.pathname === '/api/speeches/9/assets/90/poster-frame' && request.method() === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>
        if (Object.keys(body).length !== 1 || typeof body.time_seconds !== 'number' || !Number.isFinite(body.time_seconds) || body.time_seconds < 0 || body.time_seconds > 3) {
          unexpected.push(`Invalid poster body: ${request.postData()}`)
          return json({ message: 'Invalid isolated poster request.' }, 422)
        }
        notebook.ownerWire?.posterRequests.push({ path: url.pathname, body: { time_seconds: body.time_seconds } })
        const status = await notebook.ownerWire?.posterReply?.() ?? 200
        if (notebook.draggable && status === 401) authenticated = false
        return json(status === 200 ? { asset: { ...notebookSpeech(notebook).primary_video, poster_time_seconds: body.time_seconds } }
          : { message: 'Isolated poster failure.' }, status)
      }
      if (notebook.ownerVideoTools && /^\/api\/speeches\/9\/annotations\/owner-[ab]-voice\/voice-playback-url$/.test(url.pathname)) await notebook.ownerWire?.voiceReply?.()
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
      // The header's requests bell reads the incoming Friends list; keep the single pending request the old
      // /api/connections?state=pending mock above stood for.
      case '/api/friends': return json(url.searchParams.get('view') === 'incoming'
        ? { friends: [{ connection_id: 1, person: { id: 2, name: 'Avery Speaker', username: 'avery', avatar_url: null },
          mutual_friends_count: 0, requested_at: presentationDate, connected_at: null, note: null }], meta: { total: 1, next_cursor: null } }
        : { friends: [], meta: { total: 0, next_cursor: null } })
      // The header's account chip reads its own public profile for the saved photo (UserMenu.tsx); no photo, so it
      // keeps the initials fallback these presentation checks were written against.
      case '/api/u/presentation-member': return json({ profile: {
        id: presentationUser.id, username: presentationUser.username, display_name: presentationUser.display_name,
        bio: null, pronouns: null, location: null, avatar_url: null, credential: 'member',
      } })
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
      await presentationExpect(rail.getByRole('link')).toHaveCount(6)
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
          for (const name of ['Your profile', 'Edit profile', 'Account & privacy', 'Log out']) {
            await presentationExpect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
          }
          const popup = page.getByRole('menu')
          await presentationExpect(popup.getByRole('menuitem')).toHaveText(['Your profile', 'Edit profile', 'Account & privacy', 'Log out'])
          presentationExpect(await popup.evaluate((element) => Boolean(element.closest('.workspace-header, .workspace-sidebar, .workspace-dashboard, .workspace-login')))).toBe(false)
          presentationExpect(await popup.evaluate((element) => getComputedStyle(element).getPropertyValue('--workspace-paper'))).toBe('')
          presentationExpect(await avatar.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color }))).toEqual(avatarPair)
          await page.keyboard.press('Escape')
        }
      }
      await page.getByRole('button', { name: 'Main navigation', exact: true }).click()
      await presentationExpect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
        'My reviews', 'My speeches', 'Find reviewers', 'Upload a speech', 'Search', 'Become a Coach',
      ])
      await expectNoPageOverflow(page)
      await page.getByRole('menuitem', { name: 'Search', exact: true }).click()
      await presentationExpect(page).toHaveURL(`${APP_URL}/search`)
      await presentationExpect(page.getByRole('heading', { name: 'Search your speeches', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Main navigation', exact: true }).click()
      await presentationExpect(page.getByRole('menu', { name: 'Main navigation' })).toBeVisible()
      await page.setViewportSize({ width: 1024, height: 900 })
      await presentationExpect(page.getByRole('menu')).toHaveCount(0)
      await presentationExpect(page.getByRole('button', { name: 'Main navigation', exact: true })).toBeHidden()
      const sidebar = page.getByRole('navigation', { name: 'Main' })
      await presentationExpect(sidebar).toBeVisible()
      for (const name of ['Your profile', 'Edit profile', 'Account & privacy']) {
        await presentationExpect(sidebar.getByRole('link', { name, exact: true })).toHaveCount(0)
      }
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
interface OwnerToolsWire {
  posterRequests: Array<{ path: string; body: { time_seconds: number } }>
  posterReply?: () => Promise<number>
  voiceReply?: () => Promise<void>
}
interface ScrubWire {
  reviewRequests: number
  playbackRequests: number
  voiceMediaRequests: number
  mutations: string[]
  reviewReply?: (request: number) => Promise<number>
  playbackReply?: (request: number) => Promise<void>
}
interface NotebookFixtureOptions {
  draggable?: boolean
  scrubWire?: ScrubWire
  noSelectedReview?: boolean
  // Strict owner-only wire contract; legacy presentation fixtures retain their existing behavior.
  ownerVideoTools?: boolean
  ownerVariant?: 'empty' | 'denied'
  ownerWire?: OwnerToolsWire
  reviewer?: boolean
  // Opt in to one consistent reviewer/speech/annotation identity; legacy dashboard fixtures stay unchanged.
  reviewerOverlay?: boolean
  // 13 saved mixed annotations (text + voice, erased/historical points, processing/failed
  // transcripts) for the review-22 reviewer, who is also a Coach so the Voice tool exists.
  notebookTools?: boolean
  missingCaptions?: boolean
  writtenBody?: string
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
    username: 'notebook-member', display_name: 'Morgan Member', roles: options.ownerVideoTools && options.reviewer ? ['coach', 'admin'] : options.notebookTools ? ['coach'] : [], email_verified: true,
    onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 120_000, quota_bytes: 5_000_000, uploads_in_flight: 0 }
}
function notebookSpeech(options: NotebookFixtureOptions) {
  return { id: 9, ulid: 'notebook-speech', user_id: 1, title: notebookTitle,
    description: 'A rehearsal about confidence, opening clearly and connecting with the audience.',
    delivered_on: null, change_note: null, created_at: notebookDate, captions_enabled: true,
    primary_video: { id: 90, kind: 'video', status: options.notReady ? 'processing' : 'ready', failure_code: null, duration_seconds: '3',
      width: options.portrait ? 360 : 640, height: options.portrait ? 640 : 360, poster_time_seconds: null },
    ...(options.ownerVideoTools ? { sprite: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHZkAAAAASUVORK5CYII=',
      columns: 5, rows: 2, frame_width: 800, frame_height: options.portrait ? 568 : 180, duration_seconds: '3' } } : {}) }
}
// Ids that own ready audio in the notebookTools set; only these may resolve a playback URL.
const notebookToolsAudioIds = ['notebook-voice', 'tools-voice-historic', 'tools-voice-ready-2', 'tools-voice-ready-3']
// Chronological: 13 notes = pages of 6, 6 and 1. Text ranges never overlap points; 2.45-3.0 stays free for a live draft.
function notebookToolsAnnotations() {
  const text = (id: string, start: number, end: number, body: string) => ({ id, timing_type: 'range', start_seconds: start,
    duration_seconds: Math.round((end - start) * 1000) / 1000, kind: 'observation', topic: null, body, lock_version: 1, client_uuid: id, voice: null })
  const voice = (id: string, start: number, body: string, status: { audio_status: string; transcript_status: string } | null, timing: 'point' | null = 'point') => ({
    id, timing_type: timing, start_seconds: start, duration_seconds: 4, kind: 'observation', topic: null, body, lock_version: 1, client_uuid: id,
    voice: status === null ? null : { asset_id: 100 + Math.round(start * 100), ...status, failure_code: status.transcript_status === 'failed' ? 'fixture_transcript_failed' : null } })
  const ready = { audio_status: 'ready', transcript_status: 'ready' }
  return [
    text('tools-text-01', 0, .2, 'Open with a steady breath before the first word.'),
    voice('tools-voice-processing', .22, '', { audio_status: 'ready', transcript_status: 'processing' }),
    text('tools-text-02', .25, .35, 'Slow down on this phrase.'),
    text('notebook-written', .4, .9, 'Pause briefly before the opening sentence. Give the audience a moment to settle, then begin with a warm and confident voice.'),
    voice('tools-voice-failed', .95, '', { audio_status: 'ready', transcript_status: 'failed' }),
    voice('tools-voice-erased', 1, 'This transcript survives the erased audio.', null),
    voice('notebook-voice', 1.2, 'Your opening sounds warm and confident.', ready),
    voice('tools-voice-historic', 1.4, 'Historical note recorded before timing types existed.', ready, null),
    text('tools-text-03', 1.5, 1.7, 'Let the story land before moving on.'),
    voice('tools-voice-ready-2', 1.8, 'This pause works well.', ready),
    text('tools-text-04', 1.9, 2, 'Good eye contact here.'),
    text('tools-text-05', 2.1, 2.2, 'Lift the pitch slightly to close the thought.'),
    voice('tools-voice-ready-3', 2.3, 'A strong, memorable finish.', ready),
  ]
}
function notebookReview(options: NotebookFixtureOptions) {
  return { id: 22, status: 'in_progress', invitation_message: 'Please consider my opening.', allow_preview: false,
    prior_commentary_shared: false, invited_at: notebookDate, responded_at: notebookDate,
    first_published_at: options.feedback ? notebookDate : null, last_published_at: options.feedback ? notebookDate : null, last_transition_at: notebookDate, revoked_at: null, revocation_reason: null,
    speech: { id: 9, ulid: 'notebook-speech', title: notebookTitle, owner_name: 'Morgan Member' },
    reviewer: { id: options.reviewer ? 2 : 3, username: 'avery-reviewer', name: 'Avery Reviewer' } }
}
// Two published tracks have different row identities and timing, never draft-inclusive rows.
function ownerToolsTracks(options: NotebookFixtureOptions) {
  const first = { ...notebookReview(options), status: 'published', first_published_at: notebookDate,
    last_published_at: notebookDate, annotations_count: options.ownerVariant === 'empty' ? 0 : 6,
    published_annotations_count: options.ownerVariant === 'empty' ? 0 : 6, revoked_by_is_self: false }
  return [first, { ...first, id: 23, last_published_at: '2026-09-30T12:00:00Z',
    reviewer: { id: 4, username: 'jamie-member', name: 'Jamie Member' } }]
}
function ownerToolsRows(reviewId: number) {
  const prefix = reviewId === 22 ? 'owner-a' : 'owner-b', shift = reviewId === 22 ? 0 : .1
  const row = (id: string, start: number, duration: number, timing: 'point' | 'range', body: string, audio = false) => ({
    id: `${prefix}-${id}`, timing_type: timing, start_seconds: start, duration_seconds: duration,
    kind: 'observation', topic: null, body, lock_version: 1, client_uuid: `${prefix}-${id}`,
    voice: audio ? { asset_id: reviewId + 100, audio_status: 'ready', transcript_status: 'ready', failure_code: null } : null,
  })
  return [row('edge', 0, 0, 'point', 'Erased boundary transcript.'),
    row('text', .4 + shift, .5, 'range', `${prefix} published written feedback.`),
    row('erased', 1 + shift, 0, 'point', 'The transcript survives erased audio.'),
    row('voice', 1.2 + shift, 10, 'point', `${prefix} published voice transcript.`, true),
    row('late', 2.2 + shift, .3, 'range', `${prefix} final written feedback.`),
    row('end', 2.99, 0, 'point', 'Erased ending transcript.')]
}
function ownerToolsResponse(url: URL, method: string, options: NotebookFixtureOptions): { body: unknown; status?: number } | undefined {
  if (!options.ownerVideoTools || method !== 'GET') return undefined
  const tracks = ownerToolsTracks(options)
  switch (url.pathname) {
    case '/api/speeches/9/reviews': return { body: { reviews: tracks } }
    case '/api/speeches/9/review-roster': return { body: { reviews: options.noSelectedReview ? [] : tracks } }
    case '/api/speeches/9/annotations': {
      const review = tracks.find((track) => String(track.id) === url.searchParams.get('review_id'))
      if (!review || [...url.searchParams.keys()].some((key) => key !== 'review_id')) return { status: 403, body: { message: 'Unexpected owner review denied.' } }
      if (options.ownerVariant === 'denied') return { status: 403, body: { message: 'Commentary unavailable.' } }
      return { body: { review_id: review.id, reviewer: review.reviewer,
        annotations: options.ownerVariant === 'empty' ? [] : ownerToolsRows(review.id) } }
    }
    case '/api/speeches/9/annotations/owner-a-voice/voice-playback-url':
    case '/api/speeches/9/annotations/owner-b-voice/voice-playback-url': return { body: { audio: { url: `${APP_URL}/__notebook/voice.m4a`, expires_at: '2030-01-01T00:00:00Z' } } }
  }
}
function notebookResponse(url: URL, method: string, options: NotebookFixtureOptions, body?: Record<string, unknown>): { body: unknown; status?: number } | undefined {
  const path = url.pathname
  const ownerResponse = ownerToolsResponse(url, method, options)
  if (ownerResponse) return ownerResponse
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
    '/api/me/preferences/voice-commentary/9', ...(options.reviewerOverlay ? ['/api/reviews'] : [])]
  const toolsAudioPath = options.notebookTools && notebookToolsAudioIds.some((id) => path === `/api/speeches/9/annotations/${id}/voice-playback-url`)
  if (!handled.includes(path) && !toolsAudioPath) return undefined
  if (options.mode === 'error') return { status: 500, body: { message: 'Presentation fixture failure.' } }
  const speech = notebookSpeech(options), review = notebookReview(options), empty = options.mode === 'empty'
  switch (path) {
    case '/api/reviews': return { body: { invited: [], in_progress: [review], published: [], revoked: [] } }
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
    case '/api/speeches/9/captions': if (options.missingCaptions) return { body: { captions: { status: 'failed', asset_id: 91, failure_code: 'fixture_captions_unavailable', updated_at: notebookDate } } }; return { body: { captions: { status: 'ready', asset_id: 91, failure_code: null, updated_at: notebookDate,
      revision: 'notebook-revision', vtt: 'WEBVTT\n\n00:00.000 --> 00:03.000\nFind your voice.\n' } } }
    case '/api/speeches/9/transcript': return { body: { transcript: { body: 'Find your voice.', segments: [{ start: 0, end: 3, text: 'Find your voice.' }],
      word_count: 3, words_per_minute: 60, language: 'en', model: 'fixture', source: 'whisper', updated_at: notebookDate, caption_revision: 'notebook-revision' } } }
    case '/api/speeches/9/reviews': return { body: { reviews: [review] } }
    case '/api/speeches/9/review-roster': return { body: { reviews: [{ ...review, annotations_count: options.feedback ? (options.notebookTools ? 13 : 2) : 0, published_annotations_count: options.feedback ? (options.notebookTools ? 13 : 2) : 0, revoked_by_is_self: false }] } }
    case '/api/speeches/9/annotations':
      if (options.reviewerOverlay && url.searchParams.get('review_id') !== String(review.id)) return { status: 403, body: { message: 'Unexpected fixture review denied.' } }
      return { body: { review_id: options.reviewerOverlay ? review.id : Number(url.searchParams.get('review_id')), reviewer: review.reviewer, annotations: options.feedback && options.notebookTools ? notebookToolsAnnotations() : options.feedback ? [
      { id: 'notebook-written', timing_type: 'range', start_seconds: options.reviewerOverlay ? .4 : 0, duration_seconds: options.reviewerOverlay ? .5 : .8, kind: 'observation', topic: null,
        body: options.writtenBody ?? (options.reviewerOverlay ? 'Pause briefly before the opening sentence. Give the audience a moment to settle, then begin with a warm and confident voice.' : 'Pause briefly before the opening sentence.'), lock_version: 1, client_uuid: 'notebook-written', voice: null },
      { id: 'notebook-voice', timing_type: 'point', start_seconds: 1.2, duration_seconds: 10, kind: 'observation', topic: null,
        body: 'Your opening sounds warm and confident.', lock_version: 1, client_uuid: 'notebook-voice',
        voice: { asset_id: 92, audio_status: 'ready', transcript_status: 'ready', failure_code: null } },
    ] : [] } }
    case '/api/speeches/9/annotations/tools-voice-historic/voice-playback-url':
    case '/api/speeches/9/annotations/tools-voice-ready-2/voice-playback-url':
    case '/api/speeches/9/annotations/tools-voice-ready-3/voice-playback-url':
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
      await presentationExpect(rail.getByRole('link')).toHaveCount(6)
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

async function expectDocumentOrder(locators: import('@playwright/test').Locator[]) {
  const handles = await Promise.all(locators.map((locator) => locator.elementHandle()))
  for (let i = 0; i + 1 < handles.length; i++) {
    presentationExpect(await handles[i]!.evaluate((a, b) => Boolean(a.compareDocumentPosition(b as Node) & Node.DOCUMENT_POSITION_FOLLOWING), handles[i + 1]), `element ${i} precedes element ${i + 1}`).toBe(true)
  }
}

// Geometry uses the actual player host and displayed footage, including portrait
// and fullscreen. Unbounded text is compared with the owner baseline separately.
async function expectReviewerFrame(page: Page, overlay: import('@playwright/test').Locator, anchor: 'top' | 'default') {
  await presentationExpect(overlay).toHaveCSS('opacity', '1')
  const geometry = await overlay.evaluate((element) => {
    const host = element.closest('.owner-commentary-host')!, player = element.closest('.video-js')!
    const video = player.querySelector('video')!, frame = element.closest('.owner-feedback-frame')!
    const bounds = (node: Element) => {
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const root = getComputedStyle(document.documentElement), css = getComputedStyle(host)
    return { overlay: bounds(element), stack: bounds(element.parentElement!), frame: bounds(frame), video: bounds(video), aspect: video.videoWidth / video.videoHeight,
      actualHost: host.parentElement === player, notebookAncestor: Boolean(element.closest('.workspace-notebook-surface')),
      art: player.querySelectorAll('[data-workspace-scene]').length,
      tokens: ['--background', '--foreground', '--color-bg', '--color-fg'].map((token) => ({ token, host: css.getPropertyValue(token), root: root.getPropertyValue(token) })) }
  })
  presentationExpect(geometry.actualHost).toBe(true)
  presentationExpect(geometry.notebookAncestor).toBe(false)
  presentationExpect(geometry.art).toBe(0)
  presentationExpect(geometry.frame.width / geometry.frame.height).toBeCloseTo(geometry.aspect, 2)
  const footageWidth = Math.min(geometry.video.width, geometry.video.height * geometry.aspect)
  presentationExpect(geometry.frame.width).toBeCloseTo(footageWidth, 0)
  presentationExpect(geometry.frame.height).toBeCloseTo(footageWidth / geometry.aspect, 0)
  presentationExpect(geometry.overlay.x).toBeGreaterThanOrEqual(geometry.frame.x)
  presentationExpect(geometry.overlay.right).toBeLessThanOrEqual(geometry.frame.right + 1)
  presentationExpect(geometry.overlay.y).toBeGreaterThanOrEqual(geometry.frame.y)
  presentationExpect(geometry.overlay.bottom).toBeLessThanOrEqual(geometry.frame.bottom - 47)
  if (anchor === 'top') presentationExpect(geometry.overlay.y).toBeCloseTo(geometry.frame.y + 12, 0)
  // Inactive rows retain layout during fades and the render window. Compare
  // the stack's clearance, then require the active note to stay within it.
  else presentationExpect(geometry.stack.bottom).toBeCloseTo(geometry.frame.bottom - 48, 0)
  for (const token of geometry.tokens) presentationExpect(token.host, token.token).toBe(token.root)
  presentationExpect(await page.locator('.video-js [data-workspace-scene]').count()).toBe(0)
  return geometry
}

test.describe('reviewer overlay presentation (isolated frontend)', () => {
  test.setTimeout(240_000)
  for (const portrait of [false, true]) {
    test(`native ${portrait ? 'portrait without captions' : 'landscape with subtitles'} preserves timing, drafts, frame and fullscreen`, async ({ browser }) => {
      const media = await createNotebookMedia(browser, portrait)
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const mocked = await interceptPresentationApi(context, true, { reviewer: true, reviewerOverlay: true, feedback: true, portrait, media, missingCaptions: portrait })
      const page = await context.newPage()
      try {
        await page.goto(`${APP_URL}/speeches/9`)
        const video = page.locator('video[data-testid="speech-video"]'), tabs = page.getByRole('tablist', { name: 'Your feedback' })
        const target = page.getByTestId('reviewer-preview-target'), stack = target.getByTestId('overlay-stack')
        const saved = target.getByTestId('overlay-notebook-written')
        await presentationExpect(tabs).toBeVisible()
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => [element.videoWidth, element.videoHeight])).toEqual(portrait ? [360, 640] : [640, 360])
        const originalVideo = await video.elementHandle()
        await presentationExpect(target).toHaveCount(1)
        await presentationExpect(stack).toHaveAttribute('aria-hidden', 'true')
        await presentationExpect(stack).toHaveCSS('pointer-events', 'none')
        await presentationExpect(page.getByTestId('overlay-stack')).toHaveCount(1)
        const card = page.locator('[data-slot="card"]').filter({ has: page.getByTestId('timeline-strip') })
        await presentationExpect(card.getByTestId('overlay-stack')).toHaveCount(0)
        // Saved notes starts folded: the one authoritative list is not exposed until opened.
        const savedToggle = page.getByRole('button', { name: 'Saved notes (2)', exact: true })
        await presentationExpect(savedToggle).toHaveAttribute('aria-expanded', 'false')
        await presentationExpect(page.getByRole('list', { name: 'Your commentary', exact: true })).toHaveCount(0)
        await savedToggle.click()
        await presentationExpect(page.getByRole('list', { name: 'Your commentary', exact: true })).toHaveCount(1)
        await presentationExpect(page.getByRole('group', { name: 'Annotation timeline', exact: true })).toBeVisible()
        const editor = page.getByRole('region', { name: 'New annotation', exact: true, includeHidden: true })
        await presentationExpect(editor).toBeVisible()
        // Workspace order: timeline, then the creation tool, then Saved notes (the timeline stays outside both).
        await expectDocumentOrder([page.getByTestId('timeline-strip'), editor, savedToggle])
        // Wrong review IDs must not yield plausible annotations in this fixture.
        const denied = await page.evaluate(async (api) => {
          const response = await fetch(`${api}/api/speeches/9/annotations?review_id=2`, { credentials: 'include' })
          return { status: response.status, body: await response.json() }
        }, API_URL)
        presentationExpect(denied).toEqual({ status: 403, body: { message: 'Unexpected fixture review denied.' } })
        if (portrait) await presentationExpect(page.getByText('Captions unavailable.', { exact: true })).toBeVisible()
        else {
          const toggle = page.getByTestId('captions-toggle')
          await presentationExpect(toggle).toBeVisible()
          if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click()
        }
        await presentationExpect(target.locator('xpath=..')).toHaveAttribute('data-anchor', 'default')
        await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = .1 })
        await presentationExpect(saved).toHaveCSS('opacity', '0')
        await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play() })
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { intervals: [25] }).toBeGreaterThan(.43)
        await video.evaluate((element: HTMLVideoElement) => { element.pause() })
        await presentationExpect(saved).toHaveText('Pause briefly before the opening sentence. Give the audience a moment to settle, then begin with a warm and confident voice.')
        const inside = await expectReviewerFrame(page, saved, 'default')
        presentationExpect(inside.overlay.height).toBeGreaterThan(40)
        const colors = await video.evaluate((element: HTMLVideoElement) => {
          const canvas = document.createElement('canvas'); canvas.width = element.videoWidth; canvas.height = element.videoHeight
          const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0)
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set<string>()
          for (let i = 0; i < data.length; i += 400) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
          return colors.size
        })
        presentationExpect(colors).toBeGreaterThan(3)
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.3 })
        await presentationExpect(saved).toHaveAttribute('data-visible', 'false')
        await presentationExpect(saved).toHaveCSS('opacity', '0')
        const voicePoint = target.getByTestId('overlay-notebook-voice')
        await presentationExpect(voicePoint).toHaveAttribute('data-visible', 'false')
        await presentationExpect(voicePoint).toHaveCSS('opacity', '0')
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = .6 })
        await expectReviewerFrame(page, saved, 'default')
        if (!portrait) {
          await page.getByTestId('captions-toggle').click()
          await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => Array.from(element.textTracks).some((track) => track.kind === 'captions' && track.mode === 'showing'))).toBe(true)
          await presentationExpect(target.locator('xpath=..')).toHaveAttribute('data-anchor', 'top')
          await expectReviewerFrame(page, saved, 'top')
          await page.getByTestId('captions-toggle').click()
          await presentationExpect(target.locator('xpath=..')).toHaveAttribute('data-anchor', 'default')
        }
        await editor.getByRole('textbox', { name: 'Start', exact: true }).fill('1.5')
        await editor.getByRole('textbox', { name: 'End', exact: true }).fill('2.5')
        const draftInput = editor.getByRole('textbox', { name: 'Commentary', exact: true, includeHidden: true }), originalInput = await draftInput.elementHandle()
        await draftInput.fill('A private draft in a free interval.')
        await presentationExpect(editor.getByRole('button', { name: 'Add annotation', exact: true })).toBeEnabled()
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.8 })
        const draft = target.locator('.annotation-overlay[data-draft="true"]')
        await presentationExpect(draft).toHaveCount(1)
        await presentationExpect(draft).toHaveAttribute('data-testid', /^overlay-tmp_/)
        await presentationExpect(draft).toHaveCSS('border-top-style', 'dashed')
        await expectReviewerFrame(page, draft, 'default')
        await draftInput.fill('Updated private draft, still unsaved.')
        await presentationExpect(draft).toHaveText('Updated private draft, still unsaved.')
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => Array.from(element.textTracks).filter((track) => track.kind === 'metadata' && track.label === 'annotation-engine').length)).toBe(1)
        const track = await video.evaluateHandle((element: HTMLVideoElement) => Array.from(element.textTracks).find((item) => item.label === 'annotation-engine'))
        for (const tab of ['Essay', 'Transcript', 'Notes']) {
          await tabs.getByRole('tab', { name: tab, exact: true }).click()
          await presentationExpect(target).toHaveCount(1)
          await presentationExpect(page.getByTestId('overlay-stack')).toHaveCount(tab === 'Notes' ? 1 : 0)
          presentationExpect(await video.evaluate((element, original) => element === original, originalVideo)).toBe(true)
          presentationExpect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(1.8, 1)
          presentationExpect(await draftInput.evaluate((element, original) => element === original, originalInput)).toBe(true)
        }
        await presentationExpect(draftInput).toHaveValue('Updated private draft, still unsaved.')
        presentationExpect(await video.evaluate((element: HTMLVideoElement, original) => Array.from(element.textTracks).find((item) => item.label === 'annotation-engine') === original, track)).toBe(true)
        for (const width of [375, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
          await page.evaluate(() => document.documentElement.classList.add('dark'))
          await expectReviewerFrame(page, draft, 'default')
          await expectNoPageOverflow(page)
          await page.screenshot({ path: test.info().outputPath(`reviewer-${portrait ? 'portrait' : 'landscape'}-${width}.png`), fullPage: true })
        }
        await page.locator('.vjs-fullscreen-control').click()
        await page.waitForFunction(() => Boolean(document.fullscreenElement), undefined, { timeout: 1500 }).catch(() => undefined)
        const fullscreen = await page.evaluate(() => Boolean(document.fullscreenElement))
        if (fullscreen) {
          await presentationExpect(page.locator(':fullscreen [data-testid="reviewer-preview-target"] .annotation-overlay[data-draft="true"]')).toHaveCSS('opacity', '1')
          await expectReviewerFrame(page, draft, 'default')
          await presentationExpect(page.locator(':fullscreen .vjs-fullscreen-control')).toBeVisible()
          await page.locator(':fullscreen .vjs-fullscreen-control').click()
          await presentationExpect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
        }
        const evidence = test.info().outputPath('reviewer-native-capabilities.json')
        await writeFile(evidence, JSON.stringify({ fullscreenEntered: fullscreen, nativeVideoOnlyFullscreenAndPipHtml: 'not claimed', physicalMicrophoneAndIphone: 'not exercised' }, null, 2))
        await test.info().attach('reviewer-native-capabilities', { path: evidence, contentType: 'application/json' })
        presentationExpect(mocked.unexpected).toEqual([])
      } finally { await context.close() }
    })
  }

  test('long unbroken note records existing owner overflow without changing shared CSS', async ({ browser }) => {
    const measurements: { reviewer: boolean; width: number; height: number; frameHeight: number; scrollWidth: number; clientWidth: number; overflowWrap: string }[] = []
    const writtenBody = 'UnbrokenCommentary'.repeat(350)
    for (const reviewer of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 375, height: 900 }, reducedMotion: 'reduce' })
      const mocked = await interceptPresentationApi(context, true, { reviewer, reviewerOverlay: reviewer, feedback: true, missingCaptions: true, writtenBody, playbackMode: 'written' })
      const page = await context.newPage()
      try {
        await page.goto(`${APP_URL}/speeches/9`)
        const video = page.locator('video[data-testid="speech-video"]')
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
        await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = .6 })
        const overlay = page.locator('.owner-commentary-host').getByTestId('overlay-notebook-written')
        await presentationExpect(overlay).toHaveCSS('opacity', '1')
        measurements.push({ reviewer, ...await overlay.evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
          frameHeight: element.closest('.owner-feedback-frame')!.getBoundingClientRect().height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
          overflowWrap: getComputedStyle(element).overflowWrap })) })
        presentationExpect(mocked.unexpected).toEqual([])
      } finally { await context.close() }
    }
    presentationExpect(measurements[1].overflowWrap).toBe(measurements[0].overflowWrap)
    for (const result of measurements) presentationExpect(result.scrollWidth).toBeGreaterThan(result.clientWidth)
    const evidence = test.info().outputPath('reviewer-owner-existing-overflow.json')
    await writeFile(evidence, JSON.stringify({ limitation: 'Existing shared overlay CSS lacks unbroken-word containment; separately scoped CSS work is required.', measurements }, null, 2))
    await test.info().attach('reviewer-owner-existing-overflow', { path: evidence, contentType: 'application/json' })
  })
})

// ---------------------------------------------------------------------------------------------
// Annotation notebook tools: the reviewer's tool tabs, labeled timeline lanes and paged Saved
// notes disclosure, against the exact built frontend and a fail-closed review-22 fixture of 13
// mixed saved notes. Deterministic recorder doubles prove the lock seam only; they are not proof
// of a physical microphone, iPhone Safari or real worker processing.
// ---------------------------------------------------------------------------------------------
const toolsPage1 = ['tools-text-01', 'tools-voice-processing', 'tools-text-02', 'notebook-written', 'tools-voice-failed', 'tools-voice-erased']
const toolsPage2 = ['notebook-voice', 'tools-voice-historic', 'tools-text-03', 'tools-voice-ready-2', 'tools-text-04', 'tools-text-05']

test.describe('annotation notebook tools', () => {
  test.setTimeout(240_000)
  let media: Buffer
  test.beforeAll(async ({ browser }) => { media = await createNotebookMedia(browser, false) })

  async function openTools(browser: Browser, options: { width?: number; recorder?: boolean } = {}) {
    const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: 900 }, reducedMotion: 'reduce' })
    const mocked = await interceptPresentationApi(context, true, { reviewer: true, reviewerOverlay: true, feedback: true, notebookTools: true, missingCaptions: true, media })
    const page = await context.newPage()
    if (options.recorder) await installDeterministicRecorder(page)
    await page.goto(`${APP_URL}/speeches/9`)
    const video = page.locator('video[data-testid="speech-video"]')
    const tools = page.getByRole('tablist', { name: 'Add commentary' })
    await presentationExpect(tools).toBeVisible()
    await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
    await video.evaluate((element: HTMLVideoElement) => { element.muted = true; element.pause(); element.currentTime = 0 })
    const toggle = page.getByRole('button', { name: 'Saved notes (13)', exact: true })
    return {
      context, mocked, page, video, tools, toggle,
      row: (id: string) => page.locator(`li[data-annotation-id="${id}"]`),
      list: page.getByRole('list', { name: 'Your commentary', exact: true }),
      pager: page.getByRole('navigation', { name: 'Saved notes pages', exact: true }),
      form: page.getByRole('region', { name: 'New annotation', exact: true }),
      recorder: page.getByRole('region', { name: 'Record a voice note', exact: true }),
    }
  }
  type Tools = Awaited<ReturnType<typeof openTools>>
  const rowIds = (tools: Tools) => tools.list.locator('> li').evaluateAll((items) => items.map((item) => item.getAttribute('data-annotation-id')))
  const currentTime = (tools: Tools) => tools.video.evaluate((element: HTMLVideoElement) => element.currentTime)
  // A hidden tool/body must not leave focusable controls in the layout (display:none has no rects).
  async function expectNothingFocusableIn(locator: import('@playwright/test').Locator) {
    const reachable = await locator.evaluate((root) => Array.from(root.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], audio[controls], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden').map((element) => element.outerHTML.slice(0, 80)))
    presentationExpect(reachable).toEqual([])
  }

  test('tool tabs show one tool, keep the same text draft and leave the timeline lanes in place', async ({ browser }) => {
    const t = await openTools(browser)
    const { page, tools, form, recorder, video } = t
    try {
      await presentationExpect(tools.getByRole('tab')).toHaveCount(2)
      await presentationExpect(tools.getByRole('tab', { name: 'Text note', exact: true })).toHaveAttribute('aria-selected', 'true')
      await presentationExpect(tools.getByRole('tab', { name: 'Voice note', exact: true })).toHaveAttribute('aria-selected', 'false')
      await presentationExpect(form).toBeVisible()
      // The Voice tool must be chosen before its recorder UI is reachable.
      await presentationExpect(recorder).toHaveCount(0)
      const timeline = page.getByRole('group', { name: 'Annotation timeline', exact: true })
      await presentationExpect(timeline).toBeVisible()
      await presentationExpect(timeline.getByText('Text', { exact: true })).toBeVisible()
      await presentationExpect(timeline.getByText('Voice', { exact: true })).toBeVisible()
      await presentationExpect(page.getByTestId('timeline-lane-text').getByRole('button')).toHaveCount(6)
      await presentationExpect(page.getByTestId('timeline-lane-voice').getByRole('button')).toHaveCount(7)
      await presentationExpect(page.getByTestId('timeline-lane-voice').getByRole('button', { name: /^Voice note at \d+ seconds?, audio unavailable$/ })).toHaveCount(1)
      // Lane geometry: both lanes share one data axis, so equal seconds give equal x positions.
      const axis = await page.evaluate(() => {
        const lane = (name: string) => document.querySelector(`[data-testid="timeline-lane-${name}"]`)!.getBoundingClientRect()
        const text = lane('text'), voice = lane('voice'), axisBox = document.querySelector('[data-testid="timeline-axis"]')!.getBoundingClientRect()
        return { text: [text.left, text.right], voice: [voice.left, voice.right], axis: [axisBox.left, axisBox.right] }
      })
      presentationExpect(axis.text[0]).toBeCloseTo(axis.voice[0], 0); presentationExpect(axis.text[1]).toBeCloseTo(axis.voice[1], 0)
      presentationExpect(axis.axis[0]).toBeCloseTo(axis.text[0], 0)

      const start = form.getByRole('textbox', { name: 'Start', exact: true }), end = form.getByRole('textbox', { name: 'End', exact: true })
      const draft = form.getByRole('textbox', { name: 'Commentary', exact: true })
      const originalDraft = await draft.elementHandle()
      await start.fill('2.45'); await end.fill('3'); await draft.fill('Draft kept across tools.')
      await presentationExpect(tools.getByRole('tab', { name: 'Text note · Unsaved', exact: true })).toBeVisible()
      await presentationExpect(page.locator('[data-temporary="true"]')).toHaveCount(1)
      await presentationExpect(page.locator('[data-temporary="true"]')).toHaveAccessibleName(/^Unsaved text draft from \d+ seconds? to \d+ seconds?$/)

      await tools.getByRole('tab', { name: /^Voice note/ }).click()
      await presentationExpect(tools.getByRole('tab', { name: /^Voice note/ })).toHaveAttribute('aria-selected', 'true')
      await presentationExpect(recorder).toBeVisible()
      await presentationExpect(form).toHaveCount(0)
      await expectNothingFocusableIn(page.getByRole('group', { name: 'Text note tool', includeHidden: true }))
      await presentationExpect(timeline).toBeVisible()
      // The live draft stays previewed over the footage while Voice is the visible tool.
      await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 2.7 })
      await presentationExpect(page.getByTestId('reviewer-preview-target').locator('.annotation-overlay[data-draft="true"]')).toHaveCSS('opacity', '1')

      await tools.getByRole('tab', { name: /^Text note/ }).click()
      await presentationExpect(form).toBeVisible()
      await presentationExpect(recorder).toHaveCount(0)
      presentationExpect(await draft.evaluate((element, original) => element === original, originalDraft)).toBe(true)
      await presentationExpect(draft).toHaveValue('Draft kept across tools.')
      await presentationExpect(start).toHaveValue('2.45')

      // Tablist keyboard semantics: Arrow moves to Voice (activating it where the primitive follows focus).
      await tools.getByRole('tab', { name: /^Text note/ }).focus()
      await page.keyboard.press('ArrowRight')
      await presentationExpect(tools.getByRole('tab', { name: /^Voice note/ })).toBeFocused()
      if ((await tools.getByRole('tab', { name: /^Voice note/ }).getAttribute('aria-selected')) !== 'true') await page.keyboard.press('Enter')
      await presentationExpect(recorder).toBeVisible()
      await tools.getByRole('tab', { name: /^Text note/ }).click()
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page)
        await expectTargetSizes(page, '[role="tablist"][aria-label="Add commentary"] [role="tab"]')
      }
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally { await t.context.close() }
  })

  test('Saved notes folds, pages six at a time and discloses text, voice, processing, failed and erased details', async ({ browser }) => {
    const t = await openTools(browser)
    const { page, toggle, list, pager, row } = t
    try {
      await presentationExpect(toggle).toHaveAttribute('aria-expanded', 'false')
      await presentationExpect(list).toHaveCount(0)
      await presentationExpect(page.getByText('No saved notes yet.')).toHaveCount(0)
      const bodyId = (await toggle.getAttribute('aria-controls'))!
      await presentationExpect(page.locator(`[id="${bodyId}"]`)).toBeHidden()
      await expectNothingFocusableIn(page.locator(`[id="${bodyId}"]`))
      await presentationExpect(page.getByRole('group', { name: 'Annotation timeline', exact: true })).toBeVisible()

      await toggle.click()
      await presentationExpect(toggle).toHaveAttribute('aria-expanded', 'true')
      await presentationExpect(list).toHaveCount(1)
      presentationExpect(await rowIds(t)).toEqual(toolsPage1)
      await presentationExpect(pager).toContainText('Notes 1–6 of 13 · Page 1 of 3')
      const previous = pager.getByRole('button', { name: 'Previous', exact: true }), next = pager.getByRole('button', { name: 'Next', exact: true })
      await presentationExpect(previous).toHaveAttribute('aria-disabled', 'true')
      // aria-disabled (not disabled) at the edge: a forced click must still be a no-op.
      await previous.click({ force: true })
      await presentationExpect(pager).toContainText('Notes 1–6 of 13 · Page 1 of 3')

      // Row controls carry "<label>, annotation|voice note at <time>" names.
      await presentationExpect(row('tools-text-01').getByRole('button', { name: 'Go to time, annotation at 0 seconds', exact: true })).toBeVisible()
      await presentationExpect(row('tools-voice-erased').getByRole('button', { name: 'Go to time, voice note at 1 second', exact: true })).toBeVisible()
      await presentationExpect(row('tools-text-01')).toContainText('0:00.000–0:00.200')

      // Status variants, expanded in place.
      await row('tools-voice-processing').getByRole('button', { name: 'Show details, voice note at 0 seconds', exact: true }).click()
      await presentationExpect(row('tools-voice-processing').locator('p.whitespace-pre-wrap')).toHaveText('Transcribing…')
      await row('tools-voice-failed').getByRole('button', { name: 'Show details, voice note at 0 seconds', exact: true }).click()
      await presentationExpect(row('tools-voice-failed').locator('p.whitespace-pre-wrap')).toHaveText('Transcript unavailable.')
      await presentationExpect(row('tools-voice-failed').getByRole('button', { name: 'Retry transcript, voice note at 0 seconds', exact: true })).toBeVisible()
      await row('tools-voice-erased').getByRole('button', { name: 'Show details, voice note at 1 second', exact: true }).click()
      await presentationExpect(row('tools-voice-erased')).toContainText('Voice note · Audio unavailable')
      await presentationExpect(row('tools-voice-erased').getByText('Voice audio unavailable. This transcript stays at its original position.')).toBeVisible()
      await presentationExpect(row('tools-voice-erased').getByRole('button', { name: /^Preview audio/ })).toHaveCount(0)
      await presentationExpect(row('tools-voice-erased').getByRole('button', { name: 'Edit transcript, voice note at 1 second', exact: true })).toBeEnabled()

      await next.click()
      presentationExpect(await rowIds(t)).toEqual(toolsPage2)
      await presentationExpect(pager).toContainText('Notes 7–12 of 13 · Page 2 of 3')
      await presentationExpect(row('tools-text-03')).toContainText('Text note')
      // Historical audio row without a timing type is still a Voice point with audio.
      await presentationExpect(row('tools-voice-historic').getByRole('button', { name: 'Preview audio, voice note at 1 second', exact: true })).toBeVisible()

      // Voice detail: audio mounts only while the detail, page, list and Notes are active.
      const voice = row('notebook-voice')
      await voice.getByRole('button', { name: 'Show details, voice note at 1 second', exact: true }).click()
      await presentationExpect(voice.locator('p.whitespace-pre-wrap')).toHaveText('Your opening sounds warm and confident.')
      await voice.getByRole('button', { name: 'Preview audio, voice note at 1 second', exact: true }).click()
      await presentationExpect(voice.locator('audio[aria-label="Voice note audio"]')).toHaveCount(1)
      await voice.getByRole('button', { name: 'Hide details, voice note at 1 second', exact: true }).click()
      await presentationExpect(page.locator('audio[aria-label="Voice note audio"]')).toHaveCount(0)
      await voice.getByRole('button', { name: 'Show details, voice note at 1 second', exact: true }).click()
      await voice.getByRole('button', { name: 'Preview audio, voice note at 1 second', exact: true }).click()
      await presentationExpect(page.locator('audio[aria-label="Voice note audio"]')).toHaveCount(1)
      await toggle.click()
      await presentationExpect(page.locator('audio[aria-label="Voice note audio"]')).toHaveCount(0)
      await toggle.click()

      await next.click()
      await presentationExpect(pager).toContainText('Notes 13–13 of 13 · Page 3 of 3')
      presentationExpect(await rowIds(t)).toEqual(['tools-voice-ready-3'])
      await presentationExpect(next).toHaveAttribute('aria-disabled', 'true')
      await previous.click(); await previous.click()
      presentationExpect(await rowIds(t)).toEqual(toolsPage1)
      // Expansion survives paging while the note still exists.
      await presentationExpect(row('tools-voice-failed').getByRole('button', { name: 'Hide details, voice note at 0 seconds', exact: true })).toBeVisible()

      // Real keyboard walk: every focus stop inside the workspace is rendered (no hidden focus targets).
      await t.tools.getByRole('tab').first().focus()
      const stops: { rects: number; hiddenAncestor: boolean; label: string }[] = []
      for (let i = 0; i < 90; i++) {
        await page.keyboard.press('Tab')
        const stop = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          if (!el || !el.closest('[data-testid="annotation-workspace"]')) return null
          return { rects: el.getClientRects().length, hiddenAncestor: Boolean(el.closest('[hidden], [aria-hidden="true"], [inert]')), label: el.getAttribute('aria-label') ?? el.textContent?.slice(0, 40) ?? el.tagName }
        })
        if (!stop) break
        stops.push(stop)
      }
      presentationExpect(stops.length).toBeGreaterThan(10)
      presentationExpect(stops.filter((stop) => stop.rects === 0 || stop.hiddenAncestor)).toEqual([])

      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page)
        await expectTargetSizes(page, '[data-annotation-id] button, nav[aria-label="Saved notes pages"] button')
      }
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally { await t.context.close() }
  })

  test('editing locks paging, a marker reveals its note, and an off-page reveal waits for Save or Cancel', async ({ browser }) => {
    const t = await openTools(browser)
    const { page, toggle, pager, row } = t
    try {
      // Marker -> reveal while Saved notes is folded: seek once, open, page, detail, focus the summary.
      await presentationExpect(toggle).toHaveAttribute('aria-expanded', 'false')
      await page.getByTestId('voice-marker-tools-voice-ready-2').click()
      await presentationExpect(toggle).toHaveAttribute('aria-expanded', 'true')
      await presentationExpect(pager).toContainText('Notes 7–12 of 13 · Page 2 of 3')
      await presentationExpect(row('tools-voice-ready-2').getByRole('button', { name: 'Hide details, voice note at 1 second', exact: true })).toBeFocused()
      await presentationExpect(row('tools-voice-ready-2')).toHaveAttribute('data-selected', 'true')
      await presentationExpect(page.getByTestId('voice-marker-tools-voice-ready-2')).toHaveAttribute('data-selected', 'true')
      await presentationExpect.poll(() => currentTime(t)).toBeCloseTo(1.8, 1)
      // The same marker twice deliberately focuses the summary again.
      await pager.getByRole('button', { name: 'Previous', exact: true }).focus()
      await page.getByTestId('voice-marker-tools-voice-ready-2').click()
      await presentationExpect(row('tools-voice-ready-2').getByRole('button', { name: 'Hide details, voice note at 1 second', exact: true })).toBeFocused()
      // Playback never paginates by itself.
      await t.video.evaluate((element: HTMLVideoElement) => { element.currentTime = 0.1 })
      await presentationExpect(pager).toContainText('Page 2 of 3')

      await page.getByTestId('range-marker-tools-text-01').click()
      await presentationExpect(pager).toContainText('Notes 1–6 of 13 · Page 1 of 3')
      await presentationExpect(row('tools-text-01').getByRole('button', { name: 'Hide details, annotation at 0 seconds', exact: true })).toBeFocused()
      await presentationExpect.poll(() => currentTime(t)).toBeCloseTo(0, 1)

      // Edit lock: one editor, page held, collapse and other editors disabled, marker reveal deferred.
      await row('tools-text-01').getByRole('button', { name: 'Edit, annotation at 0 seconds', exact: true }).click()
      const editor = page.getByRole('region', { name: 'Editing annotation', exact: true })
      await presentationExpect(editor).toBeVisible()
      await presentationExpect(pager.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
      await presentationExpect(pager.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
      await presentationExpect(toggle).toBeDisabled()
      await presentationExpect(pager).toContainText('Editing page held · 6 saved notes shown · 13 saved total')
      await presentationExpect(pager.getByText('Save or cancel this edit to change pages.')).toBeVisible()
      await presentationExpect(row('tools-text-02').getByRole('button', { name: 'Edit, annotation at 0 seconds', exact: true })).toBeDisabled()
      const deferred = page.locator('div[role="status"]').filter({ hasText: 'Save or cancel this edit, then show the selected note.' })
      await page.getByTestId('voice-marker-tools-voice-ready-2').click()
      await presentationExpect(deferred).toBeVisible()
      await presentationExpect(deferred.getByRole('button', { name: 'Show selected note', exact: true })).toBeDisabled()
      await presentationExpect.poll(() => currentTime(t)).toBeCloseTo(1.8, 1)
      await presentationExpect(editor).toBeVisible()
      await presentationExpect(pager).toContainText('Editing page held')

      await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
      await presentationExpect(editor).toHaveCount(0)
      await presentationExpect(pager).toContainText('Notes 1–6 of 13 · Page 1 of 3')
      await presentationExpect(toggle).toBeEnabled()
      const show = page.getByRole('button', { name: 'Show selected note', exact: true })
      await presentationExpect(show).toBeEnabled()
      await show.click()
      await presentationExpect(pager).toContainText('Notes 7–12 of 13 · Page 2 of 3')
      await presentationExpect(row('tools-voice-ready-2').getByRole('button', { name: 'Hide details, voice note at 1 second', exact: true })).toBeFocused()
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally { await t.context.close() }
  })

  test('a deterministic recorder double locks the tools and outer tabs only while requesting or recording', async ({ browser }) => {
    const t = await openTools(browser, { recorder: true })
    const { page, tools, form, recorder } = t
    try {
      const outer = page.getByRole('tablist', { name: 'Your feedback' })
      const start = form.getByRole('textbox', { name: 'Start', exact: true })
      await start.fill('2.45')
      await form.getByRole('textbox', { name: 'End', exact: true }).fill('3')
      await form.getByRole('textbox', { name: 'Commentary', exact: true }).fill('Draft that must survive recording.')
      await tools.getByRole('tab', { name: /^Voice note/ }).click()
      await presentationExpect(recorder).toBeVisible()
      await recorder.getByRole('textbox', { name: 'Voice note position' }).fill('2.7')
      await recorder.getByRole('button', { name: /^Record/ }).click()
      await presentationExpect(recorder.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
      await presentationExpect(tools.getByRole('tab', { name: 'Voice note · Recording', exact: true })).toBeVisible()
      // Locked: cannot leave Voice or Notes, with a visible reason; Stop stays available.
      await presentationExpect(tools.getByRole('tab', { name: /^Text note/ })).toBeDisabled()
      await presentationExpect(outer.getByRole('tab', { name: 'Essay', exact: true })).toBeDisabled()
      await presentationExpect(outer.getByRole('tab', { name: 'Transcript', exact: true })).toBeDisabled()
      await presentationExpect(page.getByText('Stop recording to switch to Text note.')).toBeVisible()
      await presentationExpect(page.getByText('Stop recording before switching tabs.')).toBeVisible()
      // C must not stamp the hidden Text composer while the microphone is locked.
      await page.locator('body').click({ position: { x: 2, y: 2 } })
      await page.keyboard.press('c')
      await presentationExpect(page.getByRole('textbox', { name: 'Start', exact: true, includeHidden: true })).toHaveValue('2.45')
      // A draft marker cannot reveal the draft yet; Voice and Stop stay visible and the draft is unchanged.
      await page.locator('[data-temporary="true"]').click()
      await presentationExpect(page.getByText('Stop recording, then open the unsaved text draft. Your draft is unchanged.')).toBeVisible()
      await presentationExpect(recorder.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
      await presentationExpect(page.getByRole('button', { name: 'Publish feedback', exact: true })).toBeDisabled()

      await recorder.getByRole('button', { name: 'Stop', exact: true }).click()
      const preview = recorder.getByLabel('Voice note preview')
      await presentationExpect(preview).toBeVisible()
      await presentationExpect(tools.getByRole('tab', { name: 'Voice note · Unsaved recording', exact: true })).toBeVisible()
      await presentationExpect(tools.getByRole('tab', { name: /^Text note/ })).toBeEnabled()
      await presentationExpect(outer.getByRole('tab', { name: 'Essay', exact: true })).toBeEnabled()
      await presentationExpect(page.getByText('Stop recording before switching tabs.')).toHaveCount(0)
      // A stopped recording may be left and returned to; the same preview is retained and nothing is uploaded.
      const previewHandle = await preview.elementHandle()
      await tools.getByRole('tab', { name: /^Text note/ }).click()
      await presentationExpect(form).toBeVisible()
      await presentationExpect(form.getByRole('textbox', { name: 'Commentary', exact: true })).toHaveValue('Draft that must survive recording.')
      await tools.getByRole('tab', { name: /^Voice note/ }).click()
      presentationExpect(await preview.evaluate((element, original) => element === original, previewHandle)).toBe(true)
      await presentationExpect(page.getByRole('button', { name: 'Publish feedback', exact: true })).toBeDisabled()
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally { await t.context.close() }
  })
})

// Actual built route/player/controllers; every API mutation is fulfilled in this test context.
test.describe('owner video tools (isolated frontend)', () => {
  test.setTimeout(180_000)
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
  }
  async function openOwner(browser: Browser, options: NotebookFixtureOptions = {}, width = 1440) {
    const wire: OwnerToolsWire = options.ownerWire ?? { posterRequests: [] }
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    context.setDefaultTimeout(10_000)
    const mocked = await interceptPresentationApi(context, true, { ...options, ownerVideoTools: true, feedback: true, ownerWire: wire })
    const page = await context.newPage()
    await page.goto(`${APP_URL}/speeches/9`)
    const video = page.locator('video[data-testid="speech-video"]')
    const tools = page.getByRole('tablist', { name: 'Video tools', exact: true })
    if (options.notReady) await presentationExpect(page.getByText('Not ready to play yet.', { exact: true })).toBeVisible()
    else await presentationExpect(video).toBeVisible()
    if (!options.notReady && !options.reviewer) await presentationExpect(tools).toBeVisible()
    const timeline = page.locator('.owner-video-tools__timeline')
    const marker = (id: string) => timeline.getByTestId(id)
    return { wire, context, mocked, page, video, tools, timeline, marker }
  }
  async function expectHiddenPanelHasNoTargets(panel: import('@playwright/test').Locator) {
    await presentationExpect(panel).toBeHidden()
    presentationExpect(await panel.locator('button, input, a[href], [tabindex]').evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length > 0).length)).toBe(0)
  }

  for (const portrait of [false, true]) {
    test(`native ${portrait ? 'portrait' : 'landscape'} player, voice and pending poster survive utility changes`, async ({ browser }) => {
      console.log('[owner-tools/native] encoding', portrait ? 'portrait' : 'landscape')
      const media = await createNotebookMedia(browser, portrait)
      const t = await openOwner(browser, { portrait, media })
      const { page, video, tools, timeline, wire } = t
      const releaseGates: Array<() => void> = []
      try {
        await presentationExpect(t.marker('range-marker-owner-a-text')).toBeVisible()
        await presentationExpect(timeline.locator('.awt-marker')).toHaveCount(6)
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => [element.videoWidth, element.videoHeight])).toEqual(portrait ? [360, 640] : [640, 360])
        const original = await video.elementHandle()
        const initial = await video.evaluate((element: HTMLVideoElement) => {
          element.pause(); element.muted = true
          element.dataset.ownerLoads = '0'; element.dataset.ownerSeeks = '0'
          element.addEventListener('loadedmetadata', () => { element.dataset.ownerLoads = String(Number(element.dataset.ownerLoads) + 1) })
          element.addEventListener('seeking', () => { element.dataset.ownerSeeks = String(Number(element.dataset.ownerSeeks) + 1) })
          return { src: element.currentSrc, duration: element.duration, tracks: element.textTracks.length }
        })
        const captions = page.getByTestId('captions-toggle')
        if (await captions.getAttribute('aria-pressed') !== 'true') await captions.click()
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = .6 })
        await presentationExpect(t.marker('range-marker-owner-a-text')).toHaveAttribute('aria-current', 'true')
        await presentationExpect.poll(() => timeline.getByTestId('timeline-axis').evaluate((node) => parseFloat((node as HTMLElement).style.getPropertyValue('--playhead-percent')))).toBeGreaterThan(15)
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = .95 })
        await presentationExpect(t.marker('range-marker-owner-a-text')).not.toHaveAttribute('aria-current', 'true')
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
        const beforeSeek = Number(await video.getAttribute('data-owner-seeks'))
        await t.marker('range-marker-owner-a-text').focus()
        await page.keyboard.press('Enter')
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(.4, 2)
        await presentationExpect.poll(async () => Number(await video.getAttribute('data-owner-seeks')) - beforeSeek).toBe(1)
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
        presentationExpect(Number(await video.getAttribute('data-owner-seeks')) - beforeSeek).toBe(1)
        presentationExpect(wire.posterRequests).toEqual([])
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = .9 })
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
        console.log('[owner-tools/native] first user play')
        await page.locator('.vjs-big-play-button').click({ timeout: 10_000 })
        await presentationExpect(page.getByText('Playing voice commentary', { exact: true })).toBeVisible()
        await tools.getByRole('tab', { name: 'Frame selector', exact: true }).click()
        await presentationExpect(page.getByText('Playing voice commentary', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Pause commentary', exact: true }).click()
        await presentationExpect(page.getByText('Voice commentary paused', { exact: true })).toBeVisible()
        await tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
        await presentationExpect(page.getByText('Voice commentary paused', { exact: true })).toBeVisible()
        await t.marker('range-marker-owner-a-late').click()
        await presentationExpect(page.getByText('Voice commentary paused', { exact: true })).toHaveCount(0)
        presentationExpect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2.2, 2)

        console.log('[owner-tools/native] voice states and cancellation passed')
        // The picker stays mounted while pending, including its feedback after hidden settlement.
        await tools.getByRole('tab', { name: 'Frame selector', exact: true }).click()
        const pending = deferred<number>()
        releaseGates.push(() => pending.resolve(200))
        wire.posterReply = () => pending.promise
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.75 })
        await page.getByRole('button', { name: 'Use current frame', exact: true }).click()
        await presentationExpect.poll(() => wire.posterRequests.length).toBe(1)
        presentationExpect(wire.posterRequests[0]).toEqual({ path: '/api/speeches/9/assets/90/poster-frame', body: { time_seconds: 1.75 } })
        await presentationExpect(page.getByRole('button', { name: 'Updating…', exact: true })).toBeDisabled()
        await tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
        await presentationExpect(page.getByText('Poster updating…', { exact: true })).toBeHidden()
        pending.resolve(200)
        await presentationExpect(page.getByText('Poster updating…', { exact: true })).toHaveCount(1)
        await tools.getByRole('tab', { name: 'Frame selector', exact: true }).click()
        await presentationExpect(page.getByText('Poster updating…', { exact: true })).toBeVisible()
        const failure = deferred<number>()
        releaseGates.push(() => failure.resolve(503))
        wire.posterReply = () => failure.promise
        await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1.95 })
        await page.getByRole('button', { name: 'Use current frame', exact: true }).click()
        await presentationExpect.poll(() => wire.posterRequests.length).toBe(2)
        presentationExpect(wire.posterRequests[1].body).toEqual({ time_seconds: 1.95 })
        await tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
        failure.resolve(503)
        await presentationExpect(page.getByText('Could not update poster.', { exact: true })).toHaveCount(1)
        await tools.getByRole('tab', { name: 'Frame selector', exact: true }).click()
        await presentationExpect(page.getByText('Could not update poster.', { exact: true })).toBeVisible()
        wire.posterReply = undefined
        const spriteTime = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
        await page.getByRole('button', { name: 'Use frame at 0.9s', exact: true }).click()
        await presentationExpect.poll(() => wire.posterRequests.length).toBe(3)
        presentationExpect(wire.posterRequests[2].body.time_seconds).toBeCloseTo(.9, 8)
        presentationExpect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(spriteTime, 2)
        await presentationExpect(page.getByText('Poster updating…', { exact: true })).toBeVisible()
        await tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
        presentationExpect(await video.evaluate((element, old) => element === old, original)).toBe(true)
        await presentationExpect(video).toHaveCount(1)
        presentationExpect(await video.evaluate((element: HTMLVideoElement) => ({ src: element.currentSrc, duration: element.duration, tracks: element.textTracks.length }))).toEqual(initial)
        await presentationExpect(video).toHaveAttribute('data-owner-loads', '0')
        await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => Array.from(element.textTracks).some((track) => track.mode === 'showing'))).toBe(true)
        console.log('[owner-tools/native] poster requests and identity passed')
        const geometry = await page.locator('.owner-video-tools').evaluate((node) => {
          const media = document.querySelector('.video-js')!, caption = document.querySelector('[data-testid="captions-toggle"]')!
          return { outside: !node.closest('.video-js'), below: node.getBoundingClientRect().top >= Math.max(media.getBoundingClientRect().bottom, caption.getBoundingClientRect().bottom) }
        })
        presentationExpect(geometry).toEqual({ outside: true, below: true })
        await page.screenshot({ path: test.info().outputPath(`owner-tools-native-${portrait ? 'portrait' : 'landscape'}.png`), fullPage: true })
        presentationExpect(t.mocked.unexpected).toEqual([])
      } catch (error) { console.log('[owner-tools/native-body]', error); throw error }
      finally { releaseGates.forEach((release) => release()); await page.close(); await t.context.close() }
    })
  }

  test('two exact published tracks crossfade, preserve utility selection and obey all four projections', async ({ browser }) => {
    const t = await openOwner(browser)
    const { page, tools, timeline } = t
    try {
      await presentationExpect(t.marker('range-marker-owner-a-text')).toBeVisible()
      await presentationExpect(timeline.locator('[data-temporary], [data-kind="draft"]')).toHaveCount(0)
      await tools.getByRole('tab', { name: 'Frame selector', exact: true }).click()
      const tracks = page.getByRole('radiogroup', { name: 'Choose commentary track' })
      await tracks.getByText('Jamie Member', { exact: false }).click()
      await presentationExpect(tools.getByRole('tab', { name: 'Frame selector', exact: true })).toHaveAttribute('aria-selected', 'true')
      await tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
      await presentationExpect(t.marker('range-marker-owner-a-text')).toHaveCount(0)
      await presentationExpect(t.marker('range-marker-owner-b-text')).toBeVisible()
      await presentationExpect(timeline).toContainText('Jamie Member · Text + audio')
      const playback = page.getByRole('radiogroup', { name: 'Commentary playback' })
      for (const [label, total, text, voice] of [['Written notes only', 5, 2, 3], ['Audio only', 1, 0, 1], ['Off', 0, 0, 0], ['Text + audio', 6, 2, 4]] as const) {
        await playback.getByText(label, { exact: true }).click()
        await presentationExpect(timeline.locator('.awt-marker')).toHaveCount(total)
        await presentationExpect(timeline.locator('[data-kind="text"]')).toHaveCount(text)
        await presentationExpect(timeline.locator('[data-kind="voice"], [data-kind="erased-voice"]')).toHaveCount(voice)
        if (label === 'Off') await presentationExpect(timeline.getByText('Commentary is off. Open Notes to enable it.', { exact: true })).toBeVisible()
        if (label === 'Audio only') await presentationExpect(timeline).not.toContainText('published voice transcript')
      }
      await presentationExpect(t.marker('voice-marker-owner-b-erased')).toHaveAttribute('data-kind', 'erased-voice')
      await presentationExpect(t.marker('voice-marker-owner-b-erased')).toHaveAccessibleName(/audio unavailable/)
      await page.getByRole('tablist', { name: 'Speech tools', exact: true }).getByRole('tab', { name: 'Essay', exact: true }).click()
      await timeline.getByRole('button', { name: 'Open Notes', exact: true }).click()
      const notes = page.getByRole('tablist', { name: 'Speech tools', exact: true }).getByRole('tab', { name: 'Notes', exact: true })
      await presentationExpect(notes).toHaveAttribute('aria-selected', 'true')
      await presentationExpect(notes).toBeFocused()
      presentationExpect(t.wire.posterRequests).toEqual([])
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally { await t.context.close() }
  })

  test('loading voice survives tab changes and one marker seek cancels it without autoplay', async ({ browser }) => {
    const loading = deferred<void>()
    const wire: OwnerToolsWire = { posterRequests: [], voiceReply: () => loading.promise }
    const t = await openOwner(browser, { media: await createNotebookMedia(browser, false), ownerWire: wire })
    try {
      await presentationExpect(t.marker('range-marker-owner-a-text')).toBeVisible()
      await t.video.evaluate((element: HTMLVideoElement) => { element.muted = true; element.currentTime = .9 })
      await presentationExpect.poll(() => t.video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
      await t.page.locator('.vjs-big-play-button').click({ timeout: 10_000 })
      await presentationExpect(t.page.getByText('Loading voice commentary…', { exact: true })).toBeVisible()
      await t.tools.getByRole('tab', { name: 'Frame selector', exact: true }).click()
      await presentationExpect(t.page.getByText('Loading voice commentary…', { exact: true })).toBeVisible()
      await t.tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
      await t.marker('range-marker-owner-a-late').click()
      await presentationExpect(t.page.getByText('Loading voice commentary…', { exact: true })).toHaveCount(0)
      loading.resolve()
      await presentationExpect.poll(() => t.video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2.2, 2)
      presentationExpect(await t.video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
      await presentationExpect(t.page.getByText('Playing voice commentary', { exact: true })).toHaveCount(0)
      presentationExpect(wire.posterRequests).toEqual([])
      presentationExpect(t.mocked.unexpected).toEqual([])
    } catch (error) { console.log('[owner-tools/loading-body]', error); throw error }
    finally { loading.resolve(); await t.page.close(); await t.context.close() }
  })

  for (const width of [320, 375, 768, 1440]) {
    test(`responsive keyboard and hidden panels at ${width}px in light, system dark, explicit dark and forced colors`, async ({ browser }) => {
      const t = await openOwner(browser, {}, width)
      try {
        await presentationExpect(t.marker('range-marker-owner-a-text')).toBeVisible()
        const panels = t.page.locator('.owner-video-tools > [role="tabpanel"]')
        await presentationExpect(panels).toHaveCount(2)
        for (const theme of ['light', 'system-dark', 'explicit-dark', 'forced-colors']) {
          await t.page.emulateMedia({ colorScheme: theme === 'system-dark' ? 'dark' : 'light', forcedColors: theme === 'forced-colors' ? 'active' : 'none', reducedMotion: 'reduce' })
          await t.page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'explicit-dark')
          await t.tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
          await expectHiddenPanelHasNoTargets(panels.nth(1))
          await expectTargetSizes(t.page, '.owner-video-tools__tab, .owner-video-tools__notes')
          await expectNoPageOverflow(t.page)
          const bounds = await t.timeline.evaluate((root) => {
            const r = root.getBoundingClientRect()
            return Array.from(root.querySelectorAll('.awt-marker')).every((node) => { const b = node.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1 })
          })
          presentationExpect(bounds).toBe(true)
          await t.tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).focus()
          await t.page.keyboard.press('ArrowRight')
          await presentationExpect(t.tools.getByRole('tab', { name: 'Frame selector', exact: true })).toBeFocused()
          await t.page.keyboard.press('Enter')
          await expectHiddenPanelHasNoTargets(panels.nth(0))
          await presentationExpect(t.page.getByRole('button', { name: 'Use current frame', exact: true })).toBeVisible()
          await expectNoPageOverflow(t.page)
        }
        await t.page.screenshot({ path: test.info().outputPath(`owner-tools-${width}.png`), fullPage: true })
        presentationExpect(t.mocked.unexpected).toEqual([])
      } finally { await t.context.close() }
    })
  }

  for (const variant of ['empty', 'denied', 'processing', 'reviewer'] as const) {
    test(`${variant} source has the correct owner-only state without false markers`, async ({ browser }) => {
      const t = await openOwner(browser, { ownerVariant: variant === 'empty' || variant === 'denied' ? variant : undefined, notReady: variant === 'processing', reviewer: variant === 'reviewer' })
      try {
        if (variant === 'processing' || variant === 'reviewer') await presentationExpect(t.tools).toHaveCount(0)
        else {
          await presentationExpect(t.timeline).toContainText(variant === 'empty' ? 'This reviewer has no published commentary yet.' : 'Commentary is unavailable. Open Notes for details.')
          await presentationExpect(t.timeline.locator('.awt-marker')).toHaveCount(0)
        }
        presentationExpect(t.wire.posterRequests).toEqual([])
        presentationExpect(t.mocked.unexpected).toEqual([])
      } finally { await t.context.close() }
    })
  }
})

// Release-only navigation uses native input/media; API journals below never reach a backend.
test.describe('draggable timeline playhead (isolated frontend)', () => {
  test.setTimeout(120_000)
  let media: Buffer
  test.beforeAll(async ({ browser }) => { media = await createNotebookMedia(browser, false) })
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
  }
  async function openScrub(browser: Browser, reviewer = false, options: NotebookFixtureOptions = {}, width = 1440, hasTouch = false, recorder = false) {
    const wire: ScrubWire = options.scrubWire ?? { reviewRequests: 0, playbackRequests: 0, voiceMediaRequests: 0, mutations: [] }
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch })
    context.setDefaultTimeout(10_000)
    const fixture = { media, reviewer, reviewerOverlay: reviewer, notebookTools: reviewer, ownerVideoTools: !reviewer,
      feedback: true, playbackMode: 'written' as const, ...options, draggable: true, scrubWire: wire }
    const mocked = await interceptPresentationApi(context, true, fixture)
    const page = await context.newPage()
    if (recorder) await installDeterministicRecorder(page)
    await page.goto(`${APP_URL}/speeches/9`, { waitUntil: 'domcontentloaded' })
    const video = page.locator('video[data-testid="speech-video"]')
    await presentationExpect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
    await presentationExpect(page.getByTestId('captions-toggle')).toHaveAttribute('aria-pressed', 'true')
    const slider = page.getByRole('slider', { name: 'Video position', exact: true })
    await presentationExpect(slider).toBeVisible()
    await slider.evaluate((node) => {
      const video = document.querySelector<HTMLVideoElement>('video[data-testid="speech-video"]')!
      const entries: unknown[] = []
      const record = (event: Event) => {
        const rect = node.getBoundingClientRect()
        entries.push({ event: event.type, time: video.currentTime, duration: video.duration, paused: video.paused, ended: video.ended,
          dragging: node.getAttribute('data-dragging'), x: rect.x, y: rect.y, visibility: document.visibilityState })
        ;(node as HTMLElement).dataset.scrubEvents = JSON.stringify(entries.slice(-18))
      }
      node.addEventListener('pointerdown', (event) => {
        (node as HTMLElement).dataset.pointerGrip = String(event.target instanceof Element && !!event.target.closest('.awt-scrubber-grip'))
      })
      for (const name of ['pointerdown', 'pointermove', 'pointerup', 'lostpointercapture', 'blur']) node.addEventListener(name, record)
      for (const name of ['loadstart', 'emptied', 'error', 'loadedmetadata', 'durationchange']) video.addEventListener(name, record)
      window.addEventListener('blur', record)
      document.addEventListener('visibilitychange', record)
    })
    await video.evaluate((element: HTMLVideoElement) => {
      element.muted = true; element.pause()
      element.dataset.scrubSeeks = '0'; element.dataset.scrubMetadata = '0'; element.dataset.scrubResets = '0'
      element.addEventListener('seeking', () => { element.dataset.scrubSeeks = String(Number(element.dataset.scrubSeeks) + 1) })
      element.addEventListener('loadedmetadata', () => { element.dataset.scrubMetadata = String(Number(element.dataset.scrubMetadata) + 1) })
      for (const name of ['loadstart', 'emptied', 'error']) element.addEventListener(name, () => { element.dataset.scrubResets = String(Number(element.dataset.scrubResets) + 1) })
    })
    return { context, page, video, slider, wire, fixture, mocked,
      timeline: reviewer ? page.locator('.aw-root').getByTestId('timeline-strip') : page.locator('.owner-video-tools__timeline') }
  }
  type Scrub = Awaited<ReturnType<typeof openScrub>>
  const time = (t: Scrub) => t.video.evaluate((element: HTMLVideoElement) => element.currentTime)
  const seeks = async (t: Scrub) => Number(await t.video.getAttribute('data-scrub-seeks'))
  async function ready(t: Scrub) {
    await presentationExpect(t.slider).toHaveAttribute('aria-disabled', 'false')
    // Media readiness is independent of commentary. Wait the populated/empty UI state
    // before measuring a gesture so the genuine loading-notice reflow has finished.
    if (t.fixture.reviewer) await presentationExpect(t.timeline.getByTestId('range-marker-tools-text-01')).toBeVisible()
    else if (t.fixture.noSelectedReview) await presentationExpect(t.timeline).toContainText('Choose a reviewer in Notes')
    else if (t.fixture.ownerVariant === 'empty') await presentationExpect(t.timeline).toContainText('no published commentary yet')
    else if (t.fixture.ownerVariant === 'denied') await presentationExpect(t.timeline).toContainText('Commentary is unavailable')
    else if (t.fixture.playbackMode === 'off') await presentationExpect(t.timeline).toContainText('Commentary is off. Open Notes')
    else await presentationExpect(t.timeline.getByTestId('range-marker-owner-a-text')).toBeVisible()
  }
  async function position(t: Scrub, seconds: number) {
    await t.video.evaluate((element: HTMLVideoElement, target) => { element.pause(); element.currentTime = target }, seconds)
    await presentationExpect.poll(() => time(t)).toBeCloseTo(seconds, 2)
    await presentationExpect.poll(() => t.video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
    // Native seeking settles before the existing rAF necessarily paints the grip. Wait for that actual writer.
    await presentationExpect.poll(() => t.timeline.getByTestId('timeline-axis').evaluate((node) => {
      const video = document.querySelector<HTMLVideoElement>('video[data-testid="speech-video"]')!
      return Math.abs(parseFloat((node as HTMLElement).style.getPropertyValue('--playhead-percent')) - video.currentTime / video.duration * 100)
    })).toBeLessThan(.1)
  }
  async function axis(t: Scrub) {
    await t.slider.scrollIntoViewIfNeeded()
    const box = await t.slider.boundingBox()
    if (!box) throw new Error('No visible scrub axis')
    return { ...box, y: box.y + box.height / 2 }
  }
  async function begin(t: Scrub, fraction: number) {
    const box = await axis(t)
    await t.page.mouse.move(box.x + box.width * fraction, box.y)
    await t.page.mouse.down()
    await presentationExpect(t.slider).toHaveAttribute('data-dragging', 'true')
    return box
  }
  async function committed(t: Scrub, before: number, seconds?: number) {
    await presentationExpect.poll(() => seeks(t)).toBe(before + 1)
    await presentationExpect.poll(() => t.video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
    presentationExpect(await seeks(t)).toBe(before + 1)
    if (seconds !== undefined) await presentationExpect.poll(() => time(t)).toBeCloseTo(seconds, 1)
  }
  async function close(t: Scrub) { await t.page.mouse.up().catch(() => undefined); await t.page.close(); await t.context.close() }

  for (const reviewer of [false, true]) {
    test(`${reviewer ? 'reviewer' : 'owner'} native drag previews paused/playing time and seeks only on release`, async ({ browser }) => {
      const t = await openScrub(browser, reviewer)
      try {
        await ready(t)
        const original = await t.video.elementHandle()
        const metadata = await t.video.evaluate((element: HTMLVideoElement) => [element.duration, element.textTracks.length, element.currentSrc])
        if (reviewer) {
          await t.page.getByRole('textbox', { name: 'Start', exact: true }).fill('2.45')
          await t.page.getByRole('textbox', { name: 'Commentary', exact: true }).fill('Unsaved text must not be stamped or revealed by scrubbing.')
        }
        await position(t, .6)
        const before = await seeks(t), mutations = [...t.wire.mutations]
        const box = await axis(t), grip = await t.slider.locator('.awt-scrubber-grip').boundingBox()
        if (!grip) throw new Error('No grip')
        const grab = grip.x + grip.width / 2 + 3
        const grabY = grip.y + grip.height / 2
        await t.page.mouse.move(grab, grabY); await t.page.mouse.down()
        await presentationExpect(t.slider).toHaveAttribute('data-pointer-grip', 'true')
        await presentationExpect(t.slider).toHaveAttribute('data-dragging', 'true')
        const initialCandidate = Number(await t.slider.getAttribute('aria-valuenow'))
        presentationExpect(initialCandidate).toBeCloseTo(.6, 1)
        await t.page.mouse.move(grab + box.width * .3, grabY, { steps: 6 })
        const candidate = Number(await t.slider.getAttribute('aria-valuenow'))
        presentationExpect(candidate).toBeGreaterThan(1)
        presentationExpect(await time(t)).toBeCloseTo(.6, 2)
        presentationExpect(await seeks(t)).toBe(before)
        await presentationExpect(t.slider.locator('.awt-scrubber-time')).toContainText('Release to seek')
        await t.page.mouse.up()
        await committed(t, before, candidate)
        presentationExpect(await t.video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)

        // First actual user play uses Video.js's visible initial button.
        await position(t, .1)
        await t.page.locator('.vjs-big-play-button').click({ timeout: 10_000 })
        await presentationExpect.poll(() => time(t)).toBeGreaterThan(.15)
        const playingBefore = await seeks(t)
        await axis(t)
        const heldGrip = await t.slider.locator('.awt-scrubber-grip').boundingBox()
        if (!heldGrip) throw new Error('No playing grip')
        await t.page.mouse.move(heldGrip.x + heldGrip.width / 2, heldGrip.y + heldGrip.height / 2); await t.page.mouse.down()
        await presentationExpect(t.slider).toHaveAttribute('data-pointer-grip', 'true')
        const held = await time(t)
        await t.page.waitForTimeout(180)
        presentationExpect(await time(t)).toBeGreaterThan(held)
        await presentationExpect(t.slider).toHaveAttribute('data-dragging', 'true')
        presentationExpect(await seeks(t)).toBe(playingBefore)
        await t.page.mouse.up()
        await t.page.waitForTimeout(50)
        presentationExpect(await seeks(t)).toBe(playingBefore)
        presentationExpect(await t.video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
        const rail = await begin(t, .7)
        const snapshot = () => t.slider.evaluate((node) => {
          const video = document.querySelector<HTMLVideoElement>('video[data-testid="speech-video"]')!
          const rect = node.getBoundingClientRect()
          return { dragging: node.getAttribute('data-dragging'), value: node.getAttribute('aria-valuenow'),
            disabled: node.getAttribute('aria-disabled'), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            time: video.currentTime, duration: video.duration, source: video.currentSrc, paused: video.paused,
            preview: node.parentElement!.style.getPropertyValue('--scrub-preview-percent'), events: (node as HTMLElement).dataset.scrubEvents }
        })
        const gestureStart = await snapshot()
        await t.page.mouse.move(rail.x + rail.width * .8, rail.y, { steps: 5 })
        console.log('[scrub-playing/before-release]', JSON.stringify({ reviewer, start: { ...gestureStart, events: undefined }, current: { ...await snapshot(), events: undefined } }))
        presentationExpect(await seeks(t)).toBe(playingBefore)
        await t.page.mouse.up()
        console.log('[scrub-playing/after-release]', JSON.stringify({ ...await snapshot(), events: undefined }))
        await committed(t, playingBefore)
        presentationExpect(await t.video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
        await t.video.evaluate((element: HTMLVideoElement) => element.pause())
        presentationExpect(t.wire.mutations).toEqual(mutations)
        presentationExpect(await t.video.evaluate((element, old) => element === old, original)).toBe(true)
        presentationExpect(await t.video.evaluate((element: HTMLVideoElement) => [element.duration, element.textTracks.length, element.currentSrc])).toEqual(metadata)
        await presentationExpect(t.video).toHaveAttribute('data-scrub-metadata', '0')
        if (reviewer) {
          await presentationExpect(t.page.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('2.45')
          await presentationExpect(t.page.getByRole('button', { name: 'Saved notes (13)', exact: true })).toBeVisible()
          await presentationExpect(t.page.getByRole('list', { name: 'Your commentary', exact: true })).toBeHidden()
          presentationExpect(t.wire.reviewRequests).toBe(2)
        }
        presentationExpect(t.mocked.unexpected).toEqual([])
      } finally { await close(t) }
    })

    test(`${reviewer ? 'reviewer' : 'owner'} rail endpoints, keyboard and Escape preserve shortcuts and marker behavior`, async ({ browser }) => {
      const t = await openScrub(browser, reviewer)
      try {
        await ready(t); await position(t, .5)
        if (reviewer) await t.page.getByRole('textbox', { name: 'Start', exact: true }).fill('2.45')
        const mutations = [...t.wire.mutations]
        let count = await seeks(t)
        const box = await begin(t, .5)
        await t.page.mouse.move(box.x - 40, box.y); await t.page.mouse.up()
        await committed(t, count, 0)
        count = await seeks(t)
        await t.slider.focus(); await t.page.keyboard.press('ArrowRight')
        await committed(t, count, 1)
        count = await seeks(t)
        await t.page.keyboard.press('PageUp')
        await committed(t, count, Number(await t.slider.getAttribute('aria-valuemax')))
        count = await seeks(t)
        await t.page.keyboard.press('Home'); await committed(t, count, 0)
        count = await seeks(t)
        const focusedTime = await time(t)
        for (const key of ['Space', 'Enter', 'c', 'j', 'l', '[', ']', ',', '.']) {
          await presentationExpect(t.slider).toBeFocused()
          await t.page.keyboard.press(key)
        }
        const focus = await t.page.evaluate(() => ({ tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute('role') }))
        presentationExpect(await seeks(t), JSON.stringify({ focus, events: await t.slider.getAttribute('data-scrub-events') })).toBe(count)
        presentationExpect(await time(t)).toBeCloseTo(focusedTime, 2)
        presentationExpect(await t.video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
        if (reviewer) await presentationExpect(t.page.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('2.45')
        await begin(t, .8); await t.page.keyboard.press('Escape'); await t.page.mouse.up()
        presentationExpect(await seeks(t)).toBe(count)
        await presentationExpect(t.slider).not.toHaveAttribute('data-dragging', 'true')
        presentationExpect(await t.timeline.getByTestId('timeline-axis').evaluate((node) => (node as HTMLElement).style.getPropertyValue('--scrub-preview-percent'))).toBe('')
        await position(t, .6)
        count = await seeks(t)
        const marker = t.timeline.getByTestId(reviewer ? 'range-marker-tools-text-01' : 'range-marker-owner-a-text')
        await marker.click()
        await committed(t, count, reviewer ? 0 : .4)
        if (reviewer) await presentationExpect(t.page.getByRole('list', { name: 'Your commentary', exact: true })).toBeVisible()
        presentationExpect(t.wire.mutations).toEqual(mutations)
        presentationExpect(t.mocked.unexpected).toEqual([])
      } finally { await close(t) }
    })
  }

  for (const reviewer of [false, true]) {
    test(`${reviewer ? 'reviewer' : 'owner'} route replacement retires captured media before late pointer release`, async ({ browser }) => {
      const t = await openScrub(browser, reviewer)
      try {
        await ready(t); await position(t, .5)
        const retired = await t.video.elementHandle()
        if (!retired) throw new Error('No native video to retire')
        const mutations = [...t.wire.mutations]
        await begin(t, .8)
        // Activate an actual React Router link without releasing the captured mouse.
        await t.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My speeches', exact: true }).evaluate((node: HTMLElement) => node.click())
        await presentationExpect(t.page).toHaveURL(`${APP_URL}/speeches`)
        await presentationExpect.poll(() => retired.evaluate((element) => element.isConnected)).toBe(false)
        await t.page.getByRole('link', { name: 'Watch', exact: true }).evaluate((node: HTMLElement) => node.click())
        await presentationExpect(t.page).toHaveURL(`${APP_URL}/speeches/9`)
        await presentationExpect.poll(() => t.video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
        await ready(t)
        presentationExpect(await t.video.evaluate((element, old) => element === old, retired)).toBe(false)
        await t.video.evaluate((element: HTMLVideoElement) => {
          element.pause(); element.dataset.scrubSeeks = '0'
          element.addEventListener('seeking', () => { element.dataset.scrubSeeks = String(Number(element.dataset.scrubSeeks) + 1) })
        })
        const oldTime = await retired.evaluate((element: HTMLVideoElement) => element.currentTime)
        const oldSeeks = await retired.evaluate((element: HTMLVideoElement) => element.dataset.scrubSeeks)
        const freshTime = await time(t)
        await t.page.mouse.up()
        await t.page.waitForTimeout(80)
        presentationExpect(await time(t)).toBe(freshTime)
        presentationExpect(await seeks(t)).toBe(0)
        presentationExpect(await retired.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(oldTime)
        presentationExpect(await retired.evaluate((element: HTMLVideoElement) => element.dataset.scrubSeeks)).toBe(oldSeeks)
        presentationExpect(t.wire.mutations).toEqual(mutations)
        presentationExpect(t.mocked.unexpected).toEqual([])
      } finally { await close(t) }
    })
  }

  test('owner poster session denial retires captured media before late pointer release', async ({ browser }) => {
    const poster = deferred<number>(), ownerWire: OwnerToolsWire = { posterRequests: [], posterReply: () => poster.promise }
    const t = await openScrub(browser, false, { ownerWire })
    try {
      await ready(t); await position(t, .5)
      const retired = await t.video.elementHandle()
      if (!retired) throw new Error('No native video to retire')
      const tools = t.page.getByRole('tablist', { name: 'Video tools' })
      await tools.getByRole('tab', { name: 'Frame selector', exact: true }).click()
      await t.page.getByRole('button', { name: 'Use current frame', exact: true }).click()
      await presentationExpect.poll(() => ownerWire.posterRequests.length).toBe(1)
      await tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
      await ready(t)
      const mutations = [...t.wire.mutations]
      await begin(t, .8)
      const oldTime = await retired.evaluate((element: HTMLVideoElement) => element.currentTime)
      const oldSeeks = await retired.evaluate((element: HTMLVideoElement) => element.dataset.scrubSeeks)
      poster.resolve(401)
      await presentationExpect(t.page).toHaveURL(/\/login(?:\?|$)/)
      await presentationExpect(t.page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible()
      // Identity loss is a hard navigation: the old document, and the handle's
      // execution context with it, is destroyed. A throwing evaluate means retired.
      const alive = <T,>(read: (element: HTMLVideoElement) => T) =>
        retired.evaluate(read).then((value) => ({ gone: false, value }), () => ({ gone: true, value: undefined }))
      await presentationExpect.poll(async () => (await retired.evaluate((element) => element.isConnected).catch(() => false))).toBe(false)
      await t.page.mouse.up()
      await t.page.waitForTimeout(80)
      const time = await alive((element) => element.currentTime), seeks = await alive((element) => element.dataset.scrubSeeks)
      if (!time.gone) presentationExpect(time.value).toBe(oldTime)
      if (!seeks.gone) presentationExpect(seeks.value).toBe(oldSeeks)
      await presentationExpect(t.video).toHaveCount(0)
      presentationExpect(ownerWire.posterRequests).toHaveLength(1)
      presentationExpect(t.wire.mutations).toEqual(mutations)
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally { poster.resolve(401); await close(t) }
  })

  for (const state of ['off', 'empty', 'no-selection'] as const) {
    test(`owner ${state} still navigates without exposing markers or new review requests`, async ({ browser }) => {
      const t = await openScrub(browser, false, { playbackMode: state === 'off' ? 'off' : 'written',
        ownerVariant: state === 'empty' ? 'empty' : undefined, noSelectedReview: state === 'no-selection' })
      try {
        await ready(t); await position(t, .2)
        await presentationExpect(t.timeline.locator('.awt-marker')).toHaveCount(0)
        const count = await seeks(t), mutations = [...t.wire.mutations], reviews = t.wire.reviewRequests
        const box = await begin(t, .6)
        presentationExpect(await seeks(t)).toBe(count)
        await t.page.mouse.up(); await committed(t, count, Number(await t.slider.getAttribute('aria-valuemax')) * .6)
        presentationExpect(box.height).toBe(44)
        presentationExpect(t.wire.reviewRequests).toBe(reviews)
        presentationExpect(t.wire.mutations).toEqual(mutations)
        presentationExpect(t.mocked.unexpected).toEqual([])
      } finally { await close(t) }
    })
  }

  test('owner hidden captured release preserves pending poster and does not mark unread feedback', async ({ browser }) => {
    const poster = deferred<number>(), ownerWire: OwnerToolsWire = { posterRequests: [], posterReply: () => poster.promise }
    const t = await openScrub(browser, false, { ownerWire })
    try {
      await ready(t); await position(t, .5)
      const tools = t.page.getByRole('tablist', { name: 'Video tools' })
      await tools.getByRole('tab', { name: 'Frame selector', exact: true }).click()
      await t.page.getByRole('button', { name: 'Use current frame', exact: true }).click()
      await presentationExpect.poll(() => ownerWire.posterRequests.length).toBe(1)
      await tools.getByRole('tab', { name: 'Commentary timeline', exact: true }).click()
      await t.page.getByRole('tablist', { name: 'Speech tools' }).getByRole('tab', { name: 'Essay', exact: true }).click()
      await t.page.evaluate(() => localStorage.clear())
      const count = await seeks(t), stored = await t.page.evaluate(() => JSON.stringify(localStorage)), mutations = [...t.wire.mutations]
      await begin(t, .7)
      // Real tab activation while a pointer remains captured; hidden/inert cancels it.
      await tools.getByRole('tab', { name: 'Frame selector', exact: true }).evaluate((node: HTMLElement) => node.click())
      await t.page.mouse.up()
      presentationExpect(await seeks(t)).toBe(count)
      await presentationExpect(t.slider).toBeHidden()
      poster.resolve(200)
      await presentationExpect(t.page.getByText('Poster updating…', { exact: true })).toBeVisible()
      presentationExpect(ownerWire.posterRequests).toHaveLength(1)
      presentationExpect(t.wire.mutations).toEqual(mutations)
      presentationExpect(await t.page.evaluate(() => JSON.stringify(localStorage))).toBe(stored)
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally { poster.resolve(200); await close(t) }
  })

  test('reviewer waits for one fresh validation GET without reviewer.id and retries only explicitly', async ({ browser }) => {
    const validation = deferred<number>(), retry = deferred<number>()
    const wire: ScrubWire = { reviewRequests: 0, playbackRequests: 0, voiceMediaRequests: 0, mutations: [],
      reviewReply: (count) => count === 2 ? validation.promise : count === 3 ? retry.promise : Promise.resolve(200) }
    const t = await openScrub(browser, true, { scrubWire: wire })
    try {
      await presentationExpect.poll(() => wire.reviewRequests).toBe(2)
      await presentationExpect(t.slider).toHaveAttribute('aria-disabled', 'true')
      await t.page.waitForTimeout(100)
      presentationExpect(wire.reviewRequests).toBe(2)
      validation.resolve(500)
      const action = t.page.getByRole('button', { name: 'Retry timeline navigation', exact: true })
      await presentationExpect(action).toBeEnabled()
      await presentationExpect(t.slider).toHaveAttribute('aria-disabled', 'true')
      await action.click()
      await presentationExpect(action).toBeDisabled()
      await presentationExpect.poll(() => wire.reviewRequests).toBe(3)
      retry.resolve(200); await ready(t)
      await position(t, .6)
      const count = await seeks(t)
      await t.slider.focus(); await t.page.keyboard.press('ArrowRight'); await committed(t, count, 1.6)
      presentationExpect(wire.reviewRequests).toBe(3)
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally { validation.resolve(500); retry.resolve(200); await close(t) }
  })

  test('reviewer requesting/recording and inactive Notes guard capture without changing drafts or recording anchor', async ({ browser }) => {
    const t = await openScrub(browser, true, {}, 1440, false, true)
    try {
      await ready(t)
      // Hold the browser-local deterministic recorder's microphone request.
      await t.page.evaluate(() => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        let release!: () => void
        const gate = new Promise<void>((done) => { release = done })
        Object.assign(globalThis, { __releaseScrubMic: release })
        navigator.mediaDevices.getUserMedia = async (constraints) => { await gate; return original(constraints) }
      })
      const editor = t.page.getByRole('region', { name: 'New annotation', exact: true })
      await editor.getByRole('textbox', { name: 'Start', exact: true }).fill('2.45')
      await editor.getByRole('textbox', { name: 'Commentary', exact: true }).fill('Text draft preserved while navigating.')
      await t.page.getByRole('tablist', { name: 'Add commentary' }).getByRole('tab', { name: /^Voice note/ }).click()
      const recorder = t.page.getByRole('region', { name: 'Record a voice note' })
      await recorder.getByRole('textbox', { name: 'Voice note position' }).fill('2.7')
      const count = await seeks(t)
      await begin(t, .6)
      await recorder.getByRole('button', { name: /^Record/ }).evaluate((node: HTMLElement) => node.click())
      await presentationExpect(t.slider).toHaveAttribute('aria-disabled', 'true')
      await t.page.mouse.up()
      presentationExpect(await seeks(t)).toBe(count)
      await t.page.evaluate(() => (globalThis as typeof globalThis & { __releaseScrubMic: () => void }).__releaseScrubMic())
      await presentationExpect(recorder.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
      // The existing recorder normalizes the same 2.7s anchor when permission resolves.
      await presentationExpect(recorder.getByRole('textbox', { name: 'Voice note position' })).toHaveValue('0:02.700')
      const anchor = await recorder.getByRole('textbox', { name: 'Voice note position' }).inputValue()
      await presentationExpect(t.slider).toHaveAttribute('aria-disabled', 'true')
      await recorder.getByRole('button', { name: 'Stop', exact: true }).click()
      await ready(t)
      await presentationExpect(recorder.getByRole('textbox', { name: 'Voice note position' })).toHaveValue(anchor)
      const preview = recorder.getByLabel('Voice note preview'), original = await preview.elementHandle()
      await begin(t, .8)
      await t.page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Essay', exact: true }).evaluate((node: HTMLElement) => node.click())
      await t.page.mouse.up()
      await presentationExpect(t.slider).toBeHidden()
      presentationExpect(await seeks(t)).toBe(count)
      await t.page.getByRole('tablist', { name: 'Your feedback' }).getByRole('tab', { name: 'Notes', exact: true }).click()
      presentationExpect(await preview.evaluate((node, old) => node === old, original)).toBe(true)
      await presentationExpect(t.page.getByRole('textbox', { name: 'Start', exact: true, includeHidden: true })).toHaveValue('2.45')
      presentationExpect(t.wire.mutations).toEqual([])
      presentationExpect(t.mocked.unexpected).toEqual([])
    } finally {
      await t.page.evaluate(() => (globalThis as typeof globalThis & { __releaseScrubMic?: () => void }).__releaseScrubMic?.()).catch(() => undefined)
      await close(t)
    }
  })

  for (const state of ['loading', 'playing', 'paused'] as const) {
    test(`native ${state} voice continues during preview, Escape cancels preview, commit cancels voice once`, async ({ browser }) => {
      const audioUrl = deferred<void>()
      const ownerWire: OwnerToolsWire = { posterRequests: [], ...(state === 'loading' ? { voiceReply: () => audioUrl.promise } : {}) }
      const t = await openScrub(browser, false, { playbackMode: 'all', ownerWire })
      try {
        await ready(t); await position(t, .9)
        await t.page.locator('.vjs-big-play-button').click({ timeout: 10_000 })
        await presentationExpect(t.page.getByText(state === 'loading' ? 'Loading voice commentary…' : 'Playing voice commentary', { exact: true })).toBeVisible()
        if (state === 'paused') await t.page.getByRole('button', { name: 'Pause commentary', exact: true }).click()
        const status = state === 'paused' ? 'Voice commentary paused' : state === 'loading' ? 'Loading voice commentary…' : 'Playing voice commentary'
        const count = await seeks(t), originalTime = await time(t), mutations = [...t.wire.mutations]
        await begin(t, .8)
        await presentationExpect(t.page.getByText(status, { exact: true })).toBeVisible()
        presentationExpect(await seeks(t)).toBe(count)
        await t.page.keyboard.press('Escape'); await t.page.mouse.up()
        await presentationExpect(t.page.getByText(status, { exact: true })).toBeVisible()
        presentationExpect(await time(t)).toBeCloseTo(originalTime, 2)
        // Escape must not propagate to the controller's Skip/resume shortcut.
        presentationExpect(await t.video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
        const box = await begin(t, .7)
        await t.page.mouse.move(box.x + box.width * .75, box.y, { steps: 5 })
        const candidate = Number(await t.slider.getAttribute('aria-valuenow'))
        await t.page.mouse.up(); await committed(t, count, candidate)
        await presentationExpect(t.page.getByText(status, { exact: true })).toHaveCount(0)
        const audioRequests = t.wire.voiceMediaRequests
        audioUrl.resolve()
        await t.page.waitForTimeout(100)
        if (state === 'loading') presentationExpect(t.wire.voiceMediaRequests).toBe(audioRequests)
        presentationExpect(await t.video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
        presentationExpect(t.wire.mutations).toEqual(mutations)
        presentationExpect(ownerWire.posterRequests).toEqual([])
        presentationExpect(t.mocked.unexpected).toEqual([])
      } finally { audioUrl.resolve(); await close(t) }
    })
  }

  for (const reviewer of [false, true]) {
    test(`${reviewer ? 'reviewer' : 'owner'} same-element native source error/reset cancels capture and discards late release`, async ({ browser }) => {
      const refresh = deferred<void>()
      const wire: ScrubWire = { reviewRequests: 0, playbackRequests: 0, voiceMediaRequests: 0, mutations: [],
        playbackReply: (request) => request > 1 ? refresh.promise : Promise.resolve() }
      const t = await openScrub(browser, reviewer, { scrubWire: wire })
      try {
        await ready(t); await position(t, .6)
        const original = await t.video.elementHandle(), reviews = wire.reviewRequests
        await begin(t, .8)
        // Invalid local bytes cause genuine native emptied/loadstart/error, then the existing
        // adapter asks its intercepted playback-url endpoint for a replacement of this source.
        await t.video.evaluate((element: HTMLVideoElement) => { element.src = 'data:video/mp4;base64,AA=='; element.load() })
        await presentationExpect.poll(async () => Number(await t.video.getAttribute('data-scrub-resets'))).toBeGreaterThan(0)
        await presentationExpect(t.slider).toHaveAttribute('aria-disabled', 'true')
        await presentationExpect(t.slider).not.toHaveAttribute('data-dragging', 'true')
        await presentationExpect.poll(() => wire.playbackRequests).toBeGreaterThan(1)
        refresh.resolve()
        await ready(t)
        presentationExpect(await t.video.evaluate((node, old) => node === old, original)).toBe(true)
        const current = await time(t), count = await seeks(t)
        await t.page.mouse.up()
        await presentationExpect.poll(() => t.video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
        presentationExpect(await seeks(t)).toBe(count)
        presentationExpect(await time(t)).toBeCloseTo(current, 2)
        presentationExpect(wire.reviewRequests).toBe(reviews)
        presentationExpect(wire.mutations).toEqual([])
        presentationExpect(t.mocked.unexpected).toEqual([])
      } finally { refresh.resolve(); await close(t) }
    })
  }

  for (const reviewer of [false, true]) {
    test(`${reviewer ? 'reviewer' : 'owner'} continuous native touch drag previews and commits once`, async ({ browser, browserName }) => {
      test.skip(browserName !== 'chromium', 'Playwright WebKit exposes tap only, without a continuous touch-move protocol; physical iPhone/iPad horizontal drag, vertical scroll and pinch remain manual.')
      const t = await openScrub(browser, reviewer, {}, 375, true)
      try {
        await ready(t); await position(t, .4)
        const cdp = await t.context.newCDPSession(t.page), box = await axis(t), count = await seeks(t), mutations = [...t.wire.mutations]
        const point = (fraction: number) => ({ x: box.x + box.width * fraction, y: box.y, id: 11, radiusX: 4, radiusY: 4, force: 1 })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(.3)] })
        await presentationExpect(t.slider).toHaveAttribute('data-dragging', 'true')
        for (const fraction of [.4, .5, .6, .7]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(fraction)] })
        presentationExpect(await time(t)).toBeCloseTo(.4, 2)
        presentationExpect(await seeks(t)).toBe(count)
        const finalTarget = Number(await t.slider.getAttribute('aria-valuemax')) * .7
        // CDP acknowledges input before the last native move is necessarily delivered to the page.
        await presentationExpect.poll(async () => Number(await t.slider.getAttribute('aria-valuenow'))).toBeCloseTo(finalTarget, 2)
        const candidate = Number(await t.slider.getAttribute('aria-valuenow'))
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await committed(t, count, candidate)
        presentationExpect(t.wire.mutations).toEqual(mutations)
        presentationExpect(t.mocked.unexpected).toEqual([])
        await cdp.detach()
      } finally { await close(t) }
    })
  }

  for (const width of [320, 375, 768, 1440]) {
    test(`both roles keep a bounded focusable 44px row and reachable markers at ${width}px across themes`, async ({ browser }) => {
      for (const reviewer of [false, true]) {
        const t = await openScrub(browser, reviewer, {}, width)
        try {
          await ready(t)
          for (const theme of ['light', 'system-dark', 'explicit-dark', 'forced-colors']) {
            await t.page.emulateMedia({ colorScheme: theme === 'system-dark' ? 'dark' : 'light', forcedColors: theme === 'forced-colors' ? 'active' : 'none', reducedMotion: 'reduce' })
            await t.page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'explicit-dark')
            await t.slider.focus()
            await presentationExpect(t.slider).toBeFocused()
            const geometry = await t.slider.evaluate((element) => {
              const row = element.getBoundingClientRect(), timeline = element.closest('[data-testid="timeline-strip"]')!
              const text = timeline.querySelector('[data-testid="timeline-lane-text"]')!.getBoundingClientRect()
              return { height: row.height, width: row.width, clear: row.bottom <= text.top + 1,
                markers: Array.from(timeline.querySelectorAll<HTMLElement>('.awt-marker')).every((marker) => marker.tabIndex === 0 && marker.getClientRects().length > 0) }
            })
            presentationExpect(geometry.height).toBe(44)
            presentationExpect(geometry.width).toBeGreaterThan(44)
            presentationExpect(geometry.clear).toBe(true)
            presentationExpect(geometry.markers).toBe(true)
            await expectNoPageOverflow(t.page)
            for (const key of ['Home', 'End']) {
              await t.page.keyboard.press(key)
              const target = key === 'Home' ? 0 : Number(await t.slider.getAttribute('aria-valuemax'))
              await presentationExpect.poll(() => time(t)).toBeCloseTo(target, 2)
              await presentationExpect.poll(() => t.video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
              await presentationExpect.poll(() => t.timeline.getByTestId('timeline-axis').evaluate((node) => {
                const video = document.querySelector<HTMLVideoElement>('video[data-testid="speech-video"]')!
                return Math.abs(parseFloat((node as HTMLElement).style.getPropertyValue('--playhead-percent')) - video.currentTime / video.duration * 100)
              })).toBeLessThan(.1)
              const bounded = await t.slider.evaluate((node) => {
                const row = node.getBoundingClientRect()
                return ['.awt-scrubber-grip', '.awt-scrubber-time'].every((selector) => {
                  const child = node.querySelector(selector)!.getBoundingClientRect()
                  return child.left >= row.left - 1 && child.right <= row.right + 1 && child.top >= row.top - 1 && child.bottom <= row.bottom + 1
                })
              })
              presentationExpect(bounded, `${theme}/${key}: grip and time label stay inside the 44px row`).toBe(true)
            }
            await position(t, .2)
            const count = await seeks(t)
            await t.page.keyboard.press('ArrowRight')
            await committed(t, count)
            await position(t, .2)
          }
          await t.page.screenshot({ path: test.info().outputPath(`scrub-${reviewer ? 'reviewer' : 'owner'}-${width}.png`), fullPage: true })
          presentationExpect(t.mocked.unexpected).toEqual([])
        } finally { await close(t) }
      }
    })
  }
})
