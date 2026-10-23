/**
 * TimelineStrip: labeled Text / Voice lanes on one shared time axis.
 *
 * PROP CONTRACT (for integrators, e.g. AnnotationComposerPanel)
 * - annotations: the FULL annotation set (saved + any temporary drafts). Never a page slice.
 * - videoEl / durationSeconds: native video.duration (finite, > 0) wins once known; the
 *   asset durationSeconds is only the pre-metadata fallback. Zero/unknown => everything
 *   draws at 0 with no NaN/Infinity. The playhead is driven by usePlayheadPercent (unchanged).
 * - onSeek?(seconds): called exactly once per marker activation (mouse or keyboard).
 * - onMarkerActivate?(activation): identity-aware, called right after that one seek. The
 *   parent must NOT seek again itself. Receives { id, kind, temporary, annotation, seconds }.
 * - selectedId?: explicit selection; independent of time-driven highlighting.
 * - draftIds?: ids of annotations that are unsaved temporary text drafts (dashed, labelled
 *   "Unsaved text draft"). They live in the Text lane and are never classified as saved.
 * - activeIds?: ids that are "current" at the playhead (time-driven). Only these get
 *   aria-current="true" (matching list rows); selection never does.
 * - scrub?: independent current-source navigation authority. Opts into a dedicated
 *   44px first row; never invokes marker callbacks. Omit to preserve three rows.
 * - speechId / reviewId / onLiveRetime / onRetimeError: legacy, accepted and ignored.
 *
 * Unknown/zero duration: markers are spread evenly by chronological index (bounded rows,
 * every marker still individually focusable). Identical accessible names within a lane get
 * a ", N of M with this name" suffix.
 *
 * Geometry: range widths are exact (clamped to the axis, no percentage inflation; a CSS
 * 2px min-width hairline keeps a zero/very short range visible and focusable). Voice
 * points are classified by isPointAnnotation; recording length never affects width.
 * Overlapping ranges get deterministic subtracks (start, id order); dense voice glyphs get
 * collision-aware subtracks using the measured axis width (local ResizeObserver).
 *
 * STYLING HOOKS (prefix `awt-`; layout/geometry work without any stylesheet, the classes
 * are for appearance only):
 *   awt-timeline, awt-lane, awt-lane--text, awt-lane--voice, awt-lane-label, awt-track,
 *   awt-axis (playhead overlay; carries --playhead-percent), awt-playhead, awt-stem,
 *   awt-ticks, awt-tick, awt-marker, awt-marker--text, awt-marker--voice,
 *   awt-marker--erased, awt-marker--draft, awt-marker--selected, awt-marker--current,
 *   awt-marker-glyph.
 * State is also on data attributes: data-kind (text|voice|erased-voice|draft),
 * data-selected, data-current, data-temporary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlayheadPercent } from '@/hooks/usePlayheadPercent'
import { formatSpokenTimecode, formatTimecode } from '@/lib/time'
import { isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { compareByStartThenId } from '@/lib/annotationOrder'
import { Volume2, VolumeX } from 'lucide-react'
import { TimelineScrubber, type TimelineScrubCapability } from './TimelineScrubber'
export type { TimelineScrubCapability } from './TimelineScrubber'

export type TimelineMarkerKind = 'text' | 'voice' | 'erased-voice' | 'draft'

export interface TimelineMarkerActivation {
  id: string
  kind: TimelineMarkerKind
  /** True for an unsaved temporary text draft (never a saved row). */
  temporary: boolean
  annotation: Annotation
  /** The (unclamped) stored start the single seek used. */
  seconds: number
}

const GUTTER = '3.5rem'
const TEXT_ROW_REM = 1.5
const VOICE_ROW_REM = 1.75
const GLYPH_PX = 24
const FALLBACK_AXIS_PX = 600

const finitePositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
const safe = (n: number) => (Number.isFinite(n) ? n : 0)
const clampPct = (n: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0)

export function TimelineStrip({
  annotations, videoEl, durationSeconds, onSeek, onMarkerActivate, selectedId = null, draftIds, activeIds, scrub,
}: {
  annotations: readonly Annotation[]
  scrub?: TimelineScrubCapability
  speechId?: number
  reviewId?: number
  videoEl: HTMLVideoElement | null
  durationSeconds: number
  onSeek?: (seconds: number) => void
  onMarkerActivate?: (activation: TimelineMarkerActivation) => void
  selectedId?: string | null
  draftIds?: ReadonlySet<string> | readonly string[]
  activeIds?: ReadonlySet<string> | readonly string[]
  /** Legacy call sites may pass these during a coordinated UI refresh; unused. */
  onLiveRetime?: (live: Annotation) => void
  onRetimeError?: (message: string) => void
}) {
  const setPlayheadNode = usePlayheadPercent(videoEl)
  const axisRef = useRef<HTMLElement | null>(null)
  const setAxis = useCallback((node: HTMLElement | null) => {
    axisRef.current = node
    setPlayheadNode(node)
  }, [setPlayheadNode])

  // Native duration, bound to the concrete element it was read from.
  const [native, setNative] = useState<{ el: HTMLVideoElement | null; seconds: number }>({ el: null, seconds: 0 })
  useEffect(() => {
    if (!videoEl) return
    const read = () => setNative({ el: videoEl, seconds: finitePositive(videoEl.duration) ? videoEl.duration : 0 })
    read()
    const events = ['loadedmetadata', 'durationchange', 'emptied', 'loadstart'] as const
    events.forEach((e) => videoEl.addEventListener(e, read))
    return () => events.forEach((e) => videoEl.removeEventListener(e, read))
  }, [videoEl])
  const nativeSeconds = videoEl && native.el === videoEl ? native.seconds : 0
  const duration = nativeSeconds > 0 ? nativeSeconds : finitePositive(durationSeconds) ? durationSeconds : 0
  const hasNative = nativeSeconds > 0

  // The hook does not move the playhead without a finite native duration; reset a retained node.
  useEffect(() => {
    axisRef.current?.style.setProperty('--playhead-percent', '0%')
  }, [videoEl, hasNative])

  // Measured data-axis width for voice glyph collision.
  const voiceTrackRef = useRef<HTMLDivElement | null>(null)
  const [axisPx, setAxisPx] = useState(FALLBACK_AXIS_PX)
  useEffect(() => {
    const node = voiceTrackRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const measure = () => { const w = node.getBoundingClientRect().width; if (w > 0) setAxisPx(w) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const drafts = useMemo(() => new Set(draftIds ?? []), [draftIds])
  const current = useMemo(() => new Set(activeIds ?? []), [activeIds])

  const { textItems, voiceItems, textRows, voiceRows } = useMemo(() => {
    const sorted = [...annotations].sort(compareByStartThenId)
    const textEnds: number[] = []
    const voiceLastPx: number[] = []
    const textItems: Array<{ annotation: Annotation; row: number; left: number; width: number; temporary: boolean; validEnd: boolean }> = []
    const voiceItems: Array<{ annotation: Annotation; row: number; left: number }> = []
    const total = { text: sorted.filter((a) => !isPointAnnotation(a)).length, voice: sorted.filter(isPointAnnotation).length }
    const seen = { text: 0, voice: 0 }
    for (const annotation of sorted) {
      const start = safe(annotation.start_seconds)
      const lane = isPointAnnotation(annotation) ? 'voice' : 'text'
      const slot = seen[lane]++
      const left = duration > 0 ? clampPct(start / duration * 100) : slot / Math.max(1, total[lane]) * 100
      if (isPointAnnotation(annotation)) {
        const px = left / 100 * axisPx
        let row = voiceLastPx.findIndex((last) => px - last >= GLYPH_PX)
        if (row < 0) { row = voiceLastPx.length; voiceLastPx.push(px) } else voiceLastPx[row] = px
        voiceItems.push({ annotation, row, left })
        continue
      }
      const validEnd = Number.isFinite(annotation.duration_seconds) && annotation.duration_seconds > 0
      const end = start + (validEnd ? annotation.duration_seconds : 0)
      let row = duration > 0 ? textEnds.findIndex((e) => e <= start) : 0
      if (row < 0) { row = textEnds.length; textEnds.push(end) } else textEnds[row] = Math.max(end, textEnds[row] ?? end)
      const right = duration > 0 ? clampPct(end / duration * 100) : 0
      textItems.push({ annotation, row, left, width: Math.max(0, right - left), temporary: drafts.has(annotation.id), validEnd })
    }
    return { textItems, voiceItems, textRows: Math.max(1, textEnds.length), voiceRows: Math.max(1, voiceLastPx.length) }
  }, [annotations, duration, axisPx, drafts])

  const activate = (annotation: Annotation, kind: TimelineMarkerKind) => {
    const seconds = annotation.start_seconds
    onSeek?.(seconds)
    onMarkerActivate?.({ id: annotation.id, kind, temporary: kind === 'draft', annotation, seconds })
  }
  const state = (id: string) => ({
    'data-selected': id === selectedId ? 'true' : undefined,
    'data-current': current.has(id) ? 'true' : undefined,
    'aria-current': current.has(id) ? ('true' as const) : undefined,
  })
  const stateClass = (id: string) =>
    `${id === selectedId ? ' awt-marker--selected outline outline-2 outline-offset-2 outline-foreground' : ''}${current.has(id) ? ' awt-marker--current' : ''}`
  const selectedSuffix = (id: string) => (id === selectedId ? ', selected' : '')

  const textName = ({ annotation, temporary, validEnd }: (typeof textItems)[number]) => {
    const start = formatSpokenTimecode(annotation.start_seconds)
    const range = validEnd ? `from ${start} to ${formatSpokenTimecode(annotation.start_seconds + annotation.duration_seconds)}` : `at ${start}, end time not set`
    return `${temporary ? 'Unsaved text draft' : 'Text note'} ${range}`
  }
  const voiceName = ({ annotation }: (typeof voiceItems)[number]) =>
    `Voice note at ${formatSpokenTimecode(annotation.start_seconds)}${annotation.voice === null ? ', audio unavailable' : ''}`
  const dedupe = (names: string[]) => {
    const totals = new Map<string, number>(); names.forEach((n) => totals.set(n, (totals.get(n) ?? 0) + 1))
    const seenN = new Map<string, number>()
    return names.map((n) => {
      const total = totals.get(n) ?? 1
      if (total < 2) return n
      const i = (seenN.get(n) ?? 0) + 1; seenN.set(n, i)
      return `${n}, ${i} of ${total} with this name`
    })
  }
  const textNames = dedupe(textItems.map(textName))
  const voiceNames = dedupe(voiceItems.map(voiceName))

  const textHeight = `${textRows * TEXT_ROW_REM}rem`
  const voiceHeight = `${voiceRows * VOICE_ROW_REM}rem`
  const gridRows = `${scrub ? '44px ' : ''}${textHeight} ${voiceHeight} auto`
  const rowOffset = scrub ? 1 : 0

  return <div className="awt-timeline relative grid gap-y-1 rounded-md border border-border bg-muted/30 py-1 pr-3"
    style={{ gridTemplateColumns: `${GUTTER} minmax(0, 1fr)`, gridTemplateRows: gridRows }}
    data-testid="timeline-strip" role="group" aria-label="Annotation timeline">
    <div className="awt-lane-label awt-lane-label--text col-start-1 row-start-1 flex items-center pl-2 text-xs font-medium" style={{ minWidth: 0, gridRowStart: 1 + rowOffset }}>Text</div>
    <div className="awt-lane awt-lane--text relative col-start-2 row-start-1" data-testid="timeline-lane-text" style={{ height: textHeight, gridRowStart: 1 + rowOffset }}>
      <div className="awt-track absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
      {textItems.map(({ annotation, row, left, width, temporary }, i) => {
        const kind: TimelineMarkerKind = temporary ? 'draft' : 'text'
        return <button key={annotation.id} type="button" onClick={() => activate(annotation, kind)}
          aria-label={`${textNames[i]}${selectedSuffix(annotation.id)}`}
          data-kind={kind} data-temporary={temporary ? 'true' : undefined} {...state(annotation.id)}
          className={`awt-marker awt-marker--${temporary ? 'draft' : 'text'}${stateClass(annotation.id)} absolute box-border h-5 min-w-[2px] rounded-sm border bg-primary/30 ${temporary ? 'border-dashed border-primary' : 'border-solid border-primary'}`}
          style={{ top: `${row * TEXT_ROW_REM + 0.125}rem`, left: `${left}%`, width: `${width}%` }}
          data-testid={temporary ? `draft-marker-${annotation.id}` : `range-marker-${annotation.id}`} />
      })}
    </div>

    <div className="awt-lane-label awt-lane-label--voice col-start-1 row-start-2 flex items-center pl-2 text-xs font-medium" style={{ minWidth: 0, gridRowStart: 2 + rowOffset }}>Voice</div>
    <div ref={voiceTrackRef} className="awt-lane awt-lane--voice relative col-start-2 row-start-2" data-testid="timeline-lane-voice" style={{ height: voiceHeight, gridRowStart: 2 + rowOffset }}>
      <div className="awt-track absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
      {voiceItems.map(({ annotation, row, left }, i) => {
        const erased = annotation.voice === null
        const kind: TimelineMarkerKind = erased ? 'erased-voice' : 'voice'
        const Icon = erased ? VolumeX : Volume2
        return <span key={annotation.id}>
          <span className="awt-stem pointer-events-none absolute inset-y-0 w-px bg-primary/40" aria-hidden="true" style={{ left: `${left}%` }} />
          <button type="button" onClick={() => activate(annotation, kind)}
            aria-label={`${voiceNames[i]}${selectedSuffix(annotation.id)}`}
            data-kind={kind} {...state(annotation.id)}
            className={`awt-marker awt-marker--${erased ? 'erased' : 'voice'}${stateClass(annotation.id)} absolute flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-primary bg-background text-primary ${erased ? 'border-dotted' : ''}`}
            style={{ top: `${row * VOICE_ROW_REM + 0.125}rem`, left: `${left}%` }}
            data-testid={`voice-marker-${annotation.id}`}>
            <Icon className="awt-marker-glyph size-3.5" aria-hidden="true" />
          </button>
        </span>
      })}
    </div>

    <div className="col-start-2 row-start-3 flex justify-between text-xs text-muted-foreground" data-testid="timeline-ticks" aria-hidden="true" style={{ gridRowStart: 3 + rowOffset }}>
      {duration > 0
        ? [0, duration / 2, duration].map((t, i) => <span key={i} className="awt-tick">{formatTimecode(t)}</span>)
        : <span className="awt-tick">{formatTimecode(0)}</span>}
    </div>

    {/* Playhead overlay: spans both lanes and the ticks, only over the data axis (gutter excluded). */}
    <div ref={setAxis} className="awt-axis pointer-events-none relative col-start-2 row-span-3 row-start-1" data-testid="timeline-axis"
      style={{ ['--playhead-percent' as string]: '0%', gridRow: `1 / span ${3 + rowOffset}` }}>
      {scrub && <TimelineScrubber videoEl={videoEl} capability={scrub} axisRef={axisRef} />}
      <div className="awt-playhead absolute inset-y-0 w-0.5 -translate-x-px bg-[var(--color-danger)]" data-testid="timeline-playhead"
        style={{ left: 'var(--scrub-preview-percent, var(--playhead-percent, 0%))' }} />
    </div>
  </div>
}
