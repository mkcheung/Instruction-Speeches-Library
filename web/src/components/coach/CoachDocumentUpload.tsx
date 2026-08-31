import { useEffect, useState } from 'react'
import Uppy from '@uppy/core'
import Dashboard from '@uppy/react/dashboard'
import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import { Button } from '@/components/ui/button'
import { FormBanner } from '@/components/ui/form-message'
import { useUploadCoachApplicationDocumentsMutation } from '@/features/coachApplication/coachApplicationApi'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'

/**
 * STEP-12-FROZEN-CONTRACT.md §9: "extend `UploadDashboard.tsx`'s existing
 * Uppy pattern... `allowedFileTypes: ['application/pdf']`,
 * `maxNumberOfFiles: 2`... no new upload library needed."
 *
 * One real divergence from `UploadDashboard.tsx`, called out rather than
 * silently copied: `UploadDashboard` wires `@uppy/aws-s3` because the
 * video-upload backend exposes four presigned-multipart endpoints
 * (create/sign-part/complete/abort) for it to drive. The frozen contract
 * pins exactly ONE route for documents — `POST /api/coach-applications/
 * {id}/documents`, described as "multipart, two files" — with no
 * per-part-signing endpoints alongside it. There is nothing for
 * `@uppy/aws-s3` to call here, so this component reuses Uppy's Core +
 * Dashboard (file picking, drag-drop, the two-PDF restriction UI — the
 * actual "existing Uppy pattern") but submits with a plain `FormData` POST
 * through `coachApplicationApi`, matching the literal pinned route instead
 * of re-deriving presigned endpoints the contract doesn't mention.
 *
 * Same StrictMode hazard `UploadDashboard.tsx`'s own comment documents:
 * the Uppy instance is created AND destroyed inside one `useEffect`, never
 * `useState`-lazy-init + a separate cleanup effect, so a StrictMode
 * dev-only remount can't tear down the one live instance the mounted
 * `<Dashboard>` still points at.
 */
export function CoachDocumentUpload({
  applicationId,
  onUploaded,
}: {
  applicationId: number
  onUploaded: () => void
}) {
  const [uppy, setUppy] = useState<Uppy | null>(null)
  const [uploadDocuments, { isLoading: isUploading }] = useUploadCoachApplicationDocumentsMutation()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const instance = new Uppy({
      restrictions: { maxNumberOfFiles: 2, allowedFileTypes: ['application/pdf'] },
      autoProceed: false,
    })

    // Same StrictMode constraint `UploadDashboard.tsx`'s doc-comment
    // explains: the instance must be created AND destroyed inside this one
    // effect, not `useState`-lazy-init, so a dev-only double-mount can't
    // tear down the one live instance the still-mounted `<Dashboard>`
    // points at. That leaves no way to avoid this `setState` call inside
    // the effect body itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUppy(instance)

    return () => {
      instance.destroy()
    }
  }, [])

  if (!uppy) return null

  const handleUpload = async () => {
    setError(null)
    const files = uppy.getFiles()
    if (files.length === 0) return

    const formData = new FormData()
    for (const file of files) {
      if (file.data instanceof Blob) {
        formData.append('documents[]', file.data, file.name ?? 'certification.pdf')
      }
    }

    try {
      await uploadDocuments({ id: applicationId, formData }).unwrap()
      for (const file of files) {
        uppy.removeFile(file.id)
      }
      onUploaded()
    } catch (uploadError) {
      setError(extractServerErrorMessage(uploadError))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} hideUploadButton />
      <FormBanner message={error} />
      <Button type="button" onClick={handleUpload} disabled={isUploading}>
        {isUploading ? 'Uploading…' : 'Upload documents'}
      </Button>
    </div>
  )
}
