import { useEffect, useRef, useState } from 'react'
import Uppy from '@uppy/core'
import AwsS3 from '@uppy/aws-s3'
import Dashboard from '@uppy/react/dashboard'
import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import { store } from '@/app/store'
import { speechApi } from '@/features/speech/speechApi'
import type { CompletedPart } from '@/features/speech/types'
import { useGetMeQuery } from '@/features/auth/authApi'
import { QuotaMeter } from '@/components/account/QuotaMeter'
import { ToastProvider, Toaster, useToastManager } from '@/components/ui/toast'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'
import { formatBytes } from '@/lib/formatBytes'

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
 *
 * The Uppy instance is created AND destroyed inside the same `useEffect`
 * (not `useState`-lazy-init + a separate destroy-on-cleanup effect). That
 * split is a real, easy-to-hit bug, not a style preference: under
 * `<StrictMode>` (main.tsx — dev only, never production), React
 * mounts→cleans up→remounts every effect once as a bug-detection pass. A
 * `useState`-created singleton survives that remount (state persists), but
 * a `useEffect` cleanup that calls `uppy.destroy()` fires on the FIRST,
 * throwaway unmount too — tearing down the one-and-only Uppy instance the
 * still-live `<Dashboard>` is wired to, which is exactly why the dashboard
 * rendered as an empty, unresponsive box the first time this was tried in
 * dev. Creating fresh inside the effect means StrictMode's extra
 * mount/destroy cycle produces a second, equally valid instance instead of
 * corrupting the first one.
 *
 * §7.8 adds a quota meter above the Dashboard, a pre-flight client-side
 * size check (via `onBeforeFileAdded` — the only Uppy hook that can veto a
 * file before it's added to the upload queue, let alone before
 * `createMultipartUpload` ever dispatches; `restrictions.maxFileSize`
 * would also reject it but can't show OUR "you have N left" message, only
 * a fixed one), and surfacing of the server's own 422 message when the
 * pre-flight check passes but the atomic backend check still rejects (a
 * stale `/api/me` snapshot, or the concurrent-uploads cap, which has no
 * client-observable signal at all). No `ToastProvider` wraps this
 * component from above (`SpeechCreate.tsx` renders it directly), so it
 * provides its own — same split-component pattern as
 * `AnnotationComposerPanel.tsx`.
 */
export function UploadDashboard(props: { speechId: number; onAssetReady: (assetId: number) => void }) {
  return (
    <ToastProvider>
      <UploadDashboardInner {...props} />
      <Toaster />
    </ToastProvider>
  )
}

function UploadDashboardInner({
  speechId,
  onAssetReady,
}: {
  speechId: number
  onAssetReady: (assetId: number) => void
}) {
  const [uppy, setUppy] = useState<Uppy | null>(null)
  const { data: me } = useGetMeQuery()
  const toastManager = useToastManager()

  // Read the latest `onAssetReady` from inside the effect without making
  // it a dependency — the parent passes a fresh closure every render, and
  // depending on it would tear down and recreate the upload (and any
  // in-progress file selection) on every keystroke elsewhere on the page.
  const onAssetReadyRef = useRef(onAssetReady)
  useEffect(() => {
    onAssetReadyRef.current = onAssetReady
  })

  // Same pattern: the Uppy setup effect only re-runs on `[speechId]`, but
  // the pre-flight check and the 422 toast both need the LATEST quota
  // snapshot / toast manager at the moment a file is added or an upload
  // fails — not a value closed over at effect-creation time. `useGetMeQuery()`'s
  // cached data updates reactively on every render, so reading it through a
  // ref kept current here (rather than depending on it in the effect below)
  // is what makes the pre-flight check see a snapshot refreshed by another
  // tab or a just-finished upload, without tearing down the Uppy instance
  // (and any in-progress file selection) every time `/api/me` refetches.
  // `null` means "no snapshot yet" (the query hasn't resolved, or failed) —
  // deliberately distinct from a real 0/0 reading, which would otherwise
  // make the pre-flight check below treat "we don't know the quota" the
  // same as "the quota is exhausted" and reject a file during the brief
  // window before `/api/me` first resolves on page load.
  const quotaRef = useRef<{ usedBytes: number; quotaBytes: number } | null>(
    me ? { usedBytes: me.user.storage_bytes_used, quotaBytes: me.user.quota_bytes } : null,
  )
  useEffect(() => {
    quotaRef.current = me ? { usedBytes: me.user.storage_bytes_used, quotaBytes: me.user.quota_bytes } : null
  })

  const toastManagerRef = useRef(toastManager)
  useEffect(() => {
    toastManagerRef.current = toastManager
  })

  useEffect(() => {
    // A plain mutable box, deliberately NOT `useRef` — closed over by the
    // plugin callbacks below, which only ever run from real Uppy upload
    // events (never during render), so there's no ref-during-render hazard
    // here the way there would be if this were read outside the effect.
    const pendingAssetId: { current: number | null } = { current: null }

    const instance = new Uppy({
      restrictions: { maxNumberOfFiles: 1, allowedFileTypes: ['video/*'] },

      // The common, preventable case: reject a file that would exceed
      // the user's remaining quota before Uppy ever queues it, let alone
      // before `createMultipartUpload` dispatches a network request.
      // Returning `false` here deliberately suppresses Uppy's own info
      // panel ("should be done by the developer", per its own source) —
      // the toast below is that message.
      onBeforeFileAdded: (file) => {
        const snapshot = quotaRef.current
        // No `/api/me` snapshot yet: let the file through rather than
        // reject it against a fabricated zero quota — the server's atomic
        // `reserve()` is still the enforcement backstop either way.
        if (snapshot === null) return true
        const { usedBytes, quotaBytes } = snapshot
        const remaining = Math.max(quotaBytes - usedBytes, 0)
        if (typeof file.size === 'number' && file.size > remaining) {
          toastManagerRef.current.add({
            title: 'Not enough storage left',
            description: `This file is ${formatBytes(file.size)} and you have ${formatBytes(remaining)} left.`,
            timeout: 8000,
          })
          return false
        }
        return true
      },
    }).use(AwsS3, {
      shouldUseMultipart: true,

      async createMultipartUpload(file) {
        let response
        try {
          response = await store
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
        } catch (error) {
          // The fallback case: the pre-flight check above only knows the
          // last `/api/me` snapshot (stale — another tab, another upload
          // finishing) and can't predict the 2-concurrent-uploads cap at
          // all (a live server-side fact, not derivable from a byte-count
          // snapshot). Surface whatever the server actually said.
          toastManagerRef.current.add({
            title: 'Upload could not start',
            description: extractServerErrorMessage(error),
            timeout: 8000,
          })
          throw error
        }

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

        onAssetReadyRef.current(result.asset.id)

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
    })

    setUppy(instance)

    return () => {
      instance.destroy()
    }
  }, [speechId])

  return (
    <div className="flex flex-col gap-3">
      {me && <QuotaMeter usedBytes={me.user.storage_bytes_used} quotaBytes={me.user.quota_bytes} />}
      {uppy && <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} />}
    </div>
  )
}
