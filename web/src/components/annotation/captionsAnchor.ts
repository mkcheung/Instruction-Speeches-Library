import { useEffect, useState } from 'react'

/**
 * ⚠️ Deliberately stubbed — STEP-06-watch-commentary.md's "Deliberately
 * stubbed" section and MODERNIZATION_PLAN.md §8.6: "anchor the annotation
 * overlay to the top whenever captions are showing." Captions
 * (`kind="captions"`, the ASR pipeline) don't exist until STEP-09 — this
 * hook is coded and wired to a `TextTrack`'s `mode`, exactly as it will be
 * used once a real captions track exists, but nothing in STEP-06 ever
 * constructs or passes it one (`OverlayStack`'s `anchor` prop defaults to
 * `'default'` and nothing here calls this hook). It is inert by
 * construction, not by omission — DO NOT delete this as dead code; STEP-09
 * is expected to call it directly.
 *
 * `TextTrack` has no `modechange`/similar DOM event, so short-interval
 * polling is the documented workaround (same approach used by libraries
 * that watch caption visibility) until STEP-09 has a concrete player
 * integration to react to instead.
 */
export function useCaptionsAnchor(captionsTrack: TextTrack | null | undefined): 'top' | 'default' {
  const [anchor, setAnchor] = useState<'top' | 'default'>(
    captionsTrack?.mode === 'showing' ? 'top' : 'default',
  )

  useEffect(() => {
    const check = () => setAnchor(captionsTrack?.mode === 'showing' ? 'top' : 'default')
    check()
    if (!captionsTrack) return
    const intervalId = window.setInterval(check, 500)
    return () => window.clearInterval(intervalId)
  }, [captionsTrack])

  return anchor
}
