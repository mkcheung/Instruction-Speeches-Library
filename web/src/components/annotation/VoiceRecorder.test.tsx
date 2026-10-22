import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceRecorder, type VoiceRecorderSessionReport } from '@/components/annotation/VoiceRecorder'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

vi.mock('@/components/annotation/VoiceWaveformPreview', () => ({
  VoiceWaveformPreview: () => <div data-testid="waveform-preview"><audio data-testid="preview-audio" /></div>,
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


type RecorderProps = React.ComponentProps<typeof VoiceRecorder>
/** renderWithProviders pins its element to a router route, so props are swapped through state. */
function renderControlled(initial: RecorderProps) {
  let set!: (props: RecorderProps) => void
  function Harness() {
    const [props, setProps] = useState(initial)
    set = setProps
    return <VoiceRecorder {...props} />
  }
  const view = renderWithProviders(<Harness />)
  return { ...view, rerender: (props: RecorderProps) => act(() => set(props)) }
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
    renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={video} />)

    await user.click(screen.getByRole('button', { name: /record/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible())
    video.currentTime = 44
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByTestId('waveform-preview')).toBeVisible()
    expect(screen.getByText(/voice note at 0:12\.300/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Re-record' }))
    expect(screen.queryByTestId('waveform-preview')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalled()
  })

  it('stops the microphone stream when unmounted during recording', async () => {
    const user = userEvent.setup()
    const rendered = renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={pausedVideo()} />)

    await user.click(screen.getByRole('button', { name: /record/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible())
    rendered.unmount()

    expect(stopTrack).toHaveBeenCalledTimes(1)
  })

  it('keeps the visible anchor when microphone permission is delayed', async () => {
    let grant!: (stream: MediaStream) => void
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve })),
    } })
    const user = userEvent.setup()
    const video = pausedVideo(12.3)
    renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={video} />)
    await user.click(screen.getByRole('button', { name: /^Record/ }))
    video.currentTime = 45
    await act(async () => { grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream) })
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(screen.getByRole('textbox', { name: 'Voice note position' })).toHaveValue('0:12.300')
  })

  it('releases a microphone granted after the requesting component was unmounted', async () => {
    let grant!: (stream: MediaStream) => void
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve })),
    } })
    const user = userEvent.setup()
    const view = renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={pausedVideo()} />)
    await user.click(screen.getByRole('button', { name: /^Record/ }))
    view.unmount()
    await act(async () => { grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream) })
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(FakeRecorder.instance).toBeNull()
  })

  it('retains a rejected recording and lets its anchor be corrected without recording again', async () => {
    const attempts: { uuid: string; position: number; bytes: number }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      if (request.url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      const form = await request.formData()
      const sent = { uuid: String(form.get('client_uuid')), position: Number(form.get('start_seconds')), bytes: (form.get('audio') as File).size }
      attempts.push(sent)
      return new Response(JSON.stringify(attempts.length === 1 ? { code: 'annotation_overlap' }
        : { annotation: { id: '1', client_uuid: sent.uuid, timing_type: 'point', start_seconds: sent.position } }),
      { status: attempts.length === 1 ? 422 : 202, headers: { 'Content-Type': 'application/json' } })
    }))
    const user = userEvent.setup()
    renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={pausedVideo()} />)
    await user.click(screen.getByRole('button', { name: /^Record/ }))
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    const recorder = FakeRecorder.instance
    await user.click(screen.getByRole('button', { name: 'Save voice note' }))
    await screen.findByText(/position is occupied/i)
    expect(screen.getByTestId('waveform-preview')).toBeVisible()
    const position = screen.getByRole('textbox', { name: 'Voice note position' })
    expect(position).toBeEnabled()
    await user.clear(position); await user.type(position, '30')
    await user.click(screen.getByRole('button', { name: 'Save voice note' }))
    await waitFor(() => expect(screen.queryByTestId('waveform-preview')).not.toBeInTheDocument())
    expect(FakeRecorder.instance).toBe(recorder)
    expect(attempts[0].uuid).toBe(attempts[1].uuid)
    expect(attempts[0].bytes).toBe(attempts[1].bytes)
    expect(attempts.map((attempt) => attempt.position)).toEqual([12.3, 30])
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
        return new Response(JSON.stringify({ annotation: { id: '1', client_uuid: String(form.get('client_uuid')), start_seconds: Number(form.get('start_seconds')), timing_type: 'point' } }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ annotations: [], review_id: 2, reviewer: null }), { headers: { 'Content-Type': 'application/json' } })
    }))

    const user = userEvent.setup()
    renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={pausedVideo()} />)
    await user.click(screen.getByRole('button', { name: /record/i }))
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    await user.click(await screen.findByRole('button', { name: 'Save voice note' }))
    await screen.findByText(/upload outcome is uncertain/i)
    await user.click(screen.getByRole('button', { name: 'Retry original upload' }))
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
    const rendered = renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={video} />)
    await user.click(screen.getByRole('button', { name: /record/i }))
    expect(await screen.findByText(/microphone access is blocked/i)).toBeVisible()
    rendered.unmount()

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(new DOMException('missing', 'NotFoundError'))) },
    })
    renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={video} />)
    await user.click(screen.getByRole('button', { name: /record/i }))
    expect(await screen.findByText(/no microphone was found/i)).toBeVisible()
  })

  it('auto-stops at ninety seconds', async () => {
    vi.useFakeTimers()
    renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={pausedVideo()} />)
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
    renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={pausedVideo()} />)

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
    renderWithProviders(<VoiceRecorder durationMs={100_000} annotations={[]} speechId={1} reviewId={2} videoEl={pausedVideo()} />)

    await user.click(screen.getByRole('button', { name: /record/i }))
    expect(await screen.findByText(/voice recording is not supported/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: /record/i })).not.toBeInTheDocument()
    expect(stopTrack).toHaveBeenCalled()
  })
})

describe('VoiceRecorder session reporting', () => {
  const stopTrack = vi.fn()
  type Call = [string, VoiceRecorderSessionReport | null]
  const setup = () => {
    const calls: Call[] = []
    const onSessionStateChange = vi.fn((id: string, report: VoiceRecorderSessionReport | null) => { calls.push([id, report]) })
    return { calls, onSessionStateChange, last: () => calls[calls.length - 1][1] }
  }
  const mockMic = (impl: () => Promise<MediaStream>) => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(impl) } })
  const stream = () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream
  const pauseSpy = () => vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)

  beforeEach(() => {
    clearCookies(); stopTrack.mockReset(); FakeRecorder.instance = null
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    mockMic(async () => stream())
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const props = (extra: Partial<RecorderProps> = {}, video = pausedVideo()): RecorderProps =>
    ({ durationMs: 100_000, annotations: [], speechId: 1, reviewId: 2, videoEl: video, ...extra })
  const ui = (extra: Partial<RecorderProps> = {}, video = pausedVideo()) => <VoiceRecorder {...props(extra, video)} />

  it('reports delayed permission as blocking only until recording actually stops', async () => {
    let grant!: (s: MediaStream) => void
    mockMic(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
    const { calls, onSessionStateChange, last } = setup()
    const user = userEvent.setup()
    renderWithProviders(ui({ onSessionStateChange }))
    expect(last()).toMatchObject({ phase: 'idle', pending: false, hasRecording: false, blocksToolSwitch: false })
    await user.click(screen.getByRole('button', { name: /^Record/ }))
    expect(last()).toMatchObject({ phase: 'requesting', pending: true, blocksToolSwitch: true })
    await act(async () => { grant(stream()) })
    expect(last()).toMatchObject({ phase: 'recording', blocksToolSwitch: true })
    const stopSpy = vi.spyOn(FakeRecorder.instance!, 'stop').mockImplementation(() => undefined)
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stopSpy).toHaveBeenCalled()
    // Stop was requested but the recorder has not emitted stop yet: still blocking.
    expect(last()).toMatchObject({ phase: 'recording', blocksToolSwitch: true })
    stopSpy.mockRestore()
    await act(async () => { FakeRecorder.instance!.stop() })
    expect(last()).toEqual({ phase: 'preview', pending: true, hasRecording: true, blocksToolSwitch: false })
    expect(calls.every(([id]) => id === calls[0][0])).toBe(true)
  })

  it('reports permission refusal, missing device and recorder start failure as non-blocking', async () => {
    const user = userEvent.setup()
    for (const [error, phase] of [['NotAllowedError', 'denied'], ['NotFoundError', 'no-device']] as const) {
      mockMic(() => Promise.reject(new DOMException('x', error)))
      const { onSessionStateChange, last } = setup()
      const view = renderWithProviders(ui({ onSessionStateChange }))
      await user.click(screen.getByRole('button', { name: /^Record/ }))
      await waitFor(() => expect(last()).toMatchObject({ phase, pending: false, blocksToolSwitch: false }))
      view.unmount()
    }
    class NeverStarts extends FakeRecorder { override start() { throw new DOMException('no', 'NotSupportedError') } }
    vi.stubGlobal('MediaRecorder', NeverStarts)
    mockMic(async () => stream())
    const { onSessionStateChange, last } = setup()
    renderWithProviders(ui({ onSessionStateChange }))
    await user.click(screen.getByRole('button', { name: /^Record/ }))
    await waitFor(() => expect(last()).toMatchObject({ phase: 'unsupported', blocksToolSwitch: false, pending: false }))
  })

  it('reports a MediaRecorder constructor failure as an error', async () => {
    class Throws extends FakeRecorder { constructor(s: MediaStream, o?: MediaRecorderOptions) { super(s, o); throw new DOMException('no', 'NotSupportedError') } }
    vi.stubGlobal('MediaRecorder', Throws)
    const { onSessionStateChange, last } = setup()
    renderWithProviders(ui({ onSessionStateChange }))
    await userEvent.setup().click(screen.getByRole('button', { name: /^Record/ }))
    await waitFor(() => expect(last()?.blocksToolSwitch).toBe(false))
    expect(last()?.pending).toBe(false)
  })

  it('reports a recorder error event as non-blocking', async () => {
    const { onSessionStateChange, last } = setup()
    renderWithProviders(ui({ onSessionStateChange }))
    await userEvent.setup().click(screen.getByRole('button', { name: /^Record/ }))
    expect(last()?.blocksToolSwitch).toBe(true)
    await act(async () => { FakeRecorder.instance!.dispatchEvent(new Event('error')) })
    expect(last()).toMatchObject({ phase: 'error', blocksToolSwitch: false, pending: false })
  })

  it('reports the 90 second automatic stop only after the recorder stopped', async () => {
    vi.useFakeTimers()
    const { onSessionStateChange, last } = setup()
    renderWithProviders(ui({ onSessionStateChange }))
    fireEvent.click(screen.getByRole('button', { name: /record/i }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(last()).toMatchObject({ phase: 'recording', blocksToolSwitch: true })
    act(() => vi.advanceTimersByTime(90_000))
    expect(FakeRecorder.instance?.state).toBe('inactive')
    expect(last()).toMatchObject({ phase: 'preview', hasRecording: true, blocksToolSwitch: false })
  })

  it('clears only its own session report on unmount, including mid-recording', async () => {
    const { calls, onSessionStateChange } = setup()
    const first = renderWithProviders(ui({ onSessionStateChange }))
    const second = renderWithProviders(ui({ onSessionStateChange }))
    const ids = [...new Set(calls.map(([id]) => id))]
    expect(ids).toHaveLength(2)
    await userEvent.setup().click(screen.getAllByRole('button', { name: /^Record/ })[0])
    first.unmount()
    const nulls = calls.filter(([, report]) => report === null)
    expect(nulls).toHaveLength(1)
    expect(nulls[0][0]).toBe(ids[0])
    expect(calls.filter(([id]) => id === ids[1]).every(([, report]) => report !== null)).toBe(true)
    second.unmount()
    expect(calls.filter(([, report]) => report === null)).toHaveLength(2)
  })

  it('does not require a stable callback and uses the latest one without re-reporting', async () => {
    const a = setup(); const b = setup()
    const view = renderControlled(props({ onSessionStateChange: a.onSessionStateChange }))
    const before = a.calls.length
    view.rerender(props({ onSessionStateChange: b.onSessionStateChange }))
    expect(a.calls.length).toBe(before)
    expect(b.calls).toHaveLength(0)
    view.unmount()
    expect(b.calls).toHaveLength(1)
    expect(b.calls[0][1]).toBeNull()
  })

  describe('acknowledged saves', () => {
    const recordAndStop = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: /^Record/ }))
      await user.click(await screen.findByRole('button', { name: 'Stop' }))
    }
    const saved = (uuid: string, start = 12.3) => ({ id: '77', client_uuid: uuid, timing_type: 'point', start_seconds: start })

    it('emits the saved annotation once after exact acknowledgement and never on rejection or mismatch', async () => {
      let attempts = 0
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        if (request.url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        attempts += 1
        const form = await request.formData()
        const uuid = String(form.get('client_uuid'))
        if (attempts === 1) return new Response(JSON.stringify({ code: 'annotation_overlap' }), { status: 422, headers: { 'Content-Type': 'application/json' } })
        if (attempts === 2) return new Response(JSON.stringify({ annotation: saved('other-uuid') }), { status: 202, headers: { 'Content-Type': 'application/json' } })
        return new Response(JSON.stringify({ annotation: saved(uuid, Number(form.get('start_seconds'))) }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      })
      vi.stubGlobal('fetch', fetchMock)
      const onAcknowledgedSave = vi.fn()
      const { onSessionStateChange, last } = setup()
      const user = userEvent.setup()
      renderWithProviders(ui({ onAcknowledgedSave, onSessionStateChange }))
      await recordAndStop(user)
      await user.click(screen.getByRole('button', { name: 'Save voice note' }))
      await screen.findByText(/position is occupied/i)
      expect(onAcknowledgedSave).not.toHaveBeenCalled()
      expect(last()).toMatchObject({ phase: 'error', hasRecording: true })
      await user.click(screen.getByRole('button', { name: 'Save voice note' }))
      await screen.findByText(/upload outcome is uncertain/i)
      expect(onAcknowledgedSave).not.toHaveBeenCalled()
      expect(last()).toMatchObject({ phase: 'uncertain', pending: true, hasRecording: true, blocksToolSwitch: false })
      await user.click(screen.getByRole('button', { name: 'Retry original upload' }))
      await waitFor(() => expect(onAcknowledgedSave).toHaveBeenCalledTimes(1))
      expect(onAcknowledgedSave.mock.calls[0][0]).toMatchObject({ id: '77' })
      expect(typeof onAcknowledgedSave.mock.calls[0][1]).toBe('string')
      expect(last()).toMatchObject({ phase: 'idle', pending: false, hasRecording: false })
      expect(fetchMock.mock.calls.filter(([i]) => !(i instanceof Request ? i.url : String(i)).includes('csrf'))).toHaveLength(3)
    })

    it('emits once when an uncertain upload is resolved by polling, with no extra request', async () => {
      let uuid = ''
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        if (request.url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        uuid = String((await request.formData()).get('client_uuid'))
        return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } })
      })
      vi.stubGlobal('fetch', fetchMock)
      const onAcknowledgedSave = vi.fn()
      const user = userEvent.setup()
      const video = pausedVideo()
      const view = renderControlled(props({ onAcknowledgedSave }, video))
      await recordAndStop(user)
      await user.click(screen.getByRole('button', { name: 'Save voice note' }))
      await screen.findByText(/upload outcome is uncertain/i)
      const requests = fetchMock.mock.calls.length
      const row = saved(uuid) as unknown as NonNullable<React.ComponentProps<typeof VoiceRecorder>['annotations']>[number]
      view.rerender(props({ onAcknowledgedSave, annotations: [{ ...row, id: 'x', start_seconds: 99 } as typeof row] }, video))
      expect(onAcknowledgedSave).not.toHaveBeenCalled()
      view.rerender(props({ onAcknowledgedSave, annotations: [row] }, video))
      await waitFor(() => expect(onAcknowledgedSave).toHaveBeenCalledTimes(1))
      view.rerender(props({ onAcknowledgedSave, annotations: [row, { ...row }] }, video))
      view.rerender(props({ onAcknowledgedSave, annotations: [row] }, video))
      expect(onAcknowledgedSave).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls.length).toBe(requests)
    })
  })

  describe('active prop', () => {
    it('defaults to active and does not pause the preview', async () => {
      const pause = pauseSpy()
      renderWithProviders(ui())
      await userEvent.setup().click(screen.getByRole('button', { name: /^Record/ }))
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Stop' }))
      await screen.findByTestId('preview-audio')
      expect(pause).not.toHaveBeenCalled()
    })

    it('pauses preview audio when inactive and retains blob, uuid, anchor and the preview node', async () => {
      const pause = pauseSpy()
      const uuids: string[] = []
      const bytes: number[] = []
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        if (request.url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        const form = await request.formData()
        uuids.push(String(form.get('client_uuid'))); bytes.push((form.get('audio') as File).size)
        return new Response(JSON.stringify({ annotation: { id: '9', client_uuid: String(form.get('client_uuid')), timing_type: 'point', start_seconds: Number(form.get('start_seconds')) } }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }))
      const video = pausedVideo(12.3)
      const user = userEvent.setup()
      const view = renderControlled(props({}, video))
      await user.click(screen.getByRole('button', { name: /^Record/ }))
      await user.click(await screen.findByRole('button', { name: 'Stop' }))
      const audio = await screen.findByTestId('preview-audio')
      view.rerender(props({ active: false }, video))
      expect(pause).toHaveBeenCalled()
      expect(screen.getByTestId('preview-audio')).toBe(audio)
      expect(screen.getByRole('textbox', { name: 'Voice note position' })).toHaveValue('0:12.300')
      expect(screen.getByText(/voice note at 0:12\.300/i)).toBeVisible()
      // Re-activate: nothing was discarded and nothing restarts on its own.
      pause.mockClear()
      view.rerender(props({ active: true }, video))
      expect(pause).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Save voice note' }))
      await waitFor(() => expect(uuids).toHaveLength(1))
      expect(bytes[0]).toBeGreaterThan(0)
    })

    it('pauses a preview that starts playing while inactive (late render)', async () => {
      const pause = pauseSpy()
      const user = userEvent.setup()
      const video = pausedVideo()
      const view = renderControlled(props({}, video))
      await user.click(screen.getByRole('button', { name: /^Record/ }))
      await user.click(await screen.findByRole('button', { name: 'Stop' }))
      const audio = await screen.findByTestId('preview-audio')
      view.rerender(props({ active: false }, video))
      pause.mockClear()
      fireEvent.play(audio)
      expect(pause).toHaveBeenCalled()
      view.rerender(props({ active: true }, video))
      pause.mockClear()
      fireEvent.play(audio)
      expect(pause).not.toHaveBeenCalled()
    })

    it('does not touch the microphone when inactive during recording', async () => {
      const { onSessionStateChange, last } = setup()
      const video = pausedVideo()
      const view = renderControlled(props({ onSessionStateChange }, video))
      await userEvent.setup().click(screen.getByRole('button', { name: /^Record/ }))
      await screen.findByRole('button', { name: 'Stop' })
      view.rerender(props({ onSessionStateChange, active: false }, video))
      expect(stopTrack).not.toHaveBeenCalled()
      expect(last()).toMatchObject({ phase: 'recording', blocksToolSwitch: true })
    })
  })
})
