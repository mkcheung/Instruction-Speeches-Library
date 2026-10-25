import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AppDispatch } from '@/app/store'
import { authApi } from '@/features/auth/authApi'
import { profileApi } from '@/features/profile/profileApi'
import { UNAUTHENTICATED_EVENT } from '@/lib/baseQuery'
import { playbackPreferences } from '@/lib/commentaryPlaybackPreference'
import { revalidateConnectionSession, useConnectionSession } from '@/features/connection/connectionSession'

const GUEST_PATHS = ['/login', '/register', '/forgot-password']

/**
 * Routes that render for anonymous visitors but still fire authenticated
 * queries whose 401 means "no session", not "session expired". D5
 * (PLAN-APP-HEADER.md) requires `/u/:username` to stay reachable logged
 * out, but `PublicProfile` mounts `useGetMeQuery` (and, for a signed-in
 * viewer, the Friends queries behind the identity block's connection
 * action) — and `/api/me` and `/api/friends*` are `auth:sanctum`, so every
 * anonymous visit 401s and (before this list existed) ejected the visitor
 * to `/login`. Exempting the route rather than skipping those queries
 * keeps the fix at the layer that actually owns the decision: any future
 * session probe on a public page is covered too, instead of re-opening the
 * same hole from a different call site.
 */
const PUBLIC_PATHS = ['/u/']

/**
 * Both entries here are the same shape of problem `PUBLIC_PATHS` exists
 * for, discovered the same way — a route fires `useGetMeQuery()`
 * unconditionally, so every anonymous visit 401s:
 *
 * - `/` (§7.9's landing page) needs to probe the session to redirect an
 *   already-authenticated visitor onward.
 * - `/verify` (`VerifyEmail.tsx`) has a real, designed branch for exactly
 *   this case — "You're not logged in on this device... it works
 *   cross-device" — that was unreachable: the 401 fired and redirected to
 *   `/login` before React ever rendered it. code-review finding, found
 *   the same day as the `/` case by the same mechanism, after `/` was
 *   already fixed — the first fix was scoped to the one route it was
 *   written for rather than generalized, and this is the predicted cost
 *   of that (see this file's own `PUBLIC_PATHS`/`GUEST_PATHS` arrays,
 *   which have the identical "can't see the route table" limitation).
 *
 * Neither can just join `PUBLIC_PATHS` above: that array is matched with
 * `.startsWith()`, and `'/anything'.startsWith('/')` is true for every
 * route in the app — adding `/` there would disable this component's
 * redirect for the entire SPA, not exempt one route. Checked by exact
 * equality instead, below. (`/verify` would be safe as a `.startsWith()`
 * prefix too, since nothing is nested under it — kept here instead of
 * splitting it across both arrays, so there is exactly one place that
 * means "this exact path, no descendants.")
 */
const EXACT_PUBLIC_PATHS = ['/', '/verify']

/**
 * Defense-in-depth for the 401 path: `RequireAuth` catches the common case
 * (session already gone when a protected route mounts), but a session can
 * also expire mid-session — e.g. a mutation on the onboarding form 401s
 * after 30 minutes idle. `baseQueryWithCsrfRetry` broadcasts a DOM event on
 * any 401 (never on 419); this listens for it and redirects, skipping
 * routes that are already guest-accessible so it can't loop.
 *
 * Resets `authApi`/`profileApi` before navigating, not after — this is the
 * one place that can actually win the race. `window.dispatchEvent` runs
 * listeners synchronously, so this handler executes before the `401`ing
 * mutation's own `.catch()` ever gets control back (e.g. `LogoutMenuItem`'s
 * own cache-reset-then-navigate, which fires a beat too late to matter).
 * Without the reset landing here, `Me` is still cached when `navigate`
 * below runs, and `RequireGuest` reads that stale data and bounces to
 * `/onboarding` for a moment — the exact flash D4 (PLAN-APP-HEADER.md)
 * exists to prevent.
 *
 * The guest-path check runs first, before either reset: on `/login` etc.
 * `RequireGuest`'s own `useGetMeQuery` probe 401s for every anonymous
 * visitor, and resetting `authApi` in response would invalidate that same
 * still-mounted query, triggering an immediate refetch — which 401s again,
 * re-dispatching this event forever. No navigation happens on a guest path,
 * so no reset is needed there either.
 */
export function UnauthenticatedRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  const dispatch = useDispatch<AppDispatch>()
  const session = useConnectionSession()
  const verifyingFriends = useRef(false)
  // React Router matches these route segments case insensitively. A boundary
  // after "friends" keeps public names such as "friendsomething" exempt.
  const privateFriends = /^\/u\/[^/]+\/friends(?:\/|$)/i.test(location.pathname)

  useEffect(() => {
    function handleUnauthenticated() {
      if (privateFriends) {
        // The DOM event precedes middleware's request-generation checks. A late
        // account A response must never reset account B's auth cache or session.
        // Quarantine connection data, then let a current /me decide the outcome.
        if (!verifyingFriends.current) {
          verifyingFriends.current = true
          dispatch(revalidateConnectionSession())
        }
        return
      }
      playbackPreferences.setIdentity(null)
      if (GUEST_PATHS.some((path) => location.pathname.startsWith(path))) return
      if (PUBLIC_PATHS.some((path) => location.pathname.startsWith(path))) return
      if (EXACT_PUBLIC_PATHS.includes(location.pathname)) return
      dispatch(authApi.util.resetApiState())
      dispatch(profileApi.util.resetApiState())
      navigate('/login', { state: { from: location }, replace: true })
    }

    window.addEventListener(UNAUTHENTICATED_EVENT, handleUnauthenticated)
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, handleUnauthenticated)
  }, [navigate, location, dispatch, privateFriends])

  useEffect(() => {
    if (!privateFriends) {
      verifyingFriends.current = false
      return
    }
    if (!verifyingFriends.current) return
    if (session.status === 'anonymous') {
      verifyingFriends.current = false
      playbackPreferences.setIdentity(null)
      dispatch(authApi.util.resetApiState())
      dispatch(profileApi.util.resetApiState())
      navigate('/login', { state: { from: location }, replace: true })
    } else if (session.status === 'ready' || session.status === 'error') {
      // ProfileFriends renders its retryable session error with private content
      // hidden. Never infer anonymous from a network/5xx failure.
      verifyingFriends.current = false
    }
  }, [session.status, session.generation, privateFriends, navigate, location, dispatch])

  return null
}
