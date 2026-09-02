import { Avatar } from '@/components/ui/avatar'
import { useGetConnectionsRailQuery } from '@/features/connection/connectionApi'
import { connectionMetricLine } from '@/lib/connectionMetricLine'
import { cn } from '@/lib/utils'

/**
 * §6.7.4: the ~270px left rail — bold "Connections" header, count, a 3-up
 * grid of square 1:1 tiles (bold 13px name, grey 12px metric line), sticky
 * at `lg` (1024px), a horizontally snap-scrolling strip below `lg`.
 *
 * ⚠️ Scope note (unresolved by the frozen contract, confirmed against the
 * real backend once it landed): `getConnectionsRail`
 * (`ConnectionController::index`) is `GET /api/connections` with no
 * `{username}` — always the CALLER's own accepted connections, not the
 * profile-being-viewed's. This renders the viewer's own rail
 * unconditionally on every profile page, matching the real endpoint
 * literally. Whether the intended product behavior is "always show my own
 * connections here" or "show the profile owner's connections" (gated by
 * §6.7.4's own "connection lists are private" rule) is a genuine product
 * question the backend build didn't resolve either — flagged in this
 * build's summary.
 *
 * No `meta.total` on the real response (only `next_cursor`) and no rail
 * pagination UI was in scope for this build, so the displayed count is
 * the number of rows on this one page, not a true total — understates the
 * count past 20 connections. "See all" has no destination: no
 * connections-index route exists anywhere in the frozen contract's route
 * list, so it renders as inert text rather than a broken link.
 */
export function ConnectionsRail() {
  const { data, isLoading } = useGetConnectionsRailQuery()
  const connections = data?.connections ?? []

  return (
    <aside
      aria-label="Connections"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-card p-3',
        'lg:sticky lg:top-20 lg:w-[17rem]',
        'overflow-x-auto',
      )}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Connections</h2>
        <span className="text-xs text-muted-foreground">See all</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
      </p>

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

      {!isLoading && connections.length === 0 && (
        <p className="text-xs text-muted-foreground">No connections yet.</p>
      )}

      <ul className="grid grid-cols-3 gap-2">
        {connections
          .filter((connection) => !!connection.peer)
          .map((connection) => (
            <li key={connection.id} className="flex flex-col items-center gap-1 text-center">
              <Avatar
                src={connection.peer?.avatar_url}
                alt={connection.peer?.name}
                shape="square"
                className="aspect-square h-auto w-full"
              />
              <span className="w-full truncate text-[13px] font-semibold">{connection.peer?.name}</span>
              <span className="w-full truncate text-xs text-muted-foreground">
                {connectionMetricLine(connection)}
              </span>
            </li>
          ))}
      </ul>
    </aside>
  )
}
