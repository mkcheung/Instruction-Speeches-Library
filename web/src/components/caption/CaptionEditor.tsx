import { useState } from 'react'
import { useGetCaptionsQuery } from '@/features/caption/captionApi'
import { useRetryAssetMutation } from '@/features/speech/speechApi'
import { useCaptionEditor } from '@/hooks/useCaptionEditor'
import { formatSpokenTimecode, formatTimecode } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * STEP-09-FROZEN-CONTRACT.md §5: "the caption editor is reached from the
 * transcript tab (same screen, edit-in-place per line... literally reuse
 * `Transcript.tsx`'s list/click-to-seek structure, adding inline-editable
 * text per row)." Speaker-only per §1 (`updateCaptions` is ownership-only)
 * — `SpeechWatch` only mounts this for `isOwner`; a reviewer gets
 * `TranscriptPanel` (read-only) instead.
 *
 * Owns the `getCaptions` query itself (same split as `EssayEditorPanel`/
 * `EssayEditorPanelInner`: fetch-and-gate here, hand a resolved value to
 * the part that owns per-instance editor state) so callers don't need to
 * pass `initial` down from a parent that also needs the same data.
 */
export function CaptionEditor({ speechId, onSeek }: { speechId: number; onSeek: (seconds: number) => void }) {
  const { data, isLoading, isError, refetch } = useGetCaptionsQuery({ speechId })
  const [retryAsset, { isLoading: isRetrying }] = useRetryAssetMutation()

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading captions…</p>
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-[var(--color-danger)]">
        Could not load captions. Try again.
      </p>
    )
  }

  if (data.status === 'failed') {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 text-sm text-[var(--color-danger)]">
        <span>Caption generation failed. The video still plays without captions.</span>
        <button
          type="button"
          className="underline disabled:opacity-50"
          disabled={isRetrying || data.asset_id === null}
          onClick={() => {
            if (data.asset_id === null) return
            // Re-dispatches GenerateCaptions server-side
            // (SpeechUploadController::retry) — a plain refetch would just
            // keep returning the same permanently-failed row.
            void retryAsset({ speechId, assetId: data.asset_id }).then(() => refetch())
          }}
        >
          {isRetrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }

  // `'unavailable'`: no `captions` asset was ever created for this speech
  // (off at upload time, per §3's `captions_enabled` gate, or nothing has
  // run yet) — an honest empty state, not an error, same treatment
  // `CaptionController::show`'s own doc comment describes.
  if (data.status === 'unavailable') {
    return <p className="text-sm text-muted-foreground">No captions have been generated for this speech.</p>
  }

  if (data.status !== 'ready' || !data.vtt) {
    return <p className="text-sm text-muted-foreground">Captions are still processing…</p>
  }

  return <CaptionEditorInner speechId={speechId} vtt={data.vtt} onSeek={onSeek} />
}

function CaptionEditorInner({
  speechId,
  vtt,
  onSeek,
}: {
  speechId: number
  vtt: string
  onSeek: (seconds: number) => void
}) {
  const { cues, autosaveState, editCueText, flushNow } = useCaptionEditor({ speechId, vtt })
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Click a line to fix it. Changes save automatically.</p>
        <span
          data-testid="caption-autosave-state"
          data-state={autosaveState}
          className={cn(
            'text-xs',
            autosaveState === 'offline' && 'text-[var(--color-danger)]',
            autosaveState === 'saved' && 'text-[var(--color-success)]',
            (autosaveState === 'idle' || autosaveState === 'dirty' || autosaveState === 'saving') &&
              'text-muted-foreground',
          )}
        >
          {autosaveState}
        </span>
      </div>

      <ol aria-label="Caption editor" className="flex max-h-96 flex-col gap-1 overflow-y-auto">
        {cues.map((cue) => (
          <li key={cue.id} className="flex items-start gap-2 rounded-md px-2 py-1 hover:bg-muted">
            <button
              type="button"
              onClick={() => onSeek(cue.start)}
              aria-label={`Seek to ${formatSpokenTimecode(cue.start)}`}
              className="shrink-0 tabular-nums text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              {formatTimecode(cue.start)}
            </button>

            {editingId === cue.id ? (
              <textarea
                autoFocus
                data-testid={`caption-cue-input-${cue.id}`}
                value={cue.text}
                rows={2}
                className="flex-1 resize-none rounded border border-border bg-background p-1 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onChange={(e) => editCueText(cue.id, e.target.value)}
                onBlur={() => {
                  setEditingId(null)
                  flushNow()
                }}
              />
            ) : (
              <button
                type="button"
                data-testid={`caption-cue-${cue.id}`}
                onClick={() => setEditingId(cue.id)}
                className="flex-1 text-left text-sm"
              >
                {cue.text || <span className="italic text-muted-foreground">Empty line — click to edit</span>}
              </button>
            )}
          </li>
        ))}
        {cues.length === 0 && <li className="px-2 py-1 text-sm text-muted-foreground">No captions yet.</li>}
      </ol>
    </div>
  )
}
