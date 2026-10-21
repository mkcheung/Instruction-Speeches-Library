import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Search from '@/routes/Search'
import { transcriptApi } from '@/features/transcript/transcriptApi'
import type { SpeechSearchResult } from '@/features/transcript/types'
import { renderWithProviders, createTestStore, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function speech(overrides: Partial<SpeechSearchResult> = {}): SpeechSearchResult {
  return {
    id: 7, ulid: '01XYZ', title: 'District final speech', description: 'Practice run',
    delivered_on: null, change_note: null, created_at: '2026-01-01T00:00:00Z',
    captions_enabled: true, primary_video: null, ...overrides,
  }
}
function mockSearch(handler: (q: string) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
    if (url.includes('/speeches/search')) return handler(new URL(url).searchParams.get('q')!)
    throw new Error(`unexpected fetch: ${url}`)
  }))
}
function enter(value: string) {
  fireEvent.change(screen.getByLabelText('Search text'), { target: { value } })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const delay = () => act(async () => { await new Promise((done) => setTimeout(done, 350)) })

describe('Search', () => {
  beforeEach(() => clearCookies())
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('skips empty and whitespace-only input and keeps the 300ms debounce', async () => {
    vi.useFakeTimers()
    const handler = vi.fn(() => jsonResponse({ results: [] }))
    mockSearch(handler)
    renderWithProviders(<Search />)
    expect(screen.getByRole('status')).toHaveTextContent('Start typing to search.')
    enter('   ')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(handler).not.toHaveBeenCalled()
    enter(' district ')
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(handler).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(handler).toHaveBeenCalledWith('district')
  })

  it('renders server highlights, excerpt ellipses and a complete keyboard-accessible title', async () => {
    mockSearch(() => jsonResponse({ results: [speech({
      description: 'A district practice run', search_match: {
        title: [{ text: 'District', matched: true }, { text: ' final speech', matched: false }],
        description: [{ text: 'A ', matched: false }, { text: 'district', matched: true }, { text: ' practice run', matched: false }],
        transcript_excerpt: {
          parts: [{ text: 'Our ', matched: false }, { text: 'district', matched: true }, { text: ' finalists.', matched: false }],
          truncated_before: true, truncated_after: true,
        },
      },
    })] }))
    const user = userEvent.setup()
    const { container, router } = renderWithProviders(<Search />)
    await user.click(screen.getByLabelText('Search text'))
    enter('district')
    const link = await screen.findByRole('link', { name: 'District final speech' })
    expect(link).toHaveAttribute('href', '/speeches/7')
    expect(container.querySelectorAll('mark')).toHaveLength(3)
    expect(screen.getByText('Transcript excerpt')).toBeInTheDocument()
    expect(screen.getByText(/…Our/, { selector: 'p' }).textContent).toBe('…Our district finalists.…')
    expect(screen.getByRole('status')).toHaveTextContent('1 speech matched.')
    expect(link).toHaveClass('focus-visible:ring-3')
    expect(link.closest('li')).toHaveClass('[overflow-wrap:anywhere]')
    await user.tab()
    expect(link).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/speeches/7'))
  })

  it('never invents highlights or excerpts for metadata-only or old API responses', async () => {
    mockSearch(() => jsonResponse({ results: [
      speech({ search_match: {
        title: [{ text: 'District', matched: true }, { text: ' final speech', matched: false }],
        description: [{ text: 'Practice run', matched: false }], transcript_excerpt: null,
      } }),
      speech({ id: 8, title: 'Old district response', description: null }),
      speech({ id: 9, title: 'Empty description', description: '', search_match: {
        title: [{ text: 'Empty description', matched: false }], description: null, transcript_excerpt: null,
      } }),
    ] }))
    const { container } = renderWithProviders(<Search />)
    enter('district')
    await screen.findByRole('link', { name: 'Old district response' })
    expect(screen.queryByText('Transcript excerpt')).not.toBeInTheDocument()
    expect(container.querySelectorAll('mark')).toHaveLength(1)
    expect(container.querySelectorAll('li p')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('3 speeches matched.')
  })

  it('renders HTML-looking metadata and excerpt literally', async () => {
    const title = '<img src=x onerror=alert(1)> district'
    const description = '<script>alert("district")</script>'
    mockSearch(() => jsonResponse({ results: [speech({ title, description, search_match: {
      title: [{ text: title, matched: true }], description: [{ text: description, matched: true }],
      transcript_excerpt: { parts: [{ text: '<iframe>district</iframe>', matched: true }], truncated_before: false, truncated_after: false },
    } })] }))
    const { container } = renderWithProviders(<Search />)
    enter('district')
    await screen.findByRole('link', { name: title })
    expect(screen.getByText(description)).toBeInTheDocument()
    expect(screen.getByText('<iframe>district</iframe>')).toBeInTheDocument()
    expect(container.querySelector('img,script,iframe')).toBeNull()
  })

  it('shows a content-only match without marking unrelated metadata', async () => {
    mockSearch(() => jsonResponse({ results: [speech({ search_match: {
      title: [{ text: 'District final speech', matched: false }],
      description: [{ text: 'Practice run', matched: false }],
      transcript_excerpt: {
        parts: [{ text: 'This is a ', matched: false }, { text: 'conversation', matched: true }, { text: '.', matched: false }],
        truncated_before: false, truncated_after: false,
      },
    } })] }))
    const { container } = renderWithProviders(<Search />)
    enter('conversation')
    const link = await screen.findByRole('link', { name: 'District final speech' })
    expect(link.querySelector('mark')).toBeNull()
    expect(container.querySelectorAll('mark')).toHaveLength(1)
    expect(screen.getByText('conversation').tagName).toBe('MARK')
  })

  it('hides old cards immediately on typing or clear and ignores delayed older responses', async () => {
    const old = deferred<Response>()
    const next = deferred<Response>()
    const handler = vi.fn((q: string) => q === 'old' ? old.promise : next.promise)
    mockSearch(handler)
    renderWithProviders(<Search />)
    enter('old')
    await waitFor(() => expect(handler).toHaveBeenCalledWith('old'))
    enter('next')
    expect(screen.getByRole('status')).toHaveTextContent('Searching…')
    await act(async () => old.resolve(jsonResponse({ results: [speech({ title: 'Old result' })] })))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await waitFor(() => expect(handler).toHaveBeenCalledWith('next'))
    await act(async () => next.resolve(jsonResponse({ results: [speech({ title: 'Next result' })] })))
    await screen.findByRole('link', { name: 'Next result' })
    enter('new typing')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent('1 speech matched.')
    enter('')
    expect(screen.getByRole('status')).toHaveTextContent('Start typing to search.')
    await delay()
    expect(handler.mock.calls.map(([q]) => q)).toEqual(['old', 'next'])
  })

  it('keeps same-query cards while refetching but hides them after that query fails', async () => {
    const retry = deferred<Response>()
    let count = 0
    mockSearch(() => ++count === 1 ? jsonResponse({ results: [speech()] }) : retry.promise)
    const store = createTestStore()
    renderWithProviders(<Search />, { store })
    enter('district')
    await screen.findByRole('link', { name: 'District final speech' })
    act(() => { store.dispatch(transcriptApi.util.invalidateTags(['Search'])) })
    expect(screen.getByRole('status')).toHaveTextContent('Searching…')
    expect(screen.getByRole('link')).toBeInTheDocument()
    await act(async () => retry.resolve(jsonResponse({ message: 'unavailable' }, 500)))
    await screen.findByRole('alert')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent(/matched|searching/i)
    enter('another')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('never restores a cleared query when its in-flight response arrives', async () => {
    const pending = deferred<Response>()
    const handler = vi.fn(() => pending.promise)
    mockSearch(handler)
    renderWithProviders(<Search />)
    enter('district')
    await waitFor(() => expect(handler).toHaveBeenCalledOnce())
    enter('   ')
    await act(async () => pending.resolve(jsonResponse({ results: [speech()] })))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Start typing to search.')
  })

  it('shows an empty message only after the current pending request finishes', async () => {
    const pending = deferred<Response>()
    mockSearch(() => pending.promise)
    renderWithProviders(<Search />)
    enter('nonsense')
    expect(screen.getByRole('status')).toHaveTextContent('Searching…')
    expect(screen.queryByText(/no speeches matched/i)).not.toBeInTheDocument()
    await delay()
    expect(screen.getByRole('status')).toHaveTextContent('Searching…')
    await act(async () => pending.resolve(jsonResponse({ results: [] })))
    await screen.findByText('No speeches matched "nonsense".')
  })

  it('accepts 255 supplementary codepoints intact and skips 256 with an associated error', async () => {
    const handler = vi.fn(() => jsonResponse({ results: [speech()] }))
    mockSearch(handler)
    renderWithProviders(<Search />)
    const allowed = '😀'.repeat(255)
    enter(` ${allowed} `)
    await screen.findByRole('link', { name: 'District final speech' })
    expect(handler).toHaveBeenCalledWith(allowed)
    enter(allowed + '😀')
    expect(screen.getByLabelText('Search text')).toHaveValue(allowed + '😀')
    expect(screen.getByLabelText('Search text')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Search text')).toHaveAccessibleDescription('Enter no more than 255 characters.')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await delay()
    expect(handler).toHaveBeenCalledTimes(1)
    enter('valid again')
    await waitFor(() => expect(handler).toHaveBeenCalledWith('valid again'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refetches a cached phrase when the search route remounts', async () => {
    let count = 0
    mockSearch(() => jsonResponse({ results: ++count === 1 ? [] : [speech({ title: 'Newly indexed speech' })] }))
    const store = createTestStore()
    const first = renderWithProviders(<Search />, { store })
    enter('new phrase')
    await screen.findByText(/no speeches matched/i)
    first.unmount()
    renderWithProviders(<Search />, { store })
    enter('new phrase')
    await screen.findByRole('link', { name: 'Newly indexed speech' })
    expect(count).toBe(2)
  })
})
