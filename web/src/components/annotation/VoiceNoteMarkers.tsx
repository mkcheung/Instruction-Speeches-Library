import { Volume2 } from 'lucide-react'
import type { Annotation } from '@/features/annotation/types'

/** Point markers projected over the video.js scrubber. Voice notes are
 * intentionally glyphs, never duration bars or resize affordances. */
export function VoiceNoteMarkers({
  annotations,
  durationSeconds,
}: {
  annotations: readonly Annotation[]
  durationSeconds: number
}) {
  if (durationSeconds <= 0) return null
  const notes = annotations.filter((annotation) => annotation.voice !== null)
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-8 z-20 h-4" aria-hidden="true" data-testid="voice-note-markers">
      {notes.map((note) => (
        <span
          key={note.id}
          className="absolute flex size-4 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
          style={{ left: `${Math.max(0, Math.min(100, (note.start_seconds / durationSeconds) * 100))}%` }}
        >
          <Volume2 className="size-2.5" />
        </span>
      ))}
    </div>
  )
}
