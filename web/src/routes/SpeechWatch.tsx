import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type Player from 'video.js/dist/types/player'
import { NotebookPage } from '@/components/workspace/NotebookPage'
import { ActivityScene } from '@/components/workspace/ActivityScene'
import { usePublishWorkspaceCompanion } from '@/components/workspace/useWorkspaceCompanion'
import type { WorkspaceSceneId } from '@/components/workspace/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs'
import { VideoPlayer } from '@/components/speech/VideoPlayer'
import { InviteReviewerPanel } from '@/components/review/InviteReviewerPanel'
import { ReviewerRoster } from '@/components/review/ReviewerRoster'
import { TrackSelector } from '@/components/review/TrackSelector'
import { CommentaryPlaybackControls, VoicePlaybackControls } from '@/components/review/CommentaryPlaybackControls'
import { OverlayStack } from '@/components/annotation/OverlayStack'
import { AnnotationComposerPanel } from '@/components/annotation/AnnotationComposerPanel'
import { VoiceNoteMarkers } from '@/components/annotation/VoiceNoteMarkers'
import { useCaptionsAnchor } from '@/components/annotation/captionsAnchor'
import { EssayEditorPanel } from '@/components/essay/EssayEditorPanel'
import { EssayReadOnlyPanel } from '@/components/essay/EssayReadOnlyPanel'
import { EssayReviewerPicker } from '@/components/essay/EssayReviewerPicker'
import { CaptionEditor } from '@/components/caption/CaptionEditor'
import { TranscriptPanel } from '@/components/caption/TranscriptPanel'
import { CaptionsToggle } from '@/components/caption/CaptionsToggle'
import { CaptionSettingsToggle } from '@/components/caption/CaptionSettingsToggle'
import { ReportDialog } from '@/components/report/ReportDialog'
import { getErrorStatus } from '@/lib/errorStatus'
import { getVideoElement, getCaptionsTrack, setCaptionsTrack } from '@/shared/media/videojs-adapter'
import { useCommentaryTrack } from '@/hooks/useCommentaryTrack'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { canRecordVoiceForRoles } from '@/lib/voiceRoles'
import { useMyReviewForSpeech } from '@/hooks/useMyReviewForSpeech'
import { useCaptionsJob, useCaptionsBlobUrl } from '@/hooks/useCaptionsJob'
import { useGetSpeechQuery, useLazyGetPlaybackUrlQuery, useSetPosterFrameMutation } from '@/features/speech/speechApi'
import type { SpeechSprite } from '@/features/speech/types'
import { useGetMeQuery } from '@/features/auth/authApi'
import { cn } from '@/lib/utils'


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

type PlaybackSource = {
  key: string
  speechId: number
  assetId: number
  url: string
  generation: number
}

type ReadyPlayback = {
  source: PlaybackSource
  player: Player
  video: HTMLVideoElement
}

type PreviewRegistration = { identity: string; node: HTMLDivElement; token: symbol }

export default function SpeechWatch() {
  const { id } = useParams<{ id: string }>()
  const speechId = Number(id)
  const { data: speech, isLoading, error } = useGetSpeechQuery(speechId, { skip: !speechId })
  const { data: me } = useGetMeQuery()
  const [fetchPlaybackUrl] = useLazyGetPlaybackUrlQuery()
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource | null>(null)
  const initialUrl = playbackSource?.url ?? null
  const [readyPlayback, setReadyPlayback] = useState<ReadyPlayback | null>(null)
  const [previewRegistration, setPreviewRegistration] = useState<PreviewRegistration | null>(null)
  const playerRef = useRef<Player | null>(null)
  // Render-triggering state, deliberately not a bare ref — §8.2: a ref
  // mutation doesn't re-render, so `useTimedAnnotations` (inside
  // `useCommentaryTrack`) would never see the element and would silently
  // never attach.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  // W2/W4: the real ratio, once the browser has decoded metadata — takes
  // priority over the poster-seeded guess below once it arrives.
  const [measuredAr, setMeasuredAr] = useState<number | undefined>(undefined)
  // STEP-09: the real native `TextTrack` once `setCaptionsTrack` has
  // attached one — `null` until both the player is ready AND a caption
  // job has produced VTT text. Render-triggering state (not a ref, same
  // reasoning as `videoEl` above) — `useCaptionsAnchor`/`CaptionsToggle`
  // both need a re-render when this changes.
  const [captionsTrack, setCaptionsTrackState] = useState<TextTrack | null>(null)
  // Bumped by `VideoPlayer`'s `onSourceRefreshed` every time the
  // error-driven signed-URL refresh (§9.3) actually reloads the video —
  // video.js strips remote text tracks (including captions) on every
  // `src` reassignment, and nothing else about that refresh is visible to
  // React (it's entirely internal to `videojs-adapter.ts`'s error
  // handler). Included in the caption-attach effect's own deps below so
  // that effect re-runs and re-adds the caption track after every refresh,
  // not just after the initial job completion or an edit.
  const [sourceRefreshToken, setSourceRefreshToken] = useState(0)
  const [ownerTab, setOwnerTab] = useState('notes')
  const [reviewerTab, setReviewerTab] = useState('notes')
  const [htmlFullscreen, setHtmlFullscreen] = useState(false)
  const [fullscreenControlsOpen, setFullscreenControlsOpen] = useState(false)

  const asset = speech?.primary_video

  // A retained RTK result is useful for stable rendering, but cannot identify
  // a new playback request while the route is resolving a different speech.
  const currentSpeech = Number.isSafeInteger(speechId) && speechId > 0 &&
    !isLoading && !error && !!speech && Number(speech.id) === speechId
  const requestSpeechId = currentSpeech && asset?.status === 'ready' ? speechId : null
  const requestAssetId = requestSpeechId !== null ? asset!.id : null

  useEffect(() => {
    if (requestSpeechId === null || requestAssetId === null) return
    let cancelled = false
    const key = `${requestSpeechId}:${requestAssetId}`
    fetchPlaybackUrl({ speechId: requestSpeechId, assetId: requestAssetId }).unwrap()
      .then(({ url }) => {
        if (cancelled) return
        setPlaybackSource((previous) => previous?.key === key && previous.url === url
          ? previous
          : { key, speechId: requestSpeechId, assetId: requestAssetId, url,
            generation: (previous?.generation ?? 0) + 1 })
      })
      .catch(() => {
        if (cancelled) return
        // A same-source refresh retains its mounted editor. A genuinely new
        // source's initial failure returns to the existing not-ready surface.
        setPlaybackSource((previous) => previous?.key === key ? previous : null)
      })
    return () => { cancelled = true }
  }, [fetchPlaybackUrl, requestSpeechId, requestAssetId])

  // VideoPlayer keeps the latest callback for refreshes. Bind that callback
  // to the source actually rendered, including when A is retained on route B.
  const refreshUrl = useCallback(async () => {
    if (!playbackSource) throw new Error('No playable asset.')
    const result = await fetchPlaybackUrl({
      speechId: playbackSource.speechId, assetId: playbackSource.assetId,
    }).unwrap()
    return result.url
  }, [fetchPlaybackUrl, playbackSource])

  const onPlayerReady = useCallback((player: Player) => {
    if (!playbackSource || player.isDisposed()) return
    const video = getVideoElement(player)
    if (!video) return
    playerRef.current = player
    setVideoEl(video)
    setReadyPlayback({ source: playbackSource, player, video })
  }, [playbackSource])

  // W2/W4: `videoEl` is a real `<video>` element (`getVideoElement`) — its
  // own `loadedmetadata` gives the true, display-correct ratio (autorotate
  // already applied by the browser), so this listens directly rather than
  // going through video.js's player events.
  useEffect(() => {
    if (!videoEl) return
    const updateFromElement = () => {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        setMeasuredAr(videoEl.videoWidth / videoEl.videoHeight)
      }
    }
    // Covers the case where metadata is already loaded by the time this
    // effect attaches (e.g. a cached video), not just the future event.
    updateFromElement()
    videoEl.addEventListener('loadedmetadata', updateFromElement)
    return () => videoEl.removeEventListener('loadedmetadata', updateFromElement)
  }, [videoEl])

  // W2's mandatory fallback chain: measured ratio (post-`loadedmetadata`)
  // -> poster's persisted dimensions (display-correct, W4) -> the video
  // asset's own persisted, rotation-corrected dimensions (W4 "Source 2",
  // for the posterless case) -> 16/9. Never leave `--video-ar` unset — an
  // unset custom property makes the width `calc()` invalid, `width` falls
  // back to `auto`, and `margin-inline: auto` then collapses the box to
  // 0x0 in every engine (measured).
  const posterAr =
    speech?.poster && speech.poster.width > 0 && speech.poster.height > 0
      ? speech.poster.width / speech.poster.height
      : undefined
  const assetAr = asset && asset.width && asset.height ? asset.width / asset.height : undefined
  const videoAr = measuredAr ?? posterAr ?? assetAr ?? 16 / 9

  // STEP-09-captions.md's acceptance list: the video reaches `ready`
  // before the caption job finishes, so this is gated on the VIDEO
  // asset's own readiness, not on anything caption-specific — a speech
  // with no captions yet (or ever) still plays fine, this hook just never
  // finds anything to attach.
  const { captions } = useCaptionsJob(speechId, asset?.status === 'ready')
  const captionsBlobUrl = useCaptionsBlobUrl(
    captions?.status === 'ready' && captions.vtt ? captions.vtt : undefined,
  )

  // Attaches/replaces the native `<track kind="captions">` once the
  // player exists (`videoEl` only becomes non-null once `player.ready()`
  // has fired — see `onPlayerReady` below) and whenever a fresh caption
  // URL shows up (job completes, or a caption edit re-derives the VTT and
  // this effect's `captionsBlobUrl` dependency changes). Deliberately does
  // NOT recreate the whole player (unlike the `initialUrl`-keyed effect
  // that builds it) — captions attach onto the existing player instance.
  useEffect(() => {
    const player = playerRef.current
    // The previous ready binding can outlive source disposal until the new
    // player's deferred ready callback supplies its concrete video element.
    if (!player || !videoEl || player.isDisposed() || getVideoElement(player) !== videoEl) return
    setCaptionsTrack(player, captionsBlobUrl ? { src: captionsBlobUrl, label: 'English' } : null)
    setCaptionsTrackState(getCaptionsTrack(player))
    // `sourceRefreshToken` is otherwise unread here — its only job is to
    // force this effect to re-run (and thus re-add the caption track)
    // after a signed-URL refresh strips it, per the comment on its
    // declaration above.
  }, [videoEl, captionsBlobUrl, sourceRefreshToken])

  // §8.6/STEP-09's "Deliberately stubbed" hook, live for the first time:
  // anchors the annotation overlay to the top whenever captions are
  // showing, so native bottom-centre captions and the overlay never
  // collide.
  const captionsAnchor = useCaptionsAnchor(captionsTrack)

  const isOwner =
    !!me?.user && !!speech && speech.user_id !== undefined && Number(me.user.id) === speech.user_id
  const roles = me?.user.roles ?? []
  const canRecordVoice = canRecordVoiceForRoles(roles)

  // Called unconditionally (Rules of Hooks) even before `speech` has
  // loaded — `enabled: isOwner` keeps its queries skipped until then.
  const commentary = useCommentaryTrack(speechId, isOwner ? videoEl : null, isOwner, me?.user.id,
    htmlFullscreen ? fullscreenControlsOpen : ownerTab === 'notes')
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
    visible: htmlFullscreen ? fullscreenControlsOpen : ownerTab === 'notes',
  }

  // STEP-07: a non-owner who is themselves an access-granting reviewer of
  // this speech gets the authoring composer instead of the owner's
  // read-only TrackSelector — `enabled: !isOwner` keeps this skipped for
  // the owner and for a still-loading `speech`.
  const { review: myReview } = useMyReviewForSpeech(speechId, !isOwner && !!speech)

  // RTK Query can retain A during navigation to B. The new preview needs
  // the current route, resolved source generation and actual ready tech to
  // agree before a reviewer target can be published.
  const sourceMatches = currentSpeech && asset?.status === 'ready' &&
    playbackSource?.speechId === speechId && playbackSource.assetId === asset.id
  // State records provenance; concrete player/tech checks also reject a ready
  // binding left behind after VideoPlayer disposes/recreates its source.
  const sourceReady = sourceMatches && readyPlayback?.source.key === playbackSource?.key &&
    readyPlayback?.source.generation === playbackSource?.generation &&
    !readyPlayback.player.isDisposed() && getVideoElement(readyPlayback.player) === readyPlayback.video
  const previewIdentity = sourceReady && me?.user && !isOwner && myReview &&
    myReview.speech?.id === speechId && myReview.revoked_at === null &&
    ['accepted', 'in_progress', 'published'].includes(myReview.status)
    ? `${me.user.id}:${speechId}:${asset!.id}:${myReview.id}` : null
  const registerPreviewTarget = useCallback((node: HTMLDivElement | null) => {
    if (!node || !previewIdentity) return
    const registration = { identity: previewIdentity, node, token: Symbol('reviewer preview') }
    setPreviewRegistration(registration)
    // React 19 runs this exact registration's cleanup. An older cleanup
    // cannot clear its replacement, even within the same preview identity.
    return () => setPreviewRegistration((current) =>
      current?.token === registration.token && current.node === node ? null : current)
  }, [previewIdentity])
  const previewTarget = previewIdentity && previewRegistration?.identity === previewIdentity
    ? previewRegistration.node : null

  const feedbackVisible = isOwner || (!!myReview && asset?.status === 'ready' && !!initialUrl)
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
    onSeek: isOwner ? commentary.seek : (seconds: number) => {
      if (videoEl) seekVideo(videoEl, seconds)
    },
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
          {asset?.status === 'ready' && initialUrl ? (
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
                initialUrl={initialUrl}
                refreshUrl={refreshUrl}
                poster={speech.poster?.url}
                onPlayerReady={onPlayerReady}
                onSourceRefreshed={() => setSourceRefreshToken((token) => token + 1)}
                onHtmlFullscreenChange={(fullscreen) => {
                  setHtmlFullscreen(fullscreen)
                  if (!fullscreen) setFullscreenControlsOpen(false)
                }}
                presentation={isOwner ? (
                <>
                  <div className="owner-feedback-frame" style={{ '--video-ar': videoAr } as React.CSSProperties}>
                    <OverlayPositioner anchor={captionsAnchor}>
                    <OverlayStack
                      annotations={commentary.overlayAnnotations}
                      activeIds={commentary.overlayActiveIds}
                      priorityId={commentary.overlayVoiceId}
                      currentTime={commentary.currentTime}
                      anchor={captionsAnchor}
                    />
                    </OverlayPositioner>
                  </div>
                  <VoiceNoteMarkers
                    annotations={commentary.markerAnnotations}
                    durationSeconds={asset.duration_seconds === null ? (videoEl?.duration ?? 0) : Number(asset.duration_seconds)}
                  />
                  {htmlFullscreen && (commentary.voicePlayback.current || commentary.voicePlayback.hint || commentary.voicePlayback.error) && (
                    <div className="pointer-events-auto absolute bottom-12 left-3 z-30 max-w-[min(360px,calc(100%-24px))] rounded-lg border bg-background p-2 text-foreground shadow-lg"
                      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
                        if (event.key === 'Escape') commentary.voicePlayback.skip()
                        event.stopPropagation()
                      }}>
                      <VoicePlaybackControls playback={commentary.voicePlayback} />
                    </div>
                  )}
                  {htmlFullscreen && <details className="pointer-events-auto absolute right-3 top-3 z-30 max-h-[60vh] w-[min(360px,calc(100%-24px))] overflow-y-auto rounded-lg border bg-background p-3 text-foreground shadow-lg"
                    open={fullscreenControlsOpen} onToggle={(event) => setFullscreenControlsOpen(event.currentTarget.open)}
                    onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
                        if (event.key === 'Escape') commentary.voicePlayback.skip()
                        event.stopPropagation()
                      }}>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Commentary controls</summary>
                    <CommentaryPlaybackControls {...playbackControlProps} showVoiceControls={false} />
                  </details>}
                </>
                ) : previewIdentity ? (
                  <div className="owner-feedback-frame" style={{ '--video-ar': videoAr } as React.CSSProperties}>
                    <OverlayPositioner anchor={captionsAnchor}>
                      <div data-testid="reviewer-preview-target" className="pointer-events-none" ref={registerPreviewTarget} />
                    </OverlayPositioner>
                  </div>
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
          {asset?.status === 'ready' && initialUrl && (
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
          {isOwner && asset?.status === 'ready' && initialUrl && (
            <PosterFramePicker speechId={speechId} assetId={asset.id} playerRef={playerRef} sprite={speech.sprite} />
          )}
        </CardContent>
      </Card>

      {/* STEP-08-FROZEN-CONTRACT.md's tab strip: notes stay adjacent to the
          player (where the timestamp context lives), the essay goes
          underneath in its own panel — the two are used in different
          modes (notes while watching, essay after), so a tab strip rather
          than a stack. */}
      {isOwner && (
        <Tabs className="workspace-notebook-surface" value={ownerTab} onValueChange={(value) => setOwnerTab(String(value))}>
          {/* `flex-wrap max-w-full`, not bare `flex-wrap`: the list is
              `inline-flex w-fit` (components/ui/tabs.tsx), i.e. sized to
              max-content, so without a cap it has no reason to wrap and a
              fourth tab would simply overflow a narrow phone. */}
          <TabsList aria-label="Speech tools" className="flex-wrap max-w-full">
            <TabsTab value="notes">Notes</TabsTab>
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
            <div className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-reading">
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
              reviewerName={commentary.options.find((o) => o.key === commentary.selected)?.label}
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
            <div className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-reading">
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
              onSeek={(seconds) => {
                if (videoEl) seekVideo(videoEl, seconds)
              }}
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
      )}

      {!isOwner && myReview && asset?.status === 'ready' && initialUrl && (
        <Tabs className="workspace-notebook-surface" value={reviewerTab} onValueChange={(value) => setReviewerTab(String(value))}>
          <TabsList aria-label="Your feedback">
            <TabsTab value="notes">Notes</TabsTab>
            <TabsTab value="essay">Essay</TabsTab>
            <TabsTab value="transcript">Transcript</TabsTab>
          </TabsList>
          {/* `keepMounted`: §7.7.1 of IMPLEMENTATION-PLANS.md — DECIDED:
              `AnnotationList` (inside `AnnotationComposerPanel` below) is
              the coach-side AUTHORITATIVE ACCESSIBLE SURFACE for this
              authoring screen (§8.6's "always available, <ol>,
              chronological, timecoded, aria-current, click-to-seek" list),
              not a gap where a second `Transcript` instance belongs —
              `Transcript.tsx`'s own `<ol aria-label="Commentary
              transcript">` is the SPEAKER-side surface (mounted above via
              `TrackSelector`, owner-only) and intentionally has no
              coach-side counterpart; rendering one here would duplicate
              the coach's own notes into two lists on one screen and create
              a Playwright strict-mode `aria-label` collision. Without
              `keepMounted`, Base UI's default `TabsPanel` behaviour
              unmounts this panel — and `AnnotationList` with it — the
              instant the reviewer switches to Essay or Transcript, which
              is what made the surface fail §8.6's "always available"
              property until this was added. */}
          <TabsPanel value="notes" keepMounted>
            <AnnotationComposerPanel
              speechId={speechId}
              review={myReview}
              previewTarget={previewTarget}
              previewEnabled={reviewerTab === 'notes' && !!previewIdentity}
              previewAnchor={captionsAnchor}
              videoEl={videoEl}
              durationSeconds={
                asset.duration_seconds !== null ? Number(asset.duration_seconds) : 0
              }
              userId={me?.user.id}
              canRecordVoice={canRecordVoice}
              onSeek={(seconds) => {
                if (videoEl) seekVideo(videoEl, seconds)
              }}
            />
          </TabsPanel>
          <TabsPanel value="essay">
            <EssayEditorPanel speechId={speechId} review={myReview} />
          </TabsPanel>
          {/* Read-only for a reviewer — `readCaptions` grants read access
              same as the speech itself (§1), but `updateCaptions` stays
              owner-only, so no `CaptionEditor` here. */}
          <TabsPanel value="transcript">
            <div className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-reading">
            <TranscriptPanel
              speechId={speechId}
              onSeek={(seconds) => {
                if (videoEl) seekVideo(videoEl, seconds)
              }}
            />
            </div>
          </TabsPanel>
        </Tabs>
      )}
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
}: {
  speechId: number
  assetId: number
  playerRef: React.RefObject<Player | null>
  sprite?: SpeechSprite
}) {
  const [setPosterFrame, { isLoading }] = useSetPosterFrameMutation()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [pendingCell, setPendingCell] = useState<number | null>(null)

  const applyTime = useCallback(
    async (timeSeconds: number, cellIndex: number | null = null) => {
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
    [setPosterFrame, speechId, assetId],
  )

  const handleUseCurrentFrame = () => {
    const player = playerRef.current
    if (!player) return
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
        <Button type="button" size="sm" variant="outline" className="workspace-notebook-control workspace-notebook-control--secondary" disabled={isLoading} onClick={handleUseCurrentFrame}>
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
                disabled={isLoading}
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
