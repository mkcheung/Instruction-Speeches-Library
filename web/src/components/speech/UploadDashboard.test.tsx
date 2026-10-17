import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UploadDashboard } from '@/components/speech/UploadDashboard'

/**
 * §7.8: the pre-flight quota check and the quota meter, unit-tested
 * against the real `@uppy/react` `<Dashboard>` (the same ResizeObserver
 * stub `src/test/setup.ts` already added for STEP-12's document upload
 * component covers this one too).
 *
 * `useGetMeQuery` and the two lower-level modules `UploadDashboard.tsx`
 * dispatches through directly (`@/app/store`, `@/features/speech/speechApi`
 * — Uppy's plugin callbacks run outside any component, so they bypass
 * RTK Query hooks) are mocked rather than hit over the network, matching
 * this codebase's established pattern of mocking the API module one layer
 * up (`AnnotationComposerPanel.test.tsx` does the same for
 * `annotationApi`/`reviewApi`).
 */
let meResult: { data: { user: { storage_bytes_used: number; quota_bytes: number } } | undefined } = {
  data: { user: { storage_bytes_used: 1024, quota_bytes: 10 * 1024 } },
}
vi.mock('@/features/auth/authApi', () => ({
  useGetMeQuery: () => meResult,
}))

const createUploadInitiate = vi.fn(() => ({
  unwrap: () => Promise.resolve({ asset: { id: 1 }, upload_id: 'upload-1', key: 'key-1' }),
}))
vi.mock('@/features/speech/speechApi', () => ({
  speechApi: {
    endpoints: {
      createUpload: { initiate: () => createUploadInitiate() },
      signPart: { initiate: vi.fn() },
      completeUpload: { initiate: vi.fn() },
      abortUpload: { initiate: vi.fn() },
    },
  },
}))
vi.mock('@/app/store', () => ({
  store: { dispatch: (action: unknown) => action },
}))

function selectFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"][name="files[]"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

describe('UploadDashboard', () => {
  beforeEach(() => {
    createUploadInitiate.mockClear()
    meResult = { data: { user: { storage_bytes_used: 1024, quota_bytes: 10 * 1024 } } }
  })

  it('renders the used/quota text from the current /api/me snapshot', () => {
    render(<UploadDashboard speechId={1} onAssetReady={vi.fn()} />)
    expect(screen.getByText('1.0 KiB of 10.0 KiB used')).toBeInTheDocument()
  })

  it('rejects a file larger than the remaining quota pre-flight, and never calls createMultipartUpload', async () => {
    // 1 KiB used of a 10 KiB quota -> 9 KiB remaining.
    const { container } = render(<UploadDashboard speechId={1} onAssetReady={vi.fn()} />)

    const file = new File([new Uint8Array(20 * 1024)], 'speech.mp4', { type: 'video/mp4' })
    selectFile(container, file)

    expect(await screen.findByText('Not enough storage left')).toBeInTheDocument()
    expect(screen.getByText('This file is 20.0 KiB and you have 9.0 KiB left.')).toBeInTheDocument()
    expect(createUploadInitiate).not.toHaveBeenCalled()
  })

  it('lets a file within the remaining quota through to createMultipartUpload', async () => {
    const { container } = render(<UploadDashboard speechId={1} onAssetReady={vi.fn()} />)

    const file = new File([new Uint8Array(1024)], 'speech.mp4', { type: 'video/mp4' })
    selectFile(container, file)

    expect(screen.queryByText('Not enough storage left')).not.toBeInTheDocument()

    // autoProceed is off (the default), so a file passing pre-flight sits
    // queued until the user explicitly starts the upload.
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 1 file' }))

    await waitFor(() => expect(createUploadInitiate).toHaveBeenCalled())
  })
})
