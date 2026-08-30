import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { ExportSection } from '@/components/account/ExportSection'
import { useExportJob, latestExportOfKind } from '@/hooks/useExportJob'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

/** Mounts `ExportSection` wired to the real `useExportJob` polling hook,
 * same way `Account.tsx` does — exercises the full request -> polling ->
 * ready -> download-link path end to end rather than stubbing the hook. */
function Harness() {
  const { exports } = useExportJob()
  return (
    <ExportSection
      kind="account"
      title="Everything on your speeches"
      description="desc"
      latest={latestExportOfKind(exports, 'account')}
    />
  )
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

describe('ExportSection: request -> polling -> ready -> download link', () => {
  beforeEach(() => clearCookies())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('walks the full lifecycle and renders a plain <a href> once ready', async () => {
    let state: 'none' | 'processing' | 'ready' = 'none'
    let listCallCount = 0

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })

      if (url.endsWith('/api/privacy/exports') && methodOf(input, init) === 'POST') {
        state = 'processing'
        return jsonResponse({
          export: {
            id: 9,
            kind: 'account',
            status: 'processing',
            byte_size: null,
            expires_at: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        })
      }

      if (url.endsWith('/api/privacy/exports') && methodOf(input, init) === 'GET') {
        listCallCount += 1
        if (state === 'none') return jsonResponse({ exports: [] })
        // Flips to ready on the second poll, simulating the job finishing
        // mid-poll.
        if (state === 'processing' && listCallCount >= 3) state = 'ready'
        return jsonResponse({
          exports: [
            {
              id: 9,
              kind: 'account',
              status: state,
              byte_size: state === 'ready' ? 1234 : null,
              expires_at: state === 'ready' ? '2026-01-01T00:10:00Z' : null,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
        })
      }

      if (url.endsWith('/api/privacy/exports/9/download')) {
        return jsonResponse({ url: 'https://storage.example/signed/9?sig=abc' })
      }

      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<Harness />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Request export' }))

    // Both the (now-disabled) button label and the status badge read
    // "Preparing…" while processing — assert at least one instance shows up
    // rather than picking a single (ambiguous) match.
    await waitFor(() => expect(screen.getAllByText('Preparing…').length).toBeGreaterThan(0))

    const link = await screen.findByTestId('export-download-link-account', {}, { timeout: 6000 })
    expect(link).toHaveAttribute('href', 'https://storage.example/signed/9?sig=abc')
  }, 10000)
})
