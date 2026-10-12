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

/**
 * code-review finding (§7.2 max review): a wall-clock ISO timestamp
 * formatter, not a video-position one like the two above — grouped here
 * anyway as this file's natural home for "time formatting shared across
 * routes/components" rather than adding a third near-duplicate home.
 * Previously copied byte-for-byte into both `Dashboard.tsx` and
 * `ReviewerRoster.tsx`.
 */
export function formatTimestamp(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleString()
}
