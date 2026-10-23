import { useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { formatSpokenTimecode, formatTimecode } from '@/lib/time'

/** Navigation authority is separate from marker access. Include the rendered source generation in bindingKey. */
export interface TimelineScrubCapability {
  bindingKey: string
  enabled: boolean
  active: boolean
  /** The caller must independently guard its latest committed auth/source/media binding. */
  onSeek: (seconds: number) => void
}

type Geometry = { left: number; top: number; width: number; height: number }
type Session = {
  node: HTMLDivElement; axis: HTMLElement | null; video: HTMLVideoElement; bindingKey: string; epoch: number; source: string
  duration: number; pointerId: number; downX: number; offset: number; grip: boolean; moved: boolean
  geometry: Geometry; candidate: number
}
const validDuration = (video: HTMLVideoElement | null): video is HTMLVideoElement =>
  !!video && !video.error && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0
const clamp = (value: number, duration: number) => Math.min(duration, Math.max(0, Number.isFinite(value) ? value : 0))
const sourceOf = (video: HTMLVideoElement) => `${video.currentSrc}|${video.getAttribute('src') ?? ''}`
const sameGeometry = (a: Geometry, b: Geometry) =>
  (['left', 'top', 'width', 'height'] as const).every((key) => Math.abs(a[key] - b[key]) < 0.5)

function rendered(node: HTMLElement | null): node is HTMLDivElement {
  if (!node?.isConnected || document.visibilityState === 'hidden') return false
  const rect = node.getBoundingClientRect()
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return false
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.hasAttribute('inert') || ancestor.inert) return false
    const style = getComputedStyle(ancestor)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') return false
  }
  return true
}

/** A release-only navigation control. Playback ticks update DOM, never React state or another rAF. */
export function TimelineScrubber({ videoEl, capability, axisRef }: {
  videoEl: HTMLVideoElement | null
  capability: TimelineScrubCapability
  axisRef: RefObject<HTMLElement | null>
}) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const helpId = useId()
  const latest = useRef({ videoEl, capability })
  const media = useRef({ video: null as HTMLVideoElement | null, epoch: 0, metadata: false })
  const session = useRef<Session | null>(null)
  const [dragging, setDragging] = useState(false)

  const available = () => {
    const { videoEl: video, capability: cap } = latest.current
    return cap.enabled && cap.active && media.current.video === video && media.current.metadata && validDuration(video)
  }
  const sync = () => {
    const node = nodeRef.current
    if (!node) return
    const video = latest.current.videoEl
    const duration = validDuration(video) ? video.duration : 0
    const value = clamp(session.current?.candidate ?? video?.currentTime ?? 0, duration)
    const enabled = available() && rendered(node)
    node.setAttribute('aria-disabled', String(!enabled))
    node.tabIndex = enabled ? 0 : -1
    node.setAttribute('aria-valuemax', String(duration))
    node.setAttribute('aria-valuenow', String(value))
    node.setAttribute('aria-valuetext', `${formatSpokenTimecode(value)} of ${formatSpokenTimecode(duration)}`)
    if (timeRef.current) timeRef.current.textContent = `${formatTimecode(value)} / ${formatTimecode(duration)}${session.current ? ' · Release to seek' : ''}`
  }
  const end = (updateState = true) => {
    const old = session.current
    session.current = null // lostpointercapture is allowed to fire synchronously from release.
    const axis = old?.axis ?? axisRef.current
    axis?.style.removeProperty('--scrub-preview-percent')
    if (old) {
      try { if (old.node.hasPointerCapture(old.pointerId)) old.node.releasePointerCapture(old.pointerId) } catch { /* detached capture */ }
      if (updateState) setDragging(false)
    }
    sync()
  }
  const validSession = (gesture: Session) => {
    const { videoEl: video, capability: cap } = latest.current
    return available() && video === gesture.video && cap.bindingKey === gesture.bindingKey &&
      media.current.epoch === gesture.epoch && video.duration === gesture.duration && sourceOf(video) === gesture.source &&
      rendered(gesture.node) && sameGeometry(gesture.geometry, gesture.node.getBoundingClientRect())
  }
  const preview = (gesture: Session, clientX: number) => {
    if (Math.abs(clientX - gesture.downX) >= 3) gesture.moved = true
    gesture.candidate = clamp((clientX - gesture.geometry.left - gesture.offset) / gesture.geometry.width * gesture.duration, gesture.duration)
    gesture.axis?.style.setProperty('--scrub-preview-percent', `${gesture.candidate / gesture.duration * 100}%`)
    sync()
  }

  // Publish only committed props, and invalidate before a subsequent event can use a retired binding.
  useLayoutEffect(() => {
    latest.current = { videoEl, capability }
    if (session.current && !validSession(session.current)) end()
    sync() // Restore imperative ARIA/readout after unrelated React commits too.
  })

  useLayoutEffect(() => {
    const current = media.current
    current.video = videoEl
    current.epoch += 1
    current.metadata = validDuration(videoEl)
    const reset = () => { current.epoch += 1; current.metadata = false; end() }
    const metadata = () => { current.metadata = validDuration(videoEl); if (session.current && !validSession(session.current)) end(); sync() }
    const update = () => { if (session.current && !validSession(session.current)) end(); sync() }
    const hide = () => { if (document.visibilityState === 'hidden') end(); sync() }
    const cancel = () => end()
    const node = nodeRef.current
    const withoutPosition = (style: string | null) => (style ?? '').replace(/--(?:playhead-percent|scrub-preview-percent)\s*:[^;]*(?:;|$)/g, '').trim()
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => {
      // The existing rAF owns the axis style. Its position-only writes must never cause layout reads.
      if (records.every((record) => record.attributeName === 'style' && record.target === axisRef.current &&
        withoutPosition(record.oldValue) === withoutPosition(axisRef.current.getAttribute('style')))) return
      if (session.current && !rendered(node)) end()
      sync()
    })
    // Kept-mounted panels can become inert/hidden without a React render of this child.
    for (let ancestor = node?.parentElement; ancestor; ancestor = ancestor.parentElement) {
      observer?.observe(ancestor, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'inert', 'style', 'class'] })
    }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (node) resizeObserver?.observe(node)
    const resets = ['loadstart', 'emptied', 'error'] as const
    const updates = ['durationchange', 'timeupdate', 'seeking', 'seeked'] as const
    resets.forEach((event) => videoEl?.addEventListener(event, reset))
    updates.forEach((event) => videoEl?.addEventListener(event, update))
    videoEl?.addEventListener('loadedmetadata', metadata)
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    document.addEventListener('visibilitychange', hide)
    sync()
    return () => {
      end(false)
      current.metadata = false
      current.video = null
      observer?.disconnect()
      resizeObserver?.disconnect()
      resets.forEach((event) => videoEl?.removeEventListener(event, reset))
      updates.forEach((event) => videoEl?.removeEventListener(event, update))
      videoEl?.removeEventListener('loadedmetadata', metadata)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('resize', cancel)
      document.removeEventListener('visibilitychange', hide)
    }
    // These functions deliberately read committed refs, not render-time closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoEl])

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (session.current || event.button !== 0 || !event.isPrimary || !available() || !rendered(event.currentTarget)) return
    const video = latest.current.videoEl!
    const node = event.currentTarget
    const geometry = node.getBoundingClientRect()
    const grip = event.target instanceof Element && !!event.target.closest('.awt-scrubber-grip')
    const value = clamp(video.currentTime, video.duration)
    const gesture: Session = {
      node, axis: axisRef.current, video, bindingKey: latest.current.capability.bindingKey, epoch: media.current.epoch, source: sourceOf(video),
      duration: video.duration, pointerId: event.pointerId, downX: event.clientX, geometry, grip, moved: false,
      offset: grip ? event.clientX - (geometry.left + value / video.duration * geometry.width) : 0, candidate: value,
    }
    try { node.setPointerCapture(event.pointerId) } catch { return }
    node.focus({ preventScroll: true })
    session.current = gesture
    setDragging(true)
    preview(gesture, event.clientX)
  }

  return <div ref={nodeRef} className="awt-scrubber" role="slider" aria-label="Video position"
    aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={0} aria-valuenow={0} aria-disabled="true"
    aria-describedby={helpId} tabIndex={-1} data-dragging={dragging ? 'true' : undefined}
    style={{ position: 'relative', height: 44, width: '100%', pointerEvents: 'auto', touchAction: 'pan-y pinch-zoom' }}
    onPointerDown={down}
    onPointerMove={(event) => {
      const gesture = session.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (!validSession(gesture)) { end(); return }
      preview(gesture, event.clientX)
    }}
    onPointerUp={(event) => {
      const gesture = session.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (event.button !== 0) return
      if (!validSession(gesture)) { end(); return }
      preview(gesture, event.clientX)
      const target = gesture.candidate
      const commit = (!gesture.grip || gesture.moved) && Math.abs(target - gesture.video.currentTime) > 0.001
      end()
      if (commit && validSession(gesture)) latest.current.capability.onSeek(target)
      sync()
    }}
    onPointerCancel={(event) => { if (session.current?.pointerId === event.pointerId) end() }}
    onLostPointerCapture={(event) => { if (session.current?.pointerId === event.pointerId) end() }}
    onBlur={() => end()}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Tab') { end(); return }
      if (event.key === 'Escape' && session.current) { event.preventDefault(); end(); return }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (session.current && !validSession(session.current)) end()
      const video = latest.current.videoEl
      const node = nodeRef.current
      if (!available() || !validDuration(video) || !rendered(node)) return
      const base = session.current?.candidate ?? video.currentTime
      const target = ({ ArrowLeft: base - 1, ArrowDown: base - 1, ArrowRight: base + 1, ArrowUp: base + 1,
        PageDown: base - 10, PageUp: base + 10, Home: 0, End: video.duration } as Record<string, number>)[event.key]
      if (target !== undefined) {
        event.preventDefault()
        const bindingKey = latest.current.capability.bindingKey
        const epoch = media.current.epoch
        const duration = video.duration
        const source = sourceOf(video)
        end()
        const value = clamp(target, duration)
        if (available() && latest.current.videoEl === video && latest.current.capability.bindingKey === bindingKey &&
          media.current.epoch === epoch && video.duration === duration && sourceOf(video) === source && rendered(node) &&
          Math.abs(value - video.currentTime) > 0.001) latest.current.capability.onSeek(value)
        sync()
      } else if ([' ', 'Enter', 'c', 'C', 'j', 'J', 'l', 'L', '[', ']', ',', '.'].includes(event.key)) event.preventDefault()
    }}>
    <span className="awt-scrubber-grip" aria-hidden="true"
      style={{ position: 'absolute', left: 'clamp(8px, var(--scrub-preview-percent, var(--playhead-percent, 0%)), calc(100% - 8px))' }} />
    <span ref={timeRef} className="awt-scrubber-time" aria-hidden="true">0:00 / 0:00</span>
    <span id={helpId} className="awt-scrubber-help">Drag to preview. Release to seek.</span>
  </div>
}
