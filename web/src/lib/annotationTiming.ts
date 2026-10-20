/** Canonical authoring geometry. End is derived for the existing start/duration API. */
export const MAX_ANNOTATION_START_MS = 9_999_999_999
export const MIN_ANNOTATION_LENGTH_MS = 500
export const MAX_ANNOTATION_LENGTH_MS = 120_000

export type AnnotationTimingType = 'range' | 'point'
export interface TimingAnnotation {
  id: string
  start_seconds: number
  duration_seconds: number
  voice: unknown | null
  timing_type?: AnnotationTimingType | null
}
export interface AnnotationGeometry {
  type: AnnotationTimingType
  startMs: number
  endMs: number
}

/** Parse exact milliseconds, never a floating-point sum of timecode components. */
export function parseAnnotationTime(input: string): number | null {
  const value = input.trim()
  if (value.length === 0 || value.length > 48) return null
  const parts = value.split(':')
  if (parts.length > 3) return null
  const secondsPart = parts.at(-1)!
  if (!(parts.length === 1 ? /^\d+(?:\.\d{1,3})?$/ : /^[0-5]\d(?:\.\d{1,3})?$/).test(secondsPart)) return null
  if (parts.length > 1 && !/^\d+$/.test(parts[0])) return null
  if (parts.length === 3 && !/^[0-5]\d$/.test(parts[1])) return null
  const [whole, fraction = ''] = secondsPart.split('.')
  let milliseconds = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
  if (parts.length === 2) milliseconds += BigInt(parts[0]) * 60_000n
  if (parts.length === 3) milliseconds += BigInt(parts[0]) * 3_600_000n + BigInt(parts[1]) * 60_000n
  if (milliseconds > BigInt(MAX_ANNOTATION_START_MS)) return null
  return Number(milliseconds)
}

export function formatAnnotationTime(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > MAX_ANNOTATION_START_MS) return ''
  const wholeSeconds = Math.floor(milliseconds / 1000)
  const seconds = String(wholeSeconds % 60).padStart(2, '0')
  const fraction = String(milliseconds % 1000).padStart(3, '0')
  const minutes = Math.floor(wholeSeconds / 60)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}.${fraction}`
    : `${minutes}:${seconds}.${fraction}`
}

export function captureAnnotationTime(currentTime: number, durationMs: number | null, ended = false): number | null {
  if (!Number.isFinite(currentTime) || currentTime < 0 || durationMs === null || !Number.isSafeInteger(durationMs) || durationMs <= 0) return null
  const milliseconds = ended ? durationMs : Math.round(currentTime * 1000)
  return milliseconds <= durationMs && milliseconds <= MAX_ANNOTATION_START_MS ? milliseconds : null
}

/** Undefined supports pre-amendment API clients; null is explicitly unresolved history. */
export function annotationGeometry(annotation: TimingAnnotation): AnnotationGeometry | null {
  const { start_seconds: start, duration_seconds: duration } = annotation
  if (!Number.isFinite(start) || start < 0 || start * 1000 > MAX_ANNOTATION_START_MS) return null
  const type = annotation.timing_type === 'point' || (annotation.timing_type == null && annotation.voice !== null) ? 'point' : 'range'
  const startMs = Math.round(start * 1000)
  if (type === 'point') return { type, startMs, endMs: startMs }
  if (!Number.isFinite(duration) || duration <= 0) return null
  return { type, startMs, endMs: startMs + Math.round(duration * 1000) }
}

export function geometriesOverlap(left: AnnotationGeometry, right: AnnotationGeometry): boolean {
  if (left.type === 'point') return right.type === 'point'
    ? left.startMs === right.startMs
    : right.startMs <= left.startMs && left.startMs < right.endMs
  if (right.type === 'point') return left.startMs <= right.startMs && right.startMs < left.endMs
  return left.startMs < right.endMs && right.startMs < left.endMs
}

export function validateAnnotationPoint(position: string, durationMs: number | null, annotations: readonly TimingAnnotation[] | undefined) {
  const startMs = parseAnnotationTime(position)
  let message: string | null = null
  const conflicts: TimingAnnotation[] = []
  if (startMs === null) message = 'Choose a valid voice note position.'
  else if (durationMs === null || !Number.isSafeInteger(durationMs) || durationMs <= 0) message = 'Speech timing is not ready.'
  else if (startMs >= durationMs) message = 'A voice note must be before the speech ends.'
  if (annotations === undefined) message = 'Load existing feedback before recording or saving.'
  if (startMs !== null && annotations) for (const annotation of annotations) {
    const geometry = annotationGeometry(annotation)
    if (!geometry) message = 'Could not read existing annotation timing. Refresh feedback.'
    else if (geometriesOverlap({ type: 'point', startMs, endMs: startMs }, geometry)) conflicts.push(annotation)
  }
  if (conflicts.length) message = 'This position is occupied by feedback in your review. Choose a free position.'
  return { valid: message === null, startMs, message, conflicts }
}

export interface AnnotationSelectionValidation {
  valid: boolean
  errors: { start?: string; end?: string; body?: string; general?: string }
  conflicts: TimingAnnotation[]
  geometry: AnnotationGeometry | null
}

export function validateAnnotationSelection({ start, end, body, durationMs, annotations, excludeId }: {
  start: string
  end: string
  body: string
  durationMs: number | null
  annotations: readonly TimingAnnotation[] | undefined
  excludeId?: string
}): AnnotationSelectionValidation {
  const errors: AnnotationSelectionValidation['errors'] = {}
  const startMs = parseAnnotationTime(start)
  const endMs = parseAnnotationTime(end)
  if (startMs === null) errors.start = 'Choose a valid start time, such as 0:12.500.'
  if (endMs === null) errors.end = 'Choose a valid end time, such as 0:18.000.'
  if (!body.trim()) errors.body = 'Enter commentary for this segment.'
  if (durationMs === null || !Number.isSafeInteger(durationMs) || durationMs <= 0) errors.general = 'Speech timing is not ready. Try again when the video is ready.'
  if (annotations === undefined) errors.general = 'Load the existing feedback before adding an annotation.'
  let geometry: AnnotationGeometry | null = null
  if (startMs !== null && endMs !== null) {
    const length = endMs - startMs
    if (length < MIN_ANNOTATION_LENGTH_MS) errors.end = 'End must be at least half a second after Start.'
    else if (length > MAX_ANNOTATION_LENGTH_MS) errors.end = 'Choose a segment no longer than 120 seconds.'
    if (durationMs !== null && endMs > durationMs) errors.end = 'End must be within the speech.'
    if (durationMs !== null && startMs >= durationMs) errors.start = 'Start must be before the speech ends.'
    if (length > 0) geometry = { type: 'range', startMs, endMs }
  }
  const conflicts: TimingAnnotation[] = []
  if (geometry && annotations) {
    for (const annotation of annotations) {
      if (annotation.id === excludeId) continue
      const other = annotationGeometry(annotation)
      if (!other) errors.general = 'Could not read existing annotation timing. Refresh feedback before saving.'
      else if (geometriesOverlap(geometry, other)) conflicts.push(annotation)
    }
    if (conflicts.length) errors.general = 'This segment overlaps feedback in your review. Choose a free segment.'
  }
  return { valid: Object.keys(errors).length === 0, errors, conflicts, geometry }
}
