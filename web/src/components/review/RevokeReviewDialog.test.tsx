import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RevokeReviewDialog } from '@/components/review/RevokeReviewDialog'
import type { RosterReview } from '@/features/review/types'

function rosterReview(overrides: Partial<RosterReview> = {}): RosterReview {
  return {
    id: 5,
    status: 'in_progress',
    invitation_message: null,
    allow_preview: false,
    prior_commentary_shared: false,
    invited_at: '2026-09-01T10:00:00Z',
    responded_at: '2026-09-02T10:00:00Z',
    first_published_at: null,
    last_published_at: null,
    last_transition_at: '2026-09-02T10:00:00Z',
    revoked_at: null,
    revocation_reason: null,
    reviewer: { id: 7, username: 'coach7', name: 'Coach Seven' },
    annotations_count: 3,
    published_annotations_count: 1,
    revoked_by_is_self: false,
    ...overrides,
  }
}

/**
 * IMPLEMENTATION-PLANS.md §7.2.6: "Follow `ClearAnnotationsDialog.tsx`
 * exactly" — a mandatory reason for BOTH modes (not just purge, unlike
 * `ClearAnnotationsDialog`'s own `isPublished`-only gate — §7.2.5's
 * `RevokeReviewRequest` makes `reason` required on a first revoke
 * regardless of which verb ends the access), plus a type-the-word gate
 * for purge only.
 */
describe('RevokeReviewDialog', () => {
  it('revoke mode: confirm is disabled until a reason is typed, and no type-to-confirm gate exists', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<RevokeReviewDialog review={rosterReview()} mode="revoke" isSubmitting={false} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByTestId('revoke-dialog')
    const confirmButton = within(dialog).getByRole('button', { name: 'Revoke' })
    expect(confirmButton).toBeDisabled()

    expect(within(dialog).queryByText(/Type/)).not.toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Reason'), 'Time constraints')
    expect(confirmButton).not.toBeDisabled()

    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledWith('Time constraints')
  })

  it('purge mode: confirm stays disabled with only a reason — DELETE must also be typed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <RevokeReviewDialog review={rosterReview()} mode="purge" isSubmitting={false} onConfirm={onConfirm} />,
    )

    await user.click(screen.getByRole('button', { name: 'Revoke and delete their work' }))
    const dialog = await screen.findByTestId('revoke-and-purge-dialog')
    const confirmButton = within(dialog).getByRole('button', { name: 'Revoke and delete their work' })
    expect(confirmButton).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Reason'), 'Policy violation')
    expect(confirmButton).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Type/), 'wrong word')
    expect(confirmButton).toBeDisabled()

    // Case-insensitive, same as `ClearAnnotationsDialog`'s own gate (this
    // dialog follows it exactly, per IMPLEMENTATION-PLANS.md §7.2.6) —
    // unlike `DeleteAccountDialog`'s exact-match gate, which is a
    // different precedent this component does not follow.
    await user.clear(within(dialog).getByLabelText(/Type/))
    await user.type(within(dialog).getByLabelText(/Type/), 'delete')
    expect(confirmButton).not.toBeDisabled()

    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledWith('Policy violation')
  })

  it('purge mode: states the note counts in the dialog copy', async () => {
    const user = userEvent.setup()
    render(
      <RevokeReviewDialog
        review={rosterReview({ annotations_count: 12, published_annotations_count: 4 })}
        mode="purge"
        isSubmitting={false}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Revoke and delete their work' }))
    const dialog = await screen.findByTestId('revoke-and-purge-dialog')
    expect(within(dialog).getByText(/12 notes/)).toBeInTheDocument()
    expect(within(dialog).getByText(/4 of them published/)).toBeInTheDocument()
  })

  it('revoke mode: does not delete anything, and says so', async () => {
    const user = userEvent.setup()
    render(<RevokeReviewDialog review={rosterReview()} mode="revoke" isSubmitting={false} onConfirm={vi.fn().mockResolvedValue(undefined)} />)

    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByTestId('revoke-dialog')
    expect(within(dialog).getByText(/nothing here is deleted/i)).toBeInTheDocument()
  })

  /**
   * code-review finding (§7.2 max review): Cancel used to call
   * `setOpen(false)` directly, bypassing `onOpenChange` (where `reset()`
   * lives) — Base UI's `AlertDialogRoot` only fires `onOpenChange` for its
   * OWN close gestures, never when a parent sets the controlled `open`
   * prop externally. In purge mode this meant a cancelled attempt's typed
   * "DELETE" confirmation and reason survived into the next open, letting
   * a fresh attempt submit without re-typing the safety word at all.
   */
  it('purge mode: Cancel clears the typed reason and confirmation word for the next open', async () => {
    const user = userEvent.setup()
    render(
      <RevokeReviewDialog review={rosterReview()} mode="purge" isSubmitting={false} onConfirm={vi.fn().mockResolvedValue(undefined)} />,
    )

    await user.click(screen.getByRole('button', { name: 'Revoke and delete their work' }))
    let dialog = await screen.findByTestId('revoke-and-purge-dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Policy violation')
    await user.type(within(dialog).getByLabelText(/Type/), 'DELETE')
    expect(within(dialog).getByRole('button', { name: 'Revoke and delete their work' })).not.toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('revoke-and-purge-dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revoke and delete their work' }))
    dialog = await screen.findByTestId('revoke-and-purge-dialog')
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('')
    expect(within(dialog).getByLabelText(/Type/)).toHaveValue('')
    expect(within(dialog).getByRole('button', { name: 'Revoke and delete their work' })).toBeDisabled()
  })
})
