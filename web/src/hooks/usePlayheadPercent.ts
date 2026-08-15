import { useEffect, useRef } from 'react'

/**
 * MODERNIZATION_PLAN.md §8.4: "the playhead is a CSS custom property
 * driven by rAF, never React state — this is a hard performance
 * requirement, not a style preference; markers are `%`-positioned buttons
 * so resize costs zero JS." Deliberately NOT built on `useVideoCurrentTime`
 * (that hook's own comment names it "NOT what the timeline strip's
 * playhead should use" — it's `timeupdate`-driven React state, and a React
 * re-render per tick for something that only ever needs a CSS write is
 * exactly the cost this hook exists to avoid).
 *
 * Returns a ref-callback: attach it to the timeline container. Every
 * animation frame while a `videoEl` is attached, this writes
 * `--playhead-percent` directly onto that DOM node via `style.setProperty`
 * — no `setState`, so React never re-renders on account of playback
 * position. `TimelineStrip`'s CSS reads the property to position
 * `.annotation-timeline__playhead`.
 */
export function usePlayheadPercent(videoEl: HTMLVideoElement | null): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!videoEl) return

    let frameId: number | null = null
    const tick = () => {
      const node = nodeRef.current
      const duration = videoEl.duration
      if (node && Number.isFinite(duration) && duration > 0) {
        const percent = Math.min(100, Math.max(0, (videoEl.currentTime / duration) * 100))
        node.style.setProperty('--playhead-percent', `${percent}%`)
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [videoEl])

  return (node: HTMLElement | null) => {
    nodeRef.current = node
  }
}
