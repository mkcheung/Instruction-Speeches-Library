import { useEffect, useState } from 'react'
import Uppy from '@uppy/core'
import AwsS3 from '@uppy/aws-s3'
import Dashboard from '@uppy/react/dashboard'
import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import { store } from '@/app/store'
import { speechApi } from '@/features/speech/speechApi'
import type { CompletedPart } from '@/features/speech/types'

/**
 * STEP-03-upload-and-watch.md: "Uppy Dashboard with the multipart threshold
 * at ~20 MB." §9.1's four presigned-multipart endpoints back this, via
 * `store.dispatch(speechApi.endpoints.X.initiate(...)).unwrap()` — Uppy's
 * plugin callbacks run outside any component, so they go through the store
 * directly rather than through hooks, but still ride
 * `baseQueryWithCsrfRetry` (CSRF cookie handling, 401 handling) exactly
 * like every other request in this app.
 *
 * Resumability (the demo script's "turn off your wifi at 40%... it
 * resumes") is Uppy's own: `@uppy/aws-s3` retries failed part uploads with
 * backoff, and each part is independently retryable because the backend
 * never invalidates a signed part URL — only `complete`/`abort` end the
 * upload. A page reload mid-upload is NOT resumed here (that would need
 * Uppy's IndexedDB `@uppy/store-default` persistence, a further step); the
 * acceptance item this satisfies is losing and regaining the *network*
 * mid-upload, not the *tab*.
 *
 * Only multipart is implemented — the backend has no single-PUT presign
 * endpoint — so `shouldUseMultipart` is unconditionally `true` regardless
 * of file size. What §9.1's "~20 MB threshold" buys in the reference design
 * (avoiding multipart overhead for small files) is deliberately given up
 * here for one upload code path end to end.
 */
export function UploadDashboard({
  speechId,
  onAssetReady,
}: {
  speechId: number
  onAssetReady: (assetId: number) => void
}) {
  // A plain mutable box, deliberately NOT `useRef` — the Uppy plugin
  // callbacks below are constructed inside this `useState` lazy
  // initializer (i.e. during render), and React's ref-safety lint rule
  // flags any `useRef` value closed over there as "may be read during
  // render." It never actually is (Uppy only invokes these on real upload
  // events), but a plain object sidesteps the rule without fighting it.
  const [pendingAssetId] = useState<{ current: number | null }>(() => ({ current: null }))

  const [uppy] = useState(() =>
    new Uppy({
      restrictions: { maxNumberOfFiles: 1, allowedFileTypes: ['video/*'] },
    }).use(AwsS3, {
      shouldUseMultipart: true,

      async createMultipartUpload(file) {
        const response = await store
          .dispatch(
            speechApi.endpoints.createUpload.initiate({
              speechId,
              body: {
                original_filename: file.name ?? 'upload',
                content_type: file.type ?? 'application/octet-stream',
                byte_size: file.size ?? 0,
              },
            }),
          )
          .unwrap()

        pendingAssetId.current = response.asset.id

        return { uploadId: response.upload_id, key: response.key }
      },

      async signPart(_file, { uploadId, partNumber }) {
        const assetId = pendingAssetId.current
        if (!assetId) throw new Error('No asset for this upload.')

        const response = await store
          .dispatch(speechApi.endpoints.signPart.initiate({ speechId, assetId, uploadId, partNumber }))
          .unwrap()

        return { method: 'PUT', url: response.url }
      },

      async completeMultipartUpload(_file, { uploadId, parts }) {
        const assetId = pendingAssetId.current
        if (!assetId) throw new Error('No asset for this upload.')

        const completedParts: CompletedPart[] = parts.map((part) => ({
          part_number: part.PartNumber ?? 0,
          etag: part.ETag ?? '',
        }))

        const result = await store
          .dispatch(
            speechApi.endpoints.completeUpload.initiate({ speechId, assetId, uploadId, parts: completedParts }),
          )
          .unwrap()

        onAssetReady(result.asset.id)

        return {}
      },

      async abortMultipartUpload(_file, { uploadId }) {
        const assetId = pendingAssetId.current
        if (!assetId || !uploadId) return

        await store.dispatch(speechApi.endpoints.abortUpload.initiate({ speechId, assetId, uploadId })).unwrap()
      },

      // Not used (no resume-after-reload support here — see the doc-block
      // above), but the plugin's type requires it when a companion isn't
      // configured.
      async listParts() {
        return []
      },
    }),
  )

  useEffect(() => () => uppy.destroy(), [uppy])

  return <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} />
}
