import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EssayReviewerPicker } from '@/components/essay/EssayReviewerPicker'
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

describe('EssayReviewerPicker', () => {
  it('renders nothing when there are no reviewer options', () => {
    const { container } = render(
      <EssayReviewerPicker options={[noCommentaryOption]} selected={NO_COMMENTARY} onSelect={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a chip per reviewer option, and none for No commentary', () => {
    render(
      <EssayReviewerPicker
        options={[noCommentaryOption, reviewerOption({ key: 1, label: 'Coach Seven' }), reviewerOption({ key: 2, label: 'Coach Eight' })]}
        selected={NO_COMMENTARY}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Coach Seven' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Coach Eight' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'No commentary' })).not.toBeInTheDocument()
  })

  it('calls onSelect with the clicked chip\'s key', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <EssayReviewerPicker
        options={[noCommentaryOption, reviewerOption({ key: 1, label: 'Coach Seven' })]}
        selected={NO_COMMENTARY}
        onSelect={onSelect}
      />,
    )
    await user.click(screen.getByRole('radio', { name: 'Coach Seven' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('marks the currently selected reviewer as checked', () => {
    render(
      <EssayReviewerPicker
        options={[noCommentaryOption, reviewerOption({ key: 1, label: 'Coach Seven' }), reviewerOption({ key: 2, label: 'Coach Eight' })]}
        selected={1}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Coach Seven' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Coach Eight' })).toHaveAttribute('aria-checked', 'false')
  })

  it('uses a distinct accessible name from TrackSelector\'s frozen "Choose commentary track"', () => {
    render(
      <EssayReviewerPicker
        options={[noCommentaryOption, reviewerOption()]}
        selected={NO_COMMENTARY}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryByRole('radiogroup', { name: 'Choose commentary track' })).not.toBeInTheDocument()
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Choose whose essay to read')
  })
})
