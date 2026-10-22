import { useId } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ReportDialog } from '@/components/report/ReportDialog'
import type { CommentarySelection, CommentaryTrackOption } from '@/hooks/useCommentaryTrack'
import { CommentaryPlaybackControls, type CommentaryPlaybackControlsProps } from './CommentaryPlaybackControls'
import { cn } from '@/lib/utils'

export interface TrackSelectorProps extends CommentaryPlaybackControlsProps {
  options: CommentaryTrackOption[]
  optionsLoading: boolean
  selected: CommentarySelection
  onSelect: (next: CommentarySelection) => void
  onPrefetch: (next: CommentarySelection) => void
  error: unknown
  isFetching: boolean
  fetchedReviewerName: string | undefined
  /** Fullscreen moves the single control/list owner into the player root. */
  controlsElsewhere?: boolean
}

export function TrackSelector(props: TrackSelectorProps) {
  const { options, optionsLoading, selected, onSelect, onPrefetch, error, isFetching, fetchedReviewerName, controlsElsewhere } = props
  const name = useId()
  const reviewers = options.filter((option) => option.review !== null)
  if (optionsLoading) return <p role="status" className="text-sm text-muted-foreground">Loading reviewers…</p>
  return (
    <Card className="workspace-notebook-surface workspace-notebook-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Commentary track</CardTitle>
          <CardDescription>Choose whose commentary to watch alongside the video.</CardDescription>
        </div>
        {typeof selected === 'number' && <ReportDialog reportableType="review" reportableId={selected} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {reviewers.length ? <div role="radiogroup" aria-label="Choose commentary track" className="flex flex-wrap gap-2">
          {reviewers.map((option) => (
            <label key={option.key} className={cn(
              'relative inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 py-1 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
              option.key === selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted',
            )} onMouseEnter={() => onPrefetch(option.key)}>
              <input className="sr-only" type="radio" name={name} checked={option.key === selected}
                onChange={() => onSelect(option.key)} onFocus={() => onPrefetch(option.key)} />
              {option.label}
              {option.noteCount > 0 && <span className={cn('ml-1 text-xs', option.key === selected ? 'opacity-90' : 'opacity-75')}>{` · ${option.noteCount} ${option.noteCount === 1 ? 'note' : 'notes'} total`}</span>}
              {option.hasUnread && <><span aria-hidden="true" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-current" /><span className="sr-only">{', new'}</span></>}
            </label>
          ))}
        </div> : !error && <p className="text-sm text-muted-foreground">No reviewers available.</p>}
        {Boolean(error) && <p role="alert" className="text-sm text-destructive">
          Couldn't load this reviewer's commentary. Try again, or pick another track.
          {typeof selected === 'number' && <button type="button" className="ml-1 underline" onClick={() => onSelect(selected)}>Try again</button>}
        </p>}
        {isFetching && !fetchedReviewerName && !error && <p role="status" className="text-sm text-muted-foreground">Loading commentary…</p>}
        {!controlsElsewhere && <CommentaryPlaybackControls {...props} />}
      </CardContent>
    </Card>
  )
}
