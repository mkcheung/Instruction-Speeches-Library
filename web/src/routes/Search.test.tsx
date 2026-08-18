import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Search from '@/routes/Search'
import { renderWithProviders, createTestStore, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

describe('Search', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('does not query until the user types something', () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<Search />)

    expect(screen.getByText(/start typing to search/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/speeches/search'))).toBe(false)
  })

  it('debounces the query, then shows the matching speech as a link', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/speeches/search')) {
        expect(url).toContain('q=district')
        return jsonResponse({
          results: [
            {
              id: 7,
              ulid: '01XYZ',
              title: 'District final speech',
              description: 'Practice run',
              delivered_on: null,
              change_note: null,
              created_at: '2026-01-01T00:00:00Z',
              captions_enabled: true,
              primary_video: null,
            },
          ],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<Search />)

    await user.type(screen.getByLabelText(/phrase/i), 'district')

    const link = await screen.findByRole('link', { name: 'District final speech' })
    expect(link).toHaveAttribute('href', '/speeches/7')
  })

  it('shows a "no matches" message for a query that returns nothing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/speeches/search')) return jsonResponse({ results: [] })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<Search />)

    await user.type(screen.getByLabelText(/phrase/i), 'nonsense')

    await waitFor(() => expect(screen.getByText(/no speeches matched/i)).toBeInTheDocument())
  })

  it('refetches a previously cached phrase when the search route remounts', async () => {
    let searchCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/speeches/search')) {
        searchCallCount += 1
        return jsonResponse({
          results:
            searchCallCount === 1
              ? []
              : [
                  {
                    id: 8,
                    ulid: '01REFRESHED',
                    title: 'Newly indexed speech',
                    description: null,
                    delivered_on: null,
                    change_note: null,
                    created_at: '2026-01-01T00:00:00Z',
                    captions_enabled: true,
                    primary_video: null,
                  },
                ],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    // Reuse one store so the first empty result remains in RTK Query's
    // unused-data cache after the route unmounts, matching real SPA nav.
    const store = createTestStore()
    const first = renderWithProviders(<Search />, { store })
    const firstUser = userEvent.setup()
    await firstUser.type(screen.getByLabelText(/phrase/i), 'new phrase')
    await screen.findByText(/no speeches matched/i)
    expect(searchCallCount).toBe(1)
    first.unmount()

    renderWithProviders(<Search />, { store })
    const secondUser = userEvent.setup()
    await secondUser.type(screen.getByLabelText(/phrase/i), 'new phrase')

    expect(await screen.findByRole('link', { name: 'Newly indexed speech' })).toBeInTheDocument()
    expect(searchCallCount).toBe(2)
  })
})
