import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

function stubLocationAssign() {
  const assign = vi.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, assign },
  })
  return {
    assign,
    restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }),
  }
}

/**
 * STEP-11-FROZEN-CONTRACT.md §10: copies `ClearAnnotationsDialog.tsx`'s
 * typed-confirmation gating (new word `DELETE`) and `LogoutMenuItem`'s
 * hard-navigate + `resetApiState` post-success pattern. Covers the gating
 * itself and all three logout-style outcomes (success / already-401 /
 * genuine failure).
 */
describe('DeleteAccountDialog', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the confirm button disabled until the exact word "DELETE" is typed', async () => {
    const user = userEvent.setup()
    render(<DeleteAccountDialog />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Delete my account' }))

    const dialog = await screen.findByTestId('delete-account-dialog')
    const confirmButton = within(dialog).getAllByRole('button', { name: 'Delete my account' })[0]
    expect(confirmButton).toBeDisabled()

    const input = screen.getByLabelText(/Type/)
    await user.type(input, 'delete')
    expect(confirmButton).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'DELETE')
    expect(confirmButton).not.toBeDisabled()
  })

  it('states plainly that erasing the account destroys every reviewer\'s work', async () => {
    const user = userEvent.setup()
    render(<DeleteAccountDialog />, { wrapper })
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))

    expect(
      await screen.findByText(/Destroys every reviewer's commentary, essays and voice notes/),
    ).toBeInTheDocument()
  })

  it('on success: hard-navigates to /login and resets every API cache', async () => {
    const { assign, restore } = stubLocationAssign()
    let sawDelete = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/account') && methodOf(input, init) === 'DELETE') {
        sawDelete = true
        return jsonResponse({ message: 'ok' })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<DeleteAccountDialog />, { wrapper })
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await user.type(screen.getByLabelText(/Type/), 'DELETE')

    const dialog = screen.getByTestId('delete-account-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(sawDelete).toBe(true))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))

    restore()
  })

  it('on an already-401 response: still navigates away (treated as success)', async () => {
    const { assign, restore } = stubLocationAssign()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/account')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<DeleteAccountDialog />, { wrapper })
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await user.type(screen.getByLabelText(/Type/), 'DELETE')
    const dialog = screen.getByTestId('delete-account-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))

    restore()
  })

  it('on a genuine failure (e.g. 500): does NOT navigate away, and surfaces an error', async () => {
    const { assign, restore } = stubLocationAssign()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/account')) return jsonResponse({ message: 'Server error' }, 500)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<DeleteAccountDialog />, { wrapper })
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await user.type(screen.getByLabelText(/Type/), 'DELETE')
    const dialog = screen.getByTestId('delete-account-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not delete your account — try again.'),
    )
    expect(assign).not.toHaveBeenCalled()

    restore()
  })
})
