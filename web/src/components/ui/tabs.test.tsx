import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs'

describe('Tabs', () => {
  it('switches panels on click, defaulting to the given value', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Tabs defaultValue="notes">
        <TabsList aria-label="Feedback">
          <TabsTab value="notes">Notes</TabsTab>
          <TabsTab value="essay">Essay</TabsTab>
        </TabsList>
        <TabsPanel value="notes">Notes content</TabsPanel>
        <TabsPanel value="essay">Essay content</TabsPanel>
      </Tabs>,
    )

    expect(screen.getByText('Notes content')).toBeInTheDocument()
    expect(screen.queryByText('Essay content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Essay' }))

    expect(screen.getByText('Essay content')).toBeInTheDocument()
    expect(screen.queryByText('Notes content')).not.toBeInTheDocument()
  })
})
