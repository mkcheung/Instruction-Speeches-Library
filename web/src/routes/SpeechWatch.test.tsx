import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type Player from 'video.js/dist/types/player'
import { PosterFramePicker } from '@/routes/SpeechWatch'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import type { SpeechSprite } from '@/features/speech/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function fakePlayer(currentTime: number): Player {
  return { currentTime: () => currentTime } as unknown as Player
}

const sprite: SpeechSprite = {
  url: 'https://example.com/sprite.jpg',
  columns: 5,
  rows: 2,
  frame_width: 800, // whole-tile width: 5 cols * 160px
  frame_height: 180, // whole-tile height: 2 rows * 90px
  duration_seconds: '100',
}

/**
 * STEP-04-every-video-plays.md §9.5: "use current frame" and the
 * sprite-strip picker both call `POST .../poster-frame` — this checks the
 * mutation fires with the right `time_seconds` payload from each trigger.
 */
describe('PosterFramePicker', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('"Use current frame" calls the poster-frame mutation with the player\'s currentTime', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/poster-frame')) {
        expect(JSON.parse(String(init?.body))).toEqual({ time_seconds: 12.5 })
        return jsonResponse({
          asset: { id: 9, kind: 'video', status: 'ready', failure_code: null, duration_seconds: null, width: null, height: null, poster_time_seconds: '12.5' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const playerRef = createRef<Player | null>()
    ;(playerRef as { current: Player | null }).current = fakePlayer(12.5)

    const user = userEvent.setup()
    renderWithProviders(<PosterFramePicker speechId={1} assetId={9} playerRef={playerRef} />)

    await user.click(screen.getByRole('button', { name: /use current frame/i }))

    await waitFor(() => {
      const called = fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/speeches/1/assets/9/poster-frame'))
      expect(called).toBe(true)
    })
  })

  it('clicking a sprite cell calls the poster-frame mutation with the computed timestamp', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/poster-frame')) {
        // Cell index 3 of 10, duration 100s -> 3/10 * 100 = 30.
        expect(JSON.parse(String(init?.body))).toEqual({ time_seconds: 30 })
        return jsonResponse({
          asset: { id: 9, kind: 'video', status: 'ready', failure_code: null, duration_seconds: null, width: null, height: null, poster_time_seconds: '30' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const playerRef = createRef<Player | null>()

    const user = userEvent.setup()
    renderWithProviders(<PosterFramePicker speechId={1} assetId={9} playerRef={playerRef} sprite={sprite} />)

    const cells = screen.getAllByRole('button', { name: /use frame at/i })
    expect(cells).toHaveLength(10)

    await user.click(screen.getByRole('button', { name: 'Use frame at 30.0s' }))

    await waitFor(() => {
      const called = fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/speeches/1/assets/9/poster-frame'))
      expect(called).toBe(true)
    })
  })
})
