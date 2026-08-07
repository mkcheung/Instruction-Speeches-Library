import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { UNAUTHENTICATED_EVENT } from '@/lib/baseQuery'

const GUEST_PATHS = ['/login', '/register', '/forgot-password']

/**
 * Defense-in-depth for the 401 path: `RequireAuth` catches the common case
 * (session already gone when a protected route mounts), but a session can
 * also expire mid-session — e.g. a mutation on the onboarding form 401s
 * after 30 minutes idle. `baseQueryWithCsrfRetry` broadcasts a DOM event on
 * any 401 (never on 419); this listens for it and redirects, skipping
 * routes that are already guest-accessible so it can't loop.
 */
export function UnauthenticatedRedirect() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function handleUnauthenticated() {
      if (GUEST_PATHS.some((path) => location.pathname.startsWith(path))) return
      navigate('/login', { state: { from: location }, replace: true })
    }

    window.addEventListener(UNAUTHENTICATED_EVENT, handleUnauthenticated)
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, handleUnauthenticated)
  }, [navigate, location])

  return null
}
