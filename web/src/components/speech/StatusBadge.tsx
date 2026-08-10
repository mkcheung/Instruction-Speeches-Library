import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useGetTranscodeDepthQuery, useRetryAssetMutation } from '@/features/speech/speechApi'
import type { Speech } from '@/features/speech/types'

/**
 * STEP-04-every-video-plays.md §9.5's backpressure text — "N videos ahead
 * of yours" / "You're next" — read off the global transcode-queue-depth
 * gauge. Polled at a slow, cheap interval; while the depth query hasn't
 * resolved yet this renders nothing extra so it never blocks the existing
 * "Processing" label.
 */
function QueueDepthHint() {
  const { data, isSuccess } = useGetTranscodeDepthQuery(undefined, { pollingInterval: 5000 })

  if (!isSuccess || !data) return null

  return (
    <span className="text-xs text-muted-foreground">
      {data.depth > 0 ? `${data.depth} video${data.depth === 1 ? '' : 's'} ahead of yours` : "You're next"}
    </span>
  )
}

/**
 * STEP-03-upload-and-watch.md: "'my speeches' with speech-card-status
 * rendering EVERY state including `failed` with a Retry, and a 'v2 of'
 * badge on linked speeches." `data-testid="speech-card-status"` names the
 * component the step doc itself names.
 */
export function StatusBadge({ speech }: { speech: Speech }) {
  const [retry, { isLoading: isRetrying }] = useRetryAssetMutation()
  const asset = speech.primary_video

  if (!asset) {
    // Source uploaded but the video asset hasn't been created yet — the
    // instant between "upload complete" and the transcode-processing row
    // existing. Indistinguishable from "processing" to a speaker.
    return (
      <Badge variant="secondary" data-testid="speech-card-status">
        Processing
      </Badge>
    )
  }

  if (asset.status === 'ready') {
    return (
      <Badge variant="default" data-testid="speech-card-status">
        Ready
      </Badge>
    )
  }

  if (asset.status === 'uploading') {
    return (
      <Badge variant="secondary" data-testid="speech-card-status">
        Uploading
      </Badge>
    )
  }

  if (asset.status === 'processing') {
    return (
      <div className="flex items-center gap-2" data-testid="speech-card-status">
        <Badge variant="secondary">Processing</Badge>
        <QueueDepthHint />
      </div>
    )
  }

  // failed
  return (
    <div className="flex items-center gap-2" data-testid="speech-card-status">
      <Badge variant="destructive">Failed</Badge>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isRetrying}
        onClick={() => retry({ speechId: speech.id, assetId: asset.id })}
      >
        {isRetrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  )
}

/** "v2 of {title}" — only rendered when this speech links to an earlier
 * attempt (§6.11). */
export function SupersedesBadge({ speech }: { speech: Speech }) {
  if (!speech.supersedes) return null

  return (
    <Badge variant="outline" data-testid="supersedes-badge">
      v2 of {speech.supersedes.title}
    </Badge>
  )
}
