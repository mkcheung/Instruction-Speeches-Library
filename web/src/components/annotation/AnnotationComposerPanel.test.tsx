import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { AnnotationComposerPanel } from '@/components/annotation/AnnotationComposerPanel'
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

vi.mock('@/features/annotation/annotationApi', () => ({
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
vi.mock('@/hooks/useAutoPausePreference', () => ({ useAutoPausePreference: () => [false, vi.fn()] }))
vi.mock('@/components/annotation/OverlayStack', () => ({ OverlayStack: () => null }))
vi.mock('@/components/annotation/TimelineStrip', () => ({ TimelineStrip: () => null }))
vi.mock('@/components/annotation/Composer', () => ({ Composer: ({ onPendingChange }: { onPendingChange: (id: string, pending: boolean) => void }) => <input aria-label="Draft commentary" onChange={(event) => onPendingChange('composer-test', event.target.value !== '')} /> }))
vi.mock('@/components/annotation/AnnotationList', () => ({ AnnotationList: () => null }))
vi.mock('@/components/annotation/ClearAnnotationsDialog', () => ({ ClearAnnotationsDialog: ({ disabled }: { disabled: boolean }) => <button disabled={disabled}>Clear all notes</button> }))
vi.mock('@/components/annotation/VoiceRecorder', () => ({ VoiceRecorder: () => <div data-testid="voice-recorder" /> }))

function TestRouter({ children }: { children: ReactNode }) {
  return <RouterProvider router={createMemoryRouter([{ path: '*', element: children }])} />
}

const review = { id: 9, status: 'in_progress', first_published_at: null } as unknown as Review

describe('AnnotationComposerPanel voice authoring', () => {
  beforeEach(() => {
    voiceRows = makeVoiceRows(7)
  })

  it('warns after six notes and sums their full added duration', () => {
    render(
      <TestRouter>
        <AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} />
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
        <AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} />
      </TestRouter>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not mount the recorder for a Member', () => {
    render(
      <TestRouter>
        <AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} />
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
        { path: '/speeches/:id', element: <AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} /> },
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
    render(<TestRouter><AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} /></TestRouter>)
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
      { path: '/speeches/1', element: <AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} /> },
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
