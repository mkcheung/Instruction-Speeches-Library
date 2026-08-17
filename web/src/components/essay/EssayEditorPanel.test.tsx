import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { render } from '@testing-library/react'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { EssayEditorPanel } from '@/components/essay/EssayEditorPanel'
import type { Review } from '@/features/review/types'
import type { Essay } from '@/features/essay/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: 1,
    status: 'accepted',
    invitation_message: null,
    allow_preview: true,
    prior_commentary_shared: false,
    invited_at: null,
    responded_at: null,
    first_published_at: null,
    last_published_at: null,
    last_transition_at: '2026-01-01T00:00:00Z',
    revoked_at: null,
    revocation_reason: null,
    ...overrides,
  }
}

function essay(overrides: Partial<Essay> = {}): Essay {
  return {
    essay_html: '<p>hello</p>',
    essay_text: 'hello',
    essay_published_at: null,
    essay_updated_at: null,
    essay_words: 1,
    essay_lock_version: 3,
    ...overrides,
  }
}

/**
 * `EssayEditorPanel` mounts a real `@tiptap/react` editor, which drags in
 * ProseMirror's DOM/selection assumptions that jsdom only partially
 * supports. This mock keeps the tests focused on THIS codebase's own
 * logic (autosave-state rendering, the conflict banner's three actions,
 * the publish button, and the `useBlocker` unsaved-changes dialog) rather
 * than re-testing TipTap/ProseMirror itself — `useEditor`'s `content` is
 * only read once (matching real TipTap, which also ignores prop changes
 * after mount) and `commands.setContent` is exercised for real so the
 * conflict-resolution sync effect is still covered.
 */
vi.mock('@tiptap/react', async () => {
  const React = await import('react')

  interface FakeEditor {
    getHTML(): string
    getText(): string
    isActive(): boolean
    getAttributes(): Record<string, unknown>
    chain(): unknown
    commands: { setContent: (html: string) => void }
    typeText: (next: string) => void
  }

  // A real, minimal-but-live piece of React state (not a plain class
  // instance) — real TipTap's `Editor` manages its own DOM outside React
  // entirely (via ProseMirror) and re-renders `EditorContent` through its
  // own subscription, which a plain mutable object can't reproduce. Using
  // `useState` here means `commands.setContent` (the conflict-resolution
  // sync path in `EssayEditorPanel`) actually re-renders the fake content,
  // same as the real thing would.
  function useEditor(config: { content?: string; onUpdate?: (args: { editor: FakeEditor }) => void }) {
    const [html, setHtml] = React.useState(config.content ?? '')
    const editor: FakeEditor = {
      getHTML: () => html,
      getText: () => html.replace(/<[^>]+>/g, ''),
      isActive: () => false,
      getAttributes: () => ({}),
      chain: () => {
        const chainObj = new Proxy(
          {},
          {
            get: (_t, prop) => (prop === 'run' ? () => {} : () => chainObj),
          },
        )
        return chainObj
      },
      commands: { setContent: (next: string) => setHtml(next) },
      // `setHtml` above is async (batched React state) — `onUpdate` needs
      // the NEW value synchronously, so it gets a fresh object carrying
      // `next` directly rather than reading back through the (still stale
      // until the next render) `editor.getHTML` closure.
      typeText: (next: string) => {
        setHtml(next)
        config.onUpdate?.({ editor: { ...editor, getHTML: () => next, getText: () => next.replace(/<[^>]+>/g, '') } })
      },
    }
    return editor
  }

  function EditorContent({
    editor,
    'data-testid': testId,
  }: {
    editor: FakeEditor | null
    'data-testid'?: string
  }) {
    return (
      <div data-testid={testId}>
        <div data-testid="essay-fake-content">{editor?.getHTML()}</div>
        <button type="button" onClick={() => editor?.typeText('<p>typed some words</p>')}>
          Type
        </button>
      </div>
    )
  }

  return { useEditor, EditorContent }
})

function renderPanel(speechId: number, r: Review, route = '/speeches/1') {
  const store = createTestStore()
  const router = createMemoryRouter(
    [
      {
        path: '/speeches/:id',
        element: (
          <div>
            <EssayEditorPanel speechId={speechId} review={r} />
            <Link to="/dashboard">Go to dashboard</Link>
          </div>
        ),
      },
      { path: '/dashboard', element: <p>Dashboard</p> },
    ],
    { initialEntries: [route] },
  )
  return {
    store,
    router,
    ...render(
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>,
    ),
  }
}

describe('EssayEditorPanel', () => {
  beforeEach(() => clearCookies())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows the autosave state as one word via the essay-specific test hook', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/essay')) return jsonResponse({ essay: essay() })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPanel(1, review())

    const badge = await screen.findByTestId('essay-autosave-state')
    expect(badge).toHaveTextContent('idle')
    // Distinct from annotations' own hook — both can render on screen at
    // once in the Notes/Essay tab strip without colliding.
    expect(screen.queryByTestId('autosave-state')).not.toBeInTheDocument()
  })

  it('publish is disabled until the essay has text, then calls the publish endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/essay/publish')) {
        expect(init?.method).toBe('POST')
        return jsonResponse({ essay: { ...essay(), essay_published_at: '2026-01-02T00:00:00Z' } })
      }
      if (url.includes('/essay')) return jsonResponse({ essay: essay({ essay_html: '<p>hello</p>' }) })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderPanel(1, review())

    const publishButton = await screen.findByRole('button', { name: 'Publish' })
    expect(publishButton).toBeEnabled() // seeded with non-empty text already

    await user.click(publishButton)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/essay/publish'))).toBe(true)
    })
  })

  it('renders the conflict banner and wires keepMine/useTheirs/toggleShowBoth', async () => {
    const serverCurrent = essay({ essay_html: '<p>theirs</p>', essay_lock_version: 9 })
    let essayCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/essay/publish')) return jsonResponse({ essay: essay() })
      if (url.includes('/essay')) {
        essayCallCount += 1
        // First call: the initial GET. Every write after (the PUT this
        // test's "Type" click triggers): a 409.
        if (essayCallCount === 1) return jsonResponse({ essay: essay() })
        return jsonResponse({ message: 'conflict', conflictSource: 'self', current: serverCurrent }, 409)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPanel(1, review())

    // `findByTestId` polls via `waitFor`, which Vitest's fake timers don't
    // drive automatically — resolve the initial load under REAL timers
    // first, then switch to fake ones only for the debounce wait below.
    // `fireEvent` (not `userEvent`) from here on: userEvent's internal
    // pointer-event simulation schedules its own timers, which fights
    // fake timers even with `advanceTimers` configured.
    await screen.findByTestId('essay-autosave-state')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    const banner = screen.getByTestId('essay-conflict-banner')
    expect(banner).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use theirs' }))
    expect(screen.getByTestId('essay-fake-content')).toHaveTextContent('theirs')
    expect(screen.queryByTestId('essay-conflict-banner')).not.toBeInTheDocument()
  })

  it('blocks in-app navigation while dirty and lets the user choose to leave', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      // Never resolves the PUT within this test — the point is to stay
      // "dirty" long enough to attempt navigation.
      if (url.includes('/essay') && url.endsWith('/essay')) return new Promise(() => {})
      if (url.includes('/essay')) return jsonResponse({ essay: essay() })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    const { router } = renderPanel(1, review())

    await screen.findByTestId('essay-autosave-state')
    await user.click(screen.getByRole('button', { name: 'Type' }))
    await waitFor(() => expect(screen.getByTestId('essay-autosave-state')).toHaveTextContent('dirty'))

    await user.click(screen.getByRole('link', { name: 'Go to dashboard' }))

    expect(await screen.findByTestId('essay-unsaved-changes-dialog')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/speeches/1')

    await user.click(screen.getByRole('button', { name: 'Leave' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })
})
