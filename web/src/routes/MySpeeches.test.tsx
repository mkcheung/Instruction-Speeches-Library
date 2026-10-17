import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MySpeeches from '@/routes/MySpeeches'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

const READY_SPEECH = {
  id: 7,
  ulid: '01READY',
  title: 'A ready speech',
  description: null,
  delivered_on: null,
  change_note: null,
  created_at: '2026-01-01T00:00:00Z',
  captions_enabled: true,
  primary_video: { id: 1, kind: 'video', status: 'ready', failure_code: null, duration_seconds: '10.0' },
}

/**
 * §7.5 frontend: `MySpeeches.tsx` gained an owner menu (Edit/Remove) in
 * `CardHeader` via `CardAction` — this extends the route's test coverage
 * rather than replacing it, since no `MySpeeches.test.tsx` existed before
 * this feature. Covers: the menu renders per card and opens each dialog,
 * and — the §12 frozen-contract concern this task calls out explicitly —
 * the existing `Watch` link is unaffected, still scoped inside
 * `[data-slot="card"]`, the same thing `captions.spec.ts:489-490` asserts
 * end to end.
 */
describe('MySpeeches', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/api/speeches') && !url.match(/\/\d/)) {
        return jsonResponse({ speeches: [READY_SPEECH], meta: { current_page: 1, last_page: 1, total: 1 } })
      }
      if (url.includes('/api/queue/transcode-depth')) {
        return jsonResponse({ depth: 0 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('renders the owner menu on each card, and the existing Watch link/scoping is unaffected', async () => {
    stubFetch()
    renderWithProviders(<MySpeeches />, { route: '/speeches' })

    const card = (await screen.findByRole('link', { name: 'Watch' })).closest('[data-slot="card"]')
    expect(card).not.toBeNull()

    // `Watch` stays a link, scoped inside the one `[data-slot="card"]` —
    // §12's frozen contract. No second `data-slot="card"` was introduced
    // by the owner menu.
    expect(within(card as HTMLElement).getByRole('link', { name: 'Watch' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(1)

    expect(within(card as HTMLElement).getByRole('button', { name: 'Speech options' })).toBeInTheDocument()
  })

  it('opens the edit dialog from the owner menu', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderWithProviders(<MySpeeches />, { route: '/speeches' })

    await screen.findByRole('link', { name: 'Watch' })
    await user.click(screen.getByRole('button', { name: 'Speech options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit details' }))

    expect(await screen.findByTestId('speech-edit-dialog')).toBeInTheDocument()
  })

  it('opens the delete dialog from the owner menu', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderWithProviders(<MySpeeches />, { route: '/speeches' })

    await screen.findByRole('link', { name: 'Watch' })
    await user.click(screen.getByRole('button', { name: 'Speech options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove speech' }))

    await waitFor(() => expect(screen.getByTestId('speech-delete-dialog')).toBeInTheDocument())
  })
})
