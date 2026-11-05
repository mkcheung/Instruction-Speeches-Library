import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { AnnotationComposerPanel } from '@/components/annotation/AnnotationComposerPanel'
import { useVoiceInterjections } from '@/hooks/useVoiceInterjections'
import type { ReactNode } from 'react'
import type { Annotation } from '@/features/annotation/types'
import type { Review } from '@/features/review/types'

const makeVoiceRows = (count: number): Annotation[] => Array.from({ length: count }, (_, index) => ({
  id: String(index + 1),
  start_seconds: index * 10,
  duration_seconds: index + 1,
  kind: 'observation',
  topic: null,
  body: `Transcript ${index + 1}`,
  lock_version: 0,
  client_uuid: `voice-${index + 1}`,
  voice: { asset_id: index + 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null },
}))
let voiceRows = makeVoiceRows(7)

// Stable across renders: a per-render trigger would rebuild the voice controller every render.
const { loadVoiceAudioUrl } = vi.hoisted(() => {
  const trigger = (() => Promise.resolve({ data: { url: 'https://audio.test/note.m4a' } })) as unknown
  return { loadVoiceAudioUrl: [trigger] as const }
})
vi.mock('@/features/annotation/annotationApi', () => ({
  useLazyGetVoiceAudioUrlQuery: () => loadVoiceAudioUrl,
  useGetAnnotationsQuery: () => ({ data: { annotations: voiceRows } }),
  useClearAnnotationsMutation: () => [vi.fn(() => ({ unwrap: () => Promise.resolve({}) })), { isLoading: false }],
}))
let abandonResult: () => Promise<unknown> = () => Promise.resolve({})
const abandonSpy = vi.fn((arg: unknown) => ({ unwrap: () => abandonResult().then(() => arg) }))

vi.mock('@/features/review/reviewApi', () => ({
  usePublishReviewMutation: () => [vi.fn(() => ({ unwrap: () => Promise.resolve({ published_count: 7 }) })), { isLoading: false }],
  useAbandonReviewMutation: () => [abandonSpy, { isLoading: false }],
}))
vi.mock('@/hooks/useTimedAnnotations', () => ({ useTimedAnnotations: () => new Set<string>() }))
vi.mock('@/hooks/useVideoCurrentTime', () => ({ useVideoCurrentTime: () => 0 }))
type VoiceHook = typeof import('@/hooks/useVoiceInterjections').useVoiceInterjections
let playbackOverride: Partial<ReturnType<VoiceHook>> | null = null
vi.mock('@/hooks/useVoiceInterjections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useVoiceInterjections')>()
  return { useVoiceInterjections: vi.fn((args: Parameters<VoiceHook>[0]) => {
    const real = actual.useVoiceInterjections(args)
    return playbackOverride ? { ...real, ...playbackOverride } : real
  }) }
})
vi.mock('@/components/annotation/OverlayStack', () => ({ OverlayStack: () => null }))
vi.mock('@/components/annotation/TimelineStrip', () => ({ TimelineStrip: () => null }))
const captured: { composer?: Record<string, unknown>; list?: Record<string, unknown>; recorder?: Record<string, unknown>; confirmClear?: () => void } = {}
vi.mock('@/components/annotation/Composer', () => ({ Composer: (props: { onPendingChange: (id: string, pending: boolean) => void }) => {
  captured.composer = props
  return <input aria-label="Draft commentary" onChange={(event) => props.onPendingChange('composer-test', event.target.value !== '')} />
} }))
vi.mock('@/components/annotation/AnnotationList', () => ({ AnnotationList: (props: Record<string, unknown>) => { captured.list = props; return null } }))
vi.mock('@/components/annotation/ClearAnnotationsDialog', () => ({ ClearAnnotationsDialog: ({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) => { captured.confirmClear = onConfirm; return <button disabled={disabled} onClick={() => void onConfirm()}>Clear all notes</button> } }))
vi.mock('@/components/annotation/VoiceRecorder', () => ({ VoiceRecorder: (props: { onSessionStateChange: (id: string, report: unknown) => void }) => {
  captured.recorder = props
  return <div data-testid="voice-recorder">
    <button onClick={() => props.onSessionStateChange('s1', { phase: 'recording', pending: true, hasRecording: false, blocksToolSwitch: true })}>mock-start-session</button>
    <button onClick={() => props.onSessionStateChange('s1', null)}>mock-end-session</button>
  </div>
} }))

function TestRouter({ children }: { children: ReactNode }) {
  return <RouterProvider router={createMemoryRouter([{ path: '*', element: children }])} />
}

const review = { id: 9, status: 'in_progress', first_published_at: null } as unknown as Review

describe('AnnotationComposerPanel voice authoring', () => {
  beforeEach(() => {
    voiceRows = makeVoiceRows(7)
    localStorage.clear()
    playbackOverride = null
  })

  it('warns after six notes and sums their full added duration', () => {
    render(
      <TestRouter>
        <AnnotationComposerPanel previewTarget={null} previewEnabled={false} previewAnchor="default" speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} />
      </TestRouter>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('7 voice notes')
    expect(screen.getByRole('status')).toHaveTextContent('28 seconds')
    expect(screen.getByTestId('voice-recorder')).toBeInTheDocument()
  })

  it('does not warn at exactly six voice notes', () => {
    voiceRows = makeVoiceRows(6)
    render(
      <TestRouter>
        <AnnotationComposerPanel previewTarget={null} previewEnabled={false} previewAnchor="default" speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} />
      </TestRouter>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not mount the recorder for a Member', () => {
    render(
      <TestRouter>
        <AnnotationComposerPanel previewTarget={null} previewEnabled={false} previewAnchor="default" speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} />
      </TestRouter>,
    )
    expect(screen.queryByTestId('voice-recorder')).not.toBeInTheDocument()
  })
})

/**
 * IMPLEMENTATION-PLANS.md §7.2.6's traced bug, this component's call
 * site: a successful Abandon unmounts the PARENT (`SpeechWatch`'s whole
 * "Your feedback" tab strip, via `useMyReviewForSpeech` going null), so
 * staying on the page is not a safe fallback — this asserts the
 * navigate-to-`/dashboard` half of the fix. (The other half — the
 * cross-slice `Speech`-tag dispatch inside `withdrawReview`/
 * `abandonReview`'s own `onQueryStarted` — is covered directly against a
 * real store in `features/review/crossSliceInvalidation.test.ts`, since
 * this file mocks `reviewApi` entirely.)
 */
describe('AnnotationComposerPanel Abandon button', () => {
  beforeEach(() => {
    voiceRows = makeVoiceRows(0)
    abandonSpy.mockClear()
    abandonResult = () => Promise.resolve({})
  })

  function renderAt(path: string) {
    const router = createMemoryRouter(
      [
        { path: '/speeches/:id', element: <AnnotationComposerPanel previewTarget={null} previewEnabled={false} previewAnchor="default" speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} /> },
        { path: '/dashboard', element: <div data-testid="dashboard-route">Dashboard</div> },
      ],
      { initialEntries: [path] },
    )
    render(<RouterProvider router={router} />)
    return router
  }

  it('on success: calls abandonReview with { id, speechId } and navigates to /dashboard', async () => {
    const user = userEvent.setup()
    const router = renderAt('/speeches/1')

    await user.click(screen.getByRole('button', { name: /^abandon$/i }))

    expect(abandonSpy).toHaveBeenCalledWith({ id: 9, speechId: 1 })
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(await screen.findByTestId('dashboard-route')).toBeInTheDocument()
  })

  it('on failure: does not navigate away', async () => {
    abandonResult = () => Promise.reject(new Error('network error'))
    const user = userEvent.setup()
    const router = renderAt('/speeches/1')

    await user.click(screen.getByRole('button', { name: /^abandon$/i }))

    await waitFor(() => expect(abandonSpy).toHaveBeenCalled())
    expect(router.state.location.pathname).toBe('/speeches/1')
  })
})


describe('pending feedback coordination', () => {
  beforeEach(() => { voiceRows = []; abandonSpy.mockClear() })
  it('blocks Publish, Clear and Abandon until pending text is explicitly resolved', async () => {
    const user = userEvent.setup()
    render(<TestRouter><AnnotationComposerPanel previewTarget={null} previewEnabled={false} previewAnchor="default" speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} /></TestRouter>)
    const publish = screen.getByRole('button', { name: 'Publish feedback' })
    expect(publish).toBeEnabled()
    await user.type(screen.getByRole('textbox', { name: 'Draft commentary' }), 'Unsaved')
    expect(publish).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear all notes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Abandon' }))
    expect(abandonSpy).not.toHaveBeenCalled()
    await user.clear(screen.getByRole('textbox', { name: 'Draft commentary' }))
    expect(publish).toBeEnabled()
  })
  it('protects route navigation and keeps the pending editor visible when staying', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/speeches/1', element: <AnnotationComposerPanel previewTarget={null} previewEnabled={false} previewAnchor="default" speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} /> },
      { path: '/dashboard', element: <p>Dashboard</p> },
    ], { initialEntries: ['/speeches/1'] })
    render(<RouterProvider router={router} />)
    await user.type(screen.getByRole('textbox', { name: 'Draft commentary' }), 'Keep this text')
    await act(async () => { void router.navigate('/dashboard') })
    expect(await screen.findByRole('dialog', { name: 'Unsaved feedback' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.pathname).toBe('/speeches/1')
    expect(screen.getByRole('textbox', { name: 'Draft commentary' })).toHaveValue('Keep this text')
  })
})


describe('AnnotationComposerPanel voice preview wiring', () => {
  const hook = vi.mocked(useVoiceInterjections)
  const video = document.createElement('video')
  beforeEach(() => {
    voiceRows = makeVoiceRows(2)
    localStorage.clear()
    playbackOverride = null
    hook.mockClear()
    for (const key of Object.keys(captured)) delete captured[key as keyof typeof captured]
  })
  function renderPanel(props: Partial<React.ComponentProps<typeof AnnotationComposerPanel>> = {}) {
    return render(<TestRouter><AnnotationComposerPanel previewTarget={null} previewEnabled previewAnchor="default" speechId={1} review={review}
      videoEl={video} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} {...props} /></TestRouter>)
  }
  const lastArgs = () => hook.mock.calls[hook.mock.calls.length - 1][0]
  const lastResult = () => hook.mock.results[hook.mock.results.length - 1].value as ReturnType<typeof useVoiceInterjections>

  it('hands the engine the video, the voice rows and reviewId when the preview is allowed', () => {
    renderPanel()
    expect(lastArgs()).toMatchObject({ speechId: 1, videoEl: video, audioEnabled: true, resetKey: 9 })
    expect(lastArgs().notes).toHaveLength(2)
  })

  it('hands the engine null when the preview is not allowed', () => {
    renderPanel({ previewEnabled: false })
    expect(lastArgs().videoEl).toBeNull()
  })

  it('suspends (null video) only while a recorder session is pending, and resumes after', async () => {
    const user = userEvent.setup()
    renderPanel()
    expect(lastArgs().videoEl).toBe(video)
    await user.click(screen.getByRole('button', { name: 'mock-start-session', hidden: true }))
    expect(lastArgs().videoEl).toBeNull()
    expect(screen.getByText(/won't auto-play while a recording is in progress or unsaved/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'mock-end-session', hidden: true }))
    expect(lastArgs().videoEl).toBe(video)
    expect(screen.queryByText(/won't auto-play/)).not.toBeInTheDocument()
  })

  it('does not suspend merely because the Voice note tool is selected', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('tab', { name: 'Voice note' }))
    expect(lastArgs().videoEl).toBe(video)
  })

  it('follows the persisted toggle and stores it under the per-user key', async () => {
    const user = userEvent.setup()
    renderPanel()
    const toggle = screen.getByRole('checkbox', { name: 'Auto-play my voice notes' })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(lastArgs().audioEnabled).toBe(false)
    expect(localStorage.getItem('annotation-composer:voice-autoplay:3')).toBe('false')
  })

  it('starts off when the stored preference is false, and hides the D4 hint when off', async () => {
    localStorage.setItem('annotation-composer:voice-autoplay:3', 'false')
    const user = userEvent.setup()
    renderPanel()
    expect(lastArgs().audioEnabled).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'Auto-play my voice notes' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'mock-start-session', hidden: true }))
    expect(screen.queryByText(/won't auto-play/)).not.toBeInTheDocument()
  })

  it('renders the toggle only when there are voice rows, and adds no status at rest', () => {
    voiceRows = makeVoiceRows(0)
    const { unmount } = renderPanel()
    expect(screen.queryByRole('checkbox', { name: 'Auto-play my voice notes' })).not.toBeInTheDocument()
    unmount()
    voiceRows = makeVoiceRows(2)
    renderPanel()
    expect(screen.getByRole('checkbox', { name: 'Auto-play my voice notes' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('forwards suppressResume as onAuthorIntent to Composer, AnnotationList and VoiceRecorder', () => {
    renderPanel()
    const suppress = lastResult().suppressResume
    expect(captured.composer?.onAuthorIntent).toBe(suppress)
    expect(captured.list?.onAuthorIntent).toBe(suppress)
    expect(captured.recorder?.onAuthorIntent).toBe(suppress)
  })

  it('keeps the list active and Record available at rest, and blocks both while interjecting', () => {
    const { unmount } = renderPanel()
    expect(captured.list?.active).toBe(true)
    expect(captured.recorder?.recordBlocked).toBe(false)
    unmount()
    playbackOverride = { current: voiceRows[0] }
    renderPanel()
    expect(captured.list?.active).toBe(false)
    expect(captured.recorder?.recordBlocked).toBe(true)
  })

  it('calls suppressResume when Clear all is confirmed', async () => {
    const suppress = vi.fn()
    playbackOverride = { suppressResume: suppress }
    const user = userEvent.setup()
    renderPanel({ review: { ...review, status: 'in_progress', revoked_at: null } as Review })
    await user.click(screen.getByRole('button', { name: 'Clear all notes' }))
    expect(suppress).toHaveBeenCalledTimes(1)
  })

  it('does not call suppressResume when Clear is refused because of pending work', async () => {
    const suppress = vi.fn()
    playbackOverride = { suppressResume: suppress }
    const user = userEvent.setup()
    renderPanel({ review: { ...review, status: 'in_progress', revoked_at: null } as Review })
    await user.type(screen.getByRole('textbox', { name: 'Draft commentary' }), 'Unsaved')
    await act(async () => { await captured.confirmClear?.() })
    expect(suppress).not.toHaveBeenCalled()
  })

  it('keeps the inline controls in HTML fullscreen when there is no fullscreen target', () => {
    playbackOverride = { current: voiceRows[0], state: 'playing' }
    render(<TestRouter><AnnotationComposerPanel previewTarget={null} previewEnabled previewAnchor="default" speechId={1} review={review}
      videoEl={video} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} htmlFullscreen voiceControlsTarget={null} /></TestRouter>)
    expect(screen.getAllByText('Playing voice commentary')).toHaveLength(1)
  })

  it('shows the playback controls inline, and moves them to the fullscreen target in HTML fullscreen', () => {
    playbackOverride = { current: voiceRows[0], state: 'playing' }
    const target = document.createElement('div')
    document.body.appendChild(target)
    const { rerender } = renderPanel()
    expect(screen.getByText('Playing voice commentary')).toBeInTheDocument()
    rerender(<TestRouter><AnnotationComposerPanel previewTarget={null} previewEnabled previewAnchor="default" speechId={1} review={review}
      videoEl={video} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} htmlFullscreen voiceControlsTarget={target} /></TestRouter>)
    expect(target).toHaveTextContent('Playing voice commentary')
    expect(screen.getAllByText('Playing voice commentary')).toHaveLength(1)
    target.remove()
  })
})
