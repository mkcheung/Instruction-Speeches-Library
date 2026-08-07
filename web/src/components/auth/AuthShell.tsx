import { type ReactNode } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useGetMeQuery } from '@/features/auth/authApi'

function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

function isUnauthenticated(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 401
  )
}

/** Redirects to `/login` (preserving the attempted location) unless the
 * session probe (`GET /api/user`) succeeds. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data, isLoading, isFetching, isError, error } = useGetMeQuery()

  if (isLoading || (isFetching && !data && !isError)) {
    return <FullPageSpinner />
  }

  if (isError && isUnauthenticated(error)) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!data) {
    // A non-401 failure (network error, 500) — don't strand the user on a
    // blank screen, but don't claim they're logged in either.
    return <FullPageSpinner />
  }

  return <>{children}</>
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
 */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { data, isLoading } = useGetMeQuery()
  const [searchParams] = useSearchParams()

  if (isLoading) {
    return <FullPageSpinner />
  }

  if (data) {
    const suffix = searchParams.has('verified') ? '?verified=1' : ''
    return <Navigate to={`/onboarding${suffix}`} replace />
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
