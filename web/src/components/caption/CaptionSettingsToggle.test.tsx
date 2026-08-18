import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { CaptionSettingsToggle } from '@/components/caption/CaptionSettingsToggle'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
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
 * captions-settings gap fix. Owner-gating itself is enforced by the
 * PARENT (`SpeechWatch.tsx` only mounts this inside its `isOwner` tab
 * strip, same convention `CaptionEditor` already uses) — nothing in this
 * component re-derives ownership, so there is no "renders nothing for a
 * non-owner" case to test here; that behavior lives in SpeechWatch's own
 * conditional render, not this component.
 */
describe('CaptionSettingsToggle', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('renders the current captions_enabled state', () => {
    render(<CaptionSettingsToggle speechId={1} captionsEnabled={true} />, { wrapper })

    const toggle = screen.getByTestId('caption-settings-toggle')
    expect(toggle).toHaveTextContent('Automatic captions: on')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders the off state', () => {
    render(<CaptionSettingsToggle speechId={1} captionsEnabled={false} />, { wrapper })

    const toggle = screen.getByTestId('caption-settings-toggle')
    expect(toggle).toHaveTextContent('Automatic captions: off')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking PATCHes /caption-settings with the flipped value', async () => {
    let sawPatch = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/caption-settings') && methodOf(input, init) === 'PATCH') {
        sawPatch = true
        expect(await bodyOf(input)).toEqual({ captions_enabled: false })
        return jsonResponse({
          speech: { id: 1, ulid: 'x', title: 't', description: null, delivered_on: null, change_note: null, created_at: '', captions_enabled: false, primary_video: null },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<CaptionSettingsToggle speechId={1} captionsEnabled={true} />, { wrapper })

    await user.click(screen.getByTestId('caption-settings-toggle'))

    await waitFor(() => expect(sawPatch).toBe(true))
  })

  it('shows an inline error and leaves the button re-enabled when the PATCH fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/caption-settings')) {
        return jsonResponse({ message: 'nope' }, 403)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<CaptionSettingsToggle speechId={1} captionsEnabled={true} />, { wrapper })

    await user.click(screen.getByTestId('caption-settings-toggle'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save'))
    expect(screen.getByTestId('caption-settings-toggle')).not.toBeDisabled()
  })

  it("a successful PATCH invalidates captionApi's Captions cache for the same speech", async () => {
    const { useGetCaptionsQuery } = await import('@/features/caption/captionApi')

    let captionsCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions')) {
        captionsCallCount += 1
        return jsonResponse({ captions: { status: 'unavailable', vtt: null, failure_code: null, updated_at: null, asset_id: null } })
      }
      if (url.endsWith('/api/speeches/1/caption-settings') && methodOf(input, init) === 'PATCH') {
        return jsonResponse({
          speech: { id: 1, ulid: 'x', title: 't', description: null, delivered_on: null, change_note: null, created_at: '', captions_enabled: false, primary_video: null },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = createTestStore()
    function LocalWrapper({ children }: { children: ReactNode }) {
      return <Provider store={store}>{children}</Provider>
    }

    function Harness() {
      useGetCaptionsQuery({ speechId: 1 })
      return <CaptionSettingsToggle speechId={1} captionsEnabled={true} />
    }

    const user = userEvent.setup()
    render(<Harness />, { wrapper: LocalWrapper })

    await waitFor(() => expect(captionsCallCount).toBe(1))

    await user.click(screen.getByTestId('caption-settings-toggle'))

    await waitFor(() => expect(captionsCallCount).toBe(2))
  })
})
