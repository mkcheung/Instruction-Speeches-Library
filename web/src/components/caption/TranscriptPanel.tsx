import { useGetTranscriptQuery } from '@/features/transcript/transcriptApi'
import { formatSpokenTimecode, formatTimecode } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * STEP-09-captions.md: "a readable transcript view — the whole speech as
 * text, click a line to jump there." §8.6: "the transcript list — not the
 * overlay — is the authoritative accessible surface." Read-only — the
 * editable counterpart is `CaptionEditor.tsx`, mounted instead of this for
 * the owner (§5 of the frozen contract: captions are speaker-editable
 * only). A non-owner reviewer (who can `readCaptions` per §1's
 * `SpeechPolicy` but not `updateCaptions`) always gets this component.
 */
export function TranscriptPanel({
  speechId,
  onSeek,
  currentId,
}: {
  speechId: number
  onSeek: (seconds: number) => void
  /** The currently-active segment index/id, if the caller wants to
   * highlight it (mirrors `Transcript.tsx`'s `aria-current` row) — optional
   * since a transcript-only reader (no active playhead tracking wired
   * yet) is still a complete, useful view without it. */
  currentId?: string | null
}) {
  const { data, isLoading, isError } = useGetTranscriptQuery({ speechId })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading transcript…</p>
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-[var(--color-danger)]">
        Could not load the transcript.
      </p>
    )
  }

  if (data.segments.length === 0) {
    return <p className="text-sm text-muted-foreground">No transcript yet.</p>
  }

  return (
    <ol aria-label="Speech transcript" className="flex max-h-96 flex-col gap-1 overflow-y-auto">
      {data.segments.map((segment, index) => {
        const id = `segment-${index}`
        return (
          <li key={id} aria-current={id === currentId ? 'true' : undefined}>
            <button
              type="button"
              onClick={() => onSeek(segment.start)}
              className={cn(
                'flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
                id === currentId && 'bg-muted font-medium',
              )}
            >
              <span aria-hidden="true" className="shrink-0 tabular-nums text-muted-foreground">
                {formatTimecode(segment.start)}
              </span>
              <span className="sr-only">Transcript at {formatSpokenTimecode(segment.start)}</span>
              <span>{segment.text}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
