import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAcceptedViewer } from '@/features/auth/authSession'
import {
  latestExportDownloadRequestSeq,
  useGetExportDownloadUrlQuery,
  useRequestExportMutation,
} from '@/features/privacy/privacyApi'
import type { DataExport, ExportKind } from '@/features/privacy/types'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'

/** Backend signs the URL for 600s; show it for at most 540s from client request start. */
export const LINK_DISPLAY_WINDOW_MS = 540_000

/**
 * STEP-11-FROZEN-CONTRACT.md §7/§10: one section per export `kind` —
 * `'account'` ("your speeches and the commentary written about you") and
 * `'reviewer_annotations'` (the "download my annotations" reviewer
 * mitigation §11.2 asks for). `latest` is this kind's most recent row from
 * `useExportJob`'s polled list, or `undefined` before the user has ever
 * requested one.
 *
 * The download link only appears once `latest.status === 'ready'` —
 * `getExportDownloadUrl` is skipped otherwise, matching `StatusBadge.tsx`'s
 * status-to-UI convention (badge text follows the row's own `status`
 * field, one `if` per state, not a derived boolean).
 */
export function ExportSection({
  kind,
  title,
  description,
  latest,
}: {
  kind: ExportKind
  title: string
  description: string
  latest: DataExport | undefined
}) {
  const [requestExport, { isLoading: isRequesting }] = useRequestExportMutation()
  const [error, setError] = useState<string | null>(null)
  const viewer = useAcceptedViewer()

  const exportId = latest?.id ?? 0
  const wantsLink = !!viewer && latest?.status === 'ready'
  const presentationKey = `${viewer?.id ?? ''}:${exportId}`

  // Link-presentation generation: the request-start sequence number at the last invalidation.
  // A link is displayable only if its request STARTED after it, so a response in flight when
  // the page blurred/hid or the export/viewer changed can never re-enable the href. The ref
  // is the immediate source (event handlers); state only mirrors it for rendering.
  const invalidatedSeqRef = useRef(0)
  const [invalidatedSeq, setInvalidatedSeq] = useState(0)
  const [nowMs, setNowMs] = useState(() => performance.now())

  const invalidate = useCallback(() => {
    const seq = latestExportDownloadRequestSeq()
    invalidatedSeqRef.current = seq
    setInvalidatedSeq(seq)
    setNowMs(performance.now())
  }, [])

  const previousKey = useRef(presentationKey)
  // Declared BEFORE the query hook so its effect runs first and the new key's request starts after it.
  useEffect(() => {
    if (previousKey.current === presentationKey) return
    previousKey.current = presentationKey
    invalidate()
  }, [presentationKey, invalidate])

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') invalidate()
    }
    window.addEventListener('blur', invalidate)
    window.addEventListener('pagehide', invalidate)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('blur', invalidate)
      window.removeEventListener('pagehide', invalidate)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [invalidate])

  const {
    currentData: link,
    isFetching: isResolvingUrl,
    error: linkError,
    refetch,
  } = useGetExportDownloadUrlQuery(exportId, { skip: !wantsLink })

  const startedAt = link?.requestStartedAtMonotonicMs
  const isCurrentGeneration = !!link && link.requestSeq > invalidatedSeq
  const isFresh = startedAt !== undefined && nowMs - startedAt < LINK_DISPLAY_WINDOW_MS
  const showLink = wantsLink && !!link && !linkError && isCurrentGeneration && isFresh

  // One-shot timer at expiry; no polling. Activation re-checks age too (timers can be throttled).
  useEffect(() => {
    if (!showLink || startedAt === undefined) return
    const remaining = startedAt + LINK_DISPLAY_WINDOW_MS - performance.now()
    const id = setTimeout(() => setNowMs(performance.now()), Math.max(0, remaining))
    return () => clearTimeout(id)
  }, [showLink, startedAt])

  const handleDownloadClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const now = performance.now()
    const usable =
      !!link &&
      link.requestSeq > invalidatedSeqRef.current &&
      now - link.requestStartedAtMonotonicMs < LINK_DISPLAY_WINDOW_MS
    if (!usable) {
      event.preventDefault()
      setNowMs(now)
    }
  }

  const handleRefresh = () => {
    setNowMs(performance.now())
    void refetch()
  }

  const handleRequest = async () => {
    setError(null)
    try {
      await requestExport({ kind }).unwrap()
    } catch (caught) {
      setError(extractServerErrorMessage(caught))
    }
  }

  const isGone = !!linkError && 'status' in linkError && linkError.status === 410

  const isProcessing = latest?.status === 'processing'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid={`export-section-${kind}`}>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={isRequesting || isProcessing} onClick={() => void handleRequest()}>
          {isRequesting ? 'Requesting…' : isProcessing ? 'Preparing…' : 'Request export'}
        </Button>

        {latest?.status === 'processing' && <Badge variant="secondary">Preparing…</Badge>}
        {latest?.status === 'failed' && <Badge variant="destructive">Failed</Badge>}
        {latest?.status === 'ready' && !showLink && isResolvingUrl && <Badge variant="secondary">Getting link…</Badge>}
        {latest?.status === 'ready' && !showLink && !isResolvingUrl && !linkError && !link && (
          <Badge variant="secondary">Ready</Badge>
        )}
        {latest?.status === 'ready' && !showLink && !isResolvingUrl && !linkError && link && (
          <Button type="button" size="sm" variant="outline" onClick={handleRefresh}>
            Refresh download link
          </Button>
        )}
        {latest?.status === 'ready' && !isResolvingUrl && linkError && !isGone && (
          <Button type="button" size="sm" variant="outline" onClick={handleRefresh}>
            Retry
          </Button>
        )}
        {latest?.status === 'ready' && showLink && link && (
          <a
            href={link.url}
            onClick={handleDownloadClick}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            data-testid={`export-download-link-${kind}`}
          >
            Download
          </a>
        )}
      </div>

      {latest?.status === 'ready' && !isResolvingUrl && isGone && (
        <p role="alert" className="text-xs text-destructive">
          This export has expired; a new export is required.
        </p>
      )}
      {latest?.status === 'ready' && !isResolvingUrl && linkError && !isGone && (
        <p role="alert" className="text-xs text-destructive">
          Couldn&apos;t get the download link.
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
