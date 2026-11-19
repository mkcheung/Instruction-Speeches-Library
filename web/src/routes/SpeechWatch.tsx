import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type Player from 'video.js/dist/types/player'
import { NotebookPage } from '@/components/workspace/NotebookPage'
import { ActivityScene } from '@/components/workspace/ActivityScene'
import { usePublishWorkspaceCompanion } from '@/components/workspace/useWorkspaceCompanion'
import type { WorkspaceSceneId } from '@/components/workspace/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { OwnerTabs, ReviewerTabs } from '@/components/speech/SpeechWatchTabs'
import { VideoPlayer } from '@/components/speech/VideoPlayer'
import { OwnerVideoTools } from '@/components/review/OwnerVideoTools'
import { CommentaryPlaybackControls } from '@/components/review/CommentaryPlaybackControls'
import { FullscreenVoiceControls } from '@/components/annotation/VoicePlaybackControls'
import { handleVoiceControlsKeyDown } from '@/lib/voiceControlsKeys'
import { OverlayStack } from '@/components/annotation/OverlayStack'
import { VoiceNoteMarkers } from '@/components/annotation/VoiceNoteMarkers'
import { CaptionsToggle } from '@/components/caption/CaptionsToggle'
import { ReportDialog } from '@/components/report/ReportDialog'
import { getErrorStatus, isTerminalAccessError } from '@/lib/errorStatus'
import { useSpeechWatchMedia, isLiveBinding } from '@/hooks/useSpeechWatchMedia'
import { useSpeechWatchOwner } from '@/hooks/useSpeechWatchOwner'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { canRecordVoiceForRoles } from '@/lib/voiceRoles'
import { useSpeechWatchReviewer } from '@/hooks/useSpeechWatchReviewer'
import { useGetSpeechQuery, useSetPosterFrameMutation } from '@/features/speech/speechApi'
import type { SpeechSprite } from '@/features/speech/types'
import { useGetMeQuery } from '@/features/auth/authApi'
import { cn } from '@/lib/utils'
import { parseReviewQueryParam, REVIEW_QUERY_PARAM } from '@/lib/speechPath'


/**
 * Imperative DOM write, not a React state mutation — same pattern (and
 * same reason) as `useCommentaryTrack.ts`'s own `seekVideo`: pulled out to
 * module scope so the compiler's props/hook-argument immutability check
 * doesn't mistake writing `videoEl.currentTime` for a React immutability
 * bug (`videoEl` is state, but the DOM node it points at is not).
 */
function seekVideo(video: HTMLVideoElement, seconds: number): void {
  video.currentTime = seconds
}

/**
 * The full-height absolute wrapper `OverlayStack` renders into — the ONE
 * element in this tree with room to place content in either the upper or
 * lower half of the video frame. `OverlayStack.tsx` already computes the
 * correct anchor-dependent justification for ITSELF
 * (`anchor === 'top' ? 'items-start' : 'items-start justify-end'`), but
 * that only controls how `OverlayStack`'s own children stack inside its
 * own (content-sized) box — it does nothing for WHERE that box sits
 * inside this taller wrapper. Previously this wrapper hardcoded
 * `justify-end` unconditionally, so a top-anchored `OverlayStack` still
 * rendered flush against the bottom of the video, regardless of anchor.
 * The anchor-dependent justification belongs here too, on the element
 * that actually has vertical room to move.
 */
export function OverlayPositioner({
  anchor,
  children,
}: {
  anchor: 'top' | 'default'
  children: React.ReactNode
}) {
  return (
    <div
      data-testid="overlay-positioner"
      data-anchor={anchor}
      className={cn(
        'pointer-events-none absolute inset-0 flex flex-col p-3',
        anchor === 'top' ? 'justify-start' : 'justify-end',
      )}
    >
      {children}
    </div>
  )
}

/** The outlined feedback frame over the video, aligned like the overlay. */
function FeedbackFrame({ videoAr, anchor, children }: { videoAr: number; anchor: 'top' | 'default'; children: React.ReactNode }) {
  return (
    <div className="owner-feedback-frame" style={{ '--video-ar': videoAr } as React.CSSProperties}>
      <OverlayPositioner anchor={anchor}>{children}</OverlayPositioner>
    </div>
  )
}

export default function SpeechWatch() {
  const { id } = useParams<{ id: string }>()
  const speechId = Number(id)
  // The profile timeline's "Reviews they left you" link names its review, so
  // the owner's commentary track starts on that reviewer.
  const [searchParams] = useSearchParams()
  const requestedReviewId = parseReviewQueryParam(searchParams.get(REVIEW_QUERY_PARAM))
  const { data: speech, isLoading, error, requestId: speechRequestId } = useGetSpeechQuery(speechId, { skip: !speechId })
  const { data: me, error: meError, isLoading: meLoading, isFetching: meFetching, requestId: authRequestId } = useGetMeQuery()
  const asset = speech?.primary_video
  const validSpeechId = Number.isSafeInteger(speechId) && speechId > 0
  const speechIsRoute = Number(speech?.id) === speechId
  const speechDenied = isTerminalAccessError(error)
  const authDenied = isTerminalAccessError(meError)
  // A retained RTK result is useful for stable rendering, but cannot identify
  // a new playback request while the route is resolving a different speech.
  const currentSpeech = validSpeechId && !isLoading && !error && !!speech && speechIsRoute
  const media = useSpeechWatchMedia({ speechId, speech, asset, currentSpeech })
  const { playbackSource, initialUrl, readyPlayback, playerRef, videoEl,
    setSourceRefreshToken, refreshUrl, onPlayerReady, videoAr, captions, captionsTrack, captionsAnchor } = media
  const [htmlFullscreen, setHtmlFullscreen] = useState(false)
  const [fullscreenControlsOpen, setFullscreenControlsOpen] = useState(false)

  const sourceIsCurrent = asset?.status === 'ready' && playbackSource?.speechId === speechId &&
    playbackSource.assetId === asset.id
  const playable = asset?.status === 'ready' && initialUrl ? { asset, url: initialUrl } : null
  const seekCurrentVideo = (seconds: number) => { if (videoEl) seekVideo(videoEl, seconds) }

  const isOwner =
    !!me?.user && !!speech && speech.user_id !== undefined && Number(me.user.id) === speech.user_id
  const roles = me?.user.roles ?? []
  const canRecordVoice = canRecordVoiceForRoles(roles)

  const { ownerTab, setOwnerTab, ownerNotesTabRef, ownerScope, ownerSourceMatches, ownerPlaybackReady,
    ownerVideo, commentary, commentaryDenied, ownerTimelineStatus, ownerReviewerLabel, selectedReviewerLabel,
    ownerDurationSeconds, openOwnerNotes, seekOwnerTimeline, armOwnerTimelineNote, playbackControlProps,
    ownerScrubReady, ownerScrubKey } = useSpeechWatchOwner({ speechId, asset, me, isOwner, isLoading, error, meLoading, meError, meFetching,
  requestedReviewId, validSpeechId, speechIsRoute, speechDenied, authDenied, sourceIsCurrent,
  media, htmlFullscreen, fullscreenControlsOpen })

  const { reviewerTab, setReviewerTab, myReview, previewIdentity, registerPreviewTarget, previewTarget,
    registerVoiceControlsTarget, voiceControlsTarget, reviewerRecordingLocked, reviewerNavigation,
    reviewerScrubReady, reviewerScrubKey, onRecordingLockChange } = useSpeechWatchReviewer({ speechId, speech, asset, me, isOwner, isLoading, error, meLoading, meFetching, meError,
  authRequestId, speechRequestId, speechDenied, authDenied, speechIsRoute, currentSpeech, sourceIsCurrent, media })

  type LiveScrubBinding = { key: string; video: HTMLVideoElement; player: Player; seek: (seconds: number) => void }
  const liveScrub = useRef<{ owner: LiveScrubBinding | null; reviewer: LiveScrubBinding | null } | null>(null)
  // Only committed route/auth/source state can authorize a captured callback.
  // Layout synchronization closes the interval before passive effects run and
  // never publishes an abandoned concurrent render into the event path.
  useLayoutEffect(() => {
    const current = {
      owner: ownerScrubReady && readyPlayback
        ? { key: ownerScrubKey, video: readyPlayback.video, player: readyPlayback.player, seek: commentary.seek } : null,
      reviewer: reviewerScrubReady && reviewerTab === 'notes' && !reviewerRecordingLocked && readyPlayback
        ? { key: reviewerScrubKey, video: readyPlayback.video, player: readyPlayback.player,
          seek: (seconds: number) => seekVideo(readyPlayback.video, seconds) } : null,
    }
    liveScrub.current = current
    return () => { if (liveScrub.current === current) liveScrub.current = null }
  })
  const seekScrub = (role: 'owner' | 'reviewer', key: string, seconds: number) => {
    const latest = liveScrub.current?.[role]
    if (!latest || latest.key !== key || latest.video !== readyPlayback?.video ||
      latest.player !== readyPlayback.player || latest.player !== playerRef.current ||
      !isLiveBinding(latest.player, latest.video)) return
    latest.seek(seconds)
  }
  const feedbackVisible = isOwner || (!!myReview && playable !== null)
  const scenes: Record<string, WorkspaceSceneId> = {
    notes: 'reviews', essay: 'edit', transcript: 'search', reviewers: 'reviewers',
  }
  const companionScene = currentSpeech && feedbackVisible
    ? scenes[isOwner ? ownerTab : reviewerTab] ?? null
    : null
  usePublishWorkspaceCompanion(companionScene)

  // IMPLEMENTATION-PLANS.md §7.7.6: the keyboard map's owner/plain-viewer
  // mount point. Covers the owner's watch screen (`commentary`'s own
  // annotations/seek — the same §8.6 surface `TrackSelector`/`Transcript`
  // show) and a non-owner viewer who isn't themselves an authoring
  // reviewer (no commentary selector renders for them at all, so this
  // just gets an empty annotation list — `[`/`]` no-op, `Space`/`J`/`L`/
  // `,`/`.` still work on the video itself). No `setToPlayhead` here —
  // neither case has an `AnnotationEditor` to stamp.
  //
  // Disabled exactly when `AnnotationComposerPanel` below mounts its OWN
  // instance instead (the `!isOwner && myReview` branch) — that instance
  // has the richer authoring-side data (the merged draft+saved set, and
  // `setToPlayhead`), and running both at once would double-fire every
  // key.
  useKeyboardShortcuts({
    videoEl,
    annotations: isOwner ? commentary.navigationAnnotations : [],
    onSeek: isOwner ? commentary.seek : seekCurrentVideo,
    onNavigate: isOwner ? commentary.voicePlayback.armNote : undefined,
    enabled: isOwner || !myReview,
  })

  // PLAN-ACCESS-DENIED-STATES.md §0.1/§3.2. This used to be a single
  // `isLoading || !speech` guard, which conflated "still fetching" with
  // "the fetch failed": RTK Query settles a failed request to
  // `isLoading: false, data: undefined`, so `!speech` still held and the
  // page rendered `Loading…` forever — silently, with no redirect and no
  // console error, for every 403/404/500/network failure. The branches
  // below are ordered, and the last one is a catch-all specifically so
  // that hang cannot come back: any state where `speech` is absent and we
  // are not loading now renders something.
  //
  // `!speechId` is its own branch, not folded into the error case: a
  // non-numeric or zero `:id` (`/speeches/abc`, `/speeches/0`) makes
  // `Number(id)` falsy, which `skip: !speechId` turns into a query that
  // never runs — so there is no error to read, and the old guard hung
  // there too.
  //
  // Copy convention is `ReviewerDirectory.tsx`'s (whose own comment puts
  // it best — "'the request failed' and 'nobody matched' are different
  // facts"): a permission or absence state is muted and carries no
  // `role="alert"`; only a genuine failure is `destructive` and announced.
  // Deliberately NOT `<NotFound />` — that renders its own `<main>` with
  // `min-h-svh`, and this route is inside `AppLayout`, which already
  // provides `<main id="content">`.
  if (!speechId || (!isLoading && !speech)) {
    const status = speechId ? getErrorStatus(error) : 404
    // 403 covers revoked/declined/abandoned as one undifferentiated case —
    // see the plan's §2.1: splitting them would make the status code itself
    // reveal which one applies.
    const denied = status === 403
    const missing = status === 404
    const failed = !denied && !missing

    return (
      <NotebookPage width="wide" scene={null}>
        <Card className="workspace-notebook-surface workspace-notebook-panel">
          <CardContent
            className={
              failed
                ? 'flex flex-col items-start gap-3 py-6 text-sm text-destructive'
                : 'flex flex-col items-start gap-3 py-6 text-sm text-muted-foreground'
            }
            {...(failed ? { role: 'alert' } : {})}
          >
            <p>
              {denied
                ? "Access denied. This speech isn't available to your account."
                : missing
                  ? 'No such speech.'
                  : "Couldn't load this speech — try again."}
            </p>
            {/* `render={<Link/>}` is the repo's only button-as-link idiom.
                Base UI emits a dev warning about non-<button> renders here
                (as it does at the four older call sites); `nativeButton=
                {false}` silences it but stamps `role="button"` on the
                anchor, which is the wrong accessible role for navigation. */}
            <Button size="sm" variant="outline" className="workspace-notebook-control workspace-notebook-control--secondary" render={<Link to="/dashboard" />}>
              Back to my reviews
            </Button>
          </CardContent>
        </Card>
      </NotebookPage>
    )
  }

  if (isLoading || !speech) {
    return (
      <NotebookPage width="wide" scene={null}>
        <div className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status text-sm text-muted-foreground">
          Loading…
        </div>
      </NotebookPage>
    )
  }

  return (
    <NotebookPage width="wide" scene={null}>
      <Card className="workspace-notebook-media">
        <CardHeader className="workspace-notebook-surface workspace-notebook-panel-header flex flex-row items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle><h1 className="font-sans">{speech.title}</h1></CardTitle>
            {speech.description && <CardDescription>{speech.description}</CardDescription>}
          </div>
          {/* STEP-11-FROZEN-CONTRACT.md §10: speech-level report, visible to
              non-owners — an owner reporting their own speech isn't a case
              this step's UI needs to support, and `isOwner`/`!isOwner` is
              already how this header decides what to show. */}
          {companionScene && <ActivityScene scene={companionScene} variant="compact" />}
          {!isOwner && <ReportDialog reportableType="speech" reportableId={speechId} />}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {playable ? (
            // `relative` so OverlayStack's absolutely-positioned nodes sit
            // over the actual video frame (§8.5) rather than below it —
            // OverlayStack itself is `aria-hidden`/`pointer-events:none`
            // per §8.6, so it never blocks the player's own controls.
            //
            // W2/W3: the width-calc box lives HERE, on this wrapper — not
            // inside `VideoPlayer` — because this is `OverlayStack`'s
            // positioning context. Applied any deeper, this div would
            // stay full-column-width while the video centres beneath it,
            // and the overlays would land offset from the actual frame.
            // `--video-budget` feeds the width calc, not a `max-height`
            // (that approach measurably does nothing — padding is outside
            // the box it would constrain). Both custom properties carry
            // an inline fallback too, so a `calc()` with an unset
            // `--video-ar` never happens even for a single frame.
            <div
              className="relative mx-auto"
              style={
                {
                  width: 'min(100%, calc(var(--video-budget, 620px) * var(--video-ar, 1.7777778)))',
                  aspectRatio: 'var(--video-ar, 1.7777778)',
                  '--video-ar': videoAr,
                  '--video-budget': 'min(60svh, 620px)',
                } as React.CSSProperties
              }
            >
              <VideoPlayer
                key={playbackSource!.key}
                initialUrl={playable.url}
                refreshUrl={refreshUrl}
                poster={speech.poster?.url}
                onPlayerReady={onPlayerReady}
                onSourceRefreshed={() => setSourceRefreshToken((token) => token + 1)}
                onHtmlFullscreenChange={(fullscreen) => {
                  setHtmlFullscreen(fullscreen)
                  if (!fullscreen) setFullscreenControlsOpen(false)
                }}
                presentation={isOwner && ownerPlaybackReady ? (
                <>
                  <FeedbackFrame videoAr={videoAr} anchor={captionsAnchor}>
                    <OverlayStack
                      annotations={commentary.overlayAnnotations}
                      activeIds={commentary.overlayActiveIds}
                      priorityId={commentary.overlayVoiceId}
                      currentTime={commentary.currentTime}
                      anchor={captionsAnchor}
                    />
                  </FeedbackFrame>
                  <VoiceNoteMarkers
                    annotations={commentary.markerAnnotations}
                    durationSeconds={playable.asset.duration_seconds === null ? (videoEl?.duration ?? 0) : Number(playable.asset.duration_seconds)}
                  />
                  {htmlFullscreen && <FullscreenVoiceControls playback={commentary.voicePlayback} />}
                  {htmlFullscreen && <details className="pointer-events-auto absolute right-3 top-3 z-30 max-h-[60vh] w-[min(360px,calc(100%-24px))] overflow-y-auto rounded-lg border bg-background p-3 text-foreground shadow-lg"
                    open={fullscreenControlsOpen} onToggle={(event) => setFullscreenControlsOpen(event.currentTarget.open)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => handleVoiceControlsKeyDown(event, commentary.voicePlayback.skip)}>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Commentary controls</summary>
                    <CommentaryPlaybackControls {...playbackControlProps} showVoiceControls={false} />
                  </details>}
                </>
                ) : previewIdentity ? (
                  <>
                    <FeedbackFrame videoAr={videoAr} anchor={captionsAnchor}>
                        <div data-testid="reviewer-preview-target" className="pointer-events-none" ref={registerPreviewTarget} />
                    </FeedbackFrame>
                    <div data-testid="reviewer-voice-controls-target" ref={registerVoiceControlsTarget} />
                  </>
                ) : null}
              />
            </div>
          ) : (
            <p className="workspace-notebook-surface text-sm text-muted-foreground">Not ready to play yet.</p>
          )}

          {/* STEP-09-captions.md's acceptance list: "captions and
              annotations are on different tracks and toggle
              independently." This toggle only touches `captionsTrack`'s
              own `mode` — nothing here reads or writes the annotation
              overlay's visibility. Shown to every viewer who can play the
              video (not owner-gated, unlike the overlay/tab strip below —
              captions are an accessibility surface, §8.6, not reviewer
              feedback). */}
          {playable && (
            <div className="workspace-notebook-surface flex flex-wrap items-center gap-2">
              <CaptionsToggle track={captionsTrack} />
              {/* `'unavailable'` (no captions asset was ever created — off
                  at upload time, per §3's `captions_enabled` gate) renders
                  no message at all: there is nothing to retry or wait on,
                  same "honest empty state, not an error" treatment
                  `CaptionController::show`'s own doc comment describes. */}
              {captions?.status === 'failed' && (
                <span role="alert" className="text-xs text-[var(--color-danger)]">
                  Captions unavailable.
                </span>
              )}
              {(captions?.status === 'uploading' || captions?.status === 'processing') && (
                <span role="status" className="text-xs text-muted-foreground">
                  Captions processing…
                </span>
              )}
            </div>
          )}

          {/* W3/W5: was unconditionally rendered — a permissions leak (a
              non-owner reviewer saw a "Use current frame" control for
              someone else's speech) and, for a portrait speech with a
              sprite, ~324px of chrome a reviewer never needed to pay for
              at all. Gating it removes both at once. */}
          {ownerSourceMatches && (
            <OwnerVideoTools scopeKey={ownerScope!} playbackReady={ownerPlaybackReady}
              videoEl={ownerVideo} navigationAnnotations={commentary.navigationAnnotations}
              activeIds={commentary.activeIds} durationSeconds={ownerDurationSeconds}
              reviewerLabel={ownerReviewerLabel} mode={commentary.mode} status={ownerTimelineStatus}
              refreshError={!commentaryDenied && commentary.allAnnotations.length > 0 &&
                (!!error || !!meError || !!commentary.error || !!commentary.preference.loadError)}
              onSeek={seekOwnerTimeline}
              onVoiceNoteActivate={armOwnerTimelineNote} onOpenNotes={openOwnerNotes}
              scrub={{ bindingKey: ownerScrubKey, enabled: ownerScrubReady, active: true,
                onSeek: (seconds) => seekScrub('owner', ownerScrubKey, seconds) }}
              frameSelector={<PosterFramePicker speechId={speechId} assetId={asset!.id}
                playerRef={playerRef} sprite={speech.sprite} disabled={!ownerPlaybackReady} />} />
          )}
        </CardContent>
      </Card>

      {/* STEP-08-FROZEN-CONTRACT.md's tab strip: notes stay adjacent to the
          player (where the timestamp context lives), the essay goes
          underneath in its own panel — the two are used in different
          modes (notes while watching, essay after), so a tab strip rather
          than a stack. */}
      {isOwner && <OwnerTabs tab={ownerTab} onTabChange={setOwnerTab} notesTabRef={ownerNotesTabRef}
        playbackControlProps={playbackControlProps} commentary={commentary} htmlFullscreen={htmlFullscreen}
        speechId={speechId} speech={speech} selectedReviewerLabel={selectedReviewerLabel} seekCurrentVideo={seekCurrentVideo} />}

      {!isOwner && myReview && playable && <ReviewerTabs tab={reviewerTab} onTabChange={setReviewerTab}
        recordingLocked={reviewerRecordingLocked} speechId={speechId} review={myReview}
        previewTarget={previewTarget} previewIdentity={previewIdentity} htmlFullscreen={htmlFullscreen}
        voiceControlsTarget={voiceControlsTarget} captionsAnchor={captionsAnchor} onRecordingLockChange={onRecordingLockChange}
        scrubKey={reviewerScrubKey} scrubEnabled={reviewerScrubReady} seekScrub={seekScrub}
        reviewerNavigation={reviewerNavigation} videoEl={videoEl}
        durationSeconds={playable.asset.duration_seconds !== null ? Number(playable.asset.duration_seconds) : 0}
        userId={me?.user.id} canRecordVoice={canRecordVoice} seekCurrentVideo={seekCurrentVideo} />}
    </NotebookPage>
  )
}

/**
 * STEP-04-every-video-plays.md §9.5: "use current frame" plus, when a
 * sprite exists, a clickable strip of its 10 evenly-spaced thumbnails —
 * both call the same poster-frame mutation, which regenerates the poster
 * asynchronously in the background (this component only shows lightweight
 * pending/success feedback, matching `StatusBadge`'s
 * disabled-button-with-changing-label convention rather than inventing a
 * toast system this codebase doesn't otherwise have).
 */
export function PosterFramePicker({
  speechId,
  assetId,
  playerRef,
  sprite,
  disabled = false,
}: {
  speechId: number
  assetId: number
  playerRef: React.RefObject<Player | null>
  sprite?: SpeechSprite
  disabled?: boolean
}) {
  const [setPosterFrame, { isLoading }] = useSetPosterFrameMutation()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [pendingCell, setPendingCell] = useState<number | null>(null)

  const applyTime = useCallback(
    async (timeSeconds: number, cellIndex: number | null = null) => {
      const player = playerRef.current
      if (disabled || isLoading || !player || player.isDisposed()) return
      setPendingCell(cellIndex)
      setFeedback(null)
      try {
        await setPosterFrame({ speechId, assetId, body: { time_seconds: timeSeconds } }).unwrap()
        setFeedback('Poster updating…')
      } catch {
        setFeedback('Could not update poster.')
      } finally {
        setPendingCell(null)
      }
    },
    [setPosterFrame, speechId, assetId, playerRef, disabled, isLoading],
  )

  const handleUseCurrentFrame = () => {
    const player = playerRef.current
    if (disabled || isLoading || !player || player.isDisposed()) return
    const currentTime = player.currentTime() ?? 0
    void applyTime(currentTime)
  }

  const totalFrames = sprite ? sprite.columns * sprite.rows : 0
  const duration = sprite?.duration_seconds ? Number(sprite.duration_seconds) : null
  const rawCellWidth = sprite?.frame_width ? sprite.frame_width / sprite.columns : null
  const rawCellHeight = sprite?.frame_height ? sprite.frame_height / sprite.rows : null

  // W3: a portrait sprite's cells are tall (~284px for a 1080x1920
  // source, vs. ~90px landscape) — uncapped, that alone can push the
  // Commentary track heading well below the fold even with the player
  // fix applied. Scale the whole strip (image + cell box together, so the
  // background-position math stays pixel-accurate) down to a fixed
  // height budget rather than cropping it.
  const MAX_CELL_HEIGHT = 96
  const scale = rawCellHeight && rawCellHeight > MAX_CELL_HEIGHT ? MAX_CELL_HEIGHT / rawCellHeight : 1
  const cellWidth = rawCellWidth ? rawCellWidth * scale : null
  const cellHeight = rawCellHeight ? rawCellHeight * scale : null

  return (
    <div className="workspace-notebook-surface flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="workspace-notebook-control workspace-notebook-control--secondary" disabled={disabled || isLoading} onClick={handleUseCurrentFrame}>
          {isLoading && pendingCell === null ? 'Updating…' : 'Use current frame'}
        </Button>
        {feedback && <span className="text-xs text-muted-foreground">{feedback}</span>}
      </div>

      {sprite && cellWidth && cellHeight && duration !== null && (
        <div className="flex gap-1 overflow-x-auto pb-1" aria-label="Pick a poster frame">
          {Array.from({ length: totalFrames }, (_, cellIndex) => {
            const col = cellIndex % sprite.columns
            const row = Math.floor(cellIndex / sprite.columns)
            // The backend generates the sprite with ffmpeg's
            // `fps=10/DURATION` filter — 10 frames sampled at
            // t = i * (duration / 10) for i = 0..9 — so a cell's implied
            // timestamp is its index's fraction of the total duration.
            const timeSeconds = (cellIndex / totalFrames) * duration

            return (
              <button
                key={cellIndex}
                type="button"
                disabled={disabled || isLoading}
                onClick={() => void applyTime(timeSeconds, cellIndex)}
                className={cn(
                  'shrink-0 rounded border border-transparent bg-no-repeat hover:border-primary disabled:opacity-50',
                  pendingCell === cellIndex && 'border-primary',
                )}
                style={{
                  width: cellWidth,
                  height: cellHeight,
                  backgroundImage: `url(${sprite.url})`,
                  // Scaled whole-sprite size, derived from the already
                  // scaled+null-checked cell dimensions rather than
                  // `sprite.frame_width`/`frame_height` directly (both
                  // nullable — the `cellWidth && cellHeight` guard above
                  // only narrows the derived locals, not the source
                  // fields).
                  backgroundSize: `${cellWidth * sprite.columns}px ${cellHeight * sprite.rows}px`,
                  backgroundPosition: `-${col * cellWidth}px -${row * cellHeight}px`,
                }}
                aria-label={`Use frame at ${timeSeconds.toFixed(1)}s`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
