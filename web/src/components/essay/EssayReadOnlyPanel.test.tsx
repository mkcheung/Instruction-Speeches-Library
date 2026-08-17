import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import { EssayReadOnlyPanel } from '@/components/essay/EssayReadOnlyPanel'
import type { Essay } from '@/features/essay/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function essay(overrides: Partial<Essay> = {}): Essay {
  return {
    essay_html: '<p>a published essay</p>',
    essay_text: 'a published essay',
    essay_published_at: '2026-01-02T00:00:00Z',
    essay_updated_at: '2026-01-02T00:00:00Z',
    essay_words: 4,
    essay_lock_version: 2,
    ...overrides,
  }
}

describe('EssayReadOnlyPanel', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('prompts to pick a reviewer when nothing is selected — never fetches', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<EssayReadOnlyPanel speechId={1} reviewId={null} reviewerName={undefined} />)

    expect(screen.getByText(/pick a reviewer/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the published essay html for the selected reviewer', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/essay')) return jsonResponse({ essay: essay() })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<EssayReadOnlyPanel speechId={1} reviewId={7} reviewerName="A Reviewer" />)

    const content = await screen.findByTestId('essay-readonly-content')
    expect(content).toHaveTextContent('a published essay')
  })

  it('shows an honest empty state when the reviewer has not published an essay', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/essay')) {
        return jsonResponse({ essay: essay({ essay_published_at: null, essay_html: null }) })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<EssayReadOnlyPanel speechId={1} reviewId={7} reviewerName="A Reviewer" />)

    expect(await screen.findByText(/A Reviewer hasn't published an essay yet\./)).toBeInTheDocument()
  })

  it('shows a real error state on a fetch failure — never a silent empty render', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/essay')) return jsonResponse({ message: 'Forbidden' }, 403)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<EssayReadOnlyPanel speechId={1} reviewId={7} reviewerName="A Reviewer" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load/i)
  })
})
