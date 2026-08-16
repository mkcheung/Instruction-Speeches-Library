interface StartOrdered {
  id: string
  start_seconds: number
}

/** The one "sort annotations for display" rule, shared by every component
 * that lays them out in start-time order (OverlayStack, AnnotationList,
 * TimelineStrip, AnnotationComposerPanel's "current annotation" lookup).
 * The `id` tiebreak matters: without it, two annotations sharing the exact
 * same `start_seconds` sort in a stable-but-undefined order, which can
 * disagree between call sites that don't apply the same tiebreak. */
export function compareByStartThenId(a: StartOrdered, b: StartOrdered): number {
  if (a.start_seconds !== b.start_seconds) return a.start_seconds - b.start_seconds
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
