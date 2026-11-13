import type { ReactNode } from 'react'
import { Link, NavLink, useMatch } from 'react-router-dom'
import { Newspaper, UserRound, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FriendsSampleCard } from '@/components/profile/FriendsSampleCard'
import { ProfileDetailsCard } from '@/components/profile/ProfileDetailsCard'
import { ProfileFeed } from '@/components/profile/ProfileFeed'
import { NotebookPage } from '@/components/workspace/NotebookPage'
import type { PageWidth } from '@/components/layout/PageShell'
import { useWorkspaceCompanionScene } from '@/components/workspace/useWorkspaceCompanion'
import { useGetMeQuery } from '@/features/auth/authApi'
import { isAcceptedViewer, useAuthSession } from '@/features/auth/authSession'
import { useGetFriendsQuery } from '@/features/connection/connectionApi'
import type { CurrentUser } from '@/features/auth/types'
import { connectionViewerFor, useConnectionSession, useEligibleConnectionViewer, type ConnectionViewer } from '@/features/connection/connectionSession'
import { useGetPublicProfileQuery } from '@/features/profile/profileApi'
import { useListMyReviewsQuery } from '@/features/review/reviewApi'
import { getErrorStatus } from '@/lib/errorStatus'
import { waitingCount } from '@/lib/profileFeed'
import { cn } from '@/lib/utils'

/**
 * "Your profile" (`/profile`, and `/profile/feed` for the Feed view). It
 * replaces the old Edit profile form: every detail edits in place on the
 * Profile view. A friends card sits beside both views, and the Feed view
 * lists requests and new commentary.
 *
 * Admins and accounts without a username can't have friends, so they get
 * the Profile view alone. Own-profile data still comes from `/api/me` plus
 * `/api/u/{username}`; there is no `GET /api/profile`.
 */
export default function ProfileHome() {
  const scene = useWorkspaceCompanionScene()
  const { data: me } = useGetMeQuery()
  const session = useAuthSession()
  // Identity is established only when cached /me names the proven viewer of
  // this document; anything else is treated as not-yet-known, never rendered.
  const identity = me && isAcceptedViewer(session, me.user) ? me.user : null
  const username = identity?.username ?? null
  const friendsViewer = useFriendsViewer(identity)
  // The same case-insensitive, trailing-slash-tolerant match the Feed tab's NavLink uses.
  const onFeed = useMatch('/profile/feed') !== null

  const {
    data: lastProfile,
    currentData,
    isError: profileFailed,
    error: profileError,
    refetch: refetchProfile,
  } = useGetPublicProfileQuery(username ?? '', { skip: !username })
  // `currentData` so another account's profile is never shown. The one
  // exception: right after a rename, this same user's last profile stays up
  // while the new username's read is pending, instead of the page blanking.
  const profile = currentData
    ?? (!profileFailed && lastProfile && identity && String(lastProfile.id) === String(identity.id) ? lastProfile : undefined)

  const page = (children: ReactNode, width: PageWidth = 'form') => (
    <NotebookPage width={width} scene={scene} title="Your profile">{children}</NotebookPage>
  )

  if (identity && !username) {
    return page(
      <p className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status" role="status">
        Choose a username to set up your profile. <Link to="/onboarding" className="underline">Finish setting up your account</Link>.
      </p>,
    )
  }

  if (username && !profile && profileFailed) {
    return page(
      <div role="alert" className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status flex flex-col items-start gap-3">
        <p>{getErrorStatus(profileError) === 404 ? 'Your profile was not found.' : 'We could not load your profile.'}</p>
        <Button type="button" className="workspace-notebook-control workspace-notebook-control--primary" onClick={() => void refetchProfile()}>
          Retry
        </Button>
      </div>,
    )
  }

  if (!identity || !profile || !username) {
    return page(<p className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status">Loading…</p>)
  }

  if (!friendsViewer) {
    return page(<ProfileDetailsCard profile={profile} username={username} />)
  }

  return page(
    <>
      <ProfileHomeTabs viewer={friendsViewer} />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        {/* Last on a phone so the profile or feed comes first; the left pane from `lg` up. */}
        <div className="order-last lg:sticky lg:top-4 lg:order-first">
          <FriendsSampleCard viewer={friendsViewer} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {onFeed ? <ProfileFeed viewer={friendsViewer} /> : <ProfileDetailsCard profile={profile} username={username} />}
        </div>
      </div>
    </>,
    'content',
  )
}

/**
 * The friends pane's viewer, or null for admins and accounts without a
 * username. Every profile save re-checks `/api/me`, and while that same-user
 * check runs the Friends session reports "loading". Keeping this user's
 * viewer through it stops the page swapping layouts mid-save.
 */
function useFriendsViewer(identity: CurrentUser | null): ConnectionViewer | null {
  const eligible = useEligibleConnectionViewer()
  const { status } = useConnectionSession()
  if (eligible) return eligible
  return status === 'loading' && identity ? connectionViewerFor(identity) : null
}

function ProfileHomeTabs({ viewer }: { viewer: ConnectionViewer }) {
  const friendRequests = useGetFriendsQuery({ viewerId: viewer.id, view: 'incoming' })
  const reviews = useListMyReviewsQuery()
  const waiting = waitingCount(friendRequests.currentData?.meta.total ?? 0, reviews.currentData?.invited ?? [])

  return (
    <nav aria-label="Your profile home" className="workspace-notebook-surface flex justify-center gap-2 border-b border-border">
      <TabLink to="/profile" end label="Profile" icon={UserRound} />
      <TabLink to="/profile/feed" label="Feed" icon={Newspaper} waiting={waiting} />
    </nav>
  )
}

function TabLink({ to, end, label, icon: Icon, waiting = 0 }: { to: string; end?: boolean; label: string; icon: LucideIcon; waiting?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) => cn(
        'relative inline-flex h-14 w-28 items-center justify-center rounded-t-lg text-muted-foreground',
        'hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        isActive && 'text-primary after:absolute after:inset-x-2.5 after:-bottom-px after:h-[3px] after:rounded-t-sm after:bg-primary hover:text-primary',
      )}
    >
      <Icon aria-hidden="true" className="size-7" />
      <span className="sr-only">{label}{waiting > 0 ? ` (${waiting} waiting)` : ''}</span>
      {waiting > 0 && (
        <Badge aria-hidden="true" variant="destructive" className="absolute top-1.5 right-7 h-5 min-w-5 justify-center px-1 text-[11px]">
          {waiting > 9 ? '9+' : waiting}
        </Badge>
      )}
    </NavLink>
  )
}
