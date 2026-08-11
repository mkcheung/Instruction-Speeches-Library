import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type Player from 'video.js/dist/types/player'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { VideoPlayer } from '@/components/speech/VideoPlayer'
import { InviteReviewerDialog } from '@/components/review/InviteReviewerDialog'
import { TrackSelector } from '@/components/review/TrackSelector'
import { useGetSpeechQuery, useLazyGetPlaybackUrlQuery, useSetPosterFrameMutation } from '@/features/speech/speechApi'
import type { SpeechSprite } from '@/features/speech/types'
import { useGetMeQuery } from '@/features/auth/authApi'
import { cn } from '@/lib/utils'

export default function SpeechWatch() {
  const { id } = useParams<{ id: string }>()
  const speechId = Number(id)
  const { data: speech, isLoading } = useGetSpeechQuery(speechId, { skip: !speechId })
  const { data: me } = useGetMeQuery()
  const [fetchPlaybackUrl] = useLazyGetPlaybackUrlQuery()
  const [initialUrl, setInitialUrl] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const playerRef = useRef<Player | null>(null)

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

  if (isLoading || !speech) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const isOwner = !!me?.user && speech.user_id !== undefined && Number(me.user.id) === speech.user_id

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
            <VideoPlayer
              initialUrl={initialUrl}
              refreshUrl={refreshUrl}
              poster={speech.poster?.url}
              onPlayerReady={(player) => {
                playerRef.current = player
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Not ready to play yet.</p>
          )}

          {asset?.status === 'ready' && initialUrl && (
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

      {isOwner && <TrackSelector speechId={speechId} />}
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
  const cellWidth = sprite?.frame_width ? sprite.frame_width / sprite.columns : null
  const cellHeight = sprite?.frame_height ? sprite.frame_height / sprite.rows : null

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
                  backgroundSize: `${sprite.frame_width}px ${sprite.frame_height}px`,
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
