import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/features/annotation/types'
import type { useVoiceInterjections } from '@/hooks/useVoiceInterjections'
import { FullscreenVoiceControls } from '@/components/annotation/VoicePlaybackControls'

type Playback = ReturnType<typeof useVoiceInterjections>
const note = { id: '1', start_seconds: 1, duration_seconds: 2, kind: 'observation', topic: null, body: 'b',
  lock_version: 0, client_uuid: 'u', voice: { asset_id: 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null } } as Annotation

function playback(patch: Partial<Playback> = {}): Playback {
  return { state: 'idle', current: null, hint: null, error: null, skip: vi.fn(), suppressResume: vi.fn(),
    pauseCommentary: vi.fn(), resumeCommentary: vi.fn(), ...patch } as Playback
}

describe('FullscreenVoiceControls', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<FullscreenVoiceControls playback={playback()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['current', { current: note, state: 'playing' as const }, 'Playing voice commentary'],
    ['hint', { hint: note, state: 'hinting' as const }, 'Commentary ahead'],
    ['error', { error: 'Boom' }, 'Boom'],
  ])('renders for %s', (_name, patch, text) => {
    render(<FullscreenVoiceControls playback={playback(patch)} />)
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument()
  })

  it('Escape inside skips, and neither keys nor clicks propagate', () => {
    const p = playback({ current: note, state: 'playing' })
    const outerKey = vi.fn()
    const outerClick = vi.fn()
    render(<div onKeyDown={outerKey} onClick={outerClick}><FullscreenVoiceControls playback={p} /></div>)
    const button = screen.getByRole('button', { name: 'Skip commentary' })
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(p.skip).toHaveBeenCalledOnce()
    fireEvent.keyDown(button, { key: 'a' })
    expect(p.skip).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Pause commentary' }))
    expect(outerKey).not.toHaveBeenCalled()
    expect(outerClick).not.toHaveBeenCalled()
  })
})
