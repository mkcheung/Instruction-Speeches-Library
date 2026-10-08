import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { API_URL, APP_URL, FIXTURE_PASSWORD, USERS } from './fixtures.js'
import { signInToPanel } from './panel-auth.js'

/**
 * PLAN-ADMIN-DASHBOARD.md §9's E2E row — Phase 4.
 *
 * "The panel has never been exercised by a browser in CI, and no test
 * asserts `/control-panel` status codes" (§9, quoting
 * `STEP-12-RETROSPECTIVE.md:36`). Everything the backend suite proves
 * about the panel it proves through `Livewire::test()`, which deliberately
 * runs with NO panel middleware: `PanelModerationTest`'s own docblock says
 * so, and `SuspensionEnforcementTest` — the one file that does issue real
 * `/control-panel` requests — asserts only that the response is not a
 * redirect to the suspension notice, never that it is a 200. So this file
 * is the first thing in the repo to drive the panel's real middleware
 * stack, real Blade login, real mandatory TOTP challenge and real
 * stylesheet through a browser.
 *
 * Requires `api/database/seeders/E2ESeeder.php` — including the
 * `*_TOTP_SECRET` columns it now seeds for ids 9001/9002, without which
 * every panel navigation lands in Filament's mandatory enrollment flow:
 *   docker compose exec app php artisan db:seed --class=E2ESeeder
 *
 * ## What runs where
 *
 * Every test here is project-agnostic on purpose. The responsive cases
 * drive `page.setViewportSize()` through 390 / 768 / 1280 themselves
 * rather than leaning on the `mobile-webkit` project, because
 * `ci.yml`'s main Playwright command is `--project=chromium` ONLY — the
 * same gap that once let an unconditional-sidebar assertion ship broken
 * in `app-shell.spec.ts`. Running this file under `mobile-webkit` as well
 * still adds real value (WebKit's own layout engine, `hasTouch`), and it
 * works unchanged; it is just not where the 390px coverage comes from.
 *
 * ## ⚠️ The one thing this file CANNOT prove in the e2e stack
 *
 * `Filament\Http\Middleware\Authenticate` ends in
 *
 *     abort_if($user instanceof FilamentUser
 *         ? (! $user->canAccessPanel($panel))
 *         : (config('app.env') !== 'local'), 403)
 *
 * and `App\Models\User` implements neither (`EnsureUserIsAdmin`'s
 * docblock records that as a deliberate decision). `compose.e2e.yaml`
 * sets `APP_ENV: e2e`, so in the harness CI runs — and in production,
 * where it is `production` — that is an unconditional 403 for EVERY
 * authenticated user, admin or not, on every panel route. The dev stack
 * (`api/.env`, `APP_ENV=local`) is the only place the panel is reachable
 * at all today, which is where these tests were verified.
 *
 * That is a production bug, not a test-harness problem, and it is not
 * fixable from `web/tests/`: it needs `User` to implement `FilamentUser`
 * with a `canAccessPanel()`. The admin/super_admin tests below are
 * written against the correct behaviour and will fail loudly in any
 * non-local environment until that lands — which is the honest outcome,
 * and precisely the class of "it boots, so it works" error §9 exists to
 * catch. The member-403 case is the one to read carefully in that state:
 * it passes either way, because the env-403 and the role-403 render the
 * identical page. Its meaning comes from the admin-200 tests passing
 * alongside it, not from itself.
 */

/* ------------------------------------------------------------------ *
 * §8.1 — Access Denied. No panel login needed for any of these.
 * ------------------------------------------------------------------ */

test.describe('§8.1 — /control-panel refuses a non-admin, with an explanation', () => {
  test('a signed-in member gets a 403 and the branded page naming their account', async ({
    browser,
  }) => {
    // The member's SPA session cookie reaches the API origin because
    // `SESSION_DOMAIN=.speechcoach.test` covers both hosts — so this is a
    // genuinely authenticated non-admin hitting the panel, which is the
    // case §8.1 is about, not an anonymous visitor (asserted separately
    // below, because it takes a different branch entirely).
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    const response = await page.goto(`${API_URL}/control-panel`)

    // §9's "member/coach → 403". The first status-code assertion against
    // this path anywhere in the repo.
    expect(response?.status()).toBe(403)

    // `resources/views/errors/403.blade.php` exists and, until this test,
    // nothing rendered it in a browser. The apostrophe is an `&rsquo;`
    // entity in the Blade source, so this matches the rendered character.
    await expect(
      page.getByRole('heading', { name: 'You don’t have access to this page', level: 1 }),
    ).toBeVisible()

    // The `$isPanelRequest` branch, which is the whole reason the view
    // bothers to inspect `request()->is('control-panel', ...)`.
    await expect(
      page.getByText('The control panel is restricted to administrator accounts'),
    ).toBeVisible()

    // §8.1's actual product claim: "no hint that the most likely cause is
    // being signed in with the wrong one of two accounts". The page has to
    // name the account, or the hint is useless.
    await expect(page.getByText(USERS.speaker.email)).toBeVisible()

    // Both escapes from the dead end. The sign-out form posts to the
    // panel's own logout route (the view picks it by path); the secondary
    // link goes back to the SPA.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to the app' })).toHaveAttribute(
      'href',
      APP_URL,
    )

    await context.close()
  })

  test('an anonymous visitor is sent to the panel login, not 403', async ({ page }) => {
    // Deliberately no `storageState` — a fresh, unauthenticated context.
    // Filament's `Authenticate::redirectTo()` returns the panel's login
    // URL, and this is the branch that proves the 403 above came from the
    // authorization layer rather than from being signed out.
    await page.goto(`${API_URL}/control-panel`)

    await expect(page).toHaveURL(`${API_URL}/control-panel/login`)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test("the panel login page's own CSS and JS actually load", async ({ page }) => {
    // Not padding. `AdminPanelProvider`'s docblock records that the panel
    // rendered unstyled with no Alpine for an entire step, because
    // `filament:assets` had never run and "the login page returns HTTP
    // 200 whether or not its stylesheet exists, and no test ever requested
    // an asset". A page-level 200 cannot see that; a response listener can.
    const broken: string[] = []

    page.on('response', (response) => {
      const type = response.request().resourceType()
      const isPanelAsset =
        response.url().startsWith(API_URL) &&
        ['stylesheet', 'script', 'font'].includes(type)

      if (isPanelAsset && response.status() >= 400) {
        broken.push(`${response.status()} ${type} ${response.url()}`)
      }
    })

    await page.goto(`${API_URL}/control-panel/login`)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    expect(broken, 'every /css/filament and /js/filament request should succeed').toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * §6.1 / §9 — an admin reaches the dashboard.
 *
 * Serial, and sharing one page across the block, for a reason that is not
 * speed: `AppAuthentication::verifyCode(…, shouldPreventCodeReuse: true)`
 * refuses a second code from the same 30-second window for the same
 * secret, so one login per block is the shape that does not fight the
 * framework. `panel-auth.ts` documents the retry that covers the rest.
 * ------------------------------------------------------------------ */

test.describe.serial('§6.1 — an admin lands on the dashboard PAGE', () => {
  let context: BrowserContext
  let page: Page

  test.beforeAll(async ({ browser }) => {
    // Above the 30s default because `signInToPanel`'s second attempt
    // deliberately waits out a full TOTP timestep (~31s) before retrying.
    test.setTimeout(120_000)

    context = await browser.newContext()
    page = await context.newPage()
    await signInToPanel(page, USERS.admin)
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('the panel root is the Dashboard, not a redirect into whichever resource sorts first', async () => {
    // The regression `DashboardPageTest` guards from the route table, now
    // observed from a browser: before §6.1 there was no registered
    // `Filament\Pages\Dashboard`, so `RedirectToHomeController` owned
    // `GET control-panel` and sent an admin to a resource list. A URL
    // assertion is the whole test — if the redirect ever comes back, this
    // lands on /control-panel/users or similar.
    await expect(page).toHaveURL(`${API_URL}/control-panel`)
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

    // §6.1's tile and the un-orphaned widget. `MostConnectionsWidget` was
    // fully built in STEP-13 and rendered nowhere a human could see,
    // because `Filament::getWidgets()` has exactly one renderer in the
    // whole framework and no Dashboard was registered. "Visible in a
    // browser" is the only assertion that would have caught that.
    await expect(page.getByText('Open reports')).toBeVisible()
    await expect(page.getByText('Coach applications waiting')).toBeVisible()
    await expect(page.getByText('Most connections in the last 7 days')).toBeVisible()
  })

  test('the desktop sidebar collapses and expands — §7’s ->sidebarCollapsibleOnDesktop()', async () => {
    // Filament collapses the sidebar to an overlay below `lg` with no help
    // at all, so the mobile case was never the gap §7 closed; the DESKTOP
    // one was, and `sidebarCollapsibleOnDesktop()` is opt-in. Its
    // observable consequences are exact: the `<body>` carries
    // `fi-body-has-sidebar-collapsible-on-desktop`, and the topbar gets a
    // pair of chevron buttons that exist in the DOM ONLY when the flag is
    // set (`topbar.blade.php:49-104` wraps them in `@if
    // ($isSidebarCollapsibleOnDesktop || …)`).
    await page.setViewportSize({ width: 1280, height: 900 })

    await expect(page.locator('body')).toHaveClass(
      /fi-body-has-sidebar-collapsible-on-desktop/,
    )

    const sidebar = page.locator('#fi-main-sidebar')
    const usersLink = sidebar.getByRole('link', { name: 'Users' })

    // ⚠️ Located by class, NOT by accessible name. Three different buttons
    // on this page share the name "Expand sidebar" — the mobile hamburger
    // and both desktop chevrons — and `getByRole` would match all of them.
    const collapse = page.locator('.fi-topbar-close-collapse-sidebar-btn')
    const expand = page.locator('.fi-topbar-open-collapse-sidebar-btn')

    await expect(collapse).toBeVisible()
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await expect(usersLink).toBeVisible()

    // Captured BEFORE the click so the collapsed width below is compared
    // against this panel's own expanded rail rather than a hardcoded
    // number — `sidebarWidth()` is configurable and nothing here should
    // depend on the default staying 16rem.
    const expandedWidth = (await sidebar.boundingBox())?.width ?? 0
    expect(expandedWidth).toBeGreaterThan(120)

    await collapse.click()

    // `aria-expanded` is bound to the same `$store.sidebar.isOpen` the
    // rail's width is, so this is the state flip itself rather than a
    // proxy for it.
    await expect(expand).toBeVisible()
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expect(sidebar).not.toHaveClass(/fi-sidebar-open/)

    // ⚠️ NOT `expect(usersLink).toBeHidden()`, which an earlier draft
    // asserted and which fails against the real panel. Filament's
    // collapsed desktop sidebar is an ICON RAIL, not a zero-width
    // element: the links survive, keep their accessible names (that is
    // what makes an icon-only rail usable at all), and Playwright
    // correctly reports them visible. Asserting otherwise tested a
    // collapse behaviour Filament does not have, while the three
    // assertions above already prove the real one.
    //
    // The user-visible truth is the WIDTH, so measure it. The expanded
    // rail is `--sidebar-width` (16rem/256px by default); collapsed it is
    // `--collapsed-sidebar-width`. A generous threshold keeps this from
    // breaking if either token is retuned, while still failing loudly if
    // the rail does not shrink at all — which is the regression that
    // matters.
    const collapsedWidth = (await sidebar.boundingBox())?.width ?? 0
    expect(collapsedWidth).toBeLessThan(expandedWidth)
    expect(collapsedWidth).toBeLessThan(120)

    // Restore it. `$store.sidebar.isOpen` is `Alpine.$persist`ed to
    // localStorage, so leaving it collapsed would leak into every later
    // test in this serial block — and expanding again is the other half
    // of the contract anyway.
    await expand.click()
    await expect(sidebar).toHaveClass(/fi-sidebar-open/)
    await expect(usersLink).toBeVisible()
  })

  test('the dashboard holds up at 390, 768 and 1280 px — §10’s Phase 3 gate', async () => {
    // §10's gate for Phase 3 is the literal string "verified at 390 / 768
    // / 1280 px", and nothing verified any of the three. The breakpoints
    // that matter are not arbitrary: Filament's sidebar store switches at
    // 1024 (`stores/sidebar.js`'s own `breakpoint`), and `fi-ta-cell-label`
    // is `sm:hidden`, i.e. 640.
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1280, 900],
    ] as const) {
      await page.setViewportSize({ width, height })
      await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

      // The page may never force the viewport to scroll sideways. This is
      // the assertion that would have caught a widget with a fixed width,
      // and it is the one thing a Livewire/Blade test cannot see at all.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `no horizontal page overflow at ${width}px`).toBeLessThanOrEqual(1)

      const hamburger = page.locator('.fi-topbar-open-sidebar-btn')
      const desktopCollapse = page.locator('.fi-topbar-close-collapse-sidebar-btn')

      if (width >= 1024) {
        // `.fi-topbar-open-sidebar-btn` is `lg:hidden` once the body has
        // the collapsible-on-desktop class; the chevron takes over.
        await expect(hamburger).toBeHidden()
        await expect(desktopCollapse).toBeVisible()
      } else {
        // Below `lg` the rail is an overlay and the hamburger is the only
        // way to reach navigation — the panel's equivalent of the SPA's
        // "below md, UserMenu is the only nav" contract.
        await expect(hamburger).toBeVisible()
        await expect(desktopCollapse).toBeHidden()
        await expect(page.locator('#fi-main-sidebar')).not.toHaveClass(/fi-sidebar-open/)
      }
    }

    // The overlay actually opens on a phone. Without this the hamburger
    // assertion above only proves a button is painted.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.fi-topbar-open-sidebar-btn').click()
    await expect(page.locator('#fi-main-sidebar')).toHaveClass(/fi-sidebar-open/)
    await expect(page.locator('#fi-main-sidebar').getByRole('link', { name: 'Users' })).toBeVisible()
  })
})

/* ------------------------------------------------------------------ *
 * §5.2 / §9 — "the case nothing covers".
 * ------------------------------------------------------------------ */

test.describe.serial('§5.2 — a super_admin reaches the same panel as an admin', () => {
  let context: BrowserContext
  let page: Page

  test.beforeAll(async ({ browser }) => {
    // See the admin block above: the TOTP retry can cost a timestep.
    test.setTimeout(120_000)

    context = await browser.newContext()
    page = await context.newPage()
    await signInToPanel(page, USERS.superAdmin)
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('the dashboard admits a super_admin, which §9 flags as the uncovered case', async () => {
    // §1.2/§5.2: roles here are mutually exclusive — `syncRoles` never
    // stacks `admin` under `super_admin` — so an `admin`-only predicate
    // locks out the higher tier entirely. That was the shipped state:
    // `Gate::before` tested `hasRole('admin')` exactly, so a super_admin
    // cleared `EnsureUserIsAdmin` (which checks both) and was then denied
    // by everything INSIDE the panel. Both ends of that asymmetry are in
    // this one navigation.
    await expect(page).toHaveURL(`${API_URL}/control-panel`)
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
    await expect(page.getByText('Open reports')).toBeVisible()
  })

  test('a resource table stacks into labelled cards at 390px — §7’s ->stackedOnMobile()', async () => {
    // One resource table, per §9's "a smaller spec that genuinely runs
    // beats a large one that does not". `UserResource` is the right one:
    // it has the most columns of the five, so it is where "the user is
    // unable to see much information in a table row at once without
    // scrolling" bites hardest.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${API_URL}/control-panel/users`)

    const table = page.locator('table.fi-ta-table')
    await expect(table).toBeVisible()

    // The flag itself: `index.blade.php:1436` adds this class only when
    // `$isStackedOnMobile`. Deleting the `->stackedOnMobile()` call fails
    // here first.
    await expect(table).toHaveClass(/fi-ta-table-stacked-on-mobile/)

    // And the flag doing its job, which the class alone does not prove.
    // Stacked rows wrap every cell in `<div class="fi-ta-cell-label">` +
    // `<div class="fi-ta-cell-content">`, and the label is `sm:hidden` —
    // so a VISIBLE label at 390px means the shipped CSS really is turning
    // the row into a card, not just that a class name is present.
    const emailLabel = table.locator('.fi-ta-cell-label', { hasText: 'Email' }).first()
    await expect(emailLabel).toBeVisible()
    await expect(page.getByText(USERS.admin.email).first()).toBeVisible()

    // The column header row is `hidden sm:table-row` while stacked — the
    // header is what a card layout replaces, so it must be gone.
    await expect(
      table.locator('thead th', { hasText: 'Email' }).first(),
    ).toBeHidden()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'no horizontal page overflow at 390px').toBeLessThanOrEqual(1)

    // The same table at 1280px is a real table again: labels hidden,
    // header back. Without this half, a stylesheet that hid the header
    // unconditionally would pass the mobile assertions above.
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(emailLabel).toBeHidden()
    await expect(table.locator('thead th', { hasText: 'Email' }).first()).toBeVisible()
  })
})

/* ------------------------------------------------------------------ *
 * §7 — the SPA's entry point into the panel.
 * ------------------------------------------------------------------ */

test.describe.serial('§7 — the SPA’s "Admin panel" nav item', () => {
  let context: BrowserContext
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000)

    context = await browser.newContext()
    page = await context.newPage()

    // An inline SPA login rather than a fourth entry in `auth.setup.ts`,
    // for the reason `fixtures.ts` gives: every browser project depends on
    // that setup project, and nothing about the admin fixtures should be
    // able to take `speech-create.spec.ts` down. The timeouts match
    // `auth.setup.ts`'s, and for its documented reason — the Vite dev
    // server transforms modules on demand and intermittently stalls.
    await page.goto(`${APP_URL}/login`, { timeout: 120_000 })
    await page.getByRole('textbox', { name: 'Email' }).fill(USERS.admin.email)
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(FIXTURE_PASSWORD)
    await page.getByRole('button', { name: 'Log in' }).click()
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 120_000 })
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('the rail renders it as a real external anchor to the API origin', async () => {
    // §7's whole point: `NavItem.to` normally feeds `<NavLink>`, a
    // client-side React Router link. `/control-panel` is a Laravel route
    // on another host, so a `NavLink` would resolve it against the SPA's
    // own router and render the 404 page inside the app shell. `external:
    // true` is what makes `AppSidebar` emit an `<a href>` instead.
    await page.setViewportSize({ width: 1280, height: 900 })

    const link = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Admin panel' })

    await expect(link).toBeVisible()
    // Absolute, on `api.`, not a path resolved against `app.`.
    await expect(link).toHaveAttribute('href', `${API_URL}/control-panel`)
    // The panel is the highest-privilege origin in the system; the SPA
    // should not hand it this page's URL as a Referer.
    await expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  test('the user menu carries it too, which is the only nav below md', async () => {
    // `AppSidebar` is `hidden md:flex`, so on a phone this menu is the
    // ONLY navigation — without the same `external` branch in `UserMenu`,
    // an admin on a phone has no route to their own panel at all.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()

    await page.getByRole('button', { name: USERS.admin.name }).click()

    const item = page.getByRole('menuitem', { name: 'Admin panel' })
    await expect(item).toBeVisible()
    await expect(item).toHaveAttribute('href', `${API_URL}/control-panel`)
  })

  test('clicking it actually arrives at the panel, not at a 404 in the app shell', async () => {
    // The end-to-end of §7. This also pins something worth knowing: the
    // SPA session is accepted by the panel directly (same `web` guard,
    // and `SESSION_DOMAIN=.speechcoach.test` spans both hosts), so an
    // admin who is already signed into the app is NOT challenged for TOTP
    // again — `EnsureMultiFactorAuthenticationIsEnabled` only requires
    // that a secret EXISTS, which is why E2ESeeder seeding one matters
    // beyond the login form.
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`${APP_URL}/dashboard`)

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Admin panel' })
      .click()

    await expect(page).toHaveURL(`${API_URL}/control-panel`)
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  })
})

test.describe('§7 — and it is additive, not a rename', () => {
  test('a member sees no "Admin panel" item while keeping every baseline destination', async ({
    browser,
  }) => {
    // The negative control, and the guard on the trap §7 names: adding a
    // nav item is safe because `app-shell.spec.ts:142`'s label list is an
    // inclusion check, but RENAMING or REMOVING one of those four breaks
    // Playwright silently while vitest stays green. This asserts the four
    // still resolve, as a non-admin, alongside the new item's absence.
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })

    await page.goto(`${APP_URL}/dashboard`)

    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Admin panel' })).toHaveCount(0)

    for (const label of ['My reviews', 'My speeches', 'Edit profile', 'Account & privacy']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }

    await context.close()
  })
})
