import { Link } from 'react-router-dom'
import { skipToken } from '@reduxjs/toolkit/query'
import { FriendPersonAvatar } from '@/components/profile/FriendPersonAvatar'
import { useGetFriendsQuery } from '@/features/connection/connectionApi'
import { connectionErrorMessage, useConnectionRefresh, useEligibleConnectionViewer } from '@/features/connection/connectionSession'
import '@/components/profile/friends.css'

/** A compact preview of the current viewer's accepted friends; totals come from the server. */
export function ConnectionsRail() {
  const viewer = useEligibleConnectionViewer()
  const query = useGetFriendsQuery(viewer ? { viewerId: viewer.id, view: 'accepted' } : skipToken, { refetchOnMountOrArgChange: true })
  useConnectionRefresh(query.refetch, Boolean(viewer))
  if (!viewer) return null
  const data = query.currentData
  return (
    <aside aria-label="Your connections" className="flex flex-col gap-3 overflow-x-auto rounded-lg border border-border bg-card p-3 lg:sticky lg:top-20 lg:w-[17rem]">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Your connections</h2>
        <Link className="text-xs underline focus-visible:ring-3" to={`/u/${encodeURIComponent(viewer.username)}/friends/all`}>See all</Link>
      </div>
      {query.isFetching && <p role="status" className="text-xs text-muted-foreground">{data ? 'Refreshing…' : 'Loading…'}</p>}
      {query.isError ? <div role="alert"><p>{connectionErrorMessage(query.error)}</p><button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>Retry connections</button></div> : data && <>
        <p className="text-xs text-muted-foreground">{data.meta.total} {data.meta.total === 1 ? 'connection' : 'connections'}</p>
        {data.friends.length === 0 && <p className="text-xs text-muted-foreground">No connections yet.</p>}
        <ul className="grid grid-cols-3 gap-2">
          {data.friends.map((friend) => <li key={friend.connection_id} className="min-w-0 text-center">
            <Link to={`/u/${encodeURIComponent(friend.person.username)}`} className="flex flex-col items-center gap-1 rounded-md focus-visible:ring-3">
              <FriendPersonAvatar src={friend.person.avatar_url} />
              <span className="w-full break-words text-[13px] font-semibold">{friend.person.name}</span>
            </Link>
            <span className="text-xs text-muted-foreground">{friend.mutual_friends_count} mutual {friend.mutual_friends_count === 1 ? 'friend' : 'friends'}</span>
          </li>)}
        </ul>
      </>}
    </aside>
  )
}
