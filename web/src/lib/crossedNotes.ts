export const VOICE_NOTE_SEEK_EPSILON_SECONDS = 1

export interface VoiceNoteTiming {
  id: string
  start_seconds: number
}

/**
 * Return every voice note crossed by ordinary forward playback.
 *
 * A jump larger than one second is a seek, not playback. Backward movement
 * returns nothing and, because no fired-set is retained here, naturally
 * re-arms notes for the next forward pass. `started=false` is the first tick
 * after play and deliberately includes a note stamped at exactly 0.000.
 */
export function crossedNotes<T extends VoiceNoteTiming>(
  notes: readonly T[],
  prevTime: number,
  nowTime: number,
  started: boolean,
): readonly T[] {
  if (!Number.isFinite(prevTime) || !Number.isFinite(nowTime)) return []
  if (nowTime <= prevTime) return []
  if (nowTime - prevTime > VOICE_NOTE_SEEK_EPSILON_SECONDS) return []

  const lowerBound = started ? prevTime : -Infinity
  return notes
    .filter((note) => lowerBound < note.start_seconds && note.start_seconds <= nowTime)
    .sort((a, b) => a.start_seconds - b.start_seconds || a.id.localeCompare(b.id))
}
