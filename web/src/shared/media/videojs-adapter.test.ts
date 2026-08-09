import { describe, expect, it, vi } from 'vitest'

/**
 * §9.3's refresh-on-error handler, tested against a fake video.js player
 * (a real one needs a real `<video>` + real media pipeline, neither of
 * which exist in jsdom) — this exercises the adapter's own state machine:
 * which errors it treats as retryable, that position/play-state are
 * restored, and that a SECOND failure while refreshing doesn't leave the
 * player permanently unable to retry again later.
 */

class FakePlayer {
  listeners = new Map<string, Set<() => void>>()
  currentTimeValue = 0
  pausedValue = true
  srcCalls: unknown[] = []
  playCalled = false
  private _error: { code: number } | null = null

  on(event: string, handler: () => void) {
    this.one(event, handler, false)
  }

  one(event: string, handler: () => void, removeAfterFire = true) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    const wrapped = removeAfterFire
      ? () => {
          this.listeners.get(event)?.delete(wrapped)
          handler()
        }
      : handler
    this.listeners.get(event)!.add(wrapped)
  }

  off(event: string, handler: () => void) {
    this.listeners.get(event)?.delete(handler)
  }

  emit(event: string) {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler()
  }

  error() {
    return this._error
  }

  setError(code: number) {
    this._error = { code }
  }

  currentTime(value?: number) {
    if (value !== undefined) this.currentTimeValue = value
    return this.currentTimeValue
  }

  paused() {
    return this.pausedValue
  }

  src(value?: unknown) {
    if (value !== undefined) this.srcCalls.push(value)
  }

  play() {
    this.playCalled = true
    return Promise.resolve()
  }
}

vi.mock('video.js', () => ({
  default: vi.fn(() => new FakePlayer()),
}))

const { createVideoJsPlayer } = await import('@/shared/media/videojs-adapter')

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('videojs-adapter refresh-on-error', () => {
  it('refreshes the URL and restores position + play state on MEDIA_ERR_NETWORK', async () => {
    const refreshUrl = vi.fn().mockResolvedValue('https://fresh.example/video.mp4')
    const player = createVideoJsPlayer(document.createElement('video'), {
      initialUrl: 'https://stale.example/video.mp4',
      refreshUrl,
    }) as unknown as FakePlayer

    player.currentTimeValue = 42
    player.pausedValue = false
    player.setError(2)
    player.emit('error')
    await flush()
    await flush()

    expect(refreshUrl).toHaveBeenCalledTimes(1)
    expect(player.srcCalls).toEqual([{ src: 'https://fresh.example/video.mp4', type: 'video/mp4' }])

    player.emit('loadedmetadata')
    expect(player.currentTimeValue).toBe(42)
    expect(player.playCalled).toBe(true)
  })

  it('ignores a non-retryable error (e.g. DECODE)', async () => {
    const refreshUrl = vi.fn()
    const player = createVideoJsPlayer(document.createElement('video'), {
      initialUrl: 'https://stale.example/video.mp4',
      refreshUrl,
    }) as unknown as FakePlayer

    player.setError(3)
    player.emit('error')
    await flush()

    expect(refreshUrl).not.toHaveBeenCalled()
  })

  it('does not get stuck if the refreshed URL also errors, and can retry again later', async () => {
    const refreshUrl = vi
      .fn()
      .mockResolvedValueOnce('https://still-bad.example/video.mp4')
      .mockResolvedValueOnce('https://finally-good.example/video.mp4')

    const player = createVideoJsPlayer(document.createElement('video'), {
      initialUrl: 'https://stale.example/video.mp4',
      refreshUrl,
    }) as unknown as FakePlayer

    player.setError(2)
    player.emit('error') // first failure -> refresh #1
    await flush()
    await flush()

    // The reassigned src ALSO errors, before loadedmetadata ever fires.
    player.emit('error')
    await flush()

    // A third error must be able to trigger a second refresh — proving
    // `refreshing` was reset, not left stuck true.
    player.emit('error')
    await flush()
    await flush()

    expect(refreshUrl).toHaveBeenCalledTimes(2)
  })
})
