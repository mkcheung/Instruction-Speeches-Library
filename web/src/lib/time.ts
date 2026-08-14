/**
 * Timecode formatting shared by the transcript list and (later) the
 * authoring timeline. Two renderings of the same number on purpose —
 * MODERNIZATION_PLAN.md §8.6: marker/row labels must read "1 minute 23
 * seconds," never bare "1:23," which a screen reader pronounces as a
 * ratio ("one to twenty-three").
 */

/** `"1:23"` / `"12:04"` — visual timecode, seconds always zero-padded. */
export function formatTimecode(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** `"1 minute 23 seconds"` — the screen-reader-safe form. */
export function formatSpokenTimecode(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  const minutePart = `${minutes} minute${minutes === 1 ? '' : 's'}`
  const secondPart = `${seconds} second${seconds === 1 ? '' : 's'}`
  return minutes > 0 ? `${minutePart} ${secondPart}` : secondPart
}
