import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrackSelector } from '@/components/review/TrackSelector'
import type { Annotation } from '@/features/annotation/types'
import type { useVoiceInterjections } from '@/hooks/useVoiceInterjections'

const note: Annotation = {
  id: '1', start_seconds: 10, duration_seconds: 2, kind: 'observation', topic: null,
  body: 'Spoken note', lock_version: 0, client_uuid: 'voice-1',
  voice: { asset_id: 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null },
}

function playback(overrides: Partial<ReturnType<typeof useVoiceInterjections>> = {}) {
  return {
    state: 'idle', current: null, hint: null, skip: vi.fn(), pauseCommentary: vi.fn(), resumeCommentary: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useVoiceInterjections>
}

describe('TrackSelector voice controls', () => {
  it('keeps reviewer selection and voice mode as independent radiogroups', async () => {
    const user = userEvent.setup()
    const selectTrack = vi.fn()
    const selectMode = vi.fn()
    render(
      <TrackSelector
        options={[{ key: 'none', label: 'No commentary', review: null }]}
        optionsLoading={false}
        selected="none"
        onSelect={selectTrack}
        onPrefetch={vi.fn()}
        error={undefined}
        isFetching={false}
        fetchedReviewerName={undefined}
        annotations={[]}
        activeIds={new Set()}
        currentTime={0}
        onSeek={vi.fn()}
        voiceMode="play"
        onVoiceModeChange={selectMode}
        voicePlayback={playback()}
      />,
    )

    expect(screen.getAllByRole('radiogroup')).toHaveLength(2)
    await user.click(screen.getByRole('radio', { name: 'Text only' }))
    expect(selectMode).toHaveBeenCalledWith('text')
    expect(selectTrack).not.toHaveBeenCalled()
  })

  it('shows the approaching hint and exposes Pause and Skip for the active note', async () => {
    const user = userEvent.setup()
    const controls = playback({ state: 'playing', current: note, hint: note })
    const rendered = render(
      <TrackSelector
        options={[]}
        optionsLoading={false}
        selected="none"
        onSelect={vi.fn()}
        onPrefetch={vi.fn()}
        error={undefined}
        isFetching={false}
        fetchedReviewerName={undefined}
        annotations={[note]}
        activeIds={new Set(['1'])}
        currentTime={10}
        onSeek={vi.fn()}
        voiceMode="play"
        onVoiceModeChange={vi.fn()}
        voicePlayback={playback({ hint: note })}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Commentary ahead')

    rendered.rerender(
      <TrackSelector
        options={[]}
        optionsLoading={false}
        selected="none"
        onSelect={vi.fn()}
        onPrefetch={vi.fn()}
        error={undefined}
        isFetching={false}
        fetchedReviewerName={undefined}
        annotations={[note]}
        activeIds={new Set(['1'])}
        currentTime={10}
        onSeek={vi.fn()}
        voiceMode="play"
        onVoiceModeChange={vi.fn()}
        voicePlayback={controls}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Pause commentary' }))
    await user.click(screen.getByRole('button', { name: /Skip/ }))
    expect(controls.pauseCommentary).toHaveBeenCalled()
    expect(controls.skip).toHaveBeenCalled()
  })
})
