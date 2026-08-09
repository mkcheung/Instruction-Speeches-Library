import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { VideoPlayer } from '@/components/speech/VideoPlayer'
import { useGetSpeechQuery, useLazyGetPlaybackUrlQuery } from '@/features/speech/speechApi'

export default function SpeechWatch() {
  const { id } = useParams<{ id: string }>()
  const speechId = Number(id)
  const { data: speech, isLoading } = useGetSpeechQuery(speechId, { skip: !speechId })
  const [fetchPlaybackUrl] = useLazyGetPlaybackUrlQuery()
  const [initialUrl, setInitialUrl] = useState<string | null>(null)

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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>{speech.title}</CardTitle>
          {speech.description && <CardDescription>{speech.description}</CardDescription>}
        </CardHeader>
        <CardContent>
          {asset?.status === 'ready' && initialUrl ? (
            <VideoPlayer initialUrl={initialUrl} refreshUrl={refreshUrl} />
          ) : (
            <p className="text-sm text-muted-foreground">Not ready to play yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
