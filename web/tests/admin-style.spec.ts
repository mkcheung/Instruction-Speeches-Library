import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { API_URL, USERS } from './fixtures.js'
import { completePanelChallenge, MFA_CHALLENGE_URL, submitSharedCredentials } from './panel-auth.js'

/** Read-only content checks; run only on the dedicated, seeded E2E stack. */
const destinations = [
  ['', 'Dashboard', 'dashboard'],
  ['/coach-applications', 'Coach applications', 'coach-applications'],
  ['/users', 'Users', 'users'],
  ['/connections', 'Connections', 'connections'],
  ['/reports', 'Reports', 'reports'],
  ['/speeches', 'Speeches', 'speeches'],
] as const

async function expectScene(page: Page, key: string): Promise<void> {
  const scene = page.locator('[data-admin-scene]')
  await expect(scene).toHaveCount(1)
  await expect(scene).toHaveAttribute('data-admin-scene', key)
  await expect(scene).toHaveAttribute('aria-hidden', 'true')
  await expect(scene.locator('svg')).toHaveAttribute('focusable', 'false')
  await expect(scene.locator('a, button, input, [tabindex]')).toHaveCount(0)
}

for (const role of ['admin', 'superAdmin'] as const) {
  test.describe.serial(`Backstage Notes — ${role}`, () => {
    let context: BrowserContext
    let page: Page

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(120_000)
      context = await browser.newContext()
      page = await context.newPage()
      await page.goto(`${API_URL}/control-panel/login`)
      await submitSharedCredentials(page, USERS[role].email)
      await expect(page).toHaveURL(MFA_CHALLENGE_URL)
      await expect(page.locator('[data-admin-scene]')).toHaveCount(0)
      await completePanelChallenge(page, USERS[role])
    })

    test.afterAll(async () => {
      await context?.close()
    })

    test('serves the theme and fonts from the API with immutable, fingerprinted assets', async () => {
      const failures: string[] = []
      const loadedFonts = new Set<string>()
      page.on('response', (response) => {
        const url = new URL(response.url())
        if (url.origin !== API_URL || !/\/(?:css|fonts)\/filament\/admin\//.test(url.pathname)) return
        const headers = response.headers()
        if (response.status() !== 200) failures.push(`${response.status()} ${url.pathname}`)
        if (!headers['cache-control']?.includes('immutable')) failures.push(`missing immutable cache: ${url.pathname}`)
        if (url.pathname.endsWith('.woff2')) {
          loadedFonts.add(url.pathname)
          if (!headers['content-type']?.includes('font/woff2')) failures.push(`wrong font MIME: ${url.pathname}`)
        } else if (!headers['content-type']?.includes('text/css')) {
          failures.push(`wrong CSS MIME: ${url.pathname}`)
        }
      })
      await page.reload({ waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      const links = await page.locator('link[rel="stylesheet"]').evaluateAll((elements) =>
        elements.map((element) => (element as HTMLLinkElement).href),
      )
      const notebook = links.filter((href) => /\/css\/filament\/admin\/admin-workspace-[a-f0-9]+\.css/.test(href))
      expect(notebook).toHaveLength(1)
      expect(links.filter((href) => /\/fonts\/filament\/admin\/notebook-[a-f0-9]+\/index\.css/.test(href))).toHaveLength(1)
      expect(links.findIndex((href) => href === notebook[0])).toBeGreaterThan(
        links.findIndex((href) => href.includes('/css/filament/filament/app.css')),
      )
      expect(links.some((href) => /fonts\.(?:bunny\.net|googleapis\.com)/.test(href))).toBe(false)
      expect(loadedFonts.size).toBeGreaterThanOrEqual(2)
      expect(failures).toEqual([])
      const families = await page.locator('h1').evaluate((heading) => ({
        body: getComputedStyle(document.body).fontFamily,
        heading: getComputedStyle(heading).fontFamily,
      }))
      expect(families.body).toContain('Geist')
      expect(families.heading).toContain('Luckiest Guy')
    })

    test('maps every available destination and retains the audit role boundary', async () => {
      for (const [path, heading, key] of destinations) {
        await page.goto(`${API_URL}/control-panel${path}`)
        await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible()
        await expectScene(page, key)
      }
      const auditLink = page.getByRole('link', { name: 'Audit log', exact: true })
      if (role === 'superAdmin') {
        await expect(auditLink).toBeVisible()
        await auditLink.click()
        await expectScene(page, 'audit-log')
      } else {
        await expect(auditLink).toHaveCount(0)
        const response = await page.goto(`${API_URL}/control-panel/audit-logs`)
        expect(response?.status()).toBe(403)
        await expect(page.locator('[data-admin-scene]')).toHaveCount(0)
      }
    })

    test('retains user context after a Livewire search and uses compact functional typography on detail', async () => {
      await page.goto(`${API_URL}/control-panel/users`)
      const updated = page.waitForResponse((response) =>
        response.url() === `${API_URL}/livewire/update` && response.request().method() === 'POST',
      )
      await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(USERS.admin.username)
      expect((await updated).ok()).toBe(true)
      await expect(page.getByRole('row').filter({ hasText: USERS.admin.email })).toHaveCount(1)
      await expect(page.getByRole('row').filter({ hasText: USERS.speaker.email })).toHaveCount(0)
      await expectScene(page, 'users')

      // E2ESeeder::ADMIN_ID; a read-only account detail, without moderation actions.
      await page.goto(`${API_URL}/control-panel/users/9002`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(USERS.admin.email, { exact: true }).first()).toBeVisible()
      await expectScene(page, 'users')
      await expect(page.locator('[data-admin-scene]')).toHaveClass(/admin-workspace-scene--compact/)
      const family = await page.getByRole('heading', { level: 1 }).evaluate((heading) =>
        getComputedStyle(heading).fontFamily,
      )
      expect(family).toContain('Geist')
      expect(family).not.toContain('Luckiest Guy')
    })

    test('keeps narrow layouts usable in both system color schemes and suppresses forced-color decoration', async () => {
      await page.goto(`${API_URL}/control-panel/users`)
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
        if (colorScheme === 'dark') {
          await expect(page.locator('html')).toHaveClass(/(?:^|\s)dark(?:\s|$)/)
        } else {
          await expect(page.locator('html')).not.toHaveClass(/(?:^|\s)dark(?:\s|$)/)
        }
        await expect(page.locator('body')).toHaveCSS(
          'background-color', colorScheme === 'dark' ? 'rgb(33, 29, 26)' : 'rgb(255, 245, 230)',
        )
        for (const width of [320, 375, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await expect(page.getByRole('heading', { name: 'Users', exact: true, level: 1 })).toBeVisible()
          await expectScene(page, 'users')
          const dimensions = await page.evaluate(() => ({
            viewport: document.documentElement.clientWidth,
            content: document.documentElement.scrollWidth,
          }))
          expect(dimensions.content, `${colorScheme} at ${width}px: root must not overflow`).toBeLessThanOrEqual(dimensions.viewport + 1)
        }
      }
      await page.emulateMedia({ forcedColors: 'active' })
      await expect(page.locator('[data-admin-scene]')).toBeHidden()
      await expect(page.getByRole('heading', { name: 'Users', exact: true, level: 1 })).toBeVisible()
    })
  })
}
