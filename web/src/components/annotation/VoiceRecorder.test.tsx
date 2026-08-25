import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceRecorder } from '@/components/annotation/VoiceRecorder'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

vi.mock('@/components/annotation/VoiceWaveformPreview', () => ({
  VoiceWaveformPreview: () => <div data-testid="waveform-preview" />,
}))

class FakeRecorder extends EventTarget {
  static instance: FakeRecorder | null = null
  static isTypeSupported = () => true
  state: RecordingState = 'inactive'
  mimeType: string
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.mimeType = options?.mimeType ?? 'audio/webm'
    FakeRecorder.instance = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    const data = new Event('dataavailable') as BlobEvent
    Object.defineProperty(data, 'data', { value: new Blob(['voice bytes'], { type: this.mimeType }) })
    this.dispatchEvent(data)
    this.dispatchEvent(new Event('stop'))
  }
}

function pausedVideo(time = 12.3) {
  const video = document.createElement('video')
  video.currentTime = time
  return video
}

describe('VoiceRecorder', () => {
  const stopTrack = vi.fn()

  beforeEach(() => {
    clearCookies()
    stopTrack.mockReset()
    FakeRecorder.instance = null
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream) },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stamps the playhead at start, previews locally, and re-records without uploading', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const video = pausedVideo()
    renderWithProviders(<VoiceRecorder speechId={1} reviewId={2} videoEl={video} />)

    await user.click(screen.getByRole('button', { name: /record/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible())
    video.currentTime = 44
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByTestId('waveform-preview')).toBeVisible()
    expect(screen.getByText(/voice note at 12\.3 seconds/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Re-record' }))
    expect(screen.queryByTestId('waveform-preview')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalled()
  })

  it('stops the microphone stream when unmounted during recording', async () => {
    const user = userEvent.setup()
    const rendered = renderWithProviders(<VoiceRecorder speechId={1} reviewId={2} videoEl={pausedVideo()} />)

    await user.click(screen.getByRole('button', { name: /record/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible())
    rendered.unmount()

    expect(stopTrack).toHaveBeenCalledTimes(1)
  })

  it('reuses one client UUID when Save is retried', async () => {
    let attempts = 0
    const uuids: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      if (request.url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (request.url.includes('/voice-notes')) {
        attempts += 1
        const form = await request.clone().formData()
        uuids.push(String(form.get('client_uuid')))
        expect(form.has('duration_seconds')).toBe(false)
        if (attempts === 1) return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } })
        return new Response(JSON.stringify({ annotation: { id: '1' } }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ annotations: [], review_id: 2, reviewer: null }), { headers: { 'Content-Type': 'application/json' } })
    }))

    const user = userEvent.setup()
    renderWithProviders(<VoiceRecorder speechId={1} reviewId={2} videoEl={pausedVideo()} />)
    await user.click(screen.getByRole('button', { name: /record/i }))
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    await user.click(await screen.findByRole('button', { name: 'Save voice note' }))
    await screen.findByText(/could not record or save/i)
    await user.click(screen.getByRole('button', { name: 'Save voice note' }))
    await waitFor(() => expect(uuids).toHaveLength(2))
    expect(uuids[0]).toBe(uuids[1])
  })

  it('explains denied permission and a missing microphone separately', async () => {
    const video = pausedVideo()
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(new DOMException('denied', 'NotAllowedError'))) },
    })
    const rendered = renderWithProviders(<VoiceRecorder speechId={1} reviewId={2} videoEl={video} />)
    await user.click(screen.getByRole('button', { name: /record/i }))
    expect(await screen.findByText(/microphone access is blocked/i)).toBeVisible()
    rendered.unmount()

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(new DOMException('missing', 'NotFoundError'))) },
    })
    renderWithProviders(<VoiceRecorder speechId={1} reviewId={2} videoEl={video} />)
    await user.click(screen.getByRole('button', { name: /record/i }))
    expect(await screen.findByText(/no microphone was found/i)).toBeVisible()
  })

  it('auto-stops at ninety seconds', async () => {
    vi.useFakeTimers()
    renderWithProviders(<VoiceRecorder speechId={1} reviewId={2} videoEl={pausedVideo()} />)
    fireEvent.click(screen.getByRole('button', { name: /record/i }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(FakeRecorder.instance?.state).toBe('recording')
    act(() => vi.advanceTimersByTime(90_000))
    expect(FakeRecorder.instance?.state).toBe('inactive')
  })

  it('does not render a dead Record button when recording APIs are unavailable', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    renderWithProviders(<VoiceRecorder speechId={1} reviewId={2} videoEl={pausedVideo()} />)

    expect(screen.queryByRole('button', { name: /record/i })).not.toBeInTheDocument()
    expect(screen.getByText(/voice recording is not supported/i)).toBeVisible()
  })

  it('releases the stream and removes Record after every candidate fails to start', async () => {
    class NeverStartsRecorder extends FakeRecorder {
      override start() {
        throw new DOMException('unsupported', 'NotSupportedError')
      }
    }
    vi.stubGlobal('MediaRecorder', NeverStartsRecorder)
    const user = userEvent.setup()
    renderWithProviders(<VoiceRecorder speechId={1} reviewId={2} videoEl={pausedVideo()} />)

    await user.click(screen.getByRole('button', { name: /record/i }))
    expect(await screen.findByText(/voice recording is not supported/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: /record/i })).not.toBeInTheDocument()
    expect(stopTrack).toHaveBeenCalled()
  })
})
