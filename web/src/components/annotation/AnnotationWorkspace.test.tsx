import { StrictMode, createContext, useContext, useEffect, useRef, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { AnnotationComposerPanel } from './AnnotationComposerPanel'
import type { Annotation, AnnotationsResponse } from '@/features/annotation/types'
import type { Review } from '@/features/review/types'

function note(id: string, start = 2, duration = 4): Annotation {
  return { id, timing_type: 'range', start_seconds: start, duration_seconds: duration,
    body: 'Saved written commentary', kind: 'observation', topic: null, voice: null, lock_version: 0, client_uuid: `uuid-${id}` }
}

let queryState: { data: AnnotationsResponse; currentData: AnnotationsResponse; isError: boolean; isFetching: boolean; isSuccess: boolean; refetch: ReturnType<typeof vi.fn> }
const mutation = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }))
const createVoice = vi.fn((arg: { body: { client_uuid: string; start_seconds: number } }) => ({
  unwrap: () => Promise.resolve({ ...note('voice-saved', arg.body.start_seconds, 5), client_uuid: arg.body.client_uuid, timing_type: 'point' as const,
    voice: { asset_id: 7, audio_status: 'ready', transcript_status: 'ready', failure_code: null } }),
}))
vi.mock('@/features/annotation/annotationApi', () => ({
  useGetAnnotationsQuery: () => queryState,
  useClearAnnotationsMutation: () => [mutation, { isLoading: false }],
  useCreateAnnotationMutation: () => [mutation, { isLoading: false }],
  useUpdateAnnotationMutation: () => [mutation, { isLoading: false }],
  useDeleteAnnotationMutation: () => [mutation, { isLoading: false }],
  useRestoreVoiceAnnotationMutation: () => [mutation, { isLoading: false }],
  useRestorePointAnnotationMutation: () => [mutation, { isLoading: false }],
  useLazyGetVoiceAudioUrlQuery: () => [mutation, { isFetching: false }],
  useRetryVoiceTranscriptMutation: () => [mutation, { isLoading: false }],
  useCreateVoiceAnnotationMutation: () => [createVoice, { isLoading: false }],
}))
vi.mock('@/components/annotation/VoiceWaveformPreview', () => ({
  VoiceWaveformPreview: () => <div data-testid="waveform-preview"><audio /></div>,
}))
// Integration describe flips this to render the REAL VoiceRecorder / AnnotationList.
const integ = vi.hoisted(() => ({ real: false }))
vi.mock('@/features/review/reviewApi', () => ({
  usePublishReviewMutation: () => [mutation, { isLoading: false }],
  useAbandonReviewMutation: () => [mutation, { isLoading: false }],
}))
vi.mock('@/hooks/useAnnotationChannel', () => ({ useAnnotationChannel: () => vi.fn() }))

type RecorderProps = {
  active?: boolean
  onPendingChange?: (id: string, pending: boolean) => void
  onSessionStateChange?: (id: string, report: { phase: string; pending: boolean; hasRecording: boolean; blocksToolSwitch: boolean } | null) => void
  onAcknowledgedSave?: (saved: Annotation, sessionId: string) => void
}
const rec = vi.hoisted(() => ({ props: null as unknown, mounts: 0, node: null as HTMLElement | null }))
const recorder = () => rec.props as RecorderProps
vi.mock('@/components/annotation/VoiceRecorder', async (importActual) => {
  const actual = await importActual<typeof import('@/components/annotation/VoiceRecorder')>()
  function FakeRecorderComponent(props: RecorderProps) {
    useEffect(() => { rec.props = props })
    const ref = useRef<HTMLDivElement | null>(null)
    useEffect(() => { rec.mounts += 1; rec.node = ref.current }, [])
    return <div ref={ref} data-testid="voice-recorder" data-active={String(props.active)} />
  }
  return { VoiceRecorder: (props: RecorderProps) => integ.real
    ? <actual.VoiceRecorder {...(props as React.ComponentProps<typeof actual.VoiceRecorder>)} />
    : <FakeRecorderComponent {...props} /> }
})
const list = vi.hoisted(() => ({ props: null as unknown }))
type ListProps = {
  open: boolean; onOpenChange: (open: boolean) => void; active: boolean
  revealRequest: { id: string; token: number } | null
  onSelectedChange: (id: string | null) => void
  acknowledgedSave: { id: string; token: number } | null
  onHoldChange: (hold: { editing: boolean; operating: boolean; locked: boolean }) => void
}
const listProps = () => list.props as ListProps
vi.mock('@/components/annotation/AnnotationList', async (importActual) => {
  const actual = await importActual<typeof import('@/components/annotation/AnnotationList')>()
  function FakeList(props: ListProps) { useEffect(() => { list.props = props }); return <div data-testid="saved-list" data-open={String(props.open)} /> }
  return { AnnotationList: (props: ListProps) => integ.real
    ? <actual.AnnotationList {...(props as unknown as React.ComponentProps<typeof actual.AnnotationList>)} />
    : <FakeList {...props} /> }
})

type PanelProps = ComponentProps<typeof AnnotationComposerPanel>
const PanelContext = createContext<PanelProps | null>(null)
function PanelFromContext() {
  const props = useContext(PanelContext)
  return props && <AnnotationComposerPanel {...props} />
}
const targets: HTMLElement[] = []
function mountPanel(overrides: Partial<PanelProps> = {}, strict = false, startTime = 3) {
  const target = document.createElement('div')
  document.body.append(target)
  targets.push(target)
  const video = document.createElement('video')
  video.currentTime = startTime
  let props: PanelProps = {
    speechId: 1, review: { id: 9, status: 'in_progress', first_published_at: null } as Review,
    videoEl: video, durationSeconds: 100, userId: '3', canRecordVoice: true, onSeek: vi.fn(),
    previewTarget: target, previewEnabled: true, previewAnchor: 'default', ...overrides,
  }
  const router = createMemoryRouter([{ path: '*', element: <PanelFromContext /> }])
  const ui = () => {
    const content = <PanelContext.Provider value={props}><RouterProvider router={router} /></PanelContext.Provider>
    return strict ? <StrictMode>{content}</StrictMode> : content
  }
  const rendered = render(ui())
  return { ...rendered, target, video, onSeek: props.onSeek,
    update(next: Partial<PanelProps> = {}) { props = { ...props, ...next }; rendered.rerender(ui()) } }
}
const tab = (name: RegExp | string) => screen.getByRole('tab', { name })
const report = (phase: string, extra: Partial<{ pending: boolean; hasRecording: boolean; blocksToolSwitch: boolean }> = {}, id = 'rec-1') =>
  act(() => recorder().onSessionStateChange?.(id, { phase, pending: false, hasRecording: false, blocksToolSwitch: false, ...extra }))
const pressC = (init: KeyboardEventInit = {}) => fireEvent.keyDown(document, { code: 'KeyC', key: 'c', ...init })
const editor = () => screen.getByRole('region', { name: 'New annotation' })
const startField = () => screen.getByLabelText('Start') as HTMLInputElement
function fillDraft() {
  fireEvent.change(startField(), { target: { value: '10' } })
  fireEvent.change(within(editor()).getByLabelText('End'), { target: { value: '15' } })
  fireEvent.change(within(editor()).getByLabelText('Commentary'), { target: { value: 'Typed text' } })
}

beforeEach(() => {
  const data = { review_id: 9, reviewer: null, annotations: [note('saved')] }
  queryState = { data, currentData: data, isError: false, isFetching: false, isSuccess: true, refetch: vi.fn() }
  mutation.mockClear()
  rec.props = null; rec.mounts = 0; rec.node = null; list.props = null
  localStorage.clear()
  integ.real = false
  createVoice.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const target of targets.splice(0)) target.remove()
})

describe('annotation workspace tools', () => {
  it('shows one tool at a time, defaulting to Text, and keeps the same instances across repeated switches', () => {
    mountPanel()
    expect(screen.getByRole('tablist', { name: 'Add commentary' })).toBeInTheDocument()
    expect(tab('Text note')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('region', { name: 'New annotation' })).toHaveLength(1)
    expect(screen.queryByTestId('voice-recorder')).toBeInTheDocument()
    expect(screen.getByTestId('voice-recorder').closest('[role="tabpanel"]')).toHaveAttribute('hidden')
    const textarea = within(editor()).getByLabelText('Commentary') as HTMLTextAreaElement
    fillDraft()
    const recorderNode = rec.node
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(tab(/^Voice note/))
      expect(screen.queryByRole('region', { name: 'New annotation' })).not.toBeInTheDocument()
      expect(screen.getByTestId('voice-recorder').closest('[role="tabpanel"]')).not.toHaveAttribute('hidden')
      fireEvent.click(tab(/^Text note/))
      expect(screen.getAllByRole('region', { name: 'New annotation' })).toHaveLength(1)
    }
    expect(within(editor()).getByLabelText('Commentary')).toBe(textarea)
    expect(textarea.value).toBe('Typed text')
    expect(rec.node).toBe(recorderNode)
    expect(rec.mounts).toBe(1)
  })

  it('retains a recording report and its instance across switches, and the draft still guards publishing from the hidden Text tool', () => {
    mountPanel()
    fillDraft()
    fireEvent.click(tab(/^Voice note/))
    expect(screen.getByRole('button', { name: 'Publish feedback' })).toBeDisabled()
    report('preview', { pending: true, hasRecording: true })
    act(() => recorder().onPendingChange?.('rec-1', true))
    fireEvent.click(tab(/^Text note/))
    fireEvent.click(tab(/^Voice note/))
    expect(rec.mounts).toBe(1)
    expect(tab(/^Voice note/)).toHaveAccessibleName('Voice note · Unsaved recording')
    fireEvent.click(tab(/^Text note/))
    fireEvent.click(within(editor()).getByRole('button', { name: 'Discard new note' }))
    expect(screen.getByRole('button', { name: 'Publish feedback' })).toBeDisabled()
    act(() => recorder().onPendingChange?.('rec-1', false))
    expect(screen.getByRole('button', { name: 'Publish feedback' })).toBeEnabled()
  })

  it('has no tool tab strip and no recorder when voice is not permitted', () => {
    mountPanel({ canRecordVoice: false })
    expect(screen.queryByRole('tablist', { name: 'Add commentary' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('voice-recorder')).not.toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: 'New annotation' })).toHaveLength(1)
  })

  it('derives badges from provenance: text from the Composer, voice from recorder reports', () => {
    mountPanel()
    expect(tab(/^Text note/)).toHaveAccessibleName('Text note')
    // Recorder pending work must not mark the text tool.
    act(() => recorder().onPendingChange?.('rec-1', true))
    expect(tab(/^Text note/)).toHaveAccessibleName('Text note')
    act(() => recorder().onPendingChange?.('rec-1', false))
    fillDraft()
    expect(tab(/^Text note/)).toHaveAccessibleName('Text note · Unsaved')
    expect(tab(/^Voice note/)).toHaveAccessibleName('Voice note')
    report('saving', { pending: true, hasRecording: true })
    expect(tab(/^Voice note/)).toHaveAccessibleName('Voice note · Saving')
    report('uncertain', { pending: true, hasRecording: true })
    expect(tab(/^Voice note/)).toHaveAccessibleName('Voice note · Retry upload')
    expect(within(tab(/^Voice note/)).getByText('Retry upload')).toHaveAttribute('data-tone', 'error')
    report('preview', { pending: true, hasRecording: true })
    expect(tab(/^Voice note/)).toHaveAccessibleName('Voice note · Unsaved recording')
    report('idle')
    expect(tab(/^Voice note/)).toHaveAccessibleName('Voice note')
  })

  it('passes active to the recorder only while Voice is selected and outer Notes is active', () => {
    const view = mountPanel()
    expect(screen.getByTestId('voice-recorder')).toHaveAttribute('data-active', 'false')
    fireEvent.click(tab(/^Voice note/))
    expect(screen.getByTestId('voice-recorder')).toHaveAttribute('data-active', 'true')
    view.update({ authoringActive: false })
    expect(screen.getByTestId('voice-recorder')).toHaveAttribute('data-active', 'false')
    expect(listProps().active).toBe(false)
    view.update({ authoringActive: true })
    expect(screen.getByTestId('voice-recorder')).toHaveAttribute('data-active', 'true')
    expect(listProps().active).toBe(true)
  })
})

describe('annotation workspace recorder lock', () => {
  it('keeps Voice visible and explains while requesting or recording, then releases', () => {
    const onLock = vi.fn()
    mountPanel({ onRecordingLockChange: onLock })
    fireEvent.click(tab(/^Voice note/))
    report('requesting', { pending: true, blocksToolSwitch: true })
    expect(onLock).toHaveBeenLastCalledWith(true)
    expect(tab(/^Text note/)).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(tab(/^Text note/))
    expect(tab(/^Voice note/)).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('.aw-lock-hint')).toHaveTextContent(/Stop recording/)
    report('recording', { pending: true, blocksToolSwitch: true })
    expect(onLock).toHaveBeenLastCalledWith(true)
    report('preview', { pending: true, hasRecording: true })
    expect(onLock).toHaveBeenLastCalledWith(false)
    expect(document.querySelector('.aw-lock-hint')).toBeNull()
    fireEvent.click(tab(/^Text note/))
    expect(tab(/^Text note/)).toHaveAttribute('aria-selected', 'true')
  })

  it('clears only the matching session and always reports false on unmount', () => {
    const onLock = vi.fn()
    const view = mountPanel({ onRecordingLockChange: onLock })
    report('recording', { pending: true, blocksToolSwitch: true }, 'new-session')
    // A stale (older) session's cleanup must not release the newer session's lock.
    act(() => recorder().onSessionStateChange?.('old-session', null))
    expect(onLock).toHaveBeenLastCalledWith(true)
    act(() => recorder().onSessionStateChange?.('new-session', null))
    expect(onLock).toHaveBeenLastCalledWith(false)
    report('recording', { pending: true, blocksToolSwitch: true })
    expect(onLock).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(onLock).toHaveBeenLastCalledWith(false)
  })

  it('does not leak a retained lock into a replacement user/speech/review scope', () => {
    const onLock = vi.fn()
    const view = mountPanel({ onRecordingLockChange: onLock })
    report('recording', { pending: true, blocksToolSwitch: true })
    expect(onLock).toHaveBeenLastCalledWith(true)
    view.update({ speechId: 2 })
    expect(onLock).toHaveBeenLastCalledWith(false)
    expect(tab(/^Text note/)).not.toHaveAttribute('aria-disabled', 'true')
    expect(tab(/^Text note/)).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('.aw-lock-hint')).toBeNull()
  })

  it('survives StrictMode double effects with the exact final lock state', () => {
    const onLock = vi.fn()
    const view = mountPanel({ onRecordingLockChange: onLock }, true)
    expect(onLock).toHaveBeenLastCalledWith(false)
    report('recording', { pending: true, blocksToolSwitch: true })
    expect(onLock).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(onLock).toHaveBeenLastCalledWith(false)
  })
})

describe('annotation workspace C / Alt+C capture', () => {
  it('reveals Text and stamps the playhead without sending any save', () => {
    mountPanel()
    fireEvent.click(tab(/^Voice note/))
    expect(startField().value).toBe('')
    pressC()
    expect(tab(/^Text note/)).toHaveAttribute('aria-selected', 'true')
    expect(startField().value).not.toBe('')
    expect(mutation).not.toHaveBeenCalled()
  })

  it('does nothing while outer Notes is inactive, the review is unwritable or the microphone is locked', () => {
    const view = mountPanel({ authoringActive: false })
    pressC()
    expect(startField().value).toBe('')
    view.update({ authoringActive: true, review: { id: 9, status: 'completed', first_published_at: null } as unknown as Review })
    pressC()
    expect(startField().value).toBe('')
    view.update({ review: { id: 9, status: 'in_progress', first_published_at: null } as Review })
    fireEvent.click(tab(/^Voice note/))
    report('recording', { pending: true, blocksToolSwitch: true })
    pressC()
    expect(tab(/^Voice note/)).toHaveAttribute('aria-selected', 'true')
    expect(startField().value).toBe('')
    report('idle')
    pressC()
    expect(startField().value).not.toBe('')
    expect(mutation).not.toHaveBeenCalled()
  })

  it('keeps the typing guard: a bare c in the commentary textarea inserts no stamp', () => {
    mountPanel()
    const textarea = within(editor()).getByLabelText('Commentary')
    textarea.focus()
    fireEvent.keyDown(textarea, { code: 'KeyC', key: 'c' })
    expect(startField().value).toBe('')
    fireEvent.keyDown(textarea, { code: 'KeyC', key: 'ç', altKey: true })
    expect(startField().value).not.toBe('')
  })
})

describe('annotation workspace reveal orchestration', () => {
  it('seeks once per marker activation and issues a fresh token each time', () => {
    const { onSeek } = mountPanel()
    expect(listProps().revealRequest).toBeNull()
    fireEvent.click(screen.getByTestId('range-marker-saved'))
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(2)
    const first = listProps().revealRequest!
    expect(first.id).toBe('saved')
    fireEvent.click(screen.getByTestId('range-marker-saved'))
    expect(onSeek).toHaveBeenCalledTimes(2)
    const second = listProps().revealRequest!
    expect(second.id).toBe('saved')
    expect(second.token).toBeGreaterThan(first.token)
  })

  it('routes erased and voice point markers as saved reveals, and passes list selection to the timeline', () => {
    queryState.data.annotations = [note('saved'), { ...note('erased', 30, 5), timing_type: 'point' },
      { ...note('voice', 40, 5), timing_type: 'point', voice: { asset_id: 4, audio_status: 'ready', transcript_status: 'ready', failure_code: null } }]
    const { onSeek } = mountPanel()
    fireEvent.click(screen.getByTestId('voice-marker-erased'))
    expect(listProps().revealRequest?.id).toBe('erased')
    fireEvent.click(screen.getByTestId('voice-marker-voice'))
    expect(listProps().revealRequest?.id).toBe('voice')
    expect(onSeek).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('voice-marker-voice')).not.toHaveAttribute('data-selected')
    act(() => listProps().onSelectedChange('voice'))
    expect(screen.getByTestId('voice-marker-voice')).toHaveAttribute('data-selected', 'true')
  })

  it('selects and focuses the Text tool for a draft marker, with one seek and no list reveal', () => {
    const { onSeek } = mountPanel()
    fillDraft()
    fireEvent.click(tab(/^Voice note/))
    const marker = document.querySelector<HTMLElement>('[data-kind="draft"]')!
    expect(marker).toHaveAccessibleName(/Unsaved text draft/)
    fireEvent.click(marker)
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(10)
    expect(tab(/^Text note/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('group', { name: 'Text note tool' })).toHaveFocus()
    expect(within(editor()).getByLabelText('Commentary')).toHaveValue('Typed text')
    expect(listProps().revealRequest).toBeNull()
  })

  it('explains instead of switching when a draft marker is used during a microphone lock', () => {
    const { onSeek } = mountPanel()
    fillDraft()
    fireEvent.click(tab(/^Voice note/))
    report('recording', { pending: true, blocksToolSwitch: true })
    fireEvent.click(document.querySelector<HTMLElement>('[data-kind="draft"]')!)
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(tab(/^Voice note/)).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('.aw-lock-hint')).toHaveTextContent(/open the unsaved text draft/)
    expect(screen.queryByRole('group', { name: 'Text note tool' })).not.toBeInTheDocument()
    report('preview', { pending: true, hasRecording: true })
    expect(document.querySelector('.aw-lock-hint')).toBeNull()
    expect(tab(/^Voice note/)).toHaveAttribute('aria-selected', 'true')
    // The draft explanation must not resurface with the next, unrelated lock.
    report('recording', { pending: true, blocksToolSwitch: true })
    expect(document.querySelector('.aw-lock-hint')).toHaveTextContent('Stop recording to switch to Text note.')
    expect(document.querySelector('.aw-lock-hint')).not.toHaveTextContent(/unsaved text draft/)
  })

  it('does not focus or switch tools from playback, polling or rerenders', () => {
    const view = mountPanel()
    fillDraft()
    fireEvent.click(tab(/^Voice note/))
    act(() => { view.video.currentTime = 12; view.video.dispatchEvent(new Event('timeupdate')); view.video.dispatchEvent(new Event('seeked')) })
    view.update()
    expect(tab(/^Voice note/)).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(document.body)
    expect(listProps().revealRequest).toBeNull()
  })

  it('owns the Saved notes disclosure and refuses to fold it during a list hold', () => {
    mountPanel()
    expect(listProps().open).toBe(false)
    act(() => listProps().onOpenChange(true))
    expect(screen.getByTestId('saved-list')).toHaveAttribute('data-open', 'true')
    act(() => listProps().onHoldChange({ editing: true, operating: false, locked: true }))
    act(() => listProps().onOpenChange(false))
    expect(listProps().open).toBe(true)
    act(() => listProps().onHoldChange({ editing: false, operating: false, locked: false }))
    act(() => listProps().onOpenChange(false))
    expect(listProps().open).toBe(false)
  })

  it('wires acknowledged voice saves from the current recorder session only', () => {
    mountPanel()
    report('saving', { pending: true, hasRecording: true }, 'live-session')
    expect(listProps().acknowledgedSave).toBeNull()
    act(() => recorder().onAcknowledgedSave?.(note('stale-voice'), 'other-session'))
    expect(listProps().acknowledgedSave).toBeNull()
    act(() => recorder().onAcknowledgedSave?.(note('new-voice'), 'live-session'))
    const first = listProps().acknowledgedSave!
    expect(first.id).toBe('new-voice')
    act(() => recorder().onAcknowledgedSave?.(note('newer-voice'), 'live-session'))
    expect(listProps().acknowledgedSave!.token).toBeGreaterThan(first.token)
  })
})

describe('annotation workspace overlay portal', () => {
  it('is untouched by tool choice and Saved notes state', () => {
    const { target } = mountPanel()
    const stack = within(target).getByTestId('overlay-stack')
    expect(stack.closest('[role="tabpanel"]')).toBeNull()
    expect(stack.closest('.aw-saved')).toBeNull()
    fireEvent.click(tab(/^Voice note/))
    act(() => listProps().onOpenChange(true))
    fireEvent.click(tab(/^Text note/))
    act(() => listProps().onOpenChange(false))
    expect(within(target).getByTestId('overlay-stack')).toBe(stack)
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
  })
})

describe('annotation workspace tool tab keyboard', () => {
  it('moves selection with Arrow/Home/End/Enter once, without media toggles, seeks, captures or saves', async () => {
    const user = userEvent.setup()
    const { video, onSeek } = mountPanel()
    const play = vi.spyOn(video, 'play').mockResolvedValue()
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined)
    tab(/^Text note/).focus()
    await user.keyboard('{ArrowRight}')
    expect(tab(/^Voice note/)).toHaveFocus()
    // Focus moves; selection follows only on explicit activation (or immediately if the primitive auto-activates).
    await user.keyboard('{Enter}')
    expect(tab(/^Voice note/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/^Text note/)).toHaveAttribute('aria-selected', 'false')
    await user.keyboard('{Home}')
    expect(tab(/^Text note/)).toHaveFocus()
    await user.keyboard(' ')
    expect(tab(/^Text note/)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(tab(/^Voice note/)).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(tab(/^Text note/)).toHaveFocus()
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(onSeek).not.toHaveBeenCalled()
    expect(startField().value).toBe('')
    expect(mutation).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])').length).toBe(1)
  })
})

describe('annotation workspace unmocked integration (real VoiceRecorder + real AnnotationList)', () => {
  class FakeMediaRecorder extends EventTarget {
    static isTypeSupported = () => true
    state: RecordingState = 'inactive'
    mimeType: string
    constructor(_stream: MediaStream, options?: MediaRecorderOptions) { super(); this.mimeType = options?.mimeType ?? 'audio/webm' }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      const data = new Event('dataavailable') as BlobEvent
      Object.defineProperty(data, 'data', { value: new Blob(['voice bytes'], { type: this.mimeType }) })
      this.dispatchEvent(data)
      this.dispatchEvent(new Event('stop'))
    }
  }
  const stopTrack = vi.fn()
  let grant: (() => void) | null = null
  function stubMicrophone(delayed = false) {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn(() => delayed ? new Promise<MediaStream>((resolve) => { grant = () => resolve(stream) }) : Promise.resolve(stream)),
    } })
  }
  beforeEach(() => { integ.real = true; stopTrack.mockReset(); grant = null })

  it('(a) retains the recording across tool switches, then saves and reveals via the real acknowledgement', async () => {
    stubMicrophone()
    const user = userEvent.setup()
    const view = mountPanel({}, false, 20)
    await user.click(tab(/^Voice note/))
    await user.click(screen.getByRole('button', { name: /^Record/ }))
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    const preview = await screen.findByTestId('waveform-preview')
    await waitFor(() => expect(tab(/^Voice note/)).toHaveAccessibleName('Voice note · Unsaved recording'))
    await user.click(tab(/^Text note/))
    await user.click(tab(/^Voice note/))
    expect(screen.getByTestId('waveform-preview')).toBe(preview)
    expect(screen.getByRole('button', { name: 'Publish feedback' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save voice note' }))
    await waitFor(() => expect(createVoice).toHaveBeenCalledTimes(1))
    const sent = createVoice.mock.calls[0][0].body
    expect(sent.start_seconds).toBe(20)
    await screen.findByText(/Voice note saved at/)
    expect(screen.queryByTestId('waveform-preview')).not.toBeInTheDocument()
    // Not yet in the polled dataset: no reveal offered. Once it arrives (closed list), the notice appears.
    expect(screen.queryByRole('button', { name: 'Show saved note' })).not.toBeInTheDocument()
    const polled: AnnotationsResponse = { ...queryState.data, annotations: [note('saved'), { ...note('voice-saved', 20, 5), client_uuid: sent.client_uuid, timing_type: 'point' as const,
      voice: { asset_id: 7, audio_status: 'ready' as const, transcript_status: 'ready' as const, failure_code: null } }] }
    queryState = { ...queryState, data: polled, currentData: polled }
    view.update()
    await user.click(await screen.findByRole('button', { name: 'Show saved note' }))
    expect(screen.getByRole('button', { name: 'Saved notes (2)' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('list', { name: 'Your commentary' })).getAllByRole('listitem').map((li) => li.getAttribute('data-annotation-id')))
      .toContain('voice-saved')
  })

  it('(b) holds the page during a saved edit, defers an off-page marker, then reveals it explicitly', async () => {
    queryState.data.annotations = Array.from({ length: 8 }, (_, i) => note(`n${i + 1}`, (i + 1) * 10, 4))
    stubMicrophone()
    const user = userEvent.setup()
    const { onSeek } = mountPanel()
    await user.click(screen.getByRole('button', { name: 'Saved notes (8)' }))
    const rowIds = () => within(screen.getByRole('list', { name: 'Your commentary' })).getAllByRole('listitem').map((li) => li.getAttribute('data-annotation-id'))
    expect(rowIds()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    await user.click(screen.getAllByRole('button', { name: /^Edit,/ })[0])
    expect(screen.getByRole('region', { name: 'Editing annotation' })).toBeInTheDocument()
    // Collapse is refused while the edit holds the section open.
    const toggle = screen.getByRole('button', { name: 'Saved notes (8)' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByTestId('range-marker-n8'))
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(80)
    expect(rowIds()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    expect(screen.getByRole('region', { name: 'Editing annotation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show selected note' })).toBeDisabled()
    await user.click(within(screen.getByRole('region', { name: 'Editing annotation' })).getByRole('button', { name: 'Cancel' }))
    expect(rowIds()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    await user.click(screen.getByRole('button', { name: 'Show selected note' }))
    expect(rowIds()).toEqual(['n7', 'n8'])
    expect(screen.getByRole('button', { name: /^Hide details, annotation at/ })).toBeInTheDocument()
  })

  it('(c) reports the real recorder session lock while requesting and recording, and releases on stop and unmount', async () => {
    stubMicrophone(true)
    const onLock = vi.fn()
    const user = userEvent.setup()
    const view = mountPanel({ onRecordingLockChange: onLock }, false, 20)
    await user.click(tab(/^Voice note/))
    expect(onLock).toHaveBeenLastCalledWith(false)
    await user.click(screen.getByRole('button', { name: /^Record/ }))
    await screen.findByText('Requesting microphone access…')
    expect(onLock).toHaveBeenLastCalledWith(true)
    expect(tab(/^Text note/)).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { grant?.() })
    const stop = await screen.findByRole('button', { name: 'Stop' })
    expect(onLock).toHaveBeenLastCalledWith(true)
    await user.click(stop)
    await screen.findByTestId('waveform-preview')
    expect(onLock).toHaveBeenLastCalledWith(false)
    await user.click(screen.getByRole('button', { name: 'Re-record' }))
    await user.click(screen.getByRole('button', { name: /^Record/ }))
    await act(async () => { grant?.() })
    await screen.findByRole('button', { name: 'Stop' })
    expect(onLock).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(onLock).toHaveBeenLastCalledWith(false)
    expect(stopTrack).toHaveBeenCalled()
  })
})
