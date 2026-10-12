import { useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useGetMeQuery } from '@/features/auth/authApi'
import { getPostLoginDestination } from '@/lib/roles'

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
    <PageShell width="form" className="mx-auto items-center text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Instruction Speeches Library</h1>
        <p className="text-muted-foreground">
          Upload a video of yourself giving a speech. Invite the specific people whose feedback
          you actually want. They watch, and leave notes.
        </p>
      </div>

      <Card>
        <CardContent className="py-5 text-base font-medium">
          Nobody sees your speech unless you personally invited them. No public list, no way to
          volunteer.
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Upload your speech, invite your reviewers, and as it plays back their notes fade in at the
        exact second they apply — and fade out again once the moment's passed — so feedback lines
        up with the part of the speech it's actually about.
      </p>

      <div className="flex items-center justify-center gap-3">
        <Button render={<Link to="/register" />}>Register</Button>
        <Button variant="outline" render={<Link to="/login" />}>
          Log in
        </Button>
      </div>
    </PageShell>
  )
}
