import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceAnnotationRow } from '@/components/annotation/VoiceAnnotationRow'
import type { Annotation } from '@/features/annotation/types'

const api = vi.hoisted(() => ({
  loadAudio: vi.fn(),
  retryTranscript: vi.fn(),
  updateAnnotation: vi.fn(),
}))

vi.mock('@/features/annotation/annotationApi', () => ({
  useLazyGetVoiceAudioUrlQuery: () => [api.loadAudio, { isFetching: false }],
  useRetryVoiceTranscriptMutation: () => [api.retryTranscript, { isLoading: false }],
  useUpdateAnnotationMutation: () => [api.updateAnnotation, { isLoading: false }],
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

function row(annotation: Annotation) {
  return (
    <VoiceAnnotationRow
      annotation={annotation}
      speechId={1}
      reviewId={2}
      isCurrent={false}
      onSeek={vi.fn()}
      onDelete={vi.fn(async () => undefined)}
    />
  )
}

function renderRow(annotation: Annotation) {
  return render(row(annotation))
}

describe('VoiceAnnotationRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.retryTranscript.mockReturnValue({ unwrap: () => Promise.resolve({}) })
    api.updateAnnotation.mockImplementation(({ body }: { body: { body: string } }) => ({
      unwrap: () => Promise.resolve(voice({ body: body.body, lock_version: 5 })),
    }))
    api.loadAudio.mockReturnValue({ unwrap: () => Promise.resolve({ audio: { url: 'blob:voice', expires_at: '' } }) })
  })

  it('edits a ready transcript with its optimistic lock version', async () => {
    const user = userEvent.setup()
    renderRow(voice())

    await user.click(screen.getByRole('button', { name: 'Edit transcript' }))
    const editor = screen.getByRole('textbox', { name: 'Transcript' })
    await user.clear(editor)
    await user.type(editor, 'Coach corrected transcript')
    await user.click(screen.getByRole('button', { name: 'Save transcript' }))

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
        unwrap: () => Promise.reject({ data: { message: 'Conflict', conflictSource: 'self', current: voice({ body: 'Server text', lock_version: 9 }) } }),
      })
      .mockReturnValueOnce({ unwrap: () => Promise.resolve(voice({ body: 'My unsaved text', lock_version: 10 })) })
    renderRow(voice())

    await user.click(screen.getByRole('button', { name: 'Edit transcript' }))
    const editor = screen.getByRole('textbox', { name: 'Transcript' })
    await user.clear(editor)
    await user.type(editor, 'My unsaved text')
    await user.click(screen.getByRole('button', { name: 'Save transcript' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/text is still here/i)
    expect(editor).toHaveValue('My unsaved text')

    await user.click(screen.getByRole('button', { name: 'Save transcript' }))
    expect(api.updateAnnotation).toHaveBeenLastCalledWith(expect.objectContaining({
      body: { lock_version: 9, body: 'My unsaved text' },
    }))
  })

  it('offers transcript retry only for a failed transcript', async () => {
    const user = userEvent.setup()
    renderRow(voice({ body: '', voice: { asset_id: 71, audio_status: 'ready', transcript_status: 'failed', failure_code: 'voice_transcription_failed' } }))

    await user.click(screen.getByRole('button', { name: 'Retry transcript' }))
    expect(api.retryTranscript).toHaveBeenCalledWith({ speechId: 1, reviewId: 2, annotationId: '17' })
    expect(screen.queryByRole('button', { name: 'Edit transcript' })).not.toBeInTheDocument()
  })

  it('adopts an asynchronously completed transcript and the lock returned by each save', async () => {
    const user = userEvent.setup()
    const pending = voice({ body: '', lock_version: 2, voice: { asset_id: 71, audio_status: 'ready', transcript_status: 'pending', failure_code: null } })
    const rendered = renderRow(pending)
    rendered.rerender(row(voice({ body: 'Whisper result', lock_version: 7 })))

    await user.click(screen.getByRole('button', { name: 'Edit transcript' }))
    const editor = screen.getByRole('textbox', { name: 'Transcript' })
    expect(editor).toHaveValue('Whisper result')
    await user.clear(editor)
    await user.type(editor, 'First edit')
    await user.click(screen.getByRole('button', { name: 'Save transcript' }))
    await user.click(screen.getByRole('button', { name: 'Edit transcript' }))
    await user.clear(screen.getByRole('textbox', { name: 'Transcript' }))
    await user.type(screen.getByRole('textbox', { name: 'Transcript' }), 'Second edit')
    await user.click(screen.getByRole('button', { name: 'Save transcript' }))

    expect(api.updateAnnotation).toHaveBeenNthCalledWith(1, expect.objectContaining({ body: { lock_version: 7, body: 'First edit' } }))
    expect(api.updateAnnotation).toHaveBeenNthCalledWith(2, expect.objectContaining({ body: { lock_version: 5, body: 'Second edit' } }))
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

    await user.click(screen.getByRole('button', { name: 'Preview audio' }))
    const audio = await screen.findByLabelText('Voice note audio')
    expect(audio).toHaveAttribute('src', 'blob:voice-expired')

    act(() => {
      audio.dispatchEvent(new Event('error'))
    })
    expect(screen.queryByLabelText('Voice note audio')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Preview audio' }))
    expect(api.loadAudio).toHaveBeenCalledTimes(2)
    expect(await screen.findByLabelText('Voice note audio')).toHaveAttribute('src', 'blob:voice-fresh')
  })
})
