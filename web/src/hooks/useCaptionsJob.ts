import { useEffect, useState } from 'react'
import { useGetCaptionsQuery } from '@/features/caption/captionApi'
import type { Captions } from '@/features/caption/types'

/**
 * STEP-09-captions.md's acceptance list: "A speech from step 04 gains
 * captions without delaying its playback readiness — measured: the video
 * reaches `ready` before the caption job finishes" and "the `CC` button
 * lights up" once it does. This hook polls `captionApi`'s `getCaptions`
 * while the job is still in flight (`uploading`/`processing`) and stops
 * once it lands on a terminal state (`ready`/`failed`/`unavailable` — the
 * last one is what `CaptionController::show` synthesizes when no captions
 * asset row exists at all, e.g. captions were off at upload time; there is
 * nothing to ever transition away from there, so polling forever would
 * just be a leak) — never polls
 * before `enabled` (the caller gates that on the video asset itself being
 * `ready`, so this never fires ahead of a speech that has no video yet
 * either).
 *
 * `pollingInterval` is adjusted with the "adjusting state when a prop
 * changes" pattern (react.dev/learn/you-might-not-need-an-effect) —
 * computed and conditionally set DURING render, not inside a `useEffect`
 * whose entire body would otherwise just be a derived `setState` with no
 * actual external-system interaction (the lint this repo runs flags
 * exactly that shape).
 */
export function useCaptionsJob(speechId: number, enabled: boolean) {
  const [pollingInterval, setPollingInterval] = useState(4000)

  const { data, isFetching, refetch } = useGetCaptionsQuery(
    { speechId },
    { skip: !enabled, pollingInterval: enabled ? pollingInterval : 0 },
  )

  const desiredPollingInterval =
    data && (data.status === 'ready' || data.status === 'failed' || data.status === 'unavailable')
      ? 0
      : 4000
  if (enabled && desiredPollingInterval !== pollingInterval) {
    setPollingInterval(desiredPollingInterval)
  }

  return { captions: data as Captions | undefined, isFetching, refetch }
}

/**
 * A `<track>` needs a URL, not inline text, and §4 of the frozen contract
 * gives `getCaptions` no separate presigned-URL route the way video/poster
 * assets get (`speechApi.ts`'s `getPlaybackUrl`) — only the enveloped VTT
 * text itself. Rather than assume an undocumented presigned-URL endpoint
 * for the `captions` asset, this builds a same-origin `Blob` URL from the
 * text already fetched over the authenticated JSON API, which is both
 * simpler and stays entirely within what the contract actually specifies.
 * Flagged in the STEP-09 report as a judgment call to revisit if the real
 * backend turns out to serve captions as a presigned file URL instead.
 */
export function useCaptionsBlobUrl(vtt: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)

  // Guarded to a no-op (no `setState`) when `vtt` is falsy — the exposed
  // value is derived at the `return` below instead, so this effect's body
  // is ALWAYS real external-system work (creating/revoking a `Blob` URL),
  // never a bare derived-state assignment.
  useEffect(() => {
    if (!vtt) return
    const blob = new Blob([vtt], { type: 'text/vtt' })
    const objectUrl = URL.createObjectURL(blob)
    // `setUrl` nested in its own callback (mirroring `SpeechWatch.tsx`'s
    // `updateFromElement` shape) rather than a bare top-level call in the
    // effect body — invoked synchronously here, once, right after the
    // `Blob` URL is created.
    const applyUrl = () => setUrl(objectUrl)
    applyUrl()
    return () => URL.revokeObjectURL(objectUrl)
  }, [vtt])

  return vtt ? url : undefined
}
