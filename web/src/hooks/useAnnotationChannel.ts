import { useCallback, useEffect, useRef } from 'react'
import type { Annotation } from '@/features/annotation/types'

interface AnnotationSavedMessage {
  type: 'annotation-saved'
  annotation: Annotation
}

/**
 * MODERNIZATION_PLAN.md §10.1/§10.2: "a `BroadcastChannel` so a *clean*
 * sibling tab silently adopts the new version and only a *dirty* one
 * escalates — about 30 lines, no server involvement." One channel per
 * review (`annotations:{reviewId}`), so two tabs open on the SAME review
 * hear each other's saves, and two tabs on different reviews (or
 * different speeches) never cross-talk.
 *
 * Confirmed to need no polyfill under this project's Vitest+jsdom setup —
 * jsdom forwards Node's native `BroadcastChannel` onto the jsdom `window`
 * automatically, so the two-tab handshake is unit-tested directly rather
 * than mocked.
 *
 * Returns a stable `post` function; the caller supplies `onRemoteSave` to
 * react to a sibling tab's save (the three-tier conflict logic — clean
 * adopt vs. dirty banner — lives in the caller, e.g.
 * `useAnnotationEditor`, not here; this hook is pure transport).
 */
export function useAnnotationChannel(
  reviewId: number | null,
  onRemoteSave: (annotation: Annotation) => void,
): (annotation: Annotation) => void {
  const channelRef = useRef<BroadcastChannel | null>(null)
  const handlerRef = useRef(onRemoteSave)
  // Ref WRITE happens only inside an effect (never directly in the render
  // body) — the React Compiler's lint forbids the latter.
  useEffect(() => {
    handlerRef.current = onRemoteSave
  })

  useEffect(() => {
    if (reviewId === null || typeof BroadcastChannel === 'undefined') {
      channelRef.current = null
      return
    }
    const channel = new BroadcastChannel(`annotations:${reviewId}`)
    channelRef.current = channel

    const handler = (event: MessageEvent<AnnotationSavedMessage>) => {
      if (event.data?.type === 'annotation-saved') handlerRef.current(event.data.annotation)
    }
    channel.addEventListener('message', handler)

    return () => {
      channel.removeEventListener('message', handler)
      channel.close()
      channelRef.current = null
    }
  }, [reviewId])

  return useCallback((annotation: Annotation) => {
    channelRef.current?.postMessage({ type: 'annotation-saved', annotation } satisfies AnnotationSavedMessage)
  }, [])
}
