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
  private _poster: string | undefined = undefined

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

  poster(value?: string) {
    if (value !== undefined) this._poster = value
    return this._poster
  }
}

vi.mock('video.js', () => ({
  default: vi.fn(() => new FakePlayer()),
}))

const { createVideoJsPlayer, setCaptionsTrack, getCaptionsTrack } = await import('@/shared/media/videojs-adapter')

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

/**
 * STEP-04-every-video-plays.md §9.5's poster-flash mitigation: reassigning
 * `src` on a URL refresh resets the media element's internal "show
 * poster" state, so without this the poster flashes back over the video
 * mid-playback. `loadeddata` clears the `poster` attribute (nothing left
 * to flash); `emptied` (fired when `src` is reassigned) puts it back, and
 * both are registered exactly once — not re-armed per refresh — so they
 * keep working correctly across arbitrarily many refresh cycles without
 * accumulating duplicate listeners.
 */
describe('videojs-adapter poster-flash mitigation', () => {
  it('clears the poster attribute once the first frame has loaded', () => {
    const player = createVideoJsPlayer(document.createElement('video'), {
      initialUrl: 'https://stale.example/video.mp4',
      refreshUrl: vi.fn(),
      poster: 'https://example.com/poster.jpg',
    }) as unknown as FakePlayer

    player.emit('loadeddata')

    expect(player.poster()).toBe('')
  })

  it('restores the poster on emptied and re-clears it on the following loadeddata (repeatable across cycles)', () => {
    const player = createVideoJsPlayer(document.createElement('video'), {
      initialUrl: 'https://stale.example/video.mp4',
      refreshUrl: vi.fn(),
      poster: 'https://example.com/poster.jpg',
    }) as unknown as FakePlayer

    player.emit('loadeddata')
    expect(player.poster()).toBe('')

    // A URL refresh reassigns `src`, which resets the element — `emptied`
    // fires, then a fresh `loadeddata` once the new source has a frame.
    player.emit('emptied')
    expect(player.poster()).toBe('https://example.com/poster.jpg')

    player.emit('loadeddata')
    expect(player.poster()).toBe('')

    // A second refresh cycle must behave identically — proving the
    // listeners were not consumed/left stale after the first cycle.
    player.emit('emptied')
    expect(player.poster()).toBe('https://example.com/poster.jpg')
    player.emit('loadeddata')
    expect(player.poster()).toBe('')
  })

  it('does nothing when no poster option was provided', () => {
    const player = createVideoJsPlayer(document.createElement('video'), {
      initialUrl: 'https://stale.example/video.mp4',
      refreshUrl: vi.fn(),
    }) as unknown as FakePlayer

    player.emit('loadeddata')
    player.emit('emptied')

    expect(player.poster()).toBeUndefined()
  })
})

/**
 * STEP-09-captions.md/STEP-09-FROZEN-CONTRACT.md §5's "a real `<track
 * kind='captions' default>`" — exercised against a fake player exposing
 * just the four video.js text-track methods these two functions actually
 * call (`remoteTextTracks`/`removeRemoteTextTrack`/`addRemoteTextTrack`/
 * `textTracks`). Plain arrays stand in for video.js's `TextTrackList` —
 * both have `.length` and numeric indexing, the only two things
 * `videojs-adapter.ts`'s own `toArray` helper reads off them.
 */
type FakeTrack = { kind: string; mode: TextTrackMode; label?: string; src?: string }

function fakeCaptionsPlayer() {
  const tracks: FakeTrack[] = []
  const player = {
    remoteTextTracks: () => tracks,
    textTracks: () => tracks,
    removeRemoteTextTrack: (track: FakeTrack) => {
      const index = tracks.indexOf(track)
      if (index >= 0) tracks.splice(index, 1)
    },
    addRemoteTextTrack: (options: { kind: string; src: string; label?: string; default?: boolean }) => {
      const track: FakeTrack = {
        kind: options.kind,
        mode: options.default ? 'showing' : 'disabled',
        label: options.label,
        src: options.src,
      }
      tracks.push(track)
      return { track }
    },
  }
  return { player, tracks }
}

describe('setCaptionsTrack/getCaptionsTrack', () => {
  it('getCaptionsTrack is null before any captions track is attached', () => {
    const { player } = fakeCaptionsPlayer()
    expect(getCaptionsTrack(player as unknown as Parameters<typeof getCaptionsTrack>[0])).toBeNull()
  })

  it('attaches a real kind="captions" default track, readable back via getCaptionsTrack', () => {
    const { player } = fakeCaptionsPlayer()
    setCaptionsTrack(player as unknown as Parameters<typeof setCaptionsTrack>[0], {
      src: 'blob:fake-vtt-url',
      label: 'English',
    })

    const track = getCaptionsTrack(player as unknown as Parameters<typeof getCaptionsTrack>[0])
    expect(track).not.toBeNull()
    expect(track?.kind).toBe('captions')
    expect(track?.mode).toBe('showing') // `default: true` per the adapter's own call
  })

  it('replacing the captions URL removes the old track rather than accumulating a second one', () => {
    const { player, tracks } = fakeCaptionsPlayer()
    setCaptionsTrack(player as unknown as Parameters<typeof setCaptionsTrack>[0], { src: 'blob:one' })
    setCaptionsTrack(player as unknown as Parameters<typeof setCaptionsTrack>[0], { src: 'blob:two' })

    expect(tracks).toHaveLength(1)
    expect(tracks[0].src).toBe('blob:two')
  })

  it('passing null removes any existing captions track', () => {
    const { player } = fakeCaptionsPlayer()
    setCaptionsTrack(player as unknown as Parameters<typeof setCaptionsTrack>[0], { src: 'blob:one' })
    expect(getCaptionsTrack(player as unknown as Parameters<typeof getCaptionsTrack>[0])).not.toBeNull()

    setCaptionsTrack(player as unknown as Parameters<typeof setCaptionsTrack>[0], null)
    expect(getCaptionsTrack(player as unknown as Parameters<typeof getCaptionsTrack>[0])).toBeNull()
  })
})
