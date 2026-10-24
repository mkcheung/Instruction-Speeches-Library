import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverPositioner, PopoverPopup } from '@/components/ui/popover'
import { useAcceptConnectionMutation, useDeclineConnectionMutation, useGetFriendsQuery } from '@/features/connection/connectionApi'
import { connectionErrorMessage, useConnectionRefresh, useConnectionSession, useEligibleConnectionViewer } from '@/features/connection/connectionSession'
import type { ConnectionViewer } from '@/features/connection/connectionSession'
import type { Friend } from '@/features/connection/types'

/** The header and Friends page share the same authoritative viewer gate. */
export function ConnectionRequestsBell() {
  const viewer = useEligibleConnectionViewer()
  const session = useConnectionSession()
  return viewer ? <EligibleRequestsBell key={`${viewer.id}:${session.generation}`} viewer={viewer} /> : null
}

function EligibleRequestsBell({ viewer }: { viewer: ConnectionViewer }) {
  const query = useGetFriendsQuery({ viewerId: viewer.id, view: 'incoming' }, { refetchOnMountOrArgChange: true })
  const refetch = query.refetch
  useConnectionRefresh(refetch, true)
  useEffect(() => {
    // A scoped timer needs no global RTK focus-listener installation.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refetch()
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [refetch])
  const [completed, setCompleted] = useState<{ ids: number[]; snapshot?: number }>({ ids: [] })
  const [status, setStatus] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const data = query.currentData
  const count = query.isError ? undefined : data?.meta.total
  const requests = data?.friends.filter((request) => completed.snapshot !== query.fulfilledTimeStamp || !completed.ids.includes(request.connection_id)) ?? []
  function finish(request: Friend, action: 'accept' | 'decline') {
    setCompleted((previous) => ({ ids: [...(previous.snapshot === query.fulfilledTimeStamp ? previous.ids : []), request.connection_id], snapshot: query.fulfilledTimeStamp }))
    setStatus(action === 'accept' ? `You are now connected with ${request.person.name}.` : `Request from ${request.person.name} declined.`)
    heading.current?.focus()
  }
  return (
    <PopoverRoot modal={false}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="icon" />} className="relative">
        <span className="sr-only">{count ? `Connection requests (${count} pending)` : 'Connection requests'}</span>
        <PeopleIcon />
        {Boolean(count) && <Badge aria-hidden="true" variant="destructive" className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]">{count! > 9 ? '9+' : count}</Badge>}
      </PopoverTrigger>
      <PopoverPortal><PopoverPositioner align="end"><PopoverPopup aria-label="Connection requests">
        <h2 ref={heading} tabIndex={-1} className="px-2 text-sm font-semibold">Friend requests</h2>
        <p role="status" className="px-2 text-sm">{status}</p>
        {query.isFetching && <p role="status" className="px-2 py-2 text-sm">{data ? 'Refreshing requests…' : 'Loading requests…'}</p>}
        {query.isError ? <div role="alert" className="px-2 py-2 text-sm"><p>{connectionErrorMessage(query.error)}</p><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry requests</Button></div>
          : data && <>
            {requests.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">No pending requests.</p>}
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" aria-label="Incoming requests">
              {requests.map((request) => <RequestRow key={request.connection_id} request={request} refreshing={query.isFetching} onComplete={finish} />)}
            </ul>
          </>}
        <Link className="mt-2 block rounded px-2 py-2 text-sm underline focus-visible:ring-3" to={`/u/${encodeURIComponent(viewer.username)}/friends/requests`}>View all requests</Link>
      </PopoverPopup></PopoverPositioner></PopoverPortal>
    </PopoverRoot>
  )
}

function RequestRow({ request, refreshing, onComplete }: { request: Friend; refreshing: boolean; onComplete: (request: Friend, action: 'accept' | 'decline') => void }) {
  const [accept, accepting] = useAcceptConnectionMutation()
  const [decline, declining] = useDeclineConnectionMutation()
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const complete = useRef(onComplete)
  useEffect(() => { complete.current = onComplete }, [onComplete])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const busy = accepting.isLoading || declining.isLoading
  async function act(action: 'accept' | 'decline') {
    if (busy || refreshing) return
    setError('')
    try {
      await (action === 'accept' ? accept(request.connection_id) : decline(request.connection_id)).unwrap()
      if (mounted.current) complete.current(request, action)
    } catch (failure) {
      if (mounted.current) setError(connectionErrorMessage(failure))
    }
  }
  return <li className="flex flex-col gap-2 border-b px-2 py-2 text-sm" aria-busy={busy}>
    <span className="min-w-0 break-words font-medium">{request.person.name}</span>
    <span className="text-xs text-muted-foreground">{request.mutual_friends_count} mutual {request.mutual_friends_count === 1 ? 'friend' : 'friends'}</span>
    {request.note && <p className="break-words">{request.note}</p>}
    <span className="flex flex-wrap gap-1">
      <Button type="button" size="sm" disabled={busy || refreshing} onClick={() => void act('accept')}>{accepting.isLoading ? 'Accepting…' : 'Accept'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || refreshing} onClick={() => void act('decline')}>{declining.isLoading ? 'Declining…' : 'Decline'}</Button>
    </span>
    {error && <p role="alert">{error}</p>}
  </li>
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
