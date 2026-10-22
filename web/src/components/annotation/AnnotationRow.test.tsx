import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnnotationRow } from '@/components/annotation/AnnotationRow'
import type { Annotation } from '@/features/annotation/types'

vi.mock('@/features/annotation/annotationApi', () => ({
  useUpdateAnnotationMutation: () => [vi.fn(), { isLoading: false }],
  useCreateAnnotationMutation: () => [vi.fn(), { isLoading: false }],
}))

function note(overrides: Partial<Annotation> = {}): Annotation {
  return { id: '5', timing_type: 'range', start_seconds: 30, duration_seconds: 6, kind: 'observation', topic: null,
    body: 'A fairly ordinary note body', lock_version: 1, client_uuid: 'uuid-5', voice: null, ...overrides }
}

function renderRow(annotation: Annotation, extra: Partial<React.ComponentProps<typeof AnnotationRow>> = {}) {
  const props = { onSeek: vi.fn(), onDelete: vi.fn(), onPendingChange: vi.fn(), onEditingChange: vi.fn(), ...extra }
  render(<AnnotationRow annotation={annotation} speechId={1} reviewId={2} userId="3" videoEl={null} isCurrent={false} {...props} />)
  return props
}

describe('AnnotationRow', () => {
  beforeEach(() => localStorage.clear())

  it('shows a compact summary and opens read-only details without mounting an editor', async () => {
    const user = userEvent.setup()
    const props = renderRow(note({ body: 'x'.repeat(300) }))
    expect(screen.getByText('Text note')).toBeInTheDocument()
    expect(screen.getByText(/0:30\.000–0:36\.000/)).toBeInTheDocument()
    expect(screen.getByText(/^x+…$/).textContent!.length).toBeLessThanOrEqual(120)
    const toggle = screen.getByRole('button', { name: /^Show details/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(screen.getByRole('button', { name: /^Hide details/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('x'.repeat(300))).toBeInTheDocument()
    expect(screen.queryByTestId('annotation-editor')).not.toBeInTheDocument()
    expect(props.onEditingChange).not.toHaveBeenCalled()
    expect(props.onPendingChange).not.toHaveBeenCalledWith(expect.anything(), true)
  })

  it('keeps Go to time, details, Edit and Delete as separate controls with 44px targets', async () => {
    const user = userEvent.setup()
    const props = renderRow(note())
    await user.click(screen.getByRole('button', { name: /^Go to time/ }))
    expect(props.onSeek).toHaveBeenCalledWith(30)
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
    for (const name of [/^Go to time/, /^Show details/, /^Edit/]) expect(screen.getByRole('button', { name })).toHaveClass('min-h-11')
    await user.click(screen.getByRole('button', { name: /^Show details/ }))
    await user.click(screen.getByRole('button', { name: /^Delete annotation/ }))
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: '5' }))
  })

  it('reports editing, locks collapse while open and returns focus to the details toggle on cancel', async () => {
    const user = userEvent.setup()
    const props = renderRow(note())
    await user.click(screen.getByRole('button', { name: /^Edit,/ }))
    expect(props.onEditingChange).toHaveBeenLastCalledWith('5', true)
    expect(screen.getByRole('button', { name: /^Hide details/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onEditingChange).toHaveBeenLastCalledWith('5', false)
    expect(screen.getByRole('button', { name: /^Hide details/ })).toHaveFocus()
  })

  it('disables Edit while another editor or operation holds the list', () => {
    renderRow(note(), { editBlocked: true })
    expect(screen.getByRole('button', { name: /^Edit,/ })).toBeDisabled()
  })

  it('keeps standalone compatibility for an erased-audio point', async () => {
    const user = userEvent.setup()
    renderRow(note({ timing_type: 'point', duration_seconds: 3, body: 'Kept transcript' }))
    expect(screen.getByText('Voice note · Audio unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Edit transcript/ }))
    expect(screen.getByRole('textbox', { name: 'Transcript' })).toHaveValue('Kept transcript')
  })
})
