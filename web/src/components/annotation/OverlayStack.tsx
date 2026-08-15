import { useMemo } from 'react'
import type { Annotation } from '@/features/annotation/types'
import { useDeferredRemoval } from '@/hooks/useDeferredRemoval'
import { normalize } from '@/lib/engine'
import { compareByStartThenId } from '@/lib/annotationOrder'
import { cn } from '@/lib/utils'

/** MODERNIZATION_PLAN.md §8.5: cap at three simultaneous overlays; the
 * oldest-started is dropped on overflow. */
const SIMULTANEOUS_CAP = 3
/** MODERNIZATION_PLAN.md §8.5: render window around the playhead — sixty
 * annotations with `will-change` is sixty compositor layers. */
const WINDOW_SECONDS = 12
/** Matches `.annotation-overlay`'s 600ms CSS transition in `index.css`,
 * plus a small buffer so the unmount happens after the fade completes. */
const GHOST_MS = 650

/**
 * §8.5/§5.4: every annotation node stays mounted for as long as it's in
 * the render window; `data-visible` toggles and the CSS transition in
 * `index.css` does the actual fade. React never gets a frame for an exit
 * transition on a node it has stopped rendering, which is the whole
 * reason this component (not the pure `computeActive`) owns the
 * three-simultaneous cap and the ghost-extended render window.
 */
export function OverlayStack({
  annotations,
  activeIds,
  currentTime,
  anchor = 'default',
  draftIds,
}: {
  annotations: readonly Annotation[]
  /** From `useTimedAnnotations` — the FULL active set, uncapped. */
  activeIds: ReadonlySet<string>
  currentTime: number
  /**
   * §8.6/"Deliberately stubbed": nothing in STEP-06 ever passes `'top'`
   * here — no caller wires `useCaptionsAnchor`'s result in yet, since no
   * captions track exists until STEP-09. The prop and the positioning
   * class both exist so STEP-09 only has to pass a value, not add
   * plumbing.
   */
  anchor?: 'top' | 'default'
  /**
   * STEP-07-write-commentary.md's composer extension: ids the CALLER
   * considers provisional (a dashed border, via `data-draft`). Deliberately
   * not a field on `Annotation` itself — draft-ness is presentation-only,
   * decided by whichever component is feeding this array (the composer
   * already knows which id is its own in-progress draft), never something
   * `OverlayStack` or the engine derives on its own. Optional and unused by
   * every STEP-06 caller (`TrackSelector`/`SpeechWatch`'s speaker view),
   * which never marks anything as a draft.
   */
  draftIds?: ReadonlySet<string>
}) {
  const sorted = useMemo(
    () => [...annotations].sort(compareByStartThenId),
    [annotations],
  )

  // The three-simultaneous cap, applied HERE (not in computeActive):
  // sort the currently-active cues by (start_seconds, id) and, past three,
  // drop the oldest-started from the VISIBLE set. They remain in
  // `activeIds` (computeActive's job is unaffected); they simply stop
  // being shown, which is what "fade out" means for an overflowing cue.
  const visibleIds = useMemo(() => {
    const activeSorted = sorted.filter((a) => activeIds.has(a.id))
    const capped = activeSorted.slice(Math.max(0, activeSorted.length - SIMULTANEOUS_CAP))
    return new Set(capped.map((a) => a.id))
  }, [sorted, activeIds])

  const ghostIds = useDeferredRemoval(visibleIds, GHOST_MS)

  const renderWindow = useMemo(
    () =>
      sorted.filter((a) => {
        if (visibleIds.has(a.id) || ghostIds.has(a.id)) return true
        const n = normalize(a)
        if (!n) return false
        return n.start >= currentTime - WINDOW_SECONDS && n.start <= currentTime + WINDOW_SECONDS
      }),
    [sorted, visibleIds, ghostIds, currentTime],
  )

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none flex flex-col gap-2',
        anchor === 'top' ? 'items-start' : 'items-start justify-end',
      )}
      data-testid="overlay-stack"
    >
      {renderWindow.map((a) => (
        <div
          key={a.id}
          data-testid={`overlay-${a.id}`}
          data-visible={visibleIds.has(a.id) ? 'true' : 'false'}
          data-kind={a.kind}
          data-draft={draftIds?.has(a.id) ? 'true' : undefined}
          className="annotation-overlay rounded-md border border-border px-3 py-2 text-sm"
        >
          {a.body}
        </div>
      ))}
    </div>
  )
}
