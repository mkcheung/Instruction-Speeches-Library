import type { RefObject } from 'react'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs'
import { InviteReviewerPanel } from '@/components/review/InviteReviewerPanel'
import { ReviewerRoster } from '@/components/review/ReviewerRoster'
import { TrackSelector } from '@/components/review/TrackSelector'
import type { CommentaryPlaybackControlsProps } from '@/components/review/CommentaryPlaybackControls'
import { AnnotationComposerPanel, type AnnotationComposerPanelProps } from '@/components/annotation/AnnotationComposerPanel'
import { EssayEditorPanel } from '@/components/essay/EssayEditorPanel'
import { EssayReadOnlyPanel } from '@/components/essay/EssayReadOnlyPanel'
import { EssayReviewerPicker } from '@/components/essay/EssayReviewerPicker'
import { CaptionEditor } from '@/components/caption/CaptionEditor'
import { TranscriptPanel } from '@/components/caption/TranscriptPanel'
import { CaptionSettingsToggle } from '@/components/caption/CaptionSettingsToggle'
import type { Speech } from '@/features/speech/types'
import type { useCommentaryTrack } from '@/hooks/useCommentaryTrack'
import type { useSpeechWatchReviewer } from '@/hooks/useSpeechWatchReviewer'

const READING_PANEL = 'workspace-notebook-surface workspace-notebook-panel workspace-notebook-reading'

interface OwnerTabsProps {
  tab: string
  onTabChange: (value: string) => void
  notesTabRef: RefObject<HTMLButtonElement | null>
  playbackControlProps: CommentaryPlaybackControlsProps
  commentary: ReturnType<typeof useCommentaryTrack>
  htmlFullscreen: boolean
  speechId: number
  speech: Speech
  selectedReviewerLabel: string | undefined
  seekCurrentVideo: (seconds: number) => void
}

export function OwnerTabs({ tab, onTabChange, notesTabRef, playbackControlProps, commentary,
  htmlFullscreen, speechId, speech, selectedReviewerLabel, seekCurrentVideo }: OwnerTabsProps) {
  return (
    <Tabs className="workspace-notebook-surface" value={tab} onValueChange={(value) => onTabChange(String(value))}>
      {/* `flex-wrap max-w-full`, not bare `flex-wrap`: the list is
          `inline-flex w-fit` (components/ui/tabs.tsx), i.e. sized to
          max-content, so without a cap it has no reason to wrap and a
          fourth tab would simply overflow a narrow phone. */}
      <TabsList aria-label="Speech tools" className="flex-wrap max-w-full">
        <TabsTab value="notes" ref={notesTabRef}>Notes</TabsTab>
        <TabsTab value="essay">Essay</TabsTab>
        <TabsTab value="transcript">Transcript</TabsTab>
        <TabsTab value="reviewers">Reviewers</TabsTab>
      </TabsList>
      {/* `keepMounted`: §7.7.1 of IMPLEMENTATION-PLANS.md — Base UI
          unmounts an inactive panel by default (`shouldRender =
          keepMounted || mounted`, else `return null`), which would
          otherwise remove `TrackSelector`'s `Transcript` (the
          speaker-side accessible commentary surface, §8.6) from the
          DOM the instant the owner switches to Essay or Transcript.
          Lower priority than the reviewer's `notes` panel below (this
          isn't the path STEP-15's demo script walks), but the fix is
          one word, so it's included here too. */}
      <TabsPanel value="notes" keepMounted>
        <TrackSelector
          {...playbackControlProps}
          options={commentary.options}
          optionsLoading={commentary.optionsLoading}
          selected={commentary.selected}
          onSelect={commentary.select}
          onPrefetch={commentary.prefetch}
          error={commentary.error}
          isFetching={commentary.isFetching}
          fetchedReviewerName={commentary.fetchedReviewerName}
          controlsElsewhere={htmlFullscreen}
        />
      </TabsPanel>
      <TabsPanel value="essay">
        <div className={READING_PANEL}>
        {/* IMPLEMENTATION-PLANS.md §7.4: the Essay panel's content is
            driven by the selection made in the Notes tab's
            `TrackSelector` radiogroup — a sibling tab's state. Opening
            Essay first, before ever visiting Notes, used to land on
            `EssayReadOnlyPanel`'s "Pick a reviewer to see their essay"
            with no picker in sight. This is that picker — same
            `commentary` selection, no second query, no local state. */}
        <EssayReviewerPicker
          options={commentary.options}
          selected={commentary.selected}
          onSelect={commentary.select}
        />
        <EssayReadOnlyPanel
          speechId={speechId}
          reviewId={typeof commentary.selected === 'number' ? commentary.selected : null}
          reviewerName={selectedReviewerLabel}
        />
        </div>
      </TabsPanel>
      {/* STEP-09-FROZEN-CONTRACT.md §5: the caption editor lives here,
          on the same tab as the transcript — speaker-only
          (`updateCaptions` is ownership-only, §1), so only the
          `isOwner` tab strip gets the editable version; the
          non-owner tab strip below gets the read-only
          `TranscriptPanel` instead. */}
      <TabsPanel value="transcript">
        <div className={READING_PANEL}>
        {/* captions-settings gap fix: the owner-only automatic-
            captioning off-switch, mounted right above the editor it
            affects (both live on the one tab this codebase already
            scopes to `isOwner`). */}
        {speech && (
          <div className="mb-2">
            <CaptionSettingsToggle speechId={speechId} captionsEnabled={speech.captions_enabled} />
          </div>
        )}
        <CaptionEditor
          speechId={speechId}
          onSeek={seekCurrentVideo}
        />
        </div>
      </TabsPanel>
      {/* Inviting used to be a header button that swapped in a panel
          ABOVE this strip, pushing Notes/Essay/Transcript down the page
          — far enough, with the reviewer directory expanded, to scroll
          them out of view. A tab panel occupies a fixed slot, so it
          cannot displace its siblings.

          `keepMounted` because Base UI unmounts an inactive panel by
          default (verified against @base-ui/react 1.7.0: `shouldRender
          = keepMounted || mounted`, else `return null`) — without it a
          half-written invitation is destroyed by a glance at Notes to
          check a timestamp.

          No `onClose`: there is nothing to dismiss in a tab, and the
          panel resets itself via "Invite someone else" after a
          successful send. */}
      <TabsPanel value="reviewers" keepMounted>
        {/* IMPLEMENTATION-PLANS.md §7.2.6: the roster goes ABOVE the
            invite panel — a speaker checking in on existing reviewers
            is the more common path into this tab than inviting a new
            one, and the invite form staying "two inches below" (§7.2.4)
            is exactly what keeps re-invite deferrable without feeling
            like a dead end. */}
        <div className="mb-6">
          <ReviewerRoster speechId={speechId} />
        </div>
        <InviteReviewerPanel
          speechId={speechId}
          supersedesId={speech.supersedes?.id}
          hideHeading
        />
      </TabsPanel>
    </Tabs>
  )
}

type ReviewerTabsProps = Pick<AnnotationComposerPanelProps,
  'speechId' | 'review' | 'previewTarget' | 'htmlFullscreen' | 'voiceControlsTarget' | 'videoEl' |
  'durationSeconds' | 'userId' | 'canRecordVoice' | 'onRecordingLockChange'> & {
  tab: string
  onTabChange: (value: string) => void
  recordingLocked: boolean
  previewIdentity: string | null
  captionsAnchor: 'top' | 'default'
  scrubKey: string
  scrubEnabled: boolean
  seekScrub: (role: 'owner' | 'reviewer', key: string, seconds: number) => void
  reviewerNavigation: ReturnType<typeof useSpeechWatchReviewer>['reviewerNavigation']
  seekCurrentVideo: (seconds: number) => void
}

export function ReviewerTabs({ tab, onTabChange, recordingLocked, speechId, review, previewTarget,
  previewIdentity, htmlFullscreen, voiceControlsTarget, captionsAnchor, onRecordingLockChange,
  scrubKey, scrubEnabled, seekScrub, reviewerNavigation, videoEl, durationSeconds, userId,
  canRecordVoice, seekCurrentVideo }: ReviewerTabsProps) {
  return (
    <Tabs className="workspace-notebook-surface" value={tab} onValueChange={(value) => {
      // While the microphone is requested/recording, Notes cannot be left.
      if (recordingLocked && String(value) !== 'notes') return
      onTabChange(String(value))
    }}>
      <TabsList aria-label="Your feedback">
        <TabsTab value="notes">Notes</TabsTab>
        <TabsTab value="essay" disabled={recordingLocked}>Essay</TabsTab>
        <TabsTab value="transcript" disabled={recordingLocked}>Transcript</TabsTab>
      </TabsList>
      {recordingLocked && (
        <p className="aw-lock-hint text-sm text-muted-foreground" role="status">
          Stop recording before switching tabs.
        </p>
      )}
      {/* `keepMounted`: §7.7.1 of IMPLEMENTATION-PLANS.md — DECIDED:
          `AnnotationList` (inside `AnnotationComposerPanel` below) is
          the coach-side AUTHORITATIVE ACCESSIBLE SURFACE for this
          authoring screen (§8.6's "always available, <ol>,
          timecoded, aria-current, click-to-seek" list), not a gap
          where a second `Transcript` instance belongs. It is ONE
          authoritative PAGED list (six saved notes per page, accessible
          name "Your commentary"); the complete annotation dataset still
          drives timing, keyboard navigation and overlap validation, so
          paging never hides notes from those. `Transcript.tsx`'s own
          `<ol aria-label="Commentary transcript">` is the SPEAKER-side
          surface (mounted above via `TrackSelector`, owner-only) and
          intentionally has no coach-side counterpart; rendering one
          here would duplicate the coach's own notes into two lists on
          one screen and create a Playwright strict-mode `aria-label`
          collision. Without `keepMounted`, Base UI's default
          `TabsPanel` behaviour unmounts this panel — and
          `AnnotationList` with it — the instant the reviewer switches
          to Essay or Transcript, which is what made the surface fail
          §8.6's "always available" property until this was added.
          `authoringActive` follows the actual outer tab selection (not
          preview readiness); `onRecordingLockChange` feeds the
          session-scoped lock that keeps the reviewer on Notes while the
          microphone is requested or recording. */}
      <TabsPanel value="notes" keepMounted>
        <AnnotationComposerPanel
          speechId={speechId}
          review={review}
          previewTarget={previewTarget}
          previewEnabled={tab === 'notes' && !!previewIdentity}
          htmlFullscreen={htmlFullscreen}
          voiceControlsTarget={voiceControlsTarget}
          previewAnchor={captionsAnchor}
          authoringActive={tab === 'notes'}
          onRecordingLockChange={onRecordingLockChange}
          scrub={{ bindingKey: scrubKey, enabled: scrubEnabled,
            active: tab === 'notes', onSeek: (seconds) => seekScrub('reviewer', scrubKey, seconds) }}
          timelineNavigation={!reviewerNavigation.validated ? {
            pending: reviewerNavigation.pending, retry: reviewerNavigation.retry,
          } : undefined}
          videoEl={videoEl}
          durationSeconds={
            durationSeconds
          }
          userId={userId}
          canRecordVoice={canRecordVoice}
          onSeek={seekCurrentVideo}
        />
      </TabsPanel>
      <TabsPanel value="essay">
        <EssayEditorPanel speechId={speechId} review={review} />
      </TabsPanel>
      {/* Read-only for a reviewer — `readCaptions` grants read access
          same as the speech itself (§1), but `updateCaptions` stays
          owner-only, so no `CaptionEditor` here. */}
      <TabsPanel value="transcript">
        <div className={READING_PANEL}>
        <TranscriptPanel
          speechId={speechId}
          onSeek={seekCurrentVideo}
        />
        </div>
      </TabsPanel>
    </Tabs>
  )
}
