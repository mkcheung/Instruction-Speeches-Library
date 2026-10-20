import { useId, useState } from 'react'
import type { Annotation, CommentaryPlaybackMode } from '@/features/annotation/types'
import type { useCommentaryPlaybackPreference } from '@/hooks/useCommentaryPlaybackPreference'
import type { useVoiceInterjections } from '@/hooks/useVoiceInterjections'
import { COMMENTARY_PLAYBACK_MODES } from '@/lib/commentaryPlayback'
import { Transcript } from '@/components/annotation/Transcript'
import { cn } from '@/lib/utils'

export interface CommentaryPlaybackControlsProps {
  mode: CommentaryPlaybackMode
  onModeChange: (mode: CommentaryPlaybackMode) => void
  preference: ReturnType<typeof useCommentaryPlaybackPreference>
  voicePlayback: ReturnType<typeof useVoiceInterjections>
  disabled: boolean
  annotations: readonly Annotation[]
  allAnnotations: readonly Annotation[]
  activeIds: ReadonlySet<string>
  currentTime: number
  onSeek: (seconds: number) => void
  onReadAll: () => void
  readingKey: string
  hideReadableBody: boolean
  visible: boolean
  showVoiceControls?: boolean
}

/** One control/list owner, usable inline or inside the player's fullscreen root. */
export function CommentaryPlaybackControls(props: CommentaryPlaybackControlsProps) {
  const { mode, onModeChange, preference, voicePlayback, disabled, annotations, allAnnotations,
    activeIds, currentTime, onSeek, hideReadableBody } = props
  const name = useId()
  const isDisabled = disabled || !preference.ready
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Commentary playback" className="flex flex-wrap gap-2">
        {COMMENTARY_PLAYBACK_MODES.map((option) => (
          <label key={option.value} className={cn(
            'relative inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 py-1 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
            mode === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted',
            isDisabled && 'cursor-default opacity-50',
          )}>
            <input className="sr-only" type="radio" name={name} value={option.value} checked={mode === option.value}
              disabled={isDisabled} onChange={() => onModeChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
      {preference.loading && <p role="status" className="text-sm text-muted-foreground">Loading commentary playback setting…</p>}
      {preference.loadError && <p role="alert" className="text-sm text-destructive">
        Could not load commentary playback setting. <button type="button" className="underline" onClick={preference.retry}>Retry</button>
      </p>}
      {preference.saveError && <p role="alert" className="text-sm text-destructive">
        Could not save setting. This choice applies only to this session. <button type="button" className="underline" onClick={preference.retry}>Retry</button>
      </p>}
      {preference.saving && <p role="status" className="text-sm text-muted-foreground">Saving setting…</p>}
      {preference.preference?.source === 'legacy' && preference.preference.legacy_mode === 'text' && (
        <p className="text-sm text-muted-foreground">To read recorded feedback silently, open Read all feedback.</p>
      )}
      {props.showVoiceControls !== false && <VoicePlaybackControls playback={voicePlayback} />}
      {!disabled && preference.ready && <>
        {mode === 'off' ? <p className="text-sm text-muted-foreground">Commentary is off.</p>
          : annotations.length > 0 ? <Transcript annotations={annotations} activeIds={activeIds} currentTime={currentTime} onSeek={onSeek} hideBody={hideReadableBody} />
            : <p className="text-sm text-muted-foreground">{mode === 'written' ? 'No written notes from this reviewer.'
              : mode === 'voice' ? 'No audio commentary from this reviewer.' : 'No commentary from this reviewer.'}</p>}
        {mode !== 'all' && allAnnotations.length > 0 && <FeedbackDisclosure key={props.readingKey} {...props} />}
      </>}
    </div>
  )
}

function FeedbackDisclosure({ allAnnotations, activeIds, currentTime, onSeek, visible, onReadAll }: CommentaryPlaybackControlsProps) {
  const [open, setOpen] = useState(false)
  return <details open={open} onToggle={(event) => {
    if (event.currentTarget.open === open) return
    setOpen(event.currentTarget.open)
    if (event.currentTarget.open && visible) onReadAll()
  }}>
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Read all feedback</summary>
    {open && <Transcript annotations={allAnnotations} activeIds={activeIds} currentTime={currentTime} onSeek={onSeek} label="All feedback" />}
  </details>
}

export function VoicePlaybackControls({ playback: voicePlayback }: { playback: ReturnType<typeof useVoiceInterjections> }) {
  return <div className="flex flex-col gap-2">
{voicePlayback.error && <p role="alert" className="text-sm text-destructive">{voicePlayback.error}</p>}
      {voicePlayback.hint && !voicePlayback.current && <p role="status" className="text-sm text-muted-foreground">🔊 Commentary ahead</p>}
      {voicePlayback.current && <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
        <span role="status" className="text-sm">{voicePlayback.state === 'loading' ? 'Loading voice commentary…'
          : voicePlayback.state === 'paused' ? 'Voice commentary paused' : 'Playing voice commentary'}</span>
        {voicePlayback.state === 'paused'
          ? <button type="button" className="min-h-11 rounded-md border px-3 text-sm" onClick={() => void voicePlayback.resumeCommentary()}>Resume commentary</button>
          : <button type="button" disabled={voicePlayback.state !== 'playing'} className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-50" onClick={voicePlayback.pauseCommentary}>Pause commentary</button>}
        <button type="button" className="min-h-11 rounded-md border px-3 text-sm" onClick={voicePlayback.skip}>Skip commentary</button>
      </div>}
  </div>
}
