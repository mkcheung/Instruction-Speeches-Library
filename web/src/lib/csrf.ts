import { API_URL } from '@/lib/api'

/**
 * Sanctum SPA-mode CSRF bootstrap (§5.9).
 *
 * `GET /sanctum/csrf-cookie` sets the `XSRF-TOKEN` cookie. Every
 * state-changing request must read that cookie and echo it back as
 * `X-XSRF-TOKEN`. This module owns:
 *   - reading the cookie,
 *   - fetching it fresh, and
 *   - making sure concurrent 419s trigger exactly one refetch
 *     ("single-flight"), not one refetch per failed request.
 */

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

export function readXsrfCookie(): string | null {
  return readCookie('XSRF-TOKEN')
}

let inFlight: Promise<void> | null = null

/**
 * Fetch the CSRF cookie. If a fetch is already underway, every caller
 * awaits that same promise instead of starting a second request — this is
 * the single-flight guarantee §5.9 requires for the 419 retry path.
 */
export function ensureCsrfCookie(): Promise<void> {
  if (!inFlight) {
    inFlight = fetch(`${API_URL}/sanctum/csrf-cookie`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(() => undefined)
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}
