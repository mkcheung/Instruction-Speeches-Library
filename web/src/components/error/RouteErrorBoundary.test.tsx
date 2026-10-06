import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RouteErrorBoundary } from './RouteErrorBoundary'

/** Throws unconditionally on render — the standard way to exercise an
 * error boundary in RTL, since there's no API to "trigger" one otherwise. */
function Bomb(): never {
  throw new Error('boom')
}

describe('RouteErrorBoundary', () => {
  it('catches a thrown error and renders the fallback instead of crashing the test', () => {
    // React logs the caught render error to console.error itself (its own
    // dev-mode reporting, independent of this boundary's fallback) — known,
    // expected noise for this specific test, suppressed so it doesn't print
    // spurious red output, same as this codebase's other negative-path tests.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <Bomb />
        </RouteErrorBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      "This page hit an unexpected error. It's been reported.",
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    )

    consoleError.mockRestore()
  })

  it('does not catch errors in children that render successfully', () => {
    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <p>All good</p>
        </RouteErrorBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByText('All good')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('"Try again" re-renders the children instead of reloading the page', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()

    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('boom')
      return <p>Recovered</p>
    }

    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <Flaky />
        </RouteErrorBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()

    shouldThrow = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Recovered')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    consoleError.mockRestore()
  })
})
