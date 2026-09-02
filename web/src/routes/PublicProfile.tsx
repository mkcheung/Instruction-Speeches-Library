import { NavLink, Outlet, useParams } from 'react-router-dom'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ConnectionsRail } from '@/components/profile/ConnectionsRail'
import { ProfileConnectionAction } from '@/components/profile/ProfileConnectionAction'
import { useGetPublicProfileQuery } from '@/features/profile/profileApi'
import { useGetConnectionsRailQuery } from '@/features/connection/connectionApi'
import type { PublicProfile as PublicProfileType } from '@/features/profile/types'
import type { Connection } from '@/features/connection/types'
import { cn } from '@/lib/utils'
import NotFound from '@/routes/NotFound'

export interface PublicProfileOutletContext {
  profile: PublicProfileType
}

const SECTION_LINK_CLASS =
  'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:border-b-2 aria-[current=page]:border-primary'

/**
 * §6.7.4's two-column Facebook-style profile: cover + identity block
 * spanning both columns, a routed section `<nav>` (real links, NOT a
 * `role="tablist"` widget — §6.7.4's/STEP-13-social-layer.md's explicit
 * instruction, since these are URLs people share and go back to), a
 * sticky-at-`lg` connections rail, and an `<Outlet>` for whichever
 * section is active (About/reviews-left/reviews-received —
 * STEP-13-FROZEN-CONTRACT.md §9's three sibling routes).
 *
 * This is the first nested-tab-route pattern in the app — same
 * `<Route>`/`<Outlet>` nesting mechanics `App.tsx` already uses for
 * `AppLayout`/`RootLayout`, applied to a profile sub-route instead of the
 * whole-app shell.
 */
export default function PublicProfile() {
  const { username } = useParams<{ username: string }>()
  const { data: profile, isLoading, isError } = useGetPublicProfileQuery(username ?? '', {
    skip: !username,
  })
  // Fetched here (not just inside `ConnectionsRail`) so the identity
  // block's connection action can look up the viewer's ACCEPTED
  // connection with THIS profile's owner, if any (the only state `GET
  // /api/connections` ever returns — see `ProfileConnectionAction.tsx`'s
  // header comment for why pending/blocked are undetectable here). See
  // `ConnectionsRail.tsx`'s header comment for why `getConnectionsRail`
  // returns the viewer's own list rather than something scoped to
  // `username`.
  const { data: railData } = useGetConnectionsRailQuery(undefined, { skip: !profile })

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (isError || !profile || !username) {
    return <NotFound />
  }

  const existingConnection: Connection | null =
    railData?.connections.find((c) => c.peer?.username === profile.username) ?? null

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="aspect-[3/1] w-full bg-gradient-to-r from-muted to-muted/40" aria-hidden="true" />

        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="-mt-16 flex items-end gap-4 sm:-mt-20">
            <Avatar
              src={profile.avatar_url}
              alt={profile.display_name || profile.username}
              size="xl"
              className="border-4 border-card"
            />
            <div className="flex flex-col gap-1 pb-1">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold">{profile.display_name || `@${profile.username}`}</h1>
                {profile.credential === 'coach' && <Badge variant="default">Coach</Badge>}
              </div>
              <p className="text-[13px] text-muted-foreground">@{profile.username}</p>
            </div>
          </div>

          <ProfileConnectionAction profileUserId={existingConnection?.peer?.id ?? profile.id} existing={existingConnection} />
        </div>

        <nav aria-label="Profile sections" className="flex border-t border-border px-2">
          <NavLink to={`/u/${username}/reviews-left`} className={SECTION_LINK_CLASS}>
            Reviews you left
          </NavLink>
          <NavLink to={`/u/${username}/reviews-received`} className={SECTION_LINK_CLASS}>
            Reviews they left you
          </NavLink>
          <NavLink to={`/u/${username}`} end className={SECTION_LINK_CLASS}>
            About
          </NavLink>
        </nav>
      </div>

      <div className={cn('grid gap-4', 'lg:grid-cols-[17rem_minmax(0,36.25rem)]')}>
        <ConnectionsRail />
        <div className="min-w-0">
          <Outlet context={{ profile } satisfies PublicProfileOutletContext} />
        </div>
      </div>
    </div>
  )
}
