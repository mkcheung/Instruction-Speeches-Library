import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Transcript } from '@/components/annotation/Transcript'
import { ReportDialog } from '@/components/report/ReportDialog'
import { NO_COMMENTARY, type CommentarySelection, type CommentaryTrackOption } from '@/hooks/useCommentaryTrack'
import type { Annotation } from '@/features/annotation/types'
import { cn } from '@/lib/utils'
import type { VoiceCommentaryMode } from '@/features/annotation/types'
import type { useVoiceInterjections } from '@/hooks/useVoiceInterjections'

/**
 * STEP-06-watch-commentary.md's speaker-facing track selector, completing
 * the STEP-05 stub (which only tracked local selection state and rendered
 * a placeholder — "wiring a real player track is STEP-06's job").
 *
 * `listSpeechReviews` (`GET /api/speeches/{speech}/reviews`, confirmed
 * against `api/routes/api.php` / `ReviewController::forSpeech`) is already
 * filtered server-side to access-granting, non-revoked reviews, so every
 * row is a real radiogroup option. Owner-only; callers must gate
 * rendering on `speech.user_id === current user's id` themselves, same as
 * before.
 *
 * Purely presentational — the radiogroup, error/loading states and
 * transcript. The fetch, cross-fade and engine wiring live in
 * `useCommentaryTrack` (shared with `SpeechWatch`, which needs the same
 * `activeIds`/`annotations` to position `OverlayStack` over the actual
 * `<video>` element rather than below it in this card).
 */
export function TrackSelector({
  options,
  optionsLoading,
  selected,
  onSelect,
  onPrefetch,
  error,
  isFetching,
  fetchedReviewerName,
  annotations,
  activeIds,
  currentTime,
  onSeek,
  voiceMode,
  onVoiceModeChange,
  voicePlayback,
}: {
  options: CommentaryTrackOption[]
  optionsLoading: boolean
  selected: CommentarySelection
  onSelect: (next: CommentarySelection) => void
  onPrefetch: (next: CommentarySelection) => void
  error: unknown
  isFetching: boolean
  fetchedReviewerName: string | undefined
  annotations: readonly Annotation[]
  activeIds: ReadonlySet<string>
  currentTime: number
  onSeek: (seconds: number) => void
  voiceMode: VoiceCommentaryMode
  onVoiceModeChange: (mode: VoiceCommentaryMode) => void
  voicePlayback: ReturnType<typeof useVoiceInterjections>
}) {
  if (optionsLoading) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Commentary track</CardTitle>
          <CardDescription>Choose whose commentary to watch alongside the video.</CardDescription>
        </div>
        {/* STEP-11-FROZEN-CONTRACT.md §10: review-level report ("annotation
            sets" in STEP-11.md's own wording — a review IS the annotation
            set). Only rendered once a real review is selected: `NO_COMMENTARY`
            has no `reportable_id` to attach to. */}
        {typeof selected === 'number' && <ReportDialog reportableType="review" reportableId={selected} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Choose commentary track" className="flex flex-wrap gap-2">
          {options.map((option) => {
            const isChecked = option.key === selected
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={isChecked}
                onClick={() => onSelect(option.key)}
                onMouseEnter={() => onPrefetch(option.key)}
                onFocus={() => onPrefetch(option.key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  isChecked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-muted',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">Voice commentary</p>
          <div role="radiogroup" aria-label="Voice commentary" className="flex flex-wrap gap-2">
            {([
              ['play', 'Play commentary'],
              ['text', 'Text only'],
              ['none', 'None'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={voiceMode === mode}
                onClick={() => onVoiceModeChange(mode)}
                className={cn(
                  'min-h-11 rounded-full border px-3 py-1 text-sm transition-colors',
                  voiceMode === mode
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {voicePlayback.hint && !voicePlayback.current && voiceMode === 'play' && (
          <p role="status" className="text-sm text-muted-foreground">🔊 Commentary ahead</p>
        )}
        {voicePlayback.current && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2" role="status">
            <span className="text-sm">
              {voicePlayback.state === 'loading' ? 'Loading voice commentary…' : 'Playing voice commentary'}
            </span>
            {voicePlayback.state === 'paused' ? (
              <button type="button" className="min-h-11 rounded-md border px-3 text-sm" onClick={() => void voicePlayback.resumeCommentary()}>
                Resume commentary
              </button>
            ) : (
              <button type="button" className="min-h-11 rounded-md border px-3 text-sm" onClick={voicePlayback.pauseCommentary}>
                Pause commentary
              </button>
            )}
            <button type="button" className="min-h-11 rounded-md border px-3 text-sm" onClick={voicePlayback.skip}>
              Skip <span aria-hidden="true">▸</span>
            </button>
          </div>
        )}

        {/* Reject-don't-silently-fall-back-to-"No commentary": a 403/404/422
            from the annotations endpoint is a real error state, matching
            the backend's rule (STEP-06 contract). */}
        {Boolean(error) && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            Couldn't load this reviewer's commentary. Try again, or pick another track.
          </p>
        )}

        {selected !== NO_COMMENTARY && isFetching && !fetchedReviewerName && !error && (
          <p className="text-sm text-muted-foreground">Loading commentary…</p>
        )}

        {selected !== NO_COMMENTARY && fetchedReviewerName && annotations.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">{fetchedReviewerName} hasn't left commentary yet.</p>
        )}

        <Transcript annotations={annotations} activeIds={activeIds} currentTime={currentTime} onSeek={onSeek} />
      </CardContent>
    </Card>
  )
}
