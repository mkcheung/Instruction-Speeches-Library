import { fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query/react'
import { API_URL } from '@/lib/api'
import { ensureCsrfCookie, readXsrfCookie } from '@/lib/csrf'

import {
  authSessionActions,
  captureProof,
  isPrivateTransportBlocked,
  isProofCurrent,
  SESSION_CHANGED,
  type AuthSessionState,
} from '@/features/auth/authSession'

/**
 * How a request relates to the document's identity (R1, plan §8.1). The
 * default is `private`: fenced to the identity that started it, and a 401
 * withdraws the document's proof until a fresh `/me` decides. Only
 * code-owned exceptions opt out, through the endpoint's `extraOptions`:
 *
 * - `probe`   `/me`: settles identity itself (see `authSessionMiddleware`).
 * - `control` login/register/logout: change the cookie; never fenced.
 * - `public`  forgot/reset password and other anonymous-safe requests.
 */
export interface SessionOptions { session?: 'probe' | 'control' | 'public' }

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
  FetchBaseQueryError,
  SessionOptions
> = async (args, api, extraOptions) => {
  const mode = extraOptions?.session
  const fenced = mode === undefined
  // Stores without the identity slice (isolated transport tests) have nothing to fence against.
  const read = () => (api.getState() as { authSession?: AuthSessionState }).authSession
  const sessionChanged = (): { error: FetchBaseQueryError } => ({
    error: { status: 'CUSTOM_ERROR', error: SESSION_CHANGED, data: undefined },
  })

  const before = fenced ? read() : undefined
  if (before && isPrivateTransportBlocked(before)) return sessionChanged()
  const proof = before ? captureProof(before) : null
  const stale = () => {
    const now = read()
    return !!proof && !!now && !isProofCurrent(now, proof)
  }

  if (isStateChanging(args) && !readXsrfCookie()) {
    await ensureCsrfCookie()
    if (stale()) return sessionChanged()
  }

  let result = await rawBaseQuery(args, api, extraOptions ?? {})

  if (result.error?.status === 419) {
    await ensureCsrfCookie()
    // A replay would carry the CURRENT cookie: never replay on behalf of an obsolete identity.
    if (stale()) return sessionChanged()
    result = await rawBaseQuery(args, api, extraOptions ?? {})
  }

  // An obsolete response is a session-change error, never old data or an unqualified 401.
  if (stale()) return sessionChanged()

  if (fenced && result.error?.status === 401 && proof) {
    api.dispatch(authSessionActions.privateUnauthorized({ generation: proof.generation }))
  }

  return result
}
