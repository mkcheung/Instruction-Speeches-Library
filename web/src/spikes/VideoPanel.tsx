import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { API_URL } from '@/lib/api'

const DEFAULT_OBJECT_KEY = 'spikes/sample.mp4'

type PresignState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; url: string }
  | { status: 'error'; message: string }

interface VideoPanelProps {
  /** Hands the live `<video>` element up to the cue-timing panel. */
  onVideoElement: (el: HTMLVideoElement | null) => void
}

/**
 * Panel (b): video + scrub harness.
 *
 * Fetches a presigned GET URL from the backend's spike presign endpoint for
 * a configurable object key and points a real `<video controls>` at it.
 * This is a human-driven harness — verifying Range/seek behavior requires
 * an actual browser and an actual object in SeaweedFS, neither of which
 * exist in this environment. The code path is exercised end to end; the
 * playback/seek result itself is not (and cannot be) asserted here.
 */
export default function VideoPanel({ onVideoElement }: VideoPanelProps) {
  const [objectKey, setObjectKey] = useState(DEFAULT_OBJECT_KEY)
  const [presign, setPresign] = useState<PresignState>({ status: 'idle' })

  const reload = useCallback(async () => {
    setPresign({ status: 'loading' })
    try {
      const res = await fetch(
        `${API_URL}/api/spikes/presign?path=${encodeURIComponent(objectKey)}`,
        { credentials: 'include' },
      )
      if (!res.ok) {
        setPresign({ status: 'error', message: `HTTP ${res.status}` })
        return
      }
      const body = (await res.json()) as { url?: string }
      if (!body.url) {
        setPresign({ status: 'error', message: 'response had no `url` field' })
        return
      }
      setPresign({ status: 'ok', url: body.url })
    } catch (err) {
      setPresign({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [objectKey])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Video + scrub harness</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="object-key" className="text-sm text-muted-foreground">
            Object key
          </label>
          <input
            id="object-key"
            className="min-w-64 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            value={objectKey}
            onChange={(e) => setObjectKey(e.target.value)}
          />
          <Button type="button" onClick={() => void reload()}>
            Reload presigned URL
          </Button>
        </div>

        {presign.status === 'error' && (
          <p className="text-sm text-[var(--color-danger)]">
            {presign.message}
          </p>
        )}

        <video
          ref={onVideoElement}
          controls
          playsInline
          className="w-full rounded-md border bg-black"
          src={presign.status === 'ok' ? presign.url : undefined}
        >
          Your browser does not support the video tag.
        </video>

        <p className="text-xs text-muted-foreground break-all">
          GET {API_URL}/api/spikes/presign?path={objectKey}
          {presign.status === 'ok' && (
            <>
              {' '}
              → <code>{presign.url}</code>
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Manual verification only: drag the scrubber in a real browser and
          confirm it seeks (proves `Range` requests work end to end). This
          cannot be automated or asserted from this environment.
        </p>
      </CardContent>
    </Card>
  )
}
