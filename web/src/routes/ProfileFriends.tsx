import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useDispatch } from 'react-redux'
import { Navigate, NavLink, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { skipToken } from '@reduxjs/toolkit/query'
import { FriendPersonCard } from '@/components/profile/FriendPersonCard'
import { useFindFriendsQuery, useGetFriendsQuery } from '@/features/connection/connectionApi'
import { connectionErrorMessage, revalidateConnectionSession, useConnectionRefresh, useConnectionSession, useEligibleConnectionViewer } from '@/features/connection/connectionSession'
import type { PublicProfileOutletContext } from './PublicProfile'
import '@/components/workspace/notebook.css'
import '@/components/profile/friends.css'

type View = 'all' | 'requests' | 'find'
const titles: Record<View, string> = { all: 'Your friends', requests: 'Friend requests', find: 'Find friends' }

/** PublicProfile owns session/profile loading; this guard also protects direct private children. */
export default function ProfileFriends() {
  const { profile } = useOutletContext<PublicProfileOutletContext>()
  const { username, view } = useParams()
  const location = useLocation()
  const session = useConnectionSession()
  const viewer = useEligibleConnectionViewer()
  const dispatch = useDispatch()
  if (session.status === 'anonymous') return <Navigate to="/login" state={{ from: location }} replace />
  if (session.status === 'error') return <div role="alert"><p>{connectionErrorMessage(session.error)}</p><button type="button" onClick={() => dispatch(revalidateConnectionSession())}>Retry session</button></div>
  if (session.status !== 'ready') return <p role="status">Checking your session…</p>
  if (!viewer || !username || profile.username !== username || viewer.username !== profile.username || String(profile.id) !== viewer.id) return <p role="alert">Friends are unavailable for this profile.</p>
  if (!view) return <Navigate to="all" replace />
  if (view !== 'all' && view !== 'requests' && view !== 'find') return <p role="alert">This Friends page could not be found.</p>
  return <FriendsView key={`${viewer.id}:${session.generation}:${view}`} viewerId={viewer.id} username={viewer.username} view={view} />
}

function FriendsView({ viewerId, username, view }: { viewerId: string; username: string; view: View }) {
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [status, setStatus] = useState('')
  const [dismissed, setDismissed] = useState<{ ids: number[]; snapshot?: number }>({ ids: [] })
  const heading = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(false)
  const currentRefresh = useRef<() => void>(() => {})
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const cursor = cursors.at(-1) ?? null
  const friends = useGetFriendsQuery(view === 'find' ? skipToken : { viewerId, view: view === 'requests' ? 'incoming' : 'accepted', search, cursor }, { refetchOnMountOrArgChange: true })
  const found = useFindFriendsQuery(view !== 'find' || !search ? skipToken : { viewerId, search, cursor }, { refetchOnMountOrArgChange: true })
  const query = view === 'find' ? found : friends
  const active = view !== 'find' || Boolean(search)
  const refreshing = query.isFetching
  const data = query.currentData
  // Invalidated cursor pages restart at page one; never mix relationship snapshots.
  const previousRequest = useRef(query.requestId)
  const navigating = useRef({ active: false, sawFetch: false })
  useEffect(() => {
    if (!navigating.current.active && cursor && query.isFetching && query.requestId !== previousRequest.current && query.currentData) setCursors([null])
    previousRequest.current = query.requestId
    if (navigating.current.active && query.isFetching) navigating.current.sawFetch = true
    if (navigating.current.sawFetch && !query.isFetching) navigating.current = { active: false, sawFetch: false }
  }, [cursor, query.isFetching, query.requestId, query.currentData])
  function applySearch(value: string) {
    setSearch(value.trim())
    setCursors([null])
    setDismissed({ ids: [] })
    setStatus('')
  }
  useEffect(() => {
    if (view !== 'all') return
    const timeout = window.setTimeout(() => applySearch(draft), 300)
    return () => window.clearTimeout(timeout)
  }, [draft, view])
  function refresh() {
    setCursors([null])
    if (active && !cursor) void query.refetch()
  }
  useEffect(() => { currentRefresh.current = refresh })
  useConnectionRefresh(refresh, active)
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); applySearch(draft) }
  function complete(personId: number, message: string) {
    if (!mounted.current) return
    setDismissed((previous) => ({ ids: [...(previous.snapshot === query.fulfilledTimeStamp ? previous.ids : []), personId], snapshot: query.fulfilledTimeStamp }))
    setStatus(message)
    currentRefresh.current()
    heading.current?.focus()
  }
  function unavailable(message: string) {
    if (!mounted.current) return
    setStatus(message)
    currentRefresh.current()
  }
  const entries = view === 'find' ? found.currentData?.people : friends.currentData?.friends
  const visibleEntries = entries?.filter((entry, index) => !(dismissed.snapshot === query.fulfilledTimeStamp && dismissed.ids.includes(entry.person.id)) && entries.findIndex((candidate) => candidate.person.id === entry.person.id) === index)
  const next = data?.meta.next_cursor
  return (
    <section className="workspace-notebook-page workspace-notebook-surface friends-region" aria-labelledby="friends-title">
      <header className="friends-heading"><h2 id="friends-title">Friends</h2><p>A place for the people in your rehearsal circle.</p></header>
      <nav className="friends-navigation" aria-label="Friends sections">
        {(Object.keys(titles) as View[]).map((destination) => <NavLink key={destination} to={`/u/${encodeURIComponent(username)}/friends/${destination}`}>{titles[destination]}</NavLink>)}
      </nav>
      <div className="friends-results">
        <h3 tabIndex={-1} ref={heading}>{titles[view]}</h3>
        {view !== 'requests' && <form className="friends-search" onSubmit={submit} role="search">
          <label htmlFor="friends-name-search">{view === 'find' ? 'Find people by name' : 'Search your friends by name'}</label>
          <div><input id="friends-name-search" type="search" maxLength={100} value={draft} onChange={(event) => { setDraft(event.target.value); if (!event.target.value.trim()) applySearch('') }} /><button type="submit">Search</button><button type="button" className="friends-secondary" onClick={() => { setDraft(''); applySearch('') }}>Clear</button></div>
        </form>}
        <p role="status" className="friends-announcement">{status}</p>
        {!active ? <p>Enter a name to find people.</p> : <>
          {refreshing && <p role="status">{data ? 'Refreshing…' : 'Loading…'}</p>}
          {query.isError ? <div role="alert" className="friends-error"><p>{connectionErrorMessage(query.error)}</p><button type="button" onClick={refresh} disabled={refreshing}>Retry</button></div> : data && <>
            {view !== 'find' && <p aria-live="polite">{friends.currentData!.meta.total} {view === 'requests' ? 'incoming requests' : search ? 'matching friends' : 'friends'}</p>}
            {visibleEntries?.length === 0 && <p>{view === 'find' ? 'No people match this name.' : view === 'requests' ? 'No incoming requests.' : search ? 'No friends match this name.' : 'No friends yet.'}</p>}
            <ul className="friends-list" aria-label={titles[view]}>{view === 'find'
              ? found.currentData?.people.filter((entry) => visibleEntries?.includes(entry)).map((entry) => <FriendPersonCard key={entry.person.id} mode="find" person={entry} disabled={refreshing} onComplete={complete} onUnavailable={unavailable} />)
              : friends.currentData?.friends.filter((entry) => visibleEntries?.includes(entry)).map((entry) => <FriendPersonCard key={entry.connection_id} mode={view === 'all' ? 'accepted' : 'incoming'} person={entry} disabled={refreshing} onComplete={complete} onUnavailable={unavailable} />)}</ul>
            <div className="friends-pagination" aria-label="Results pages"><button type="button" className="friends-secondary" disabled={refreshing || cursors.length === 1} onClick={() => { navigating.current = { active: true, sawFetch: false }; setCursors((pages) => pages.slice(0, -1)); heading.current?.focus() }}>Previous</button><span>Page {cursors.length}</span><button type="button" disabled={refreshing || !next} onClick={() => { navigating.current = { active: true, sawFetch: false }; if (next) setCursors((pages) => [...pages, next]); heading.current?.focus() }}>Next</button></div>
          </>}
        </>}
      </div>
    </section>
  )
}
