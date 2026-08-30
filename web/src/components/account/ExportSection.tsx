import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useGetExportDownloadUrlQuery, useRequestExportMutation } from '@/features/privacy/privacyApi'
import type { DataExport, ExportKind } from '@/features/privacy/types'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'

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

  const { data: downloadUrl, isFetching: isResolvingUrl } = useGetExportDownloadUrlQuery(latest?.id ?? 0, {
    skip: !latest || latest.status !== 'ready',
  })

  const handleRequest = async () => {
    setError(null)
    try {
      await requestExport({ kind }).unwrap()
    } catch (caught) {
      setError(extractServerErrorMessage(caught))
    }
  }

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
        {latest?.status === 'ready' && !downloadUrl && (
          <Badge variant="secondary">{isResolvingUrl ? 'Getting link…' : 'Ready'}</Badge>
        )}
        {latest?.status === 'ready' && downloadUrl && (
          <a
            href={downloadUrl}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            data-testid={`export-download-link-${kind}`}
          >
            Download
          </a>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
