import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceAnnotationRow } from '@/components/annotation/VoiceAnnotationRow'
import type { Annotation } from '@/features/annotation/types'

const api = vi.hoisted(() => ({
  loadAudio: vi.fn(),
  retryTranscript: vi.fn(),
  updateAnnotation: vi.fn(),
  fetching: false,
}))

vi.mock('@/features/annotation/annotationApi', () => ({
  useLazyGetVoiceAudioUrlQuery: () => [api.loadAudio, { isFetching: api.fetching }],
  useRetryVoiceTranscriptMutation: () => [api.retryTranscript, { isLoading: false }],
  useUpdateAnnotationMutation: () => [api.updateAnnotation, { isLoading: false }],
  useCreateAnnotationMutation: () => [vi.fn(), { isLoading: false }],
}))

function voice(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: '17',
    start_seconds: 12.5,
    duration_seconds: 3,
    kind: 'observation',
    topic: null,
    body: 'Original transcript',
    lock_version: 4,
    client_uuid: 'voice-17',
    voice: { asset_id: 71, audio_status: 'ready', transcript_status: 'ready', failure_code: null },
    ...overrides,
  }
}

function row(annotation: Annotation, extra: Partial<React.ComponentProps<typeof VoiceAnnotationRow>> = {}) {
  return (
    <VoiceAnnotationRow
      annotation={annotation}
      speechId={1}
      reviewId={2}
      userId="3"
      isCurrent={false}
      onSeek={vi.fn()}
      onDelete={vi.fn(async () => undefined)}
      {...extra}
    />
  )
}

function renderRow(annotation: Annotation) {
  return render(row(annotation))
}

const erased = (overrides: Partial<Annotation> = {}) => voice({ timing_type: 'point', voice: null, ...overrides })

describe('VoiceAnnotationRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.fetching = false
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    localStorage.clear()
    api.retryTranscript.mockReturnValue({ unwrap: () => Promise.resolve({}) })
    api.updateAnnotation.mockImplementation(({ body }: { body: { body: string; lock_version: number } }) => ({
      unwrap: () => Promise.resolve(voice({ body: body.body, lock_version: body.lock_version + 1 })),
    }))
    api.loadAudio.mockReturnValue({ unwrap: () => Promise.resolve({ audio: { url: 'blob:voice', expires_at: '' } }) })
  })

  it('edits a ready transcript with its optimistic lock version', async () => {
    const user = userEvent.setup()
    renderRow(voice())

    await user.click(screen.getByRole('button', { name: /^Edit transcript/ }))
    const editor = screen.getByRole('textbox', { name: 'Transcript' })
    await user.clear(editor)
    await user.type(editor, 'Coach corrected transcript')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(api.updateAnnotation).toHaveBeenCalledWith({
      speechId: 1,
      reviewId: 2,
      annotationId: '17',
      body: { lock_version: 4, body: 'Coach corrected transcript' },
    })
  })

  it('keeps typed text and adopts the server lock after a conflict', async () => {
    const user = userEvent.setup()
    api.updateAnnotation
      .mockReturnValueOnce({
        unwrap: () => Promise.reject({ status: 409, data: { message: 'Conflict', conflictSource: 'self', current: voice({ body: 'Server text', lock_version: 9 }) } }),
      })
      .mockReturnValueOnce({ unwrap: () => Promise.resolve(voice({ body: 'My unsaved text', lock_version: 10 })) })
    renderRow(voice())

    await user.click(screen.getByRole('button', { name: /^Edit transcript/ }))
    const editor = screen.getByRole('textbox', { name: 'Transcript' })
    await user.clear(editor)
    await user.type(editor, 'My unsaved text')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed elsewhere/i)
    expect(editor).toHaveValue('My unsaved text')
    expect(api.updateAnnotation).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(api.updateAnnotation).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(api.updateAnnotation).toHaveBeenLastCalledWith(expect.objectContaining({
      body: { lock_version: 9, body: 'My unsaved text' },
    }))
  })

  it('offers transcript retry only for a failed transcript', async () => {
    const user = userEvent.setup()
    renderRow(voice({ body: '', voice: { asset_id: 71, audio_status: 'ready', transcript_status: 'failed', failure_code: 'voice_transcription_failed' } }))

    await user.click(screen.getByRole('button', { name: /^Show details/ }))
    await user.click(screen.getByRole('button', { name: /^Retry transcript/ }))
    expect(api.retryTranscript).toHaveBeenCalledWith({ speechId: 1, reviewId: 2, annotationId: '17' })
    expect(screen.queryByRole('button', { name: /^Edit transcript/ })).not.toBeInTheDocument()
  })

  it('adopts an asynchronously completed transcript and the lock returned by each save', async () => {
    const user = userEvent.setup()
    const pending = voice({ body: '', lock_version: 2, voice: { asset_id: 71, audio_status: 'ready', transcript_status: 'pending', failure_code: null } })
    const rendered = renderRow(pending)
    rendered.rerender(row(voice({ body: 'Whisper result', lock_version: 7 })))

    await user.click(screen.getByRole('button', { name: /^Edit transcript/ }))
    const editor = screen.getByRole('textbox', { name: 'Transcript' })
    expect(editor).toHaveValue('Whisper result')
    await user.clear(editor)
    await user.type(editor, 'First edit')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await user.click(screen.getByRole('button', { name: /^Edit transcript/ }))
    await user.clear(screen.getByRole('textbox', { name: 'Transcript' }))
    await user.type(screen.getByRole('textbox', { name: 'Transcript' }), 'Second edit')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(api.updateAnnotation).toHaveBeenNthCalledWith(1, expect.objectContaining({ body: { lock_version: 7, body: 'First edit' } }))
    expect(api.updateAnnotation).toHaveBeenNthCalledWith(2, expect.objectContaining({ body: { lock_version: 8, body: 'Second edit' } }))
  })

  it('recovers from an expired presigned preview URL by re-fetching on the next click', async () => {
    // Code-review finding: the fetched audio URL is presigned with a fixed
    // TTL (MediaUrlSigner::DEFAULT_TTL_SECONDS, 600s). preview() no-ops
    // once audioUrl is set (`if (audioUrl) return`), so without clearing
    // it on playback error, a session left open past the TTL got a
    // silent, permanently unrecoverable "Preview audio" button.
    const user = userEvent.setup()
    api.loadAudio
      .mockReturnValueOnce({ unwrap: () => Promise.resolve({ audio: { url: 'blob:voice-expired', expires_at: '' } }) })
      .mockReturnValueOnce({ unwrap: () => Promise.resolve({ audio: { url: 'blob:voice-fresh', expires_at: '' } }) })
    renderRow(voice())

    await user.click(screen.getByRole('button', { name: /^Preview audio/ }))
    const audio = await screen.findByLabelText('Voice note audio')
    expect(audio).toHaveAttribute('src', 'blob:voice-expired')

    act(() => {
      audio.dispatchEvent(new Event('error'))
    })
    expect(screen.queryByLabelText('Voice note audio')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Preview audio/ }))
    expect(api.loadAudio).toHaveBeenCalledTimes(2)
    expect(await screen.findByLabelText('Voice note audio')).toHaveAttribute('src', 'blob:voice-fresh')
  })

  it('never lets an acknowledged saved object revive audio the latest row has erased', async () => {
    const user = userEvent.setup()
    const rendered = renderRow(voice())
    await user.click(screen.getByRole('button', { name: /^Edit transcript/ }))
    const editor = screen.getByRole('textbox', { name: 'Transcript' })
    await user.clear(editor)
    await user.type(editor, 'Acknowledged body')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    // The poll still has the older lock_version, but the audio is now erased.
    rendered.rerender(row(erased()))
    expect(screen.queryByRole('button', { name: /^Preview audio/ })).not.toBeInTheDocument()
    expect(screen.getByText('Voice note · Audio unavailable')).toBeInTheDocument()
    expect(screen.getByText('Acknowledged body', { selector: 'p.whitespace-pre-wrap' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Edit transcript/ })).toBeInTheDocument()
  })

  it('keeps the same transcript editor and typed text through audio erasure', async () => {
    const user = userEvent.setup()
    const onEditingChange = vi.fn()
    const rendered = render(row(voice(), { onEditingChange }))
    await user.click(screen.getByRole('button', { name: /^Edit transcript/ }))
    const editor = screen.getByRole('textbox', { name: 'Transcript' })
    await user.type(editor, ' plus draft')
    rendered.rerender(row(erased(), { onEditingChange }))
    expect(screen.getByRole('textbox', { name: 'Transcript' })).toBe(editor)
    expect(editor).toHaveValue('Original transcript plus draft')
    expect(onEditingChange).toHaveBeenCalledTimes(1)
    expect(onEditingChange).toHaveBeenCalledWith('17', true)
  })

  it('pauses and unmounts preview audio when inactive or when details close', async () => {
    const user = userEvent.setup()
    const pause = vi.mocked(HTMLMediaElement.prototype.pause)
    const rendered = renderRow(voice())
    await user.click(screen.getByRole('button', { name: /^Preview audio/ }))
    await screen.findByLabelText('Voice note audio')
    pause.mockClear()
    rendered.rerender(row(voice(), { audioActive: false }))
    expect(pause).toHaveBeenCalled()
    expect(screen.queryByLabelText('Voice note audio')).not.toBeInTheDocument()
    rendered.rerender(row(voice(), { audioActive: true }))
    expect(await screen.findByLabelText('Voice note audio')).toBeInTheDocument()
    pause.mockClear()
    await user.click(screen.getByRole('button', { name: /^Hide details/ }))
    expect(pause).toHaveBeenCalled()
    expect(screen.queryByLabelText('Voice note audio')).not.toBeInTheDocument()
  })

  it('does not reopen details or mount audio when a late URL resolves after the details closed', async () => {
    const user = userEvent.setup()
    let resolve!: (value: { audio: { url: string; expires_at: string } }) => void
    api.loadAudio.mockReturnValue({ unwrap: () => new Promise((done) => { resolve = done }) })
    renderRow(voice())
    await user.click(screen.getByRole('button', { name: /^Preview audio/ }))
    await user.click(screen.getByRole('button', { name: /^Hide details/ }))
    await act(async () => { resolve({ audio: { url: 'blob:late', expires_at: '' } }) })
    expect(screen.getByRole('button', { name: /^Show details/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Voice note audio')).not.toBeInTheDocument()
  })

  it('keeps the visible Loading text inside the preview button accessible name', () => {
    api.fetching = true
    renderRow(voice())
    const button = screen.getByRole('button', { name: /^Loading…/ })
    expect(button).toHaveTextContent('Loading…')
  })
})
