import { useEffect, useRef, useState } from 'react'
import type { Speech } from '@/features/speech/types'
import type { MeResponse } from '@/features/auth/types'
import type { Annotation } from '@/features/annotation/types'
import type { OwnerTimelineStatus } from '@/components/review/OwnerVideoTools'
import { isTerminalAccessError } from '@/lib/errorStatus'
import { useCommentaryTrack } from '@/hooks/useCommentaryTrack'
import { isLiveBinding, type useSpeechWatchMedia } from '@/hooks/useSpeechWatchMedia'

export function useSpeechWatchOwner({ speechId, asset, me, isOwner, isLoading, error, meLoading, meError, meFetching,
  requestedReviewId, validSpeechId, speechIsRoute, speechDenied, authDenied, sourceIsCurrent,
  media, htmlFullscreen, fullscreenControlsOpen }: {
  speechId: number
  asset: Speech['primary_video'] | undefined
  me: MeResponse | undefined
  isOwner: boolean
  isLoading: boolean
  error: unknown
  meLoading: boolean
  meError: unknown
  meFetching: boolean
  requestedReviewId: number | null
  validSpeechId: boolean
  speechIsRoute: boolean
  speechDenied: boolean
  authDenied: boolean
  sourceIsCurrent: boolean
  media: ReturnType<typeof useSpeechWatchMedia>
  htmlFullscreen: boolean
  fullscreenControlsOpen: boolean
}) {
  const [ownerTab, setOwnerTab] = useState('notes')
  const ownerNotesTabRef = useRef<HTMLButtonElement | null>(null)
  const focusOwnerNotesRef = useRef(false)
  const [validatedOwnerKey, setValidatedOwnerKey] = useState<string | null>(null)
  const { playbackSource, readyPlayback, sourceRefreshToken, concreteReady } = media
  // Ownership may survive a same-context transient refresh, but cached data
  // cannot establish a new context or restore one after terminal denial.
  const ownerCandidate = validSpeechId && speechIsRoute && isOwner && asset
    ? `${me!.user.id}:${speechId}:${asset.id}` : null
  const ownerDenied = speechDenied || authDenied
  const ownerResolved = !isLoading && !error && !meLoading && !meError
  const ownerScope = !ownerDenied && ownerCandidate !== null &&
    (ownerResolved || validatedOwnerKey === ownerCandidate) ? ownerCandidate : null
  // Adjust during render so a terminal response invalidates the remembered
  // context immediately; a later 500 cannot resurrect the old permission.
  if (validatedOwnerKey !== ownerScope) setValidatedOwnerKey(ownerScope)

  const ownerSourceMatches = ownerScope !== null && sourceIsCurrent
  const ownerPlaybackReady = ownerSourceMatches && concreteReady
  const ownerVideo = ownerPlaybackReady ? readyPlayback!.video : null

  const ownerCommentaryVisible = htmlFullscreen ? fullscreenControlsOpen : ownerTab === 'notes'

  // Keep the one canonical hook mounted. Bind only the current concrete video;
  // same-identity preparation retains utility/picker state without binding A to B.
  const commentary = useCommentaryTrack(speechId, ownerVideo, ownerScope !== null, me?.user.id,
    ownerCommentaryVisible, requestedReviewId)
  const commentaryDenied = isTerminalAccessError(commentary.error) ||
    commentary.preference.accessDenied
  let ownerTimelineStatus: OwnerTimelineStatus
  if (commentaryDenied) ownerTimelineStatus = 'unavailable'
  else if (commentary.optionsLoading || commentary.preference.loading) ownerTimelineStatus = 'loading'
  else if (commentary.preference.loadError || !commentary.preference.ready) ownerTimelineStatus = 'unavailable'
  else if (commentary.selected === 'none') ownerTimelineStatus = commentary.error ? 'unavailable' : 'no-selection'
  else if (!commentary.fetchedReviewerName) ownerTimelineStatus = commentary.error ? 'unavailable' : 'loading'
  else if (commentary.error && commentary.allAnnotations.length === 0) ownerTimelineStatus = 'unavailable'
  else if (commentary.mode === 'off') ownerTimelineStatus = 'off'
  else if (commentary.allAnnotations.length === 0) ownerTimelineStatus = 'empty'
  else if (commentary.navigationAnnotations.length === 0) ownerTimelineStatus = 'mode-empty'
  else ownerTimelineStatus = 'ready'
  const selectedReviewerLabel = commentary.options.find((option) => option.key === commentary.selected)?.label
  const ownerReviewerLabel = commentaryDenied ? null : selectedReviewerLabel ?? null
  const ownerDuration = Number(asset?.duration_seconds)
  const ownerDurationSeconds = Number.isFinite(ownerDuration) && ownerDuration > 0 ? ownerDuration : 0
  useEffect(() => {
    if (ownerTab === 'notes' && focusOwnerNotesRef.current) {
      focusOwnerNotesRef.current = false
      ownerNotesTabRef.current?.focus()
    }
  }, [ownerTab])
  const openOwnerNotes = () => {
    if (ownerTab === 'notes') ownerNotesTabRef.current?.focus()
    else {
      focusOwnerNotesRef.current = true
      setOwnerTab('notes')
    }
  }
  const ownerTimelineSeekable = () => !!(ownerPlaybackReady && readyPlayback && isLiveBinding(readyPlayback.player, readyPlayback.video))
  const seekOwnerTimeline = (seconds: number) => { if (ownerTimelineSeekable()) commentary.seek(seconds) }
  // TimelineStrip seeks, then reports a Voice point. Arm it under the seek's own guard:
  // armNote never seeks (PLAN-VOICE-NOTE-CLICK-AND-ROW-PLAY.md §1.2).
  const armOwnerTimelineNote = (note: Annotation) => { if (ownerTimelineSeekable()) commentary.voicePlayback.armNote(note) }
  const playbackControlProps = {
    mode: commentary.mode,
    onModeChange: commentary.selectMode,
    preference: commentary.preference,
    disabled: commentary.selected === 'none' || !commentary.fetchedReviewerName,
    annotations: commentary.annotations,
    allAnnotations: commentary.allAnnotations,
    hideReadableBody: commentary.hideReadableBody,
    activeIds: commentary.activeIds,
    currentTime: commentary.currentTime,
    onSeek: commentary.seek,
    voicePlayback: commentary.voicePlayback,
    readingKey: commentary.readingKey,
    onReadAll: commentary.markRead,
    visible: ownerCommentaryVisible,
  }

  // A background auth request retains data while its current account is
  // unresolved. Keep same-account proof, but lend it no navigation authority
  // until that request settles and the committed identity still matches.
  const ownerScrubReady = ownerPlaybackReady && !meFetching
  const ownerScrubKey = `${ownerScope}:${playbackSource?.generation}:${sourceRefreshToken}`
  return { ownerTab, setOwnerTab, ownerNotesTabRef, ownerScope, ownerSourceMatches, ownerPlaybackReady,
    ownerVideo, commentary, commentaryDenied, ownerTimelineStatus, ownerReviewerLabel, selectedReviewerLabel,
    ownerDurationSeconds, openOwnerNotes, seekOwnerTimeline, armOwnerTimelineNote, playbackControlProps,
    ownerScrubReady, ownerScrubKey }
}
