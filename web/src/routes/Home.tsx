import { Suspense, lazy, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useGetMeQuery } from '@/features/auth/authApi'
import { getPostLoginDestination } from '@/lib/roles'

// Lazy, because `Home` is imported eagerly by `App.tsx`: this keeps the
// landing page's components and CSS out of the main bundle, so signed-in
// visitors (redirected below before this renders) never download them.
const Landing = lazy(() => import('@/components/landing/Landing').then((m) => ({ default: m.Landing })))

function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

/**
 * `/` — the SPA's unguarded root route (`App.tsx`). Nothing in the app
 * links here (it's reached only by someone typing the bare domain,
 * following a bookmark, or an external referral), so this is pure
 * first-impression traffic for a visitor who hasn't decided whether to
 * sign up yet, and the one place that gets to state the product's actual
 * differentiator before they go looking for it elsewhere.
 *
 * Authenticated-visitor handling mirrors `AuthShell.tsx`'s `RequireGuest`
 * exactly, because this page has the same two destinations `RequireGuest`
 * already handles (an in-app dashboard, or the cross-origin admin panel)
 * even though it isn't wrapped in that guard — `/` has to work whether or
 * not a session exists, not just for guests.
 *
 * Logged-out visitors get `<Landing />`, which is full-bleed (its own
 * curtains and background), so it doesn't sit inside a `PageShell`.
 */
export default function Home() {
  const { data, isLoading } = useGetMeQuery()
  const destination = data ? getPostLoginDestination(data.user) : null

  // Depend on the primitive `to`/`external` values, not `destination`
  // itself — see `RequireGuest`'s identical comment: `destination` is a
  // fresh object every render, so an object-identity dependency would
  // re-fire this effect (and re-call `window.location.replace()`) on every
  // background refetch of `useGetMeQuery` while this component is still
  // mounted, not just once.
  useEffect(() => {
    if (destination?.external) {
      window.location.replace(destination.to)
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
    return <Navigate to={destination.to} replace />
  }

  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Landing />
    </Suspense>
  )
}
