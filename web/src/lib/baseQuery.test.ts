import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import { authApi } from '@/features/auth/authApi'
import { UNAUTHENTICATED_EVENT } from '@/lib/baseQuery'
import { clearCookies } from '@/test/renderWithProviders'

function makeStore() {
  return configureStore({
    reducer: { [authApi.reducerPath]: authApi.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(authApi.middleware),
  })
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('baseQueryWithCsrfRetry', () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('419 is not 401: refetches the CSRF cookie and retries the same request once', async () => {
    let loginAttempts = 0
    let csrfFetches = 0

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('/sanctum/csrf-cookie')) {
        csrfFetches += 1
        document.cookie = 'XSRF-TOKEN=fresh-token'
        return new Response(null, { status: 204 })
      }
      if (url.includes('/login')) {
        loginAttempts += 1
        if (loginAttempts === 1) {
          return jsonResponse({ message: 'CSRF token mismatch.' }, 419)
        }
        return jsonResponse({}, 200)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = makeStore()
    const result = await store.dispatch(
      authApi.endpoints.login.initiate({ email: 'a@example.com', password: 'secretpass' }),
    )

    expect(loginAttempts).toBe(2)
    expect(csrfFetches).toBeGreaterThanOrEqual(1)
    expect('error' in result && result.error).toBeFalsy()
  })

  it('concurrent 419s trigger exactly one CSRF refetch (single-flight)', async () => {
    document.cookie = 'XSRF-TOKEN=stale-token'
    let csrfFetches = 0
    const attemptsByUrl: Record<string, number> = {}

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('/sanctum/csrf-cookie')) {
        csrfFetches += 1
        document.cookie = 'XSRF-TOKEN=fresh-token'
        // Simulate network latency so concurrent callers overlap.
        await new Promise((resolve) => setTimeout(resolve, 10))
        return new Response(null, { status: 204 })
      }
      attemptsByUrl[url] = (attemptsByUrl[url] ?? 0) + 1
      if (attemptsByUrl[url] === 1) {
        return jsonResponse({ message: 'CSRF token mismatch.' }, 419)
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = makeStore()
    const results = await Promise.all([
      store.dispatch(authApi.endpoints.login.initiate({ email: 'a@example.com', password: 'x' })),
      store.dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'a@example.com' })),
    ])

    for (const result of results) {
      expect('error' in result && result.error).toBeFalsy()
    }
    expect(csrfFetches).toBe(1)
  })

  it('401 broadcasts the unauthenticated event and is never retried', async () => {
    document.cookie = 'XSRF-TOKEN=existing-token'
    const handler = vi.fn()
    window.addEventListener(UNAUTHENTICATED_EVENT, handler)

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('/api/me')) {
        return jsonResponse({ message: 'Unauthenticated.' }, 401)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = makeStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)

    window.removeEventListener(UNAUTHENTICATED_EVENT, handler)
  })
})
