import { useId } from 'react'
import { Link } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhotoOrFallback } from '@/components/profile/FriendPersonAvatar'
import { useGetFriendSampleQuery } from '@/features/connection/connectionApi'
import { connectionErrorMessage, type ConnectionViewer } from '@/features/connection/connectionSession'
import { profilePath } from '@/lib/profilePath'
import { countLabel } from '@/lib/utils'

/**
 * The left pane of "Your profile": up to nine friends in random order. Each
 * visit refetches, so the order changes from one visit to the next; a
 * friend's tile opens their `/u/:username` page.
 */
export function FriendsSampleCard({ viewer }: { viewer: ConnectionViewer }) {
  const headingId = useId()
  const query = useGetFriendSampleQuery({ viewerId: viewer.id, limit: 9 }, { refetchOnMountOrArgChange: true })
  const data = query.currentData

  return (
    <aside aria-labelledby={headingId} className="workspace-notebook-surface workspace-notebook-panel flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-lg font-bold">Friends</h2>
        <Link className="text-sm font-semibold underline underline-offset-3" to={profilePath(viewer.username, 'friends', 'all')}>
          See all friends
        </Link>
      </div>
      {query.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p>{connectionErrorMessage(query.error)}</p>
          <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Retry friends
          </Button>
        </div>
      ) : !data ? (
        <p role="status" className="text-sm text-muted-foreground">Loading friends…</p>
      ) : (
        <>
          <p className="-mt-2 text-xs text-muted-foreground">{countLabel(data.meta.total, 'friend')}</p>
          {data.friends.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No friends yet. <Link className="underline" to={profilePath(viewer.username, 'friends', 'find')}>Find people</Link>
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-x-2.5 gap-y-3.5" aria-label="Friends, in random order">
              {data.friends.map((friend) => (
                <li key={friend.connection_id} className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    to={profilePath(friend.person.username)}
                    className="group flex flex-col gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <PhotoOrFallback
                      src={friend.person.avatar_url}
                      loading="lazy"
                      className="aspect-square w-full rounded-md object-cover"
                      fallback={(
                        <span aria-hidden="true" className="flex aspect-square w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <UserRound className="size-7" />
                        </span>
                      )}
                    />
                    <span className="text-[13px] leading-tight font-semibold break-words group-hover:underline">{friend.person.name}</span>
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {countLabel(friend.mutual_friends_count, 'mutual friend')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  )
}
