import { test, expect } from '@playwright/test'
import { APP_URL, USERS } from './fixtures.js'

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
