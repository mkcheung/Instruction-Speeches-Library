import { useEffect, useRef, useState } from 'react'

/**
 * MODERNIZATION_PLAN.md §5.4: "The same trap reappears at delete. An
 * optimistic delete removes the row and unmounts its node, killing the
 * fade. A `useDeferredRemoval` hook keeps 'ghosts' mounted for the exit
 * duration; ghosts never appear in the active set, so they fade and then
 * unmount."
 *
 * Watches `visibleIds` (in `OverlayStack`'s case: the capped, currently
 * `data-visible="true"` set) and returns every id that either IS in
 * `visibleIds` right now, OR left it within the last `ghostMs` — i.e. is
 * still mid-exit-transition. The caller ORs this into its render window
 * so a node isn't yanked out of the DOM mid-fade.
 *
 * `ghostMs` should be >= the CSS transition duration (`index.css`'s
 * `.annotation-overlay` is 600ms by default) with a small buffer so the
 * unmount genuinely happens after the animation finishes, not during it.
 */
export function useDeferredRemoval(
  visibleIds: ReadonlySet<string>,
  ghostMs = 650,
): ReadonlySet<string> {
  const [ghostSet, setGhostSet] = useState<ReadonlySet<string>>(() => new Set())
  const prevVisibleRef = useRef<ReadonlySet<string>>(new Set())
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const prevVisible = prevVisibleRef.current
    const timers = timersRef.current

    const justLeft: string[] = []
    for (const id of prevVisible) {
      if (!visibleIds.has(id)) justLeft.push(id)
    }

    // Anything that just left visibility becomes a ghost, timed to unmount
    // after the exit transition would have finished.
    for (const id of justLeft) {
      const existingTimer = timers.get(id)
      if (existingTimer) clearTimeout(existingTimer)
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          setGhostSet((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }, ghostMs),
      )
    }

    // Anything visible again (re-activated before its ghost timer fired,
    // e.g. scrubbed back into range) cancels its pending removal — it's
    // simply active again, not a ghost.
    for (const id of visibleIds) {
      const existingTimer = timers.get(id)
      if (existingTimer) {
        clearTimeout(existingTimer)
        timers.delete(id)
      }
    }

    if (justLeft.length > 0 || visibleIds.size > 0) {
      const updateGhosts = () =>
        setGhostSet((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const id of justLeft) {
            if (!next.has(id)) {
              next.add(id)
              changed = true
            }
          }
          for (const id of visibleIds) {
            if (next.has(id)) {
              next.delete(id)
              changed = true
            }
          }
          return changed ? next : prev
        })
      updateGhosts()
    }

    prevVisibleRef.current = visibleIds
  }, [visibleIds, ghostMs])

  // Clear any in-flight timers on unmount so they don't fire setState
  // after the component using this hook is gone.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  return ghostSet
}
