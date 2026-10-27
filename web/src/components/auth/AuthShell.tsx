import { type ReactNode, useEffect, useRef } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useGetMeQuery } from '@/features/auth/authApi'
import { getErrorStatus } from '@/lib/errorStatus'
import { getPostLoginDestination } from '@/lib/roles'
import { hardNavigation } from '@/lib/hardNavigation'
import { authSessionSignals, isAcceptedViewer, isTerminalStatus, useAuthSession } from '@/features/auth/authSession'
import { useDispatch } from 'react-redux'
import { Button } from '@/components/ui/button'

function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

function isUnauthenticated(error: unknown): boolean {
  return getErrorStatus(error) === 401
}

/**
 * Redirects to `/login` (preserving the attempted location) unless the
 * session probe (`GET /api/me`) succeeds AND this document has accepted that
 * user as its authoritative identity (R1).
 *
 * Private content is gated on the accepted viewer, not on RTK's cached `/me`
 * alone: while proof is withdrawn (a 401 awaiting its probe, a cross-tab
 * change, a BFCache restore, an uncertain probe) the children are hidden
 * and media is paused, but NOT unmounted, so unsaved editor state survives
 * a same-user resumption.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const auth = useAuthSession()
  const { data, isLoading, isFetching, isError, error } = useGetMeQuery()

  if (isLoading || (isFetching && !data && !isError)) {
    return <FullPageSpinner />
  }

  if (isTerminalStatus(auth.status)) {
    // A hard navigation is in flight; never render the old account's pages.
    return <FullPageSpinner />
  }

  if (isError && isUnauthenticated(error) && auth.status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!data) {
    // A non-401 failure (network error, 500) — don't strand the user on a
    // blank screen, but don't claim they're logged in either.
    return <FullPageSpinner />
  }

  return (
    <PrivateBoundary visible={isAcceptedViewer(auth, data.user)} uncertain={auth.status === 'uncertain'}>
      {children}
    </PrivateBoundary>
  )
}

/** Hides private UI without unmounting it, and stops playback while hidden. */
function PrivateBoundary({ visible, uncertain, children }: { visible: boolean; uncertain: boolean; children: ReactNode }) {
  const dispatch = useDispatch()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (visible) return
    ref.current?.querySelectorAll('video,audio').forEach((media) => {
      try { (media as HTMLMediaElement).pause() } catch { /* jsdom: not implemented */ }
    })
  }, [visible])
  return (
    <>
      {!visible && uncertain && (
        <div role="alert" className="flex min-h-svh flex-col items-center justify-center gap-3 text-sm">
          <p>Couldn't verify your session</p>
          <Button type="button" onClick={() => dispatch(authSessionSignals.revalidate())}>Retry</Button>
        </div>
      )}
      {!visible && !uncertain && <FullPageSpinner />}
      <div ref={ref} style={{ display: visible ? 'contents' : 'none' }} aria-hidden={visible ? undefined : true} inert={!visible}>
        {children}
      </div>
    </>
  )
}

/**
 * Sends an already-authenticated visitor away from guest-only routes
 * (`/login`, `/register`, `/forgot-password`).
 *
 * One wrinkle: `GET /email/verify/{id}/{hash}`'s non-JSON response
 * redirects a real browser navigation to `{frontend_url}/login?verified=1`
 * (`App\Http\Responses\Fortify\VerifyEmailResponse`) — and reaching that
 * response class at all means the request *was* authenticated. So this
 * exact route can be hit by someone who is simultaneously "already logged
 * in" (→ guest-guard would normally bounce them silently) and "just
 * clicked their verification link" (→ deserves to see that it worked).
 * Forward the query param through the redirect instead of dropping it.
 *
 * PLAN-ADMIN-LOGIN-REDIRECT.md §7.1/§7.3: an admin reaching this guard
 * (e.g. the email-verification case above, with a still-live session)
 * gets escorted to the panel like any other plain sign-in. Unlike
 * `Login.tsx`'s post-mutation callback, this component's only exit is
 * `<Navigate>`, which cannot express a cross-origin URL — so the
 * cross-origin case needs a real side effect. A bare
 * `window.location.replace()` call during render (not inside
 * `useEffect`) would double-fire under `<StrictMode>` (`main.tsx`) and
 * flash the login form in between; the effect plus a spinner avoids that.
 */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { data, isLoading } = useGetMeQuery()
  const [searchParams] = useSearchParams()
  const destination = data ? getPostLoginDestination(data.user) : null

  // Depend on the primitive `to`/`external` values, not `destination`
  // itself: `getPostLoginDestination` is called fresh on every render, so
  // the returned object is a new reference each time even when its
  // contents are unchanged — an object-identity dependency would re-fire
  // this effect (and call `window.location.replace()` again) on every
  // re-render while this component is still mounted (e.g. a background
  // refetch of `useGetMeQuery`), not just once.
  useEffect(() => {
    if (destination?.external) {
      hardNavigation.replace(destination.to)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above: primitives are the real dependency
  }, [destination?.external, destination?.to])

  if (isLoading) {
    return <FullPageSpinner />
  }

  if (destination?.external) {
    return <FullPageSpinner />
  }

  if (destination) {
    const suffix = searchParams.has('verified') ? '?verified=1' : ''
    // Post-verification lands here (`VerifyEmailResponse` redirects the
    // browser to `/login?verified=1` and the session is already live), so
    // this is the path an already-onboarded user takes after clicking a
    // verification link — send them to the dashboard, not back through a
    // wizard they finished. `?verified=1` rides along either way so the
    // "Email verified." banner still renders at the destination.
    return <Navigate to={`${destination.to}${suffix}`} replace />
  }

  return <>{children}</>
}

/** Gates a route on a verified email, per §6.5's "verified email gates
 * writes that other people see." Assumes `RequireAuth` already ran. */
export function RequireVerified({ children }: { children: ReactNode }) {
  const { data, isLoading } = useGetMeQuery()

  if (isLoading) {
    return <FullPageSpinner />
  }

  if (data && !data.user.email_verified) {
    return <Navigate to="/verify" replace />
  }

  return <>{children}</>
}
