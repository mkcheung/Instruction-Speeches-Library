import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Login from '@/routes/Login'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import { ADMIN_LOGIN_CONTINUATION } from '@/lib/roles'
import { RETURN_PATH_KEY } from '@/features/auth/returnPath'

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §7.4: "No vitest test anywhere currently
 * renders `Login` or asserts a post-login destination." This is the
 * first one — site 1's call shape (`getPostLoginDestination` plus a
 * branch between `navigate()` and a real cross-origin navigation).
 */

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/** Matches `DeleteAccountDialog.test.tsx`'s pattern — jsdom's
 * `window.location.replace` is non-configurable, so `vi.spyOn` cannot
 * redefine it directly. */
function stubLocationReplace() {
  const replace = vi.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, replace },
  })
  return {
    replace,
    restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }),
  }
}

function stubLoginResponse(user: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
    if (url.includes('/login')) {
      return jsonResponse({ user }, 200)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function submitLoginForm() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/^email$/i), 'admin@example.com')
  await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
  await user.click(screen.getByRole('button', { name: /log in/i }))
}

describe('Login', () => {
  const originalLocation = window.location
  beforeEach(() => {
    clearCookies()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('retains one semantic login heading, labeled fields, autocomplete, and the existing links inside the theater frame', () => {
    const { container } = renderWithProviders(<Login />, { route: '/login' })

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toHaveClass('workspace-login-title')
    expect(screen.getByText('Welcome back.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).not.toBeChecked()
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register')
    const submit = screen.getByRole('button', { name: 'Log in' })
    expect(submit).toBeEnabled()
    expect(submit).toHaveAttribute('type', 'submit')
    expect(submit.closest('form')).toHaveAttribute('novalidate')
    expect(submit.closest('[aria-hidden="true"]')).toBeNull()
    expect(container.querySelector('.workspace-login-card')).toContainElement(submit)
    expect(container.querySelector('[data-workspace-scene="welcome"]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the verified notice readable without changing form copy or submitting', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<Login />, { route: '/login?verified=1' })

    expect(screen.getByRole('status')).toHaveTextContent('Email verified — log in to continue.')
    expect(screen.getByRole('status')).toHaveClass('workspace-banner', 'workspace-banner--success')
    expect(screen.getByText('Welcome back.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves client-side field validation before requesting login', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<Login />, { route: '/login' })

    await userEvent.type(screen.getByLabelText('Email'), 'invalid-email')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves server field errors and keeps the form usable for retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (urlOf(input).includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      return jsonResponse({ errors: { email: ['This email cannot log in.'] } }, 422)
    }))
    const { router } = renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    expect(await screen.findByRole('alert')).toHaveTextContent('This email cannot log in.')
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('keeps the loading label and disables duplicate submissions until login completes', async () => {
    let finishLogin!: (response: Response) => void
    const pendingLogin = new Promise<Response>((resolve) => { finishLogin = resolve })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (urlOf(input).includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      return pendingLogin
    })
    vi.stubGlobal('fetch', fetchMock)
    const location = stubLocationReplace()
    renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    const submit = await screen.findByRole('button', { name: 'Logging in…' })
    expect(submit).toBeDisabled()
    await userEvent.click(submit)
    expect(fetchMock.mock.calls.filter(([input]) => new URL(urlOf(input)).pathname === '/login')).toHaveLength(1)
    await act(async () => {
      finishLogin(jsonResponse({ user: { roles: ['member'], onboarding_completed: true } }, 200))
    })
    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/dashboard'))
  })

  it('sends a member with no `from` to /dashboard', async () => {
    stubLoginResponse({ roles: ['member'], onboarding_completed: true })
    const location = stubLocationReplace()
    renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    // Every destination is a hard replace: a new account gets a fresh document (R1).
    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/dashboard'))
  })

  it('sends a roleless user with incomplete onboarding to /onboarding', async () => {
    stubLoginResponse({ roles: [], onboarding_completed: false })
    const location = stubLocationReplace()
    renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/onboarding'))
  })

  it.each(['admin', 'super_admin'])('escorts %s with no `from` through the alias using a real cross-origin navigation', async (role) => {
    stubLoginResponse({ roles: [role], onboarding_completed: true })
    const location = stubLocationReplace()

    const { router } = renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    await waitFor(() => {
      expect(location.replace).toHaveBeenCalledWith(ADMIN_LOGIN_CONTINUATION)
    })
    // The SPA's own router never moves — `navigate()` was deliberately
    // not the call made for this case.
    expect(router.state.location.pathname).toBe('/login')

    location.restore()
  })

  it.each([false, true])('submits the Remember me option as %s', async (remember) => {
    const fetchMock = stubLoginResponse({ roles: ['member'], onboarding_completed: true })
    const location = stubLocationReplace()
    renderWithProviders(<Login />, { route: '/login' })
    const checkbox = screen.getByRole('checkbox', { name: 'Remember me' })
    expect(checkbox).not.toBeChecked()
    if (remember) await userEvent.click(checkbox)

    await submitLoginForm()

    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/dashboard'))
    const loginCall = fetchMock.mock.calls.find(([input]) => new URL(urlOf(input)).pathname === '/login')
    expect(loginCall).toBeDefined()
    expect(await (loginCall![0] as Request).clone().json()).toEqual({
      email: 'admin@example.com',
      password: 'correct-horse-battery',
      remember,
    })
  })

  it('keeps a failed login on the shared form and displays the server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (urlOf(input).includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      return jsonResponse({ message: 'These credentials do not match our records.' }, 422)
    }))
    const location = stubLocationReplace()
    const { router } = renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    expect(await screen.findByText('These credentials do not match our records.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveClass('workspace-banner', 'workspace-banner--error')
    expect(router.state.location.pathname).toBe('/login')
    expect(location.replace).not.toHaveBeenCalled()
  })

  /**
   * The shared-link rule (the resolved Q2): an admin who followed a link
   * into the SPA, was bounced to `/login` by `RequireAuth`, and signs in
   * lands back on that link — not the panel. A role check ordered ahead
   * of the `from` lookup would silently eat it.
   */
  it('sends an admin WITH a `from` state back to that location — NOT the panel', async () => {
    stubLoginResponse({ roles: ['admin'], onboarding_completed: true })
    const location = stubLocationReplace()

    renderWithProviders(<Login />, {
      route: { pathname: '/login', state: { from: { pathname: '/speeches/123' } } },
    })

    await submitLoginForm()

    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/speeches/123'))
    expect(location.replace).not.toHaveBeenCalledWith(ADMIN_LOGIN_CONTINUATION)

    location.restore()
  })

  it('consumes the stored expiry return path exactly once, and rejects an unsafe one', async () => {
    stubLoginResponse({ roles: ['member'], onboarding_completed: true })
    const location = stubLocationReplace()
    window.sessionStorage.setItem(RETURN_PATH_KEY, '/speeches/9')
    renderWithProviders(<Login />, { route: '/login' })
    await submitLoginForm()
    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/speeches/9'))
    expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull()
    location.restore()
  })

  it.each(['//evil.example/x', 'https://evil.example', '/\\evil', '/login', '/api/me'])('falls back to the normal landing for unsafe return path %s', async (unsafe) => {
    stubLoginResponse({ roles: ['member'], onboarding_completed: true })
    const location = stubLocationReplace()
    window.sessionStorage.setItem(RETURN_PATH_KEY, unsafe)
    renderWithProviders(<Login />, { route: '/login' })
    await submitLoginForm()
    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/dashboard'))
    expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull()
    location.restore()
  })

  it('treats router state `from` as untrusted too', async () => {
    stubLoginResponse({ roles: ['member'], onboarding_completed: true })
    const location = stubLocationReplace()
    renderWithProviders(<Login />, { route: { pathname: '/login', state: { from: { pathname: '//evil.example' } } } })
    await submitLoginForm()
    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/dashboard'))
    location.restore()
  })
})
