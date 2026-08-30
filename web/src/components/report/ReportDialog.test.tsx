import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { ReportDialog } from '@/components/report/ReportDialog'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

async function bodyOf(input: RequestInfo | URL): Promise<Record<string, unknown>> {
  if (!(input instanceof Request)) return {}
  try {
    return (await input.clone().json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

/**
 * STEP-11-FROZEN-CONTRACT.md §1/§10: `POST /api/reports`, response
 * enveloped `{ report: ReportResource }`, error body NOT enveloped — the
 * two conventions this test suite exists to pin down, per the codebase's
 * documented history of frontend agents guessing wrong at an unpinned
 * envelope (`essayApi.ts`/`captionApi.ts`'s own top-of-file comments).
 */
describe('ReportDialog', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('submits a speech-level report with the exact enveloped body and shows a success state', async () => {
    let sawPost = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/reports') && methodOf(input, init) === 'POST') {
        sawPost = true
        expect(await bodyOf(input)).toEqual({
          reportable_type: 'speech',
          reportable_id: 42,
          reason: 'harassment',
          detail: 'They were rude in the notes.',
        })
        return jsonResponse({
          report: {
            id: 1,
            reportable_type: 'speech',
            reportable_id: 42,
            reason: 'harassment',
            detail: 'They were rude in the notes.',
            state: 'open',
            created_at: '2026-01-01T00:00:00Z',
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<ReportDialog reportableType="speech" reportableId={42} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Report' }))
    await user.click(await screen.findByRole('radio', { name: 'Harassment' }))
    await user.type(screen.getByLabelText('Details (optional)'), 'They were rude in the notes.')
    await user.click(screen.getByRole('button', { name: 'Submit report' }))

    await waitFor(() => expect(sawPost).toBe(true))
    expect(await screen.findByText('Thanks — this has been reported.')).toBeInTheDocument()
  })

  it('shows the server error message as-is on a validation failure (error body is not enveloped)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/reports')) {
        return jsonResponse({ message: 'The reportable id field is invalid.' }, 422)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<ReportDialog reportableType="review" reportableId={7} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Report' }))
    await user.click(await screen.findByRole('radio', { name: 'Spam' }))
    await user.click(screen.getByRole('button', { name: 'Submit report' }))

    expect(await screen.findByText('The reportable id field is invalid.')).toBeInTheDocument()
    // The dialog stays open and re-submittable on error, not silently closed.
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeInTheDocument()
  })

  it('refuses to submit without a reason selected, with no network call', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<ReportDialog reportableType="speech" reportableId={1} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Report' }))
    await user.click(await screen.findByRole('button', { name: 'Submit report' }))

    expect(await screen.findByText('Pick a reason first.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/api/reports'))).toBe(false)
  })
})
