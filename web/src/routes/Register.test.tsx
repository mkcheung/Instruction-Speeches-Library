import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Register from '@/routes/Register'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import { hardNavigation } from '@/lib/hardNavigation'
import { authSessionActions } from '@/features/auth/authSession'
import { act } from '@testing-library/react'

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

describe('Register', () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps a 422 email-taken error onto the email field via applyServerErrors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/register')) {
        return jsonResponse(
          {
            message: 'The given data was invalid.',
            errors: { email: ['The email has already been taken.'] },
          },
          422,
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<Register />, { route: '/register' })

    await user.type(screen.getByLabelText(/^email$/i), 'mars@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
    await user.type(screen.getByLabelText(/confirm password/i), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('The email has already been taken.')).toBeInTheDocument()
  })

  it('rejects a mismatched password confirmation before ever calling the server', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<Register />, { route: '/register' })

    await user.type(screen.getByLabelText(/^email$/i), 'mars@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
    await user.type(screen.getByLabelText(/confirm password/i), 'does-not-match')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not hard-navigate when a newer auth attempt superseded this registration', async () => {
    const replace = vi.spyOn(hardNavigation, 'replace').mockImplementation(() => {})
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/register')) { await gate; return jsonResponse({ user: { id: 'n' } }, 201) }
      throw new Error(`unexpected fetch: ${url}`)
    }))
    const user = userEvent.setup()
    const { store } = renderWithProviders(<Register />, { route: '/register' })
    await user.type(screen.getByLabelText(/^email$/i), 'mars@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
    await user.type(screen.getByLabelText(/confirm password/i), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled())
    act(() => { store.dispatch(authSessionActions.attemptStarted('newer-attempt')) })
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled())
    expect(replace).not.toHaveBeenCalled()
    replace.mockRestore()
  })
})
