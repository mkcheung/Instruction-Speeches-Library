import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { LoaderCircle, Pause, Play } from 'lucide-react'
import { annotationDisplayBody, isPlayableVoiceNote, type Annotation } from '@/features/annotation/types'
import { comparePlaybackOrder } from '@/lib/crossedNotes'
import { formatSpokenTimecode, formatTimecode } from '@/lib/time'
import { cn } from '@/lib/utils'
import { dedupeNames } from '@/lib/dedupeNames'
import type { VoicePlayback } from '@/hooks/useVoiceInterjections'

/** How long a manual scroll suppresses auto-scroll for, per §8.4/§8.5:
 * "auto-scroll suppressed... for 4s after a manual scroll." */
const MANUAL_SCROLL_SUPPRESS_MS = 4000
/** How long the "was that scroll ours?" flag stays set after we call
 * `scrollIntoView` — long enough to outlast the resulting scroll event(s)
 * without relying on `scrollend`, which Safari doesn't fire reliably. */
const PROGRAMMATIC_SCROLL_SETTLE_MS = 500

/**
 * MODERNIZATION_PLAN.md §8.5/§8.6: "the linear transcript list is also
 * readable without the video... same data, two presentations... auto-
 * scrolls to the playing row, but only when the user isn't engaged
 * (suppressed on focus-within and for 4s after a manual scroll)."
 *
 * This is also §8.6's "authoritative accessible surface" — always
 * available, chronological, timecoded, `aria-current` on the relevant
 * row, click-to-seek — independent of whether the overlay (which is
 * `aria-hidden`) is perceivable at all.
 */
export function Transcript({
  annotations,
  activeIds,
  currentTime,
  onSeek,
  hideBody = false,
  label = 'Commentary transcript',
  voicePlayback,
}: {
  annotations: readonly Annotation[]
  activeIds: ReadonlySet<string>
  currentTime: number
  onSeek: (seconds: number) => void
  hideBody?: boolean
  label?: string
  voicePlayback?: VoicePlayback
}) {
  const sorted = useMemo(
    () => [...annotations].sort(comparePlaybackOrder),
    [annotations],
  )

  const currentId = useMemo(() => {
    if (sorted.length === 0) return null
    // Prefer an active cue — with several active (overlap), the
    // most-recently-started one is the most relevant row to highlight.
    let best: Annotation | null = null
    for (const a of sorted) {
      if (activeIds.has(a.id) && (!best || a.start_seconds > best.start_seconds)) {
        best = a
      }
    }
    if (best) return best.id
    // No active cue: highlight the nearest PRECEDING cue (the last one
    // the playhead has reached), never a future one.
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].start_seconds <= currentTime) return sorted[i].id
    }
    return null
  }, [sorted, activeIds, currentTime])

  const names = useMemo(() => {
    // Only rows with ▶ carry a name, so only they count toward the ", N of M with this name" suffix.
    const ready = sorted.filter(isPlayableVoiceNote)
    const deduped = dedupeNames(ready.map((a) => formatSpokenTimecode(a.start_seconds)))
    return new Map(ready.map((a, i) => [a.id, deduped[i]]))
  }, [sorted])

  const listRef = useRef<HTMLOListElement>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const suppressUntilRef = useRef(0)
  const programmaticScrollRef = useRef(false)
  const settleTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!currentId) return
    const container = listRef.current
    const row = rowRefs.current.get(currentId)
    if (!container || !row) return
    if (container.matches(':focus-within')) return
    if (Date.now() < suppressUntilRef.current) return

    // Deliberately NOT `row.scrollIntoView()`: that scrolls every
    // scrollable ancestor including the document, so once this list is
    // below the fold every cue change during playback would drag the whole
    // page down and the video off-screen. Scroll only our own container,
    // by the minimum delta — `block: 'nearest'` semantics, hand-rolled.
    const rowRect = row.getBoundingClientRect()
    const boxRect = container.getBoundingClientRect()
    let delta = 0
    if (rowRect.top < boxRect.top) delta = rowRect.top - boxRect.top
    else if (rowRect.bottom > boxRect.bottom) delta = rowRect.bottom - boxRect.bottom
    // Already fully in view (and, in jsdom, every rect is zero) — no scroll
    // to attribute, so don't arm the flag either.
    if (delta === 0) return

    programmaticScrollRef.current = true
    // jsdom (this project's test environment) implements neither
    // `scrollTo` on elements nor layout — optional-chained so tests don't
    // need a polyfill for behavior this component doesn't otherwise depend on.
    container.scrollTo?.({ top: container.scrollTop + delta, behavior: 'smooth' })
    // One timer at a time: overlapping settles let an earlier one clear the
    // flag mid-animation, after which our own smooth scroll is read as a
    // manual scroll and suppresses auto-scroll for 4s.
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      programmaticScrollRef.current = false
    }, PROGRAMMATIC_SCROLL_SETTLE_MS)
  }, [currentId])

  const handleScroll = () => {
    if (programmaticScrollRef.current) return
    suppressUntilRef.current = Date.now() + MANUAL_SCROLL_SUPPRESS_MS
  }

  const rowPlayback = voicePlayback?.canPlayNotes ? voicePlayback : undefined

  return (
    <ol
      ref={listRef}
      onScroll={handleScroll}
      aria-label={label}
      className="flex max-h-80 flex-col gap-1 overflow-y-auto"
    >
      {sorted.map((a) => { const isCurrent = a.id === currentId; const name = names.get(a.id); return (
        <li
          key={a.id}
          ref={(el) => {
            if (el) rowRefs.current.set(a.id, el)
            else rowRefs.current.delete(a.id)
          }}
          aria-current={isCurrent ? 'true' : undefined}
          className={cn('flex items-stretch gap-1 rounded-md', isCurrent && 'bg-muted')}
        >
          <button
            type="button"
            onClick={() => { onSeek(a.start_seconds); voicePlayback?.armNote(a) }}
            className={cn(
              'flex min-h-11 min-w-0 flex-1 items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              isCurrent && 'font-medium',
            )}
          >
            <span aria-hidden="true" className="shrink-0 tabular-nums text-muted-foreground">
              {formatTimecode(a.start_seconds)}
            </span>
            <span className="sr-only">Annotation at {formatSpokenTimecode(a.start_seconds)}</span>
            <span className="min-w-0 break-words">{hideBody ? `Voice commentary · ${a.voice?.audio_status === 'ready' ? 'Ready' : a.voice?.audio_status === 'failed' ? 'Unavailable' : 'Processing'}` : annotationDisplayBody(a)}</span>
          </button>
          {rowPlayback && name !== undefined && <RowPlayButton note={a} name={name} playback={rowPlayback} />}
        </li>
      )})}
      {sorted.length === 0 && (
        <li className="px-2 py-1 text-sm text-muted-foreground">No commentary on this track.</li>
      )}
    </ol>
  )
}

function RowPlayButton({ note, name, playback }: { note: Annotation; name: string; playback: VoicePlayback }) {
  const state = playback.current?.id === note.id ? playback.state : 'idle'
  const label = state === 'loading' ? `Loading voice commentary at ${name}`
    : state === 'playing' ? `Pause voice commentary at ${name}`
      : state === 'paused' ? `Resume voice commentary at ${name}` : `Play voice commentary at ${name}`
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Safari does not focus a clicked button; the list's :focus-within auto-scroll guard needs it.
    event.currentTarget.focus({ preventScroll: true })
    if (state === 'loading') return
    if (state === 'playing') playback.pauseCommentary()
    else if (state === 'paused') void playback.resumeCommentary()
    else playback.playNote(note)
  }
  const Icon = state === 'loading' ? LoaderCircle : state === 'playing' ? Pause : Play
  return (
    <button type="button" aria-label={label} aria-disabled={state === 'loading' ? 'true' : undefined} onClick={onClick}
      className={cn('inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring')}>
      <Icon aria-hidden="true" className={cn('size-4', state === 'loading' ? 'motion-safe:animate-spin' : 'fill-current')} />
    </button>
  )
}
