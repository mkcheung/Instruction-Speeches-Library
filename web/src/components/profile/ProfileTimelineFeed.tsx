import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TimelineCard } from '@/components/profile/TimelineCard'
import { useGetProfileTimelineQuery } from '@/features/connection/connectionApi'
import type { ProfileTimelineItem, ProfileTimelineTab } from '@/features/connection/types'

/**
 * STEP-13-FROZEN-CONTRACT.md §9: plain "Load more" button, `useState` +
 * fetch-next-page-on-click — no `react-intersection-observer`, no
 * virtualization (explicitly not to be added; zero-cost/self-hosted
 * constraint). Cursor comes from the previous page's `meta.next_cursor`.
 *
 * §6.7.3's "honest product consequence": a profile connected-but-never-
 * reviewed renders an empty timeline BY DESIGN. `firstName` names the
 * page for what it is ("Your history with Jordan") at the call site, not
 * here — this component only owns the empty-state COPY, which must never
 * read as a bare "No results."
 *
 * Callers (`ProfileReviewsLeft`/`ProfileReviewsReceived`) key this
 * component by `username` — remounting on a profile change resets the
 * accumulated pages for free, instead of a `useEffect` calling `setState`
 * synchronously in its body (flagged by this repo's `react-hooks/
 * set-state-in-effect` rule).
 */
export function ProfileTimelineFeed({
  username,
  tab,
  firstName,
}: {
  username: string
  tab: ProfileTimelineTab
  firstName: string
}) {
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<ProfileTimelineItem[]>([])
  const appliedCursor = useRef<string | null | undefined>(undefined)

  const { data, isLoading, isFetching, isError } = useGetProfileTimelineQuery({ username, tab, cursor })

  useEffect(() => {
    if (!data) return
    // Guards against StrictMode's double-invoke and re-fetch-on-cache-hit
    // appending the same page twice.
    if (appliedCursor.current === cursor) return
    appliedCursor.current = cursor
    setItems((current) => (cursor === null ? data.timeline : [...current, ...data.timeline]))
  }, [data, cursor])

  const nextCursor = data?.meta.next_cursor ?? null

  if (isLoading && items.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (isError && items.length === 0) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load this history — try again.
      </p>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm font-medium">No shared reviews yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          You and {firstName} are connected, but there's no review between you here yet.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <TimelineCard key={item.review_id} item={item} />
      ))}

      {nextCursor && (
        <Button
          type="button"
          variant="outline"
          disabled={isFetching}
          onClick={() => setCursor(nextCursor)}
          className="self-center"
        >
          {isFetching ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}
