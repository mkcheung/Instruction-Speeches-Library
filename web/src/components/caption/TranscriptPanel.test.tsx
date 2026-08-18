import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranscriptPanel } from '@/components/caption/TranscriptPanel'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

describe('TranscriptPanel', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('renders each transcript segment and seeks on click, read-only (no edit affordance)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/transcript')) {
        return jsonResponse({
          transcript: {
            body: 'Hello world. Second part.',
            segments: [
              { start: 0, end: 1.5, text: 'Hello world.' },
              { start: 1.5, end: 3, text: 'Second part.' },
            ],
            word_count: 4,
            words_per_minute: 100,
            language: 'en',
            model: 'whisper-base',
            source: 'whisper',
            updated_at: null,
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const onSeek = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<TranscriptPanel speechId={1} onSeek={onSeek} />)

    expect(await screen.findByText('Hello world.')).toBeInTheDocument()
    expect(screen.getByText('Second part.')).toBeInTheDocument()
    // No textbox anywhere — this view has no inline-editable affordance,
    // unlike `CaptionEditor`.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByText('Second part.'))
    expect(onSeek).toHaveBeenCalledWith(1.5)
  })

  it('shows an honest empty state when no transcript exists yet', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/transcript')) {
        return jsonResponse({
          transcript: {
            body: '',
            segments: [],
            word_count: 0,
            words_per_minute: null,
            language: null,
            model: null,
            source: null,
            updated_at: null,
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<TranscriptPanel speechId={1} onSeek={vi.fn()} />)

    expect(await screen.findByText(/no transcript yet/i)).toBeInTheDocument()
  })
})
