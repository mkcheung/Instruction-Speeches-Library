import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusBadge, SupersedesBadge } from '@/components/speech/StatusBadge'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import type { Speech } from '@/features/speech/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function speechWith(overrides: Partial<Speech>): Speech {
  return {
    id: 1,
    ulid: '01ABC',
    title: 'My speech',
    description: null,
    delivered_on: null,
    change_note: null,
    created_at: '2026-01-01T00:00:00Z',
    primary_video: null,
    ...overrides,
  }
}

/**
 * STEP-03-upload-and-watch.md: "speech-card-status rendering EVERY state
 * including `failed` with a Retry, and a 'v2 of' badge on linked speeches."
 */
describe('StatusBadge', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('renders Processing when there is no video asset yet', () => {
    renderWithProviders(<StatusBadge speech={speechWith({ primary_video: null })} />)
    expect(screen.getByTestId('speech-card-status')).toHaveTextContent('Processing')
  })

  it.each([
    ['uploading', 'Uploading'],
    ['processing', 'Processing'],
    ['ready', 'Ready'],
  ] as const)('renders %s as %s', (status, label) => {
    renderWithProviders(
      <StatusBadge
        speech={speechWith({
          primary_video: { id: 9, kind: 'video', status, failure_code: null, duration_seconds: null },
        })}
      />,
    )
    expect(screen.getByTestId('speech-card-status')).toHaveTextContent(label)
  })

  it('renders Failed with a working Retry button', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/retry')) {
        return jsonResponse({
          asset: { id: 9, kind: 'video', status: 'processing', failure_code: null, duration_seconds: null },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(
      <StatusBadge
        speech={speechWith({
          id: 42,
          primary_video: { id: 9, kind: 'video', status: 'failed', failure_code: 'unsupported_format', duration_seconds: null },
        })}
      />,
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      const retried = fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/speeches/42/assets/9/retry'))
      expect(retried).toBe(true)
    })
  })
})

describe('SupersedesBadge', () => {
  it('renders nothing when the speech does not supersede anything', () => {
    const { container } = renderWithProviders(<SupersedesBadge speech={speechWith({})} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders "v2 of {title}" when it does', () => {
    renderWithProviders(
      <SupersedesBadge speech={speechWith({ supersedes: { id: 1, ulid: '01OLD', title: 'Attempt 1' } })} />,
    )
    expect(screen.getByTestId('supersedes-badge')).toHaveTextContent('v2 of Attempt 1')
  })
})
