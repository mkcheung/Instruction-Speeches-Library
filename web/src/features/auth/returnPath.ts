/**
 * Post-login return path (R1, plan §8.1). Only a validated internal pathname
 * is ever persisted, in one sessionStorage key, and it is consumed once. No
 * query string, draft content or credential enters the key.
 */
export const RETURN_PATH_KEY = 'isl.auth.returnPath'

const GUEST_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password']
const NON_SPA_PREFIXES = ['/api', '/sanctum', '/logout', '/control-panel']
const PROBE_ORIGIN = 'http://return-path.invalid'

function startsWithSegment(pathname: string, prefix: string): boolean {
  const lower = pathname.toLowerCase()
  return lower === prefix || lower.startsWith(`${prefix}/`)
}

/** Returns a safe same-origin pathname, or null. Query and hash are dropped. */
export function sanitizeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > 2048) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null
  let parsed: URL
  try {
    parsed = new URL(raw, PROBE_ORIGIN)
  } catch {
    return null
  }
  if (parsed.origin !== PROBE_ORIGIN) return null
  const { pathname } = parsed
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  // eslint-disable-next-line no-control-regex
  if (decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return null
  if (GUEST_ROUTES.some((route) => startsWithSegment(decoded, route))) return null
  if (NON_SPA_PREFIXES.some((prefix) => startsWithSegment(decoded, prefix))) return null
  return pathname
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function storeReturnPath(raw: unknown): void {
  const path = sanitizeReturnPath(raw)
  const store = storage()
  if (!path || !store) return
  try { store.setItem(RETURN_PATH_KEY, path) } catch { /* storage unavailable: fall back to the default landing */ }
}

/** Reads and removes the stored path. A tampered value is discarded. */
export function consumeReturnPath(): string | null {
  const store = storage()
  if (!store) return null
  try {
    const value = store.getItem(RETURN_PATH_KEY)
    store.removeItem(RETURN_PATH_KEY)
    return sanitizeReturnPath(value)
  } catch {
    return null
  }
}

export type RouteClass = 'guest' | 'public' | 'private'

const EXACT_PUBLIC_ROUTES = ['/', '/verify']
// React Router matches these segments case-insensitively; keep the boundary after "friends".
const PRIVATE_FRIENDS = /^\/u\/[^/]+\/friends(?:\/|$)/i

/**
 * Guest routes (login etc.), routes anonymous visitors may view whose probes
 * legitimately 401 (`/`, `/verify`, `/u/*`), and everything else (private).
 * A profile's Friends tab is private even though `/u/*` is public.
 */
export function classifyRoute(pathname: string): RouteClass {
  // React Router matches case-insensitively and tolerates a trailing slash, so `/U/alex`, `/LOGIN` and `/verify/`
  // render the same routes as their canonical spellings and must classify the same way. The guest list is the one
  // `sanitizeReturnPath` uses, so the two cannot drift.
  const lower = pathname.toLowerCase()
  const normalized = lower.length > 1 ? lower.replace(/\/+$/, '') : lower
  if (GUEST_ROUTES.some((path) => normalized === path || normalized.startsWith(`${path}/`))) return 'guest'
  if (PRIVATE_FRIENDS.test(pathname)) return 'private'
  if (normalized.startsWith('/u/') || EXACT_PUBLIC_ROUTES.includes(normalized)) return 'public'
  return 'private'
}
