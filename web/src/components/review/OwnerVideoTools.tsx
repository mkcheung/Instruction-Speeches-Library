import { useState, type ReactNode } from 'react'
import { TimelineStrip, type TimelineScrubCapability } from '@/components/annotation/TimelineStrip'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import type { Annotation, CommentaryPlaybackMode } from '@/features/annotation/types'
import './owner-video-tools.css'

export type OwnerTimelineStatus = 'ready' | 'loading' | 'unavailable' | 'no-selection' | 'empty' | 'mode-empty' | 'off'

export interface OwnerVideoToolsProps {
  /** A validated user:speech:asset identity. Readiness, mode and reviewer are not identity. */
  scopeKey: string
  playbackReady: boolean
  videoEl: HTMLVideoElement | null
  /** Only the canonical hook's authorized, mode-filtered published projection. */
  navigationAnnotations: readonly Annotation[]
  activeIds: ReadonlySet<string> | readonly string[]
  durationSeconds: number
  /** The parent supplies only a currently permitted selected reviewer label. */
  reviewerLabel: string | null
  mode: CommentaryPlaybackMode
  status: OwnerTimelineStatus
  /** A nonterminal refresh failure can coexist with already authorized rows. */
  refreshError?: boolean
  onSeek: (seconds: number) => void
  /** Navigation permission is independent of commentary selection and mode. */
  scrub?: TimelineScrubCapability
  onOpenNotes: () => void
  /** The route owns the picker and its disabled prop; avoid importing the route here. */
  frameSelector: ReactNode
}

const MODE_LABELS: Record<CommentaryPlaybackMode, string> = {
  all: 'Text + audio', written: 'Written notes only', voice: 'Audio only', off: 'Off',
}
const STATUS_MESSAGES: Record<Exclude<OwnerTimelineStatus, 'ready'>, string> = {
  loading: 'Loading commentary…',
  unavailable: 'Commentary is unavailable. Open Notes for details.',
  'no-selection': 'Choose a reviewer in Notes to see their commentary.',
  empty: 'This reviewer has no published commentary yet.',
  'mode-empty': 'No commentary matches this playback mode. Open Notes to change it.',
  off: 'Commentary is off. Open Notes to enable it.',
}
const EMPTY: readonly Annotation[] = []

/** Key only this utility's state, leaving the video and commentary controllers alone. */
export function OwnerVideoTools(props: OwnerVideoToolsProps) {
  return <ScopedOwnerVideoTools key={props.scopeKey} {...props} />
}

function ScopedOwnerVideoTools({
  playbackReady, videoEl, navigationAnnotations, activeIds, durationSeconds,
  reviewerLabel, mode, status, refreshError = false, onSeek, scrub, onOpenNotes, frameSelector,
}: OwnerVideoToolsProps) {
  const [tab, setTab] = useState('timeline')
  const boundVideo = playbackReady ? videoEl : null
  const canSeek = boundVideo !== null && status === 'ready' && mode !== 'off'
  const markers = canSeek ? navigationAnnotations : EMPTY
  const visibleReviewer = mode !== 'off' && !['unavailable', 'loading', 'no-selection', 'off'].includes(status) ? reviewerLabel : null
  const message = !boundVideo ? 'Preparing video. Timeline navigation and frame selection will be available when it is ready.'
    : mode === 'off' && status !== 'unavailable' && status !== 'loading' ? STATUS_MESSAGES.off
      : status === 'ready' ? null : STATUS_MESSAGES[status]

  return <Tabs className="owner-video-tools workspace-notebook-surface" value={tab} onValueChange={(value) => setTab(String(value))}>
    <TabsList className="owner-video-tools__tabs" aria-label="Video tools">
      <TabsTab className="owner-video-tools__tab" value="timeline">Commentary timeline</TabsTab>
      <TabsTab className="owner-video-tools__tab" value="frames">Frame selector</TabsTab>
    </TabsList>
    <TabsPanel className="owner-video-tools__panel owner-video-tools__timeline" value="timeline" keepMounted>
      <div className="owner-video-tools__context">
        <p>{visibleReviewer ? `${visibleReviewer} · ` : ''}{MODE_LABELS[mode]}</p>
        <button className="owner-video-tools__notes" type="button" onClick={onOpenNotes}>Open Notes</button>
      </div>
      {message && <p className="owner-video-tools__notice" role="status">{message}</p>}
      {refreshError && <p className="owner-video-tools__notice" role="status">Commentary could not refresh. Previously loaded commentary may still be shown. Open Notes for details.</p>}
      <TimelineStrip annotations={markers} videoEl={boundVideo} durationSeconds={durationSeconds}
        activeIds={canSeek ? activeIds : []} onSeek={(seconds) => { if (canSeek) onSeek(seconds) }}
        scrub={scrub && { ...scrub, enabled: scrub.enabled && boundVideo !== null,
          active: scrub.active && tab === 'timeline' }} />
      <p className="owner-video-tools__help">Select a Text range or Voice point to seek the video. Blank areas have no commentary in this mode.</p>
    </TabsPanel>
    <TabsPanel className="owner-video-tools__panel" value="frames" keepMounted>
      <p className="owner-video-tools__help">Choose the speech poster image. Selecting a frame does not seek the video.</p>
      {!boundVideo && <p className="owner-video-tools__notice" role="status">Preparing video. Frame selection will be available when it is ready.</p>}
      {frameSelector}
    </TabsPanel>
  </Tabs>
}
