import { fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query/react'
import { API_URL } from '@/lib/api'
import { ensureCsrfCookie, readXsrfCookie } from '@/lib/csrf'

/**
 * A `401` fires from anywhere a query/mutation is used. There's no react-router
 * `navigate` reachable from a base query, so unauthenticated-ness is broadcast
 * as a DOM event; a single listener mounted near the router root (see
 * `useRedirectOnUnauthenticated`) is responsible for the actual redirect.
 * This keeps the 401 path decoupled from any one component and from RTK
 * Query's cache lifecycle.
 */
export const UNAUTHENTICATED_EVENT = 'auth:unauthenticated'

function isStateChanging(args: string | FetchArgs): boolean {
  if (typeof args === 'string') return false
  const method = (args.method ?? 'GET').toUpperCase()
  return method !== 'GET' && method !== 'HEAD'
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_URL,
  credentials: 'include',
  prepareHeaders: (headers) => {
    headers.set('Accept', 'application/json')
    const token = readXsrfCookie()
    if (token) headers.set('X-XSRF-TOKEN', token)
    return headers
  },
})

/**
 * Wraps `fetchBaseQuery` with the two rules §5.9 calls out as the ones that
 * are easy to get wrong:
 *
 * 1. **419 is not 401.** A 419 means the CSRF token is stale/missing — the
 *    fix is to refetch `/sanctum/csrf-cookie` and retry the *same* request
 *    once. It must never be treated as a sign-out.
 * 2. **401 is not 419.** A 401 means genuinely unauthenticated. It is
 *    reported via a DOM event so a route guard can redirect to `/login`;
 *    it is never retried and never triggers a CSRF refresh.
 *
 * A pre-emptive cookie fetch also runs before the *first* state-changing
 * request of a session (when no XSRF-TOKEN cookie exists yet), so the
 * common case doesn't even need the 419 round-trip.
 */
export const baseQueryWithCsrfRetry: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  if (isStateChanging(args) && !readXsrfCookie()) {
    await ensureCsrfCookie()
  }

  let result = await rawBaseQuery(args, api, extraOptions)

  if (result.error?.status === 419) {
    await ensureCsrfCookie()
    result = await rawBaseQuery(args, api, extraOptions)
  }

  if (result.error?.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT))
  }

  return result
}
