import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type Player from 'video.js/dist/types/player'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs'
import { VideoPlayer } from '@/components/speech/VideoPlayer'
import { InviteReviewerDialog } from '@/components/review/InviteReviewerDialog'
import { TrackSelector } from '@/components/review/TrackSelector'
import { OverlayStack } from '@/components/annotation/OverlayStack'
import { AnnotationComposerPanel } from '@/components/annotation/AnnotationComposerPanel'
import { EssayEditorPanel } from '@/components/essay/EssayEditorPanel'
import { EssayReadOnlyPanel } from '@/components/essay/EssayReadOnlyPanel'
import { getVideoElement } from '@/shared/media/videojs-adapter'
import { useCommentaryTrack } from '@/hooks/useCommentaryTrack'
import { useMyReviewForSpeech } from '@/hooks/useMyReviewForSpeech'
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

export default function SpeechWatch() {
  const { id } = useParams<{ id: string }>()
  const speechId = Number(id)
  const { data: speech, isLoading } = useGetSpeechQuery(speechId, { skip: !speechId })
  const { data: me } = useGetMeQuery()
  const [fetchPlaybackUrl] = useLazyGetPlaybackUrlQuery()
  const [initialUrl, setInitialUrl] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const playerRef = useRef<Player | null>(null)
  // Render-triggering state, deliberately not a bare ref — §8.2: a ref
  // mutation doesn't re-render, so `useTimedAnnotations` (inside
  // `useCommentaryTrack`) would never see the element and would silently
  // never attach.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  // W2/W4: the real ratio, once the browser has decoded metadata — takes
  // priority over the poster-seeded guess below once it arrives.
  const [measuredAr, setMeasuredAr] = useState<number | undefined>(undefined)

  const asset = speech?.primary_video

  const refreshUrl = useCallback(async () => {
    if (!asset) throw new Error('No playable asset.')
    const result = await fetchPlaybackUrl({ speechId, assetId: asset.id }).unwrap()
    return result.url
  }, [fetchPlaybackUrl, speechId, asset])

  useEffect(() => {
    if (asset?.status === 'ready') {
      refreshUrl().then(setInitialUrl).catch(() => setInitialUrl(null))
    }
    // Only re-fetch when the asset identity/status changes — refreshUrl
    // itself handles mid-playback TTL expiry, this effect is just "load
    // the first URL."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, asset?.status])

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

  const isOwner =
    !!me?.user && !!speech && speech.user_id !== undefined && Number(me.user.id) === speech.user_id

  // Called unconditionally (Rules of Hooks) even before `speech` has
  // loaded — `enabled: isOwner` keeps its queries skipped until then.
  const commentary = useCommentaryTrack(speechId, isOwner ? videoEl : null, isOwner)

  // STEP-07: a non-owner who is themselves an access-granting reviewer of
  // this speech gets the authoring composer instead of the owner's
  // read-only TrackSelector — `enabled: !isOwner` keeps this skipped for
  // the owner and for a still-loading `speech`.
  const { review: myReview } = useMyReviewForSpeech(speechId, !isOwner && !!speech)

  if (isLoading || !speech) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>{speech.title}</CardTitle>
            {speech.description && <CardDescription>{speech.description}</CardDescription>}
          </div>
          {isOwner && !inviteOpen && (
            <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
              Invite a reviewer
            </Button>
          )}
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
                initialUrl={initialUrl}
                refreshUrl={refreshUrl}
                poster={speech.poster?.url}
                onPlayerReady={(player) => {
                  playerRef.current = player
                  setVideoEl(getVideoElement(player))
                }}
              />
              {isOwner && (
                <div className="pointer-events-none absolute inset-0 flex flex-col justify-end p-3">
                  <OverlayStack
                    annotations={commentary.annotations}
                    activeIds={commentary.activeIds}
                    currentTime={commentary.currentTime}
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not ready to play yet.</p>
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

      {isOwner && inviteOpen && (
        <InviteReviewerDialog
          speechId={speechId}
          supersedesId={speech.supersedes?.id}
          onClose={() => setInviteOpen(false)}
          onInvited={() => setInviteOpen(false)}
        />
      )}

      {/* STEP-08-FROZEN-CONTRACT.md's tab strip: notes stay adjacent to the
          player (where the timestamp context lives), the essay goes
          underneath in its own panel — the two are used in different
          modes (notes while watching, essay after), so a tab strip rather
          than a stack. */}
      {isOwner && (
        <Tabs defaultValue="notes">
          <TabsList aria-label="Reviewer feedback">
            <TabsTab value="notes">Notes</TabsTab>
            <TabsTab value="essay">Essay</TabsTab>
          </TabsList>
          <TabsPanel value="notes">
            <TrackSelector
              options={commentary.options}
              optionsLoading={commentary.optionsLoading}
              selected={commentary.selected}
              onSelect={commentary.select}
              onPrefetch={commentary.prefetch}
              error={commentary.error}
              isFetching={commentary.isFetching}
              fetchedReviewerName={commentary.fetchedReviewerName}
              annotations={commentary.annotations}
              activeIds={commentary.activeIds}
              currentTime={commentary.currentTime}
              onSeek={commentary.seek}
            />
          </TabsPanel>
          <TabsPanel value="essay">
            <EssayReadOnlyPanel
              speechId={speechId}
              reviewId={typeof commentary.selected === 'number' ? commentary.selected : null}
              reviewerName={commentary.options.find((o) => o.key === commentary.selected)?.label}
            />
          </TabsPanel>
        </Tabs>
      )}

      {!isOwner && myReview && asset?.status === 'ready' && initialUrl && (
        <Tabs defaultValue="notes">
          <TabsList aria-label="Your feedback">
            <TabsTab value="notes">Notes</TabsTab>
            <TabsTab value="essay">Essay</TabsTab>
          </TabsList>
          <TabsPanel value="notes">
            <AnnotationComposerPanel
              speechId={speechId}
              review={myReview}
              videoEl={videoEl}
              durationSeconds={
                asset.duration_seconds !== null ? Number(asset.duration_seconds) : (videoEl?.duration ?? 0)
              }
              userId={me?.user.id}
              onSeek={(seconds) => {
                if (videoEl) seekVideo(videoEl, seconds)
              }}
            />
          </TabsPanel>
          <TabsPanel value="essay">
            <EssayEditorPanel speechId={speechId} review={myReview} />
          </TabsPanel>
        </Tabs>
      )}
    </div>
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={isLoading} onClick={handleUseCurrentFrame}>
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
