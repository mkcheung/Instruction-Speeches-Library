import { createHmac } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { API_URL, APP_URL, FIXTURE_PASSWORD } from './fixtures.js'

/**
 * Real shared-form credentials plus the dedicated Filament MFA challenge.
 * Seeded TOTP secrets are test data, not an MFA bypass. Admin authentication
 * stays outside auth.setup.ts so panel failures do not block unrelated specs.
 */

/** Base32 (RFC 4648) alphabet google2fa's secrets are drawn from. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const TOTP_PERIOD_SECONDS = 30

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase()
  const bytes: number[] = []
  let buffer = 0
  let bitsHeld = 0

  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index === -1) {
      throw new Error(`"${secret}" is not valid base32 (offending character: "${character}")`)
    }

    buffer = (buffer << 5) | index
    bitsHeld += 5

    if (bitsHeld >= 8) {
      bitsHeld -= 8
      bytes.push((buffer >>> bitsHeld) & 0xff)
    }
  }

  return Buffer.from(bytes)
}

/**
 * The six digits an authenticator app would be showing for `secret` right
 * now. Hand-rolled on `node:crypto` rather than adding an npm dependency:
 * HMAC-SHA1 + dynamic truncation is ~20 lines, and the parameters are not
 * a guess — `PragmaRX\Google2FA` (v9.0.0, the library Filament's
 * `AppAuthentication` delegates to) hardcodes `$algorithm = SHA1`,
 * `$oneTimePasswordLength = 6`, `$keyRegeneration = 30`.
 *
 * Cross-checked against the real implementation before being relied on:
 *
 *     php artisan tinker --execute='echo (new PragmaRX\Google2FA\Google2FA)
 *         ->getCurrentOtp("E2EADMINE2EADMIN");'
 *
 * returned the same digits as `totp("E2EADMINE2EADMIN")` for both seeded
 * secrets, in the same timestep.
 */
export function totp(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS)

  const counterBytes = Buffer.alloc(8)
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  counterBytes.writeUInt32BE(counter >>> 0, 4)

  const digest = createHmac('sha1', base32Decode(secret)).update(counterBytes).digest()

  // RFC 6238 dynamic truncation: the low nibble of the last byte picks the
  // 4-byte window, whose top bit is masked off to keep it positive.
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]

  return String(binary % 1_000_000).padStart(6, '0')
}

/** Milliseconds until the next TOTP timestep begins, plus a small margin. */
export function msUntilNextTimestep(atMs: number = Date.now()): number {
  const periodMs = TOTP_PERIOD_SECONDS * 1000

  return periodMs - (atMs % periodMs) + 1_000
}

export interface PanelUser {
  readonly email: string
  readonly totpSecret: string
}

export const MFA_CHALLENGE_URL = `${API_URL}/control-panel/multi-factor-authentication/challenge`

/** Submit the same React credential form used by every application role. */
export async function submitSharedCredentials(page: Page, email: string): Promise<void> {
  await expect(page).toHaveURL(`${APP_URL}/login`)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_PASSWORD)
  await expect(page.getByLabel('Remember me', { exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
}

/**
 * Complete real MFA, allowing one next-window retry for seeded-code reuse.
 * Reaching another auth page is never success: require the exact final URL
 * and protected page heading, with challenge/enrollment content absent.
 */
export async function completePanelChallenge(
  page: Page,
  user: PanelUser,
  target = `${API_URL}/control-panel`,
  heading = 'Dashboard',
): Promise<void> {
  await expect(page).toHaveURL(MFA_CHALLENGE_URL)
  await expect(page.getByRole('heading', { name: 'Verify your identity' })).toBeVisible()

  const codeInput = page.getByLabel('Enter the 6-digit code from the authenticator app')
  const confirmButton = page.getByRole('button', { name: 'Confirm sign in' })

  for (let attempt = 1; attempt <= 2; attempt++) {
    await codeInput.fill(totp(user.totpSecret))
    await confirmButton.click()

    try {
      await page.waitForURL(target, { timeout: 15_000 })
      break
    } catch (error) {
      // Only an unchanged challenge can justify waiting for a fresh code.
      // A redirect to setup, login, or the wrong content is a real failure.
      if (attempt === 2 || page.url() !== MFA_CHALLENGE_URL) {
        throw new Error(`MFA did not reach ${target} for ${user.email}; current URL: ${page.url()}`, {
          cause: error,
        })
      }
      await page.waitForTimeout(msUntilNextTimestep())
    }
  }

  await expect(page).toHaveURL(target)
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Verify your identity' })).toHaveCount(0)
  await expect(page.getByLabel('Enter the 6-digit code from the authenticator app')).toHaveCount(0)
  expect(new URL(page.url()).pathname).not.toMatch(/\/(?:login|multi-factor-authentication)(?:\/|$)/)
}

/** Old bookmarks and plain shared login both end at the protected dashboard. */
export async function signInToPanel(
  page: Page,
  user: PanelUser,
  entry: 'alias' | 'shared' = 'alias',
): Promise<void> {
  await page.goto(entry === 'alias' ? `${API_URL}/control-panel/login` : `${APP_URL}/login`)
  await submitSharedCredentials(page, user.email)
  await completePanelChallenge(page, user)
}
