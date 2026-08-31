import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BecomeACoach from '@/routes/BecomeACoach'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

/**
 * STEP-12-FROZEN-CONTRACT.md §9: one route, status-gated internally. Only
 * the "no application yet" case exercises `CoachApplicationForm` here
 * (the with-an-id draft case renders `CoachDocumentUpload`'s Uppy
 * `Dashboard`, covered by `CoachDocumentUpload`/`CoachApplicationForm`'s
 * own scope rather than duplicated through this route's tests).
 */
describe('BecomeACoach', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('shows the application form when nobody has applied yet (404 from /me)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/coach-applications/me')) {
        return jsonResponse({ message: 'No application.' }, 404)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<BecomeACoach />, { route: '/become-a-coach' })

    expect(await screen.findByLabelText(/why do you want to coach/i)).toBeInTheDocument()
    expect(screen.getByText(/2000 characters left/i)).toBeInTheDocument()
  })

  it('shows a waiting state with the status badge while submitted/under review', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/coach-applications/me')) {
        return jsonResponse({
          coachApplication: {
            id: 5,
            status: 'under_review',
            statement: 'x',
            decision_reason: null,
            submitted_at: '2026-01-01T00:00:00Z',
            decided_at: null,
            documents: [{ id: 1, original_filename: 'cert.pdf', status: 'clean', created_at: '2026-01-01T00:00:00Z' }],
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<BecomeACoach />, { route: '/become-a-coach' })

    expect(await screen.findByTestId('coach-application-status')).toHaveTextContent('Under review')
    expect(screen.getByText('cert.pdf')).toBeInTheDocument()
  })

  it('shows the approved state with a Coach badge', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/coach-applications/me')) {
        return jsonResponse({
          coachApplication: {
            id: 5,
            status: 'approved',
            statement: 'x',
            decision_reason: 'Credentials look solid.',
            submitted_at: '2026-01-01T00:00:00Z',
            decided_at: '2026-01-02T00:00:00Z',
            documents: [],
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<BecomeACoach />, { route: '/become-a-coach' })

    expect(await screen.findByTestId('coach-application-status')).toHaveTextContent('Approved')
    expect(screen.getByText(/you're a coach/i)).toBeInTheDocument()
  })

  it('shows the decision reason and a restart button when rejected, and restarting reopens the draft', async () => {
    let applicationStatus = 'rejected'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/coach-applications/me')) {
        return jsonResponse({
          coachApplication: {
            id: 5,
            status: applicationStatus,
            statement: 'x',
            decision_reason: applicationStatus === 'rejected' ? 'Not enough documentation.' : null,
            submitted_at: '2026-01-01T00:00:00Z',
            decided_at: '2026-01-02T00:00:00Z',
            documents: [],
          },
        })
      }
      if (url.endsWith('/api/coach-applications') && methodOf(input, init) === 'POST') {
        applicationStatus = 'draft'
        return jsonResponse({
          coachApplication: {
            id: 5,
            status: 'draft',
            statement: 'x',
            decision_reason: null,
            submitted_at: null,
            decided_at: null,
            documents: [],
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<BecomeACoach />, { route: '/become-a-coach' })

    expect(await screen.findByText('Not enough documentation.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /start a new application/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/why do you want to coach/i)).toBeInTheDocument()
    })
  })
})
