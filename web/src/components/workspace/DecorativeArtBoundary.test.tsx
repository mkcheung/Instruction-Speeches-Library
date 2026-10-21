import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecorativeArtBoundary } from './DecorativeArtBoundary'

afterEach(() => vi.restoreAllMocks())

function BrokenArt(): never {
  throw new Error('drawing failed')
}

describe('DecorativeArtBoundary', () => {
  it('renders healthy children without adding a layout wrapper', () => {
    const { container } = render(<DecorativeArtBoundary><svg data-testid="drawing" /></DecorativeArtBoundary>)
    expect(container.firstElementChild).toBe(screen.getByTestId('drawing'))
  })

  it('contains a drawing exception without replacing or disabling sibling controls', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    const onNavigate = vi.fn((event: React.MouseEvent) => event.preventDefault())
    const user = userEvent.setup()
    const { container } = render(<>
      <div data-testid="frame"><DecorativeArtBoundary><BrokenArt /></DecorativeArtBoundary></div>
      <form onSubmit={onSubmit}><label>Email<input type="email" /></label><button>Log in</button></form>
      <a href="/search" onClick={onNavigate}>Search</a>
    </>)
    expect(screen.getByTestId('frame')).toBeEmptyDOMElement()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await user.type(screen.getByLabelText('Email'), 'reviewer@example.test')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await user.click(screen.getByRole('link', { name: 'Search' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('does not retry the failed scene on unrelated rerenders; a new scene key can recover', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = vi.fn(BrokenArt)
    const Broken = broken
    const { rerender } = render(<DecorativeArtBoundary key="reviews"><Broken /></DecorativeArtBoundary>)
    const failedAttempts = broken.mock.calls.length
    rerender(<DecorativeArtBoundary key="reviews"><Broken /></DecorativeArtBoundary>)
    expect(broken).toHaveBeenCalledTimes(failedAttempts)
    rerender(<DecorativeArtBoundary key="search"><svg data-testid="recovered" /></DecorativeArtBoundary>)
    expect(screen.getByTestId('recovered')).toBeInTheDocument()
  })
})
