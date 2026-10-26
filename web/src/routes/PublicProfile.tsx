import { Link, Navigate, NavLink, Outlet, useLocation, useMatch, useParams } from 'react-router-dom'
import { skipToken } from '@reduxjs/toolkit/query'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ConnectionsRail } from '@/components/profile/ConnectionsRail'
import { ProfileConnectionAction } from '@/components/profile/ProfileConnectionAction'
import { useGetMeQuery } from '@/features/auth/authApi'
import { useGetPublicProfileQuery } from '@/features/profile/profileApi'
import { useGetFriendRelationshipQuery } from '@/features/connection/connectionApi'
import { useConnectionRefresh, useConnectionSession, useEligibleConnectionViewer } from '@/features/connection/connectionSession'
import type { PublicProfile as PublicProfileType } from '@/features/profile/types'
import NotFound from '@/routes/NotFound'
import { profilePath } from '@/lib/profilePath'

export interface PublicProfileOutletContext {
  profile: PublicProfileType
}

const SECTION_LINK_CLASS =
  'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:border-b-2 aria-[current=page]:border-primary'

/** Public identity and sections remain public; Friends owns its private child guard. */
export default function PublicProfile() {
  const { username } = useParams<{ username: string }>()
  const location = useLocation()
  const { currentData: profile, isLoading, isFetching: isFetchingProfile, isError } = useGetPublicProfileQuery(username ?? '', {
    skip: !username,
  })
  // Public profiles sit outside AppLayout. Anonymous probes must leave the
  // public sections readable; the private Friends child handles sign-in.
  const { data: me, isFetching: isFetchingMe, error: meError } = useGetMeQuery()
  const viewer = useEligibleConnectionViewer()
  const session = useConnectionSession()
  const friendsBranch = Boolean(useMatch('/u/:username/friends/*'))
  const canonicalProfile = Boolean(profile?.id && profile.username && profile.username === username)
  const freshIdentity = Boolean(viewer && !isFetchingMe && !meError && !isFetchingProfile && canonicalProfile)
  const owner = Boolean(freshIdentity && String(profile!.id) === viewer!.id && viewer!.username === profile!.username)
  const canConnect = Boolean(!friendsBranch && freshIdentity && String(profile!.id) !== viewer!.id)
  const relationship = useGetFriendRelationshipQuery(canConnect ? { viewerId: viewer!.id, targetId: profile!.id! } : skipToken, { refetchOnMountOrArgChange: true })
  useConnectionRefresh(relationship.refetch, canConnect)

  if (isLoading || (!profile && isFetchingProfile)) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  // Normalization belongs to the API. Only a settled, successful response explicitly
  // attributed to this slug may redirect; unrelated/missing attribution fails closed.
  if (profile && username && !isError && !isFetchingProfile && profile.username !== username && profile.requested_username === username) {
    return (
      <Navigate
        replace
        to={{
          pathname: location.pathname.replace(/^\/u\/[^/]+/i, profilePath(profile.username)),
          search: location.search,
          hash: location.hash,
        }}
      />
    )
  }

  if (isError || !profile || !username || profile.username !== username) {
    return <NotFound />
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      {me && !isFetchingMe && !meError && session.status === 'ready' && (
        <Link
          to="/dashboard"
          className="self-start rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          &larr; Back to dashboard
        </Link>
      )}

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

          {canConnect && <ProfileConnectionAction
            key={`${viewer!.id}:${profile.id}:${session.generation}`}
            profileUserId={profile.id}
            relationship={relationship.currentData?.relationship}
            refreshing={relationship.isFetching}
            error={relationship.error}
            onRetry={relationship.refetch}
          />}
        </div>

        <nav aria-label="Profile sections" className="flex flex-wrap border-t border-border px-2">
          <NavLink to={profilePath(username)} end className={SECTION_LINK_CLASS}>
            About
          </NavLink>
          {owner && <NavLink to={profilePath(username, 'friends')} className={SECTION_LINK_CLASS}>Friends</NavLink>}
          <NavLink to={profilePath(username, 'reviews-left')} className={SECTION_LINK_CLASS}>
            Reviews you left
          </NavLink>
          <NavLink to={profilePath(username, 'reviews-received')} className={SECTION_LINK_CLASS}>
            Reviews they left you
          </NavLink>
        </nav>
      </div>

      <div className={friendsBranch ? 'min-w-0' : 'grid gap-4 lg:grid-cols-[17rem_minmax(0,36.25rem)]'}>
        {!friendsBranch && <ConnectionsRail />}
        <div className="min-w-0">
          {friendsBranch && isFetchingProfile ? <p role="status">Loading profile…</p> : <Outlet context={{ profile } satisfies PublicProfileOutletContext} />}
        </div>
      </div>
    </div>
  )
}
