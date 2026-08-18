/**
 * A small, self-contained WebVTT parser/serializer for the caption editor
 * (STEP-09-captions.md: "the caption editor — a timecoded list, same shape
 * as the transcript list, saving back to the VTT"). `captionApi.ts`'s
 * `getCaptions`/`updateCaptions` deal in the raw VTT *text* (§4 of the
 * frozen contract — no structured-cues endpoint exists), so the editor
 * has to parse it into rows client-side and re-serialize on save.
 *
 * Deliberately minimal: no `NOTE`/`STYLE`/`REGION` block support, no
 * cue settings (`align:`/`position:`/etc. after the timestamp line) —
 * those are dropped on round-trip rather than preserved. `faster-
 * whisper`/`whisper.cpp` output plain cue-id/timestamp/text blocks with no
 * settings, which is the only shape this ever needs to actually read.
 */

export interface CaptionCue {
  /** The cue's own VTT id if it had one; otherwise a stable synthetic id
   * (`cue-{index}`) so React keys and edit targeting still work. */
  id: string
  start: number
  end: number
  text: string
}

const TIMESTAMP_RE =
  /(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/

function parseTimestamp(hours: string | undefined, minutes: string, seconds: string, millis: string): number {
  const h = hours ? Number(hours.replace(':', '')) : 0
  return h * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000
}

export function formatVttTimestamp(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = Math.floor(safe % 60)
  const millis = Math.round((safe - Math.floor(safe)) * 1000)
  return (
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
  )
}

/** Parses a WebVTT document into an ordered list of cues. Tolerant of a
 * missing/malformed `WEBVTT` header (returns `[]` rather than throwing) —
 * a not-yet-ready captions job can plausibly hand this an empty string. */
export function parseVtt(vtt: string): CaptionCue[] {
  if (!vtt.trim()) return []

  // Blocks are separated by one or more blank lines. `\r\n` and `\n` both
  // normalized first.
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const cues: CaptionCue[] = []
  let index = 0

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    if (lines.length === 0) continue
    if (lines[0].startsWith('WEBVTT') || lines[0].startsWith('NOTE') || lines[0].startsWith('STYLE')) continue

    // A cue block is either [timestamp, ...text] or [id, timestamp, ...text].
    const timestampLineIndex = lines.findIndex((l) => TIMESTAMP_RE.test(l))
    if (timestampLineIndex === -1) continue

    const match = TIMESTAMP_RE.exec(lines[timestampLineIndex])
    if (!match) continue

    const start = parseTimestamp(match[1], match[2], match[3], match[4])
    const end = parseTimestamp(match[5], match[6], match[7], match[8])
    const explicitId = timestampLineIndex > 0 ? lines[0] : null
    const text = lines.slice(timestampLineIndex + 1).join('\n')

    cues.push({ id: explicitId ?? `cue-${index}`, start, end, text })
    index += 1
  }

  return cues
}

/** Serializes cues back to a valid WebVTT document, in start-time order.
 * Writes each cue's `id` back onto its own line before the timestamp —
 * both so a round-trip through `parseVtt` is lossless, and so a synthetic
 * `cue-N` id assigned on first parse stays stable across an edit/save
 * cycle instead of being silently dropped and re-synthesized (differently,
 * if cues get reordered) on the next load. */
export function serializeVtt(cues: readonly CaptionCue[]): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  const body = sorted
    .map((cue) => `${cue.id}\n${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}`)
    .join('\n\n')
  return body ? `WEBVTT\n\n${body}\n` : 'WEBVTT\n'
}
