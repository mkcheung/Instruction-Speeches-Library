import { createHmac } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { API_URL, FIXTURE_PASSWORD } from './fixtures.js'

/**
 * PLAN-ADMIN-DASHBOARD.md §9 — "you need seeded secrets plus a TOTP
 * generator, or an env-gated bypass: new seed data *and* new machinery."
 * This file is that machinery, and it is deliberately NOT a bypass.
 *
 * Nothing about the panel's auth stack is weakened or stubbed to make
 * these tests run: the browser fills the real Filament Blade login form,
 * gets the real mandatory multi-factor challenge, and answers it with a
 * real RFC 6238 code that `PragmaRX\Google2FA` verifies the same way it
 * would verify Google Authenticator's. The only thing the test harness
 * knows that a stranger does not is the seed, which `E2ESeeder` now
 * hardcodes for ids 9001/9002 (and only those two).
 *
 * ## Why this is not in `auth.setup.ts`
 *
 * Every browser project declares `dependencies: ['setup']`, so a failure
 * in that file takes the whole suite down — its own docblock says so.
 * The panel is the least-exercised surface in the repo and the one most
 * likely to break; coupling `speech-create.spec.ts` to it would trade a
 * red admin spec for a red everything. The admin spec signs in for
 * itself instead, once per `test.describe.serial` block.
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
function msUntilNextTimestep(atMs: number = Date.now()): number {
  const periodMs = TOTP_PERIOD_SECONDS * 1000

  return periodMs - (atMs % periodMs) + 1_000
}

export interface PanelUser {
  readonly email: string
  readonly totpSecret: string
}

/**
 * Signs `user` into the Filament panel at `${API_URL}/control-panel` and
 * resolves once a panel page — not the login page, not the enrollment
 * page — is on screen.
 *
 * Two attempts, because one specific failure is expected rather than
 * exceptional. `AppAuthentication::verifyCode(…, shouldPreventCodeReuse:
 * true)` caches the accepted timestep under
 * `filament.app_authentication_codes.<md5 of secret>` and then demands
 * that every later code be strictly newer, so a second login for the SAME
 * account inside the same 30-second window is refused by design — which
 * is exactly what happens when two Playwright projects (chromium and
 * mobile-webkit, say) run this file at once. Waiting out the timestep and
 * presenting a fresh code is the correct response to that, and it is also
 * the only thing this retry can rescue: a wrong secret, a suspended
 * account or a 403 all fail identically on both attempts and surface as a
 * real failure.
 */
export async function signInToPanel(page: Page, user: PanelUser): Promise<void> {
  await page.goto(`${API_URL}/control-panel/login`)

  // EXACT STRINGS, not anchored regexes, and the distinction is not
  // stylistic — an earlier draft used `/^Email address/` and timed out on
  // every run, which read as "the panel never loaded" and cost a full
  // debugging pass to tell apart from a broken login.
  //
  // Filament renders the label as `Email address<sup>*</sup>` with the
  // markup on its own lines, so the raw text node carries surrounding
  // whitespace. Playwright normalizes whitespace when matching by STRING
  // but NOT when matching by regular expression, so `/^Email address/`
  // anchors against a leading newline and matches nothing. Measured on
  // the real login page: the regex yields 0 elements, `'Email address*'`
  // with `exact: true` yields 1.
  //
  // `exact: true` is still required on the password field for the reason
  // the earlier draft anchored in the first place: `getByLabel` is
  // case-insensitive and substring-based, so a bare `'Password'` matches
  // THREE elements here — the field, the reveal toggle's "Show password"
  // aria-label, and the toggle's "Hide password" counterpart.
  await page.getByLabel('Email address*', { exact: true }).fill(user.email)
  await page.getByLabel('Password*', { exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // `isRequired: true` is not what produces this screen — an enabled
  // provider is. `Login::authenticate()` presents the challenge because
  // `AppAuthentication::isEnabled()` returns true for a user with a
  // filled `two_factor_secret`, which is precisely what E2ESeeder now
  // gives ids 9001/9002. Without that column this heading never appears
  // and the panel redirects to mandatory enrollment instead.
  const challengeHeading = page.getByRole('heading', { name: 'Verify your identity' })
  await expect(challengeHeading).toBeVisible()

  const codeInput = page.getByLabel('Enter the 6-digit code from the authenticator app')
  const confirmButton = page.getByRole('button', { name: 'Confirm sign in' })

  for (let attempt = 1; attempt <= 2; attempt++) {
    // One `fill()` is enough even though the component renders six
    // separate `<input>`s: `filamentOneTimeCodeInput`'s own `input`
    // handler treats a value longer than one character as a paste and
    // distributes it across the digits itself.
    await codeInput.fill(totp(user.totpSecret))
    await confirmButton.click()

    // Success is leaving the login page entirely. Filament's
    // `LoginResponse` sends `redirect()->intended(Filament::getUrl())`,
    // so the destination is the panel root unless something deeper
    // redirected — `waitForURL` on "anything but /control-panel/login"
    // keeps this helper usable for a user who lands somewhere else.
    try {
      await page.waitForURL((url) => !url.pathname.endsWith('/control-panel/login'), {
        timeout: 15_000,
      })

      return
    } catch {
      if (attempt === 2) {
        throw new Error(
          `the panel multi-factor challenge rejected two consecutive codes for ${user.email}. ` +
            'If the page shows "The code you entered is invalid", the seeded secret and ' +
            "web/tests/fixtures.ts have drifted apart (check E2ESeeder's *_TOTP_SECRET " +
            'constants). If it shows a throttling notification, the run made more than ' +
            'five login attempts from this IP.',
        )
      }

      await page.waitForTimeout(msUntilNextTimestep())
    }
  }
}
