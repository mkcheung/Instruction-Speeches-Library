import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrackSelector } from '@/components/review/TrackSelector'
import type { Annotation } from '@/features/annotation/types'
import type { useVoiceInterjections } from '@/hooks/useVoiceInterjections'
import { NO_COMMENTARY, type CommentaryTrackOption } from '@/hooks/useCommentaryTrack'
import type { RosterReview } from '@/features/review/types'

const noCommentaryOption: CommentaryTrackOption = {
  key: NO_COMMENTARY,
  label: 'No commentary',
  review: null,
  noteCount: 0,
  hasUnread: false,
}

function reviewerOption(overrides: Partial<CommentaryTrackOption> = {}): CommentaryTrackOption {
  return {
    key: 1,
    label: 'Coach Seven',
    review: { id: 1 } as RosterReview,
    noteCount: 0,
    hasUnread: false,
    ...overrides,
  }
}

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
        options={[noCommentaryOption]}
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

/**
 * IMPLEMENTATION-PLANS.md §7.4: a note-count badge and an unread indicator
 * on each reviewer chip. §12's accessible-name contract pins "the chip's
 * name = the reviewer's name" as append-only — both additions render AFTER
 * `option.label`, so the reviewer's name stays an intact leading substring
 * of the chip's full accessible name (Playwright's `getByRole(name:)`
 * defaults to substring matching, which is what makes this safe).
 */
describe('TrackSelector badges', () => {
  function renderWithOptions(options: CommentaryTrackOption[]) {
    return render(
      <TrackSelector
        options={options}
        optionsLoading={false}
        selected="none"
        onSelect={vi.fn()}
        onPrefetch={vi.fn()}
        error={undefined}
        isFetching={false}
        fetchedReviewerName={undefined}
        annotations={[]}
        activeIds={new Set()}
        currentTime={0}
        onSeek={vi.fn()}
        voiceMode="play"
        onVoiceModeChange={vi.fn()}
        voicePlayback={playback()}
      />,
    )
  }

  it('shows the note count in the chip\'s accessible name when noteCount > 0', () => {
    renderWithOptions([noCommentaryOption, reviewerOption({ noteCount: 3 })])
    expect(screen.getByRole('radio', { name: /Coach Seven.*3 notes/ })).toBeInTheDocument()
  })

  it('shows no count badge when noteCount is 0', () => {
    renderWithOptions([noCommentaryOption, reviewerOption({ noteCount: 0 })])
    // The chip is still findable by its bare name (no " · N notes" suffix) —
    // an exact match here is what proves nothing was appended.
    expect(screen.getByRole('radio', { name: 'Coach Seven' })).toBeInTheDocument()
  })

  it('uses singular "note" for a count of exactly 1', () => {
    renderWithOptions([noCommentaryOption, reviewerOption({ noteCount: 1 })])
    expect(screen.getByRole('radio', { name: /Coach Seven.*1 note\b/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /1 notes/ })).not.toBeInTheDocument()
  })

  it('carries the unread signal in the accessible name, not just a decorative dot', () => {
    renderWithOptions([noCommentaryOption, reviewerOption({ hasUnread: true })])
    expect(screen.getByRole('radio', { name: /Coach Seven.*new/ })).toBeInTheDocument()
  })

  it('never shows a count badge or unread indicator on the No commentary chip, even if it somehow carried non-zero values', () => {
    // `useCommentaryTrack` always gives NO_COMMENTARY `noteCount: 0,
    // hasUnread: false` — but `TrackSelector`'s own render guard also
    // explicitly checks `option.review !== null`, not just the field
    // values, so this pins that second, independent guard rather than
    // only re-asserting the hook's fixture-level invariant.
    renderWithOptions([
      { ...noCommentaryOption, noteCount: 5, hasUnread: true },
      reviewerOption(),
    ])
    expect(screen.getByRole('radio', { name: 'No commentary' })).toBeInTheDocument()
  })
})
