import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthSession } from '@/features/auth/authSession'
import { classifyRoute, storeReturnPath } from '@/features/auth/returnPath'
import { hardNavigation } from '@/lib/hardNavigation'

/**
 * Executes the navigation half of the identity boundary (R1, plan §8.1).
 * The state half lives in `authSession` and its middleware; this component
 * only reacts to terminal outcomes, once each:
 *
 * - `lost`      the document was authenticated and a fresh `/me` confirmed the
 *               session is gone. A protected route stores its safe path and
 *               hard-replaces `/login`; a guest or public route reloads its
 *               safe path once. A document that STARTED anonymous never lands
 *               here, so an anonymous visitor's expected 401 cannot loop.
 * - `replaced`  another account owns the session. Hard-reload the current
 *               safe route into a fresh store; the new identity is never
 *               exposed to this document's old private state.
 *
 * A 401 alone is no longer a reason to navigate: it withdraws proof and
 * asks `/me`. The one soft redirect left is an anonymous visitor reaching
 * a profile's Friends tab, which has no `RequireAuth` wrapper.
 */
export function UnauthenticatedRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  const auth = useAuthSession()
  const handled = useRef<number | null>(null)

  useEffect(() => {
    const terminal = auth.status === 'lost' || auth.status === 'replaced'
    if (!terminal) return
    // One navigation per terminal generation (StrictMode double effects, re-renders).
    if (handled.current === auth.generation) return
    handled.current = auth.generation

    // A router pathname is internal already; only refuse shapes a browser would read as another origin.
    const internal = location.pathname.startsWith('/') && !location.pathname.startsWith('//') && !location.pathname.includes('\\')
    const current = internal ? `${location.pathname}${location.search}` : '/'
    if (auth.status === 'replaced') {
      hardNavigation.replace(current)
      return
    }
    if (classifyRoute(location.pathname) === 'private') {
      storeReturnPath(location.pathname)
      hardNavigation.replace('/login')
    } else {
      hardNavigation.replace(current)
    }
  }, [auth.status, auth.generation, location.pathname, location.search])

  const anonymousOnPrivateFriends = auth.status === 'anonymous'
    && classifyRoute(location.pathname) === 'private'
    && /^\/u\/[^/]+\/friends(?:\/|$)/i.test(location.pathname)
  useEffect(() => {
    if (anonymousOnPrivateFriends) navigate('/login', { state: { from: location }, replace: true })
  }, [anonymousOnPrivateFriends, navigate, location])

  return null
}
