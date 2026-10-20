import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'
import { renderWithProviders } from '@/test/renderWithProviders'
function form() {
  return renderWithProviders(<Composer userId="coach" speechId={8} reviewId={3} videoEl={null} durationMs={60_000}
    annotations={[]} onLiveChange={vi.fn()} onLiveRemove={vi.fn()} />)
}
describe('explicit annotation form presentation', () => {
  beforeEach(() => localStorage.clear())
  it('shows timecode hints without red errors before the coach begins a new note', () => {
    form()
    for (const field of ['Start', 'End', 'Commentary']) expect(screen.getByRole('textbox', { name: field })).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByRole('button', { name: 'Add annotation' })).toBeDisabled()
    expect(screen.queryByText('Choose a valid start time, such as 0:12.500.')).not.toBeInTheDocument()
    expect(screen.getAllByText('Seconds or M:SS.mmm')).toHaveLength(2)
  })
  it('explains a bad endpoint after editing and returns to clean hints after Discard', async () => {
    const user = userEvent.setup(); form()
    await user.type(screen.getByRole('textbox', { name: 'Start' }), '1')
    await user.type(screen.getByRole('textbox', { name: 'End' }), '1.2')
    expect(screen.getByRole('textbox', { name: 'End' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('End must be at least half a second after Start.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Discard new note' }))
    expect(screen.getByRole('textbox', { name: 'End' })).toHaveAttribute('aria-invalid', 'false')
  })
})
