import { useState, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import type { Annotation } from '@/features/annotation/types'
import type { Review } from '@/features/review/types'

const loadAudio = vi.hoisted(() => vi.fn())
const mutation = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }))
let queryState: Record<string, unknown>
vi.mock('@/features/annotation/annotationApi', () => ({
  useGetAnnotationsQuery: () => queryState,
  useClearAnnotationsMutation: () => [mutation, { isLoading: false }],
  useCreateAnnotationMutation: () => [mutation, { isLoading: false }],
  useUpdateAnnotationMutation: () => [mutation, { isLoading: false }],
  useDeleteAnnotationMutation: () => [mutation, { isLoading: false }],
  useRestoreVoiceAnnotationMutation: () => [mutation, { isLoading: false }],
  useRestorePointAnnotationMutation: () => [mutation, { isLoading: false }],
  useLazyGetVoiceAudioUrlQuery: () => [loadAudio, { isFetching: false }],
  useRetryVoiceTranscriptMutation: () => [mutation, { isLoading: false }],
}))
vi.mock('@/features/review/reviewApi', () => ({
  usePublishReviewMutation: () => [mutation, { isLoading: false }],
  useAbandonReviewMutation: () => [mutation, { isLoading: false }],
}))
vi.mock('@/hooks/useAnnotationChannel', () => ({ useAnnotationChannel: () => vi.fn() }))
vi.mock('@/components/annotation/VoiceRecorder', () => ({
  VoiceRecorder: ({ onAuthorIntent }: { onAuthorIntent?: () => void }) => {
    const [n, setN] = useState(0)
    return <button type="button" onClick={() => { onAuthorIntent?.(); setN(n + 1) }}>Capture voice position {n}</button>
  },
}))

import { AnnotationComposerPanel } from './AnnotationComposerPanel'
import { FakeAudio, playableVideo } from '@/test/voiceAudio'

function voice(id: string, start: number): Annotation {
  return { id, timing_type: 'point', start_seconds: start, duration_seconds: 2, kind: 'observation', topic: null, body: `voice ${id}`,
    lock_version: 0, client_uuid: `uuid-${id}`,
    voice: { asset_id: Number(id), audio_status: 'ready', transcript_status: 'ready', failure_code: null } }
}
const fire = (video: HTMLVideoElement, type: string) => video.dispatchEvent(new Event(type))
const ids = () => loadAudio.mock.calls.map(([arg]) => arg.annotationId)
const targets: HTMLElement[] = []

function mount() {
  const target = document.createElement('div')
  document.body.append(target)
  targets.push(target)
  const video = playableVideo()
  video.currentTime = 5
  video.pause()
  vi.mocked(video.pause).mockClear()
  const onSeek = vi.fn((seconds: number) => { act(() => { video.currentTime = seconds; fire(video, 'seeking'); fire(video, 'seeked') }) })
  const props: ComponentProps<typeof AnnotationComposerPanel> = {
    speechId: 1, review: { id: 9, status: 'in_progress', first_published_at: null } as Review,
    videoEl: video, durationSeconds: 100, userId: '3', canRecordVoice: true, onSeek,
    previewTarget: target, previewEnabled: true, previewAnchor: 'default',
  }
  const router = createMemoryRouter([{ path: '*', element: <AnnotationComposerPanel {...props} /> }])
  render(<RouterProvider router={router} />)
  return { video, onSeek }
}
function openSaved() {
  const toggle = screen.getByRole('button', { name: /^Saved notes/ })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
}

beforeEach(() => {
  FakeAudio.instances = []
  localStorage.clear()
  loadAudio.mockReset()
  loadAudio.mockImplementation(({ annotationId }: { annotationId: string }) => ({
    unwrap: () => Promise.resolve({ audio: { url: `https://media/${annotationId}.m4a`, expires_at: '' } }), abort: vi.fn(),
  }))
  vi.stubGlobal('Audio', FakeAudio)
  const data = { review_id: 9, reviewer: null, annotations: [voice('1', 10), voice('2', 30)] }
  queryState = { data, currentData: data, isError: false, isFetching: false, isSuccess: true, refetch: vi.fn() }
})
afterEach(() => {
  cleanup()
  for (const target of targets.splice(0)) target.remove()
  vi.unstubAllGlobals()
})

describe('coach voice-note opt-in', () => {
  it('a voice marker click seeks then arms through the panel engine; the next Play starts that note', async () => {
    const { video, onSeek } = mount()
    fireEvent.click(screen.getByTestId('voice-marker-1'))
    expect(onSeek).toHaveBeenCalledWith(10)
    expect(await screen.findByText(/Commentary ahead/)).toBeInTheDocument()
    expect(ids()).toEqual([])
    act(() => fire(video, 'play'))
    expect(ids()).toEqual(['1'])
  })

  it('"Go to time" on a saved voice row seeks then arms', async () => {
    const { video, onSeek } = mount()
    openSaved()
    fireEvent.click(screen.getAllByRole('button', { name: /^Go to time/ })[1])
    expect(onSeek).toHaveBeenCalledWith(30)
    expect(await screen.findByText(/Commentary ahead/)).toBeInTheDocument()
    act(() => fire(video, 'play'))
    expect(ids()).toEqual(['2'])
  })

  it('author intent (suppressResume) clears the cue, so Play does not start the armed note', async () => {
    const { video } = mount()
    fireEvent.click(screen.getByTestId('voice-marker-1'))
    await screen.findByText(/Commentary ahead/)
    fireEvent.click(screen.getByRole('tab', { name: /^Voice note/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Capture voice position/ }))
    act(() => fire(video, 'play'))
    expect(ids()).toEqual([])
  })

  it("the composer's own ] shortcut seeks to the next saved voice note and arms it", async () => {
    const { video, onSeek } = mount()
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ']', code: 'BracketRight', bubbles: true })) })
    expect(onSeek).toHaveBeenCalledWith(10)
    expect(await screen.findByText(/Commentary ahead/)).toBeInTheDocument()
    expect(ids()).toEqual([])
    act(() => fire(video, 'play'))
    expect(ids()).toEqual(['1'])
  })

  it('auto-play off arms nothing', async () => {
    const { video } = mount()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-play my voice notes' }))
    fireEvent.click(screen.getByTestId('voice-marker-1'))
    openSaved()
    fireEvent.click(screen.getAllByRole('button', { name: /^Go to time/ })[0])
    await act(async () => {})
    expect(screen.queryByText(/Commentary ahead/)).toBeNull()
    act(() => fire(video, 'play'))
    expect(ids()).toEqual([])
  })
})
