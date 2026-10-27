import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import type { CurrentUser } from '@/features/auth/types'
import type { DataExport } from '@/features/privacy/types'
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

const viewer: CurrentUser = {
  id: '5', email: 'v@example.test', first_name: 'V', last_name: 'W', username: 'v', display_name: 'V W',
  email_verified: true, roles: [], onboarding_completed: true, onboarding_step: 4,
  storage_bytes_used: 0, quota_bytes: 1, uploads_in_flight: 0,
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore({ viewer })}>{children}</Provider>
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

const ready = (id: number): DataExport => ({
  id, kind: 'account', status: 'ready', byte_size: 1, expires_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})

type Deferred = { resolve: (r: Response) => void }

/** Download endpoint mock: each call to /exports/{id}/download is queued as a
 * deferred the test settles by hand, so response ordering is explicit. */
function mockDownloads() {
  const calls: { id: number; d: Deferred }[] = []
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.includes('/sanctum/csrf-cookie')) return Promise.resolve(new Response(null, { status: 204 }))
    const m = url.match(/\/api\/privacy\/exports\/(\d+)\/download/)
    if (m) return new Promise<Response>((resolve) => calls.push({ id: Number(m[1]), d: { resolve } }))
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
  const ok = (n: number, url: string) => act(async () => { calls[n].d.resolve(jsonResponse({ url })); await vi.advanceTimersByTimeAsync(0) })
  const fail = (n: number, status: number) => act(async () => { calls[n].d.resolve(jsonResponse({ message: 'nope' }, status)); await vi.advanceTimersByTimeAsync(0) })
  return { calls, ok, fail }
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const link = () => screen.queryByTestId('export-download-link-account')

function mount(latest: DataExport | undefined, withViewer = true) {
  const store = createTestStore(withViewer ? { viewer } : {})
  const ui = (l: DataExport | undefined) => (
    <Provider store={store}>
      <ExportSection kind="account" title="t" description="d" latest={l} />
    </Provider>
  )
  const view = render(ui(latest))
  return { ...view, rerenderWith: (l: DataExport | undefined) => view.rerender(ui(l)) }
}

describe('ExportSection: link attribution, 540s display window, recovery (R10)', () => {
  beforeEach(() => {
    clearCookies()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not show the old export URL while a newer export resolves, nor accept the old export late response', async () => {
    const dl = mockDownloads()
    const { rerenderWith } = mount(ready(9))
    await settle()
    await dl.ok(0, 'https://s/9')
    expect(link()).toHaveAttribute('href', 'https://s/9')

    rerenderWith(ready(10))
    await settle()
    expect(link()).toBeNull()
    expect(screen.getByText('Getting link…')).toBeInTheDocument()

    await dl.ok(1, 'https://s/10')
    expect(link()).toHaveAttribute('href', 'https://s/10')
  })

  it('a late response for the previous export never renders under the new export', async () => {
    const dl = mockDownloads()
    const { rerenderWith } = mount(ready(9))
    await settle()
    rerenderWith(ready(10))
    await settle()
    await dl.ok(0, 'https://s/9-late') // export 9 answers after 10 became current
    expect(link()).toBeNull()
    await dl.ok(1, 'https://s/10')
    expect(link()).toHaveAttribute('href', 'https://s/10')
  })

  it('a rejected old-export request does not surface an error for the new export', async () => {
    const dl = mockDownloads()
    const { rerenderWith } = mount(ready(9))
    await settle()
    rerenderWith(ready(10))
    await settle()
    await dl.fail(0, 500)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.getByText('Getting link…')).toBeInTheDocument()
  })

  it('does not request or render a link without an accepted viewer', async () => {
    const dl = mockDownloads()
    mount(ready(9), false)
    await settle()
    expect(dl.calls).toHaveLength(0)
    expect(link()).toBeNull()
  })

  it('a fetch error shows Retry, and Retry recovers', async () => {
    const dl = mockDownloads()
    mount(ready(9))
    await settle()
    await dl.fail(0, 500)
    expect(link()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await settle()
    await dl.ok(1, 'https://s/9b')
    expect(link()).toHaveAttribute('href', 'https://s/9b')
  })

  it('410 says a new export is required, with no Retry', async () => {
    const dl = mockDownloads()
    mount(ready(9))
    await settle()
    await dl.fail(0, 410)
    expect(screen.getByRole('alert')).toHaveTextContent(/new export is required/i)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(link()).toBeNull()
  })

  it('removes the href at 540s from request start and offers a manual refresh (no polling, no auto click)', async () => {
    const dl = mockDownloads()
    mount(ready(9))
    await settle()
    await dl.ok(0, 'https://s/old')
    await advance(539_000)
    expect(link()).toHaveAttribute('href', 'https://s/old')
    await advance(1_000)
    expect(link()).toBeNull()
    expect(document.querySelector('a[href="https://s/old"]')).toBeNull()
    await advance(600_000)
    expect(dl.calls).toHaveLength(1) // no background renewal

    fireEvent.click(screen.getByRole('button', { name: 'Refresh download link' }))
    await settle()
    expect(dl.calls).toHaveLength(2)
    expect(link()).toBeNull() // old href not re-exposed while renewing
    await dl.ok(1, 'https://s/new')
    expect(link()).toHaveAttribute('href', 'https://s/new')
  })

  it('counts from request start, not response arrival', async () => {
    const dl = mockDownloads()
    mount(ready(9))
    await settle()
    await advance(30_000) // slow response
    await dl.ok(0, 'https://s/slow')
    await advance(509_000)
    expect(link()).not.toBeNull()
    await advance(1_000)
    expect(link()).toBeNull()
  })

  it('failed renewal never re-exposes the old href', async () => {
    const dl = mockDownloads()
    mount(ready(9))
    await settle()
    await dl.ok(0, 'https://s/old')
    await advance(540_000)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh download link' }))
    await settle()
    await dl.fail(1, 500)
    expect(link()).toBeNull()
    expect(document.querySelector('a[href="https://s/old"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await settle()
    await dl.ok(2, 'https://s/renewed')
    expect(link()).toHaveAttribute('href', 'https://s/renewed')
  })

  it('rechecks age on activation when the expiry timer was throttled', async () => {
    const dl = mockDownloads()
    mount(ready(9))
    await settle()
    await dl.ok(0, 'https://s/old')
    const a = link()!
    const base = performance.now()
    const spy = vi.spyOn(performance, 'now').mockReturnValue(base + 541_000)
    expect(fireEvent.click(a)).toBe(false) // default prevented, no download
    spy.mockRestore()
  })

  it.each([
    ['window blur', () => window.dispatchEvent(new Event('blur'))],
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
    ['visibility hidden', () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    }],
  ])('%s invalidates the href, blocks an immediate click, and needs explicit refresh', async (_n, fire) => {
    const dl = mockDownloads()
    mount(ready(9))
    await settle()
    await dl.ok(0, 'https://s/a')
    const a = link()!
    let notPrevented = true
    act(() => {
      fire()
      notPrevented = fireEvent.click(a) // event-to-render gap: ref must already be invalid
    })
    expect(notPrevented).toBe(false)
    expect(link()).toBeNull()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await settle()
    expect(link()).toBeNull() // restoration alone does not re-enable
    expect(dl.calls).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh download link' }))
    await settle()
    await dl.ok(1, 'https://s/b')
    expect(link()).toHaveAttribute('href', 'https://s/b')
  })

  it('a response that started before invalidation cannot re-enable the link', async () => {
    const dl = mockDownloads()
    mount(ready(9))
    await settle() // request 0 in flight
    act(() => { window.dispatchEvent(new Event('blur')) })
    await advance(10)
    await dl.ok(0, 'https://s/pre-blur')
    expect(link()).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh download link' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh download link' }))
    await settle()
    await dl.ok(1, 'https://s/post')
    expect(link()).toHaveAttribute('href', 'https://s/post')
  })
})
