import { StrictMode, createContext, useContext, useState, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { AnnotationComposerPanel } from './AnnotationComposerPanel'
import type { Annotation, AnnotationsResponse } from '@/features/annotation/types'
import type { Review } from '@/features/review/types'
import { lastFakeTextTrack } from '@/test/setup'

function note(id: string, start = 2, duration = 4, body = 'Saved written commentary'): Annotation {
  return { id, timing_type: 'range', start_seconds: start, duration_seconds: duration,
    body, kind: 'observation', topic: null, voice: null, lock_version: 0, client_uuid: `uuid-${id}` }
}

let queryState: { data: AnnotationsResponse; currentData?: AnnotationsResponse; isError: boolean; isFetching: boolean; isSuccess: boolean; error?: { status: number | string }; refetch: ReturnType<typeof vi.fn> }
const publish = vi.fn(() => ({ unwrap: () => Promise.resolve({ published_count: 1 }) }))
const mutation = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }))
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
}))
vi.mock('@/features/review/reviewApi', () => ({
  usePublishReviewMutation: () => [publish, { isLoading: false }],
  useAbandonReviewMutation: () => [mutation, { isLoading: false }],
}))
vi.mock('@/hooks/useAnnotationChannel', () => ({ useAnnotationChannel: () => vi.fn() }))
// Only the microphone is a seam: retain a real local Blob/pending flag while
// the production Composer, editor, list, timing hooks and OverlayStack run.
vi.mock('@/components/annotation/VoiceRecorder', () => ({
  VoiceRecorder: ({ onPendingChange }: { onPendingChange: (id: string, pending: boolean) => void }) => {
    const [recording, setRecording] = useState<Blob | null>(null)
    return <button type="button" onClick={() => {
      setRecording(new Blob(['unsaved audio']))
      onPendingChange('recording-test', true)
    }}>{recording ? `Unsaved recording: ${recording.size} bytes` : 'Capture test recording'}</button>
  },
}))

type PanelProps = ComponentProps<typeof AnnotationComposerPanel>
const PanelContext = createContext<PanelProps | null>(null)
function PanelFromContext() {
  const props = useContext(PanelContext)
  return props && <AnnotationComposerPanel {...props} />
}
const targets: HTMLElement[] = []
function makeTarget() {
  const target = document.createElement('div')
  document.body.append(target)
  targets.push(target)
  return target
}
function mountPanel(overrides: Partial<PanelProps> = {}, strict = false) {
  const target = makeTarget()
  const video = document.createElement('video')
  video.currentTime = 3
  const addTrack = vi.spyOn(video, 'addTextTrack')
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
  return { ...rendered, target, video, addTrack, onSeek: props.onSeek,
    update(next: Partial<PanelProps> = {}) { props = { ...props, ...next }; rendered.rerender(ui()) } }
}
function seek(video: HTMLVideoElement, time: number) {
  act(() => { video.currentTime = time; video.dispatchEvent(new Event('seeked')) })
}
function draft(body = 'Live draft commentary', start = '10', end = '15') {
  const editor = screen.getByRole('region', { name: 'New annotation' })
  fireEvent.change(within(editor).getByLabelText('Start'), { target: { value: start } })
  fireEvent.change(within(editor).getByLabelText('End'), { target: { value: end } })
  fireEvent.change(within(editor).getByLabelText('Commentary'), { target: { value: body } })
  return editor
}
function draftOverlay(target: HTMLElement) {
  return target.querySelector<HTMLElement>('[data-draft="true"]')
}

beforeEach(() => {
  const data = { review_id: 9, reviewer: null, annotations: [note('saved')] }
  queryState = { data, currentData: data, isError: false, isFetching: false, isSuccess: true, refetch: vi.fn() }
  publish.mockClear()
  mutation.mockClear()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  for (const target of targets.splice(0)) target.remove()
  vi.useRealTimers()
})

describe('AnnotationComposerPanel external preview', () => {
  it('portals one real stack, leaving the accessible list, timeline, editor and publishing in the panel', async () => {
    const { target, container, onSeek } = mountPanel()
    const stack = within(target).getByTestId('overlay-stack')
    expect(stack).toHaveAttribute('aria-hidden', 'true')
    expect(stack).toHaveClass('pointer-events-none', 'justify-end')
    expect(within(target).getByTestId('overlay-saved')).toHaveAttribute('data-visible', 'true')
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    expect(container.querySelector('[data-testid="overlay-stack"]')).toBeNull()
    expect(container.querySelector('div.pointer-events-none.min-h-16')).toBeNull()
    expect(screen.getAllByRole('list', { name: 'Your commentary' })).toHaveLength(1)
    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    expect(screen.getByLabelText('End')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('range-marker-saved'))
    expect(onSeek).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Publish feedback' }))
    await act(async () => {})
    expect(publish).toHaveBeenCalledWith(9)
  })

  it('uses live editor text and valid range changes in the same engine, including draft styling and removal', () => {
    const { target, video, addTrack } = mountPanel()
    const editor = draft()
    seek(video, 12)
    expect(draftOverlay(target)).toHaveAttribute('data-visible', 'true')
    expect(draftOverlay(target)).toHaveTextContent('Live draft commentary')
    fireEvent.change(within(editor).getByLabelText('Commentary'), { target: { value: 'Revised draft' } })
    expect(draftOverlay(target)).toHaveTextContent('Revised draft')
    fireEvent.change(within(editor).getByLabelText('End'), { target: { value: '25' } })
    fireEvent.change(within(editor).getByLabelText('Start'), { target: { value: '20' } })
    expect(draftOverlay(target)).toHaveAttribute('data-visible', 'false')
    seek(video, 21)
    expect(draftOverlay(target)).toHaveAttribute('data-visible', 'true')
    seek(video, 25)
    expect(draftOverlay(target)).toHaveAttribute('data-visible', 'false')
    seek(video, 22)
    expect(draftOverlay(target)).toHaveAttribute('data-visible', 'true')
    expect(addTrack).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Publish feedback' })).toBeDisabled()
    // Invalid selections are withdrawn by the real editor, not retained as a
    // stale visible draft; its text remains available for correction.
    fireEvent.change(within(editor).getByLabelText('End'), { target: { value: '19' } })
    expect(draftOverlay(target)).toBeNull()
    expect(within(editor).getByLabelText('Commentary')).toHaveValue('Revised draft')
    fireEvent.click(within(editor).getByRole('button', { name: 'Discard new note' }))
    expect(screen.getByRole('button', { name: 'Publish feedback' })).toBeEnabled()
  })

  it('hides/restores only the preview across enablement, null/replaced targets and anchors while retaining pending editors and recording', () => {
    const view = mountPanel()
    const editor = draft()
    const textarea = within(editor).getByLabelText('Commentary')
    fireEvent.click(screen.getByRole('button', { name: 'Capture test recording' }))
    const recording = screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })
    seek(view.video, 12)
    view.update({ previewEnabled: false })
    expect(screen.queryByTestId('overlay-stack')).not.toBeInTheDocument()
    view.update({ previewAnchor: 'top' })
    expect(screen.queryByTestId('overlay-stack')).not.toBeInTheDocument()
    view.update({ previewEnabled: true })
    expect(within(view.target).getByTestId('overlay-stack')).not.toHaveClass('justify-end')
    expect(draftOverlay(view.target)).toHaveAttribute('data-visible', 'true')
    const replacement = makeTarget()
    view.update({ previewTarget: replacement })
    expect(view.target).toBeEmptyDOMElement()
    expect(within(replacement).getByTestId('overlay-stack')).toBeInTheDocument()
    view.update({ previewTarget: null })
    expect(replacement).toBeEmptyDOMElement()
    expect(screen.queryByTestId('overlay-stack')).not.toBeInTheDocument()
    view.update({ previewTarget: replacement, previewAnchor: 'default' })
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    expect(draftOverlay(replacement)).toHaveAttribute('data-visible', 'true')
    expect(screen.getByLabelText('Commentary')).toBe(textarea)
    expect(textarea).toHaveValue('Live draft commentary')
    expect(screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })).toBe(recording)
    expect(screen.getByRole('button', { name: 'Publish feedback' })).toBeDisabled()
    expect(view.video.currentTime).toBe(12)
    expect(view.addTrack).toHaveBeenCalledTimes(1)
  })

  it('rebinds to a replacement video without losing drafts or responding to events from the old source', () => {
    const view = mountPanel()
    const textarea = within(draft()).getByLabelText('Commentary')
    seek(view.video, 12)
    const nextVideo = document.createElement('video')
    nextVideo.currentTime = 11
    const nextTrack = vi.spyOn(nextVideo, 'addTextTrack')
    const nextTarget = makeTarget()
    view.update({ videoEl: nextVideo, previewTarget: nextTarget })
    expect(view.target).toBeEmptyDOMElement()
    expect(draftOverlay(nextTarget)).toHaveAttribute('data-visible', 'true')
    seek(view.video, 60)
    expect(draftOverlay(nextTarget)).toHaveAttribute('data-visible', 'true')
    seek(nextVideo, 16)
    expect(draftOverlay(nextTarget)).toHaveAttribute('data-visible', 'false')
    expect(screen.getByLabelText('Commentary')).toBe(textarea)
    expect(textarea).toHaveValue('Live draft commentary')
    expect(nextTrack).toHaveBeenCalledTimes(1)
    expect(view.addTrack).toHaveBeenCalledTimes(1)
  })

  it('keeps voice recordings and erased voice points out of the timed range engine', () => {
    queryState.data.annotations = [note('saved'),
      { ...note('voice', 2, 80), timing_type: 'point', voice: { asset_id: 4, audio_status: 'ready', transcript_status: 'ready', failure_code: null } },
      { ...note('erased', 2, 80, 'Erased voice transcript'), timing_type: 'point' },
    ]
    const { target, video } = mountPanel()
    expect(within(target).getByTestId('overlay-saved')).toHaveAttribute('data-visible', 'true')
    expect(within(target).getByTestId('overlay-voice')).toHaveAttribute('data-visible', 'false')
    expect(within(target).getByTestId('overlay-erased')).toHaveAttribute('data-visible', 'false')
    expect(lastFakeTextTrack?.addCue.mock.calls.map(([cue]) => cue.id)).toEqual(['saved'])
    seek(video, 50)
    expect(target.querySelector('[data-visible="true"]')).toBeNull()
    expect(screen.getByTestId('voice-marker-voice')).toBeInTheDocument()
    expect(screen.getByTestId('voice-marker-erased')).toBeInTheDocument()
  })

  it.each([401, 403, 404, 410])('suppresses retained annotations on %i without clearing pending authoring state', (status) => {
    const view = mountPanel()
    const textarea = within(draft()).getByLabelText('Commentary')
    fireEvent.click(screen.getByRole('button', { name: 'Capture test recording' }))
    seek(view.video, 12)
    queryState = { ...queryState, isError: true, isSuccess: false, error: { status } }
    view.update()
    expect(view.target).toBeEmptyDOMElement()
    expect(screen.queryByTestId('overlay-stack')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Your draft is retained')
    expect(screen.getByLabelText('Commentary')).toBe(textarea)
    expect(textarea).toHaveValue('Live draft commentary')
    expect(screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })).toBeInTheDocument()
    // RTK retains data while pending, but clears isError. Even an isSuccess
    // projection alongside cached data must not release the denial latch.
    const retainedData = queryState.data
    queryState = { ...queryState, isError: false, isFetching: true, isSuccess: true, error: undefined }
    view.update()
    expect(view.target).toBeEmptyDOMElement()
    expect(screen.getByLabelText('Commentary')).toBe(textarea)
    queryState = { ...queryState, isError: true, isFetching: false, isSuccess: false, error: { status: 500 } }
    view.update()
    expect(view.target).toBeEmptyDOMElement()
    expect(screen.getByRole('alert')).toHaveTextContent('Your draft is retained')
    queryState = { ...queryState, isError: false, isFetching: true, error: undefined }
    view.update()
    expect(view.target).toBeEmptyDOMElement()
    queryState = { ...queryState, isFetching: false, isSuccess: true, currentData: undefined }
    view.update()
    expect(view.target).toBeEmptyDOMElement()
    queryState = { ...queryState, currentData: { ...retainedData, review_id: 99 } }
    view.update()
    expect(view.target).toBeEmptyDOMElement()
    // A successful matching response may be structurally shared with the old
    // data; object identity must not prevent recovery after authorization.
    queryState = { ...queryState, currentData: retainedData }
    view.update()
    expect(draftOverlay(view.target)).toHaveAttribute('data-visible', 'true')
    expect(screen.getByLabelText('Commentary')).toBe(textarea)
    expect(textarea).toHaveValue('Live draft commentary')
    expect(screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })).toBeInTheDocument()
  })

  it('retains saved and live preview, editor, recording and retry behavior through a transient 500 refresh error', () => {
    const view = mountPanel()
    const textarea = within(draft()).getByLabelText('Commentary')
    fireEvent.click(screen.getByRole('button', { name: 'Capture test recording' }))
    seek(view.video, 12)
    const stack = within(view.target).getByTestId('overlay-stack')
    queryState = { ...queryState, isError: true, isSuccess: false, error: { status: 500 } }
    view.update()
    expect(within(view.target).getByTestId('overlay-stack')).toBe(stack)
    expect(draftOverlay(view.target)).toHaveAttribute('data-visible', 'true')
    expect(screen.getByLabelText('Commentary')).toBe(textarea)
    expect(textarea).toHaveValue('Live draft commentary')
    expect(screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading notes' }))
    expect(queryState.refetch).toHaveBeenCalledTimes(1)
    seek(view.video, 3)
    expect(within(view.target).getByTestId('overlay-saved')).toHaveAttribute('data-visible', 'true')
    expect(view.addTrack).toHaveBeenCalledTimes(1)
  })

  it('cleans up actual portals and fade timers through StrictMode, replacement, hiding and unmount', () => {
    vi.useFakeTimers()
    const schedule = vi.spyOn(globalThis, 'setTimeout')
    const cancel = vi.spyOn(globalThis, 'clearTimeout')
    const ghostTimer = () => {
      const index = schedule.mock.calls.map(([, delay]) => delay).lastIndexOf(650)
      expect(index).toBeGreaterThanOrEqual(0)
      return schedule.mock.results[index].value
    }
    const view = mountPanel({}, true)
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    expect(view.addTrack).toHaveBeenCalledTimes(1)
    seek(view.video, 40)
    expect(within(view.target).getByTestId('overlay-saved')).toHaveAttribute('data-visible', 'false')
    const replacedTimer = ghostTimer()
    const replacement = makeTarget()
    view.update({ previewTarget: replacement })
    expect(view.target).toBeEmptyDOMElement()
    expect(within(replacement).queryByTestId('overlay-saved')).not.toBeInTheDocument()
    expect(cancel).toHaveBeenCalledWith(replacedTimer)
    seek(view.video, 3)
    expect(within(replacement).getByTestId('overlay-saved')).toHaveAttribute('data-visible', 'true')
    seek(view.video, 40)
    const hiddenTimer = ghostTimer()
    view.update({ previewEnabled: false })
    expect(replacement).toBeEmptyDOMElement()
    expect(cancel).toHaveBeenCalledWith(hiddenTimer)
    view.update({ previewEnabled: true })
    seek(view.video, 3)
    seek(view.video, 40)
    const unmountedTimer = ghostTimer()
    view.unmount()
    expect(view.target).toBeEmptyDOMElement()
    expect(replacement).toBeEmptyDOMElement()
    expect(cancel).toHaveBeenCalledWith(unmountedTimer)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByTestId('overlay-stack')).not.toBeInTheDocument()
  })
})
