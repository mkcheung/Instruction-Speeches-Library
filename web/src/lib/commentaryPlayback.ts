import type { Annotation, CommentaryPlaybackMode } from '@/features/annotation/types'
import { isPointAnnotation } from '@/features/annotation/types'

export const COMMENTARY_PLAYBACK_MODES = [
  { value: 'all', label: 'Text + audio' },
  { value: 'written', label: 'Written notes only' },
  { value: 'voice', label: 'Audio only' },
  { value: 'off', label: 'Off' },
] as const

export function isCommentaryPlaybackMode(value: unknown): value is CommentaryPlaybackMode {
  return COMMENTARY_PLAYBACK_MODES.some((option) => option.value === value)
}

/** Keep authorized source rows intact; each presentation has its own projection. */
export function projectCommentary(annotations: readonly Annotation[], mode: CommentaryPlaybackMode) {
  const written = annotations.filter((note) => note.voice === null)
  const voices = annotations.filter((note) => note.voice !== null)
  const playAudio = mode === 'all' || mode === 'voice'
  const showWritten = mode === 'all' || mode === 'written'
  const readable = mode === 'all' ? annotations : mode === 'written' ? written : mode === 'voice' ? voices : []
  return {
    written,
    voices,
    playAudio,
    showVoiceTranscript: mode === 'all',
    timedWritten: showWritten ? written.filter((note) => !isPointAnnotation(note)) : [],
    readable,
    markers: playAudio ? voices : [],
    navigation: readable,
    hideReadableBody: mode === 'voice',
  }
}
