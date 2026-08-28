import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/features/annotation/types'

const loadAudio = vi.hoisted(() => vi.fn())
vi.mock('@/features/annotation/annotationApi', () => ({
  useLazyGetVoiceAudioUrlQuery: () => [loadAudio],
}))

import { useVoiceInterjections } from '@/hooks/useVoiceInterjections'

class FakeAudio {
  static instances: FakeAudio[] = []
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  paused = true
  play = vi.fn(async () => {
    this.paused = false
  })
  pause = vi.fn(() => {
    this.paused = true
  })
  removeAttribute = vi.fn()
  load = vi.fn()
  src: string
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
}

function voice(id: string, start: number): Annotation {
  return {
    id,
    start_seconds: start,
    duration_seconds: 2,
    kind: 'observation',
    topic: null,
    body: `voice ${id}`,
    lock_version: 0,
    client_uuid: `uuid-${id}`,
    voice: { asset_id: Number(id), audio_status: 'ready', transcript_status: 'ready', failure_code: null },
  }
}

function playableVideo() {
  const video = document.createElement('video')
  let paused = false
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused })
  video.pause = vi.fn(() => {
    paused = true
  })
  video.play = vi.fn(async () => {
    paused = false
  })
  video.currentTime = 0
  return video
}

describe('useVoiceInterjections', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    loadAudio.mockReset()
    loadAudio.mockImplementation(({ annotationId }: { annotationId: string }) => ({
      unwrap: () => Promise.resolve({ audio: { url: `https://media/${annotationId}.m4a`, expires_at: '' } }),
    }))
    vi.stubGlobal('Audio', FakeAudio)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('queues every note crossed in one tick and resumes after the final ended event', async () => {
    const video = playableVideo()
    const experienced = vi.fn()
    const { result } = renderHook(() =>
      useVoiceInterjections({
        speechId: 1,
        videoEl: video,
        notes: [voice('1', 0.1), voice('2', 0.2)],
        mode: 'play',
        onExperienced: experienced,
        resetKey: 9,
      }),
    )

    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 0.25
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1))
    expect(video.pause).toHaveBeenCalled()
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(2))
    expect(experienced).toHaveBeenCalledTimes(1)
    expect(video.play).not.toHaveBeenCalled()
    act(() => FakeAudio.instances[1].onended?.())
    await waitFor(() => expect(video.play).toHaveBeenCalledTimes(1))
    expect(experienced).toHaveBeenCalledTimes(1)
    expect(result.current.current).toBeNull()
  })

  it('resumes the video when audio.play rejects', async () => {
    const video = playableVideo()
    class RejectingAudio extends FakeAudio {
      override play = vi.fn(async () => Promise.reject(new Error('blocked')))
    }
    vi.stubGlobal('Audio', RejectingAudio)
    renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(video.play).toHaveBeenCalledTimes(1))
  })

  it('Skip clears the queue and resumes immediately', async () => {
    const video = playableVideo()
    const { result } = renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(result.current.current?.id).toBe('1'))
    act(() => result.current.skip())
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(result.current.current).toBeNull()
  })

  it('a manual commentary pause suppresses auto-resume when the note later ends', async () => {
    const video = playableVideo()
    const { result } = renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => result.current.pauseCommentary())
    await act(async () => result.current.resumeCommentary())
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(result.current.current).toBeNull())
    expect(video.play).not.toHaveBeenCalled()
  })

  it('does not restart the duration safety budget after a late commentary resume', async () => {
    vi.useFakeTimers()
    const video = playableVideo()
    const { result } = renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.state).toBe('playing')
    act(() => {
      vi.advanceTimersByTime(4_000)
      result.current.pauseCommentary()
      vi.advanceTimersByTime(2_000)
    })
    await act(async () => result.current.resumeCommentary())
    expect(result.current.current).toBeNull()
    expect(video.play).not.toHaveBeenCalled()
  })

  it('keeps video paused and suppresses auto-resume after a video play gesture during voice', async () => {
    const video = playableVideo()
    renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1))
    act(() => video.dispatchEvent(new Event('play')))
    expect(video.pause).toHaveBeenCalledTimes(2)
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(FakeAudio.instances[0].pause).toHaveBeenCalled())
    expect(video.play).not.toHaveBeenCalled()
  })

  it('does not retro-fire prior notes when play begins from a non-zero time', () => {
    const video = playableVideo()
    video.currentTime = 10
    renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 2)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 10.25
      video.dispatchEvent(new Event('timeupdate'))
    })
    expect(loadAudio).not.toHaveBeenCalled()
  })

  it.each(['text', 'none'] as const)('never hints, fetches, or plays voice audio in %s mode', (mode) => {
    const video = playableVideo()
    const { result } = renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode, onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 0.25
      video.dispatchEvent(new Event('timeupdate'))
    })
    expect(result.current.hint).toBeNull()
    expect(loadAudio).not.toHaveBeenCalled()
    expect(FakeAudio.instances).toHaveLength(0)
  })

  it('recovers from URL and audio element failures', async () => {
    const video = playableVideo()
    loadAudio.mockImplementationOnce(() => ({ unwrap: () => Promise.reject(new Error('url failed')) }))
    const first = renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(video.play).toHaveBeenCalledTimes(1))
    first.unmount()

    const video2 = playableVideo()
    renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video2, notes: [voice('2', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video2.dispatchEvent(new Event('play'))
      video2.currentTime = 1
      video2.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThan(0))
    act(() => FakeAudio.instances.at(-1)?.onerror?.())
    await waitFor(() => expect(video2.play).toHaveBeenCalledTimes(1))
  })

  it('the duration plus three-second safety timer cannot strand the video', async () => {
    vi.useFakeTimers()
    const video = playableVideo()
    renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => vi.advanceTimersByTime(5001))
    expect(video.play).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('Escape skips the current interjection', async () => {
    const video = playableVideo()
    renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(video.play).toHaveBeenCalledTimes(1)
  })

  it('a forward seek suppresses notes and a backward seek re-arms them', async () => {
    const video = playableVideo()
    renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 2)], mode: 'play', onExperienced: vi.fn(), resetKey: 1 }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 5
      video.dispatchEvent(new Event('timeupdate'))
    })
    expect(loadAudio).not.toHaveBeenCalled()
    act(() => {
      video.currentTime = 1.8
      video.dispatchEvent(new Event('seeking'))
      video.dispatchEvent(new Event('seeked'))
      video.currentTime = 2.1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(loadAudio).toHaveBeenCalledTimes(1))
  })

  it('changing reviewer or mode cancels audio and resumes safely', async () => {
    const video = playableVideo()
    let resetKey = 1
    let mode: 'play' | 'text' = 'play'
    const hook = renderHook(() =>
      useVoiceInterjections({ speechId: 1, videoEl: video, notes: [voice('1', 1)], mode, onExperienced: vi.fn(), resetKey }),
    )
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 1
      video.dispatchEvent(new Event('timeupdate'))
    })
    await waitFor(() => expect(hook.result.current.current).not.toBeNull())
    resetKey = 2
    hook.rerender()
    await waitFor(() => expect(hook.result.current.current).toBeNull())
    expect(video.play).toHaveBeenCalledTimes(1)

    mode = 'text'
    hook.rerender()
    expect(hook.result.current.current).toBeNull()
  })

  it('still fires a note when a re-render lands between two ticks', async () => {
    // Regression: the listener effect re-seeded prevTimeRef to the LIVE
    // currentTime on every run, and it runs on every render (its `notes`
    // dep is a fresh filter() array from useCommentaryTrack). That narrowed
    // the [prevTime, now] window crossedNotes inspects, so a note inside
    // the swallowed gap never played — permanently, since prevTime only
    // moves forward.
    const video = playableVideo()
    const hook = renderHook(() =>
      useVoiceInterjections({
        speechId: 1,
        videoEl: video,
        // Fresh array identity each render, exactly like the real caller.
        notes: [voice('1', 10.1)],
        mode: 'play',
        onExperienced: vi.fn(),
        resetKey: 1,
      }),
    )

    act(() => {
      video.dispatchEvent(new Event('play'))
      video.currentTime = 10.0
      video.dispatchEvent(new Event('timeupdate'))
    })

    // A render between ticks — the poll/isFetching churn that happens for
    // reasons unrelated to the video clock.
    act(() => {
      video.currentTime = 10.2
      hook.rerender()
    })

    act(() => {
      video.currentTime = 10.25
      video.dispatchEvent(new Event('timeupdate'))
    })

    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1))
  })
})
