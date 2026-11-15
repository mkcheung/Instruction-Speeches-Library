import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transcript } from './Transcript'
import type { Annotation, AnnotationVoice } from '@/features/annotation/types'
import { voiceNote } from '@/test/voiceFixtures'
import type { VoicePlayback } from '@/hooks/useVoiceInterjections'

const base = { duration_seconds: 2, kind: 'observation' as const, topic: null, lock_version: 0 }
const written = (id: string, s: number): Annotation => ({ ...base, id, start_seconds: s, body: `w-${id}`, client_uuid: id, voice: null })
const voiced = (id: string, s: number, audio: AnnotationVoice['audio_status'] = 'ready') =>
  voiceNote(id, s, { body: `v-${id}`, client_uuid: id, voice: { audio_status: audio } })

function playback(patch: Partial<VoicePlayback> = {}): VoicePlayback {
  return { state: 'idle', current: null, hint: null, error: null, source: null, canPlayNotes: true, armNote: vi.fn(), playNote: vi.fn(),
    skip: vi.fn(), suppressResume: vi.fn(), pauseCommentary: vi.fn(), resumeCommentary: vi.fn(), ...patch } as VoicePlayback
}
const notes = [written('1', 1), voiced('2', 2.05), voiced('3', 2.7), voiced('4', 3, 'processing'), voiced('5', 4, 'failed'),
  { ...written('6', 5), timing_type: 'point' as const }]

describe('Transcript row ▶', () => {
  it('shows ▶ only on ready voice rows, direct <li> children after the seek button, with same-second suffixes', () => {
    render(<Transcript annotations={notes} activeIds={new Set()} currentTime={0} onSeek={vi.fn()} voicePlayback={playback()} />)
    const plays = screen.getAllByRole('button', { name: /^Play voice commentary/ })
    expect(plays.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Play voice commentary at 2 seconds, 1 of 2 with this name', 'Play voice commentary at 2 seconds, 2 of 2 with this name'])
    for (const li of screen.getAllByRole('listitem')) {
      const children = [...li.children]
      expect(children.every((c) => c.tagName === 'BUTTON')).toBe(true)
      expect(children[0].getAttribute('aria-label')).toBeNull()
    }
    expect(screen.queryAllByRole('status')).toHaveLength(0)
  })

  it.each([
    ['written', written('1', 1)],
    ['processing', voiced('2', 2, 'processing')],
    ['failed', voiced('3', 3, 'failed')],
    ['erased', { ...voiced('4', 4), voice: null }],
  ])('gives a %s row no ▶', (_name, note) => {
    render(<Transcript annotations={[note]} activeIds={new Set()} currentTime={0} onSeek={vi.fn()} voicePlayback={playback()} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryAllByRole('button', { name: /voice commentary/ })).toHaveLength(0)
  })

  it('counts only rows with ▶ toward the same-second suffix', () => {
    render(<Transcript annotations={[voiced('2', 2.05), voiced('3', 2.7, 'processing')]} activeIds={new Set()} currentTime={0}
      onSeek={vi.fn()} voicePlayback={playback()} />)
    expect(screen.getAllByRole('button', { name: /^Play voice commentary/ }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Play voice commentary at 2 seconds'])
  })

  it('puts the highlight (bg-muted, aria-current) on the <li>, not the seek button', () => {
    render(<Transcript annotations={notes} activeIds={new Set(['2'])} currentTime={0} onSeek={vi.fn()} voicePlayback={playback()} />)
    const current = screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-current') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveClass('bg-muted')
    expect(current[0].textContent).toContain('v-2')
    for (const button of current[0].querySelectorAll('button')) {
      expect(button).not.toHaveAttribute('aria-current')
      expect(button.className.split(' ')).not.toContain('bg-muted')
    }
  })

  it('shows no ▶ when audio is off', () => {
    render(<Transcript annotations={notes} activeIds={new Set()} currentTime={0} onSeek={vi.fn()} voicePlayback={playback({ canPlayNotes: false })} />)
    expect(screen.queryAllByRole('button', { name: /voice commentary/ })).toHaveLength(0)
  })

  it('row click seeks then arms (armNote ignores rows without voice); ▶ never seeks', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    const p = playback()
    render(<Transcript annotations={notes} activeIds={new Set()} currentTime={0} onSeek={onSeek} voicePlayback={p} />)
    await user.click(screen.getByRole('button', { name: /w-1/ }))
    expect(p.armNote).toHaveBeenCalledWith(notes[0])
    vi.mocked(p.armNote).mockClear()
    await user.click(screen.getByRole('button', { name: /v-2/ }))
    expect(onSeek).toHaveBeenLastCalledWith(2.05)
    expect(p.armNote).toHaveBeenCalledWith(notes[1])
    expect(onSeek.mock.invocationCallOrder.at(-1)!).toBeLessThan(vi.mocked(p.armNote).mock.invocationCallOrder[0])
    onSeek.mockClear()
    await user.click(screen.getAllByRole('button', { name: /^Play voice commentary/ })[1])
    expect(p.playNote).toHaveBeenCalledWith(notes[2])
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('follows its own note: loading is aria-disabled and inert, playing pauses, paused resumes, focus kept', () => {
    const p = playback({ current: notes[1], state: 'loading' })
    const view = render(<Transcript annotations={notes} activeIds={new Set()} currentTime={0} onSeek={vi.fn()} voicePlayback={p} />)
    const button = screen.getByRole('button', { name: 'Loading voice commentary at 2 seconds, 1 of 2 with this name' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    expect(p.playNote).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
    view.rerender(<Transcript annotations={notes} activeIds={new Set()} currentTime={0} onSeek={vi.fn()} voicePlayback={{ ...p, state: 'playing' }} />)
    expect(button).toHaveAccessibleName('Pause voice commentary at 2 seconds, 1 of 2 with this name')
    fireEvent.click(button)
    expect(p.pauseCommentary).toHaveBeenCalledOnce()
    view.rerender(<Transcript annotations={notes} activeIds={new Set()} currentTime={0} onSeek={vi.fn()} voicePlayback={{ ...p, state: 'paused' }} />)
    expect(button).toHaveAccessibleName('Resume voice commentary at 2 seconds, 1 of 2 with this name')
    fireEvent.click(button)
    expect(p.resumeCommentary).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Play voice commentary at 2 seconds, 2 of 2 with this name' })).toBeInTheDocument()
  })
})
