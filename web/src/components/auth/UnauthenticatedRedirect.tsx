import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AppDispatch } from '@/app/store'
import { authApi } from '@/features/auth/authApi'
import { profileApi } from '@/features/profile/profileApi'
import { UNAUTHENTICATED_EVENT } from '@/lib/baseQuery'

const GUEST_PATHS = ['/login', '/register', '/forgot-password']

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

  useEffect(() => {
    function handleUnauthenticated() {
      if (GUEST_PATHS.some((path) => location.pathname.startsWith(path))) return
      dispatch(authApi.util.resetApiState())
      dispatch(profileApi.util.resetApiState())
      navigate('/login', { state: { from: location }, replace: true })
    }

    window.addEventListener(UNAUTHENTICATED_EVENT, handleUnauthenticated)
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, handleUnauthenticated)
  }, [navigate, location, dispatch])

  return null
}
