import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/features/annotation/types'

const loadAudio = vi.hoisted(() => vi.fn())
vi.mock('@/features/annotation/annotationApi', () => ({ useLazyGetVoiceAudioUrlQuery: () => [loadAudio] }))

import { useVoiceInterjections } from '@/hooks/useVoiceInterjections'
import { FakeAudio, deferred, playableVideo } from '@/test/voiceAudio'

function voice(id: string, start: number, status: 'ready' | 'processing' = 'ready'): Annotation {
  return { id, start_seconds: start, duration_seconds: 2, kind: 'observation', topic: null, body: `voice ${id}`,
    lock_version: 0, client_uuid: `uuid-${id}`,
    voice: { asset_id: Number(id), audio_status: status, transcript_status: 'ready', failure_code: null } }
}
const fire = (video: HTMLVideoElement, type: string) => video.dispatchEvent(new Event(type))
function seekableVideo(at: number, playing: boolean) {
  const video = playableVideo()
  let seeking = false
  Object.defineProperty(video, 'seeking', { configurable: true, get: () => seeking })
  video.currentTime = at
  if (!playing) video.pause()
  vi.mocked(video.pause).mockClear()
  return { video, setSeeking: (value: boolean) => { seeking = value } }
}
/** Browser order: seeking (currentTime = target), then the seek's own timeupdate at `landed`, then seeked. */
function seek(video: HTMLVideoElement, setSeeking: (v: boolean) => void, target: number, landed = target) {
  act(() => { video.currentTime = target; setSeeking(true); fire(video, 'seeking') })
  act(() => { setSeeking(false); video.currentTime = landed; fire(video, 'timeupdate') })
  act(() => fire(video, 'seeked'))
}
const ids = () => loadAudio.mock.calls.map(([arg]) => arg.annotationId)
function mount(video: HTMLVideoElement, notes: Annotation[], audioEnabled = true) {
  return renderHook(({ n, on }) => useVoiceInterjections({ speechId: 1, videoEl: video, notes: n, audioEnabled: on, resetKey: 1 }),
    { initialProps: { n: notes, on: audioEnabled } })
}
/** The engine's own resume: play() is a mock, so dispatch its play event, then tick. */
function engineResumeThenTick(video: HTMLVideoElement, to: number) {
  act(() => { fire(video, 'play'); video.currentTime = to; fire(video, 'timeupdate') })
}

describe('Fix A: armNote', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    loadAudio.mockReset()
    loadAudio.mockImplementation(({ annotationId }: { annotationId: string }) => ({
      unwrap: () => Promise.resolve({ audio: { url: `https://media/${annotationId}.m4a`, expires_at: '' } }), abort: vi.fn(),
    }))
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('1 paused: arm + seek, Play starts it before any tick, resumes once, no replay', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    expect(result.current.hint?.id).toBe('1')
    act(() => fire(video, 'play'))
    expect(ids()).toEqual(['1'])
    expect(video.pause).toHaveBeenCalled()
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce())
    engineResumeThenTick(video, 1.2)
    await act(async () => {})
    expect(ids()).toEqual(['1'])
  })

  it('2+3 playing: the seek\'s own timeupdate starts it and seeked does not cancel it (D12)', async () => {
    const { video, setSeeking } = seekableVideo(5, true)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1, 1.003)
    expect(ids()).toEqual(['1'])
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce())
  })

  it('3 D12 without arm: a note crossed by the seek\'s own timeupdate survives seeked', async () => {
    const { video, setSeeking } = seekableVideo(5, true)
    const { result } = mount(video, [voice('1', 1.9)])
    seek(video, setSeeking, 1.8, 1.95)
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce())
  })

  it('4 Play mid-seek waits for the first tick after the seek', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1)])
    act(() => { result.current.armNote(voice('1', 1)); video.currentTime = 1; setSeeking(true); fire(video, 'seeking'); fire(video, 'play') })
    expect(loadAudio).not.toHaveBeenCalled()
    act(() => { setSeeking(false); fire(video, 'timeupdate'); fire(video, 'seeked') })
    expect(ids()).toEqual(['1'])
    await waitFor(() => expect(result.current.state).toBe('playing'))
  })

  it('5 a scrub elsewhere drops the cue', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    seek(video, setSeeking, 3)
    act(() => { fire(video, 'play'); video.currentTime = 3.25; fire(video, 'timeupdate') })
    await act(async () => {})
    expect(loadAudio).not.toHaveBeenCalled()
  })

  it('6 an armed 0.000 note plays once; the engine resume at 0 does not replay it', async () => {
    const { video, setSeeking } = seekableVideo(4, false)
    const { result } = mount(video, [voice('7', 0)])
    act(() => result.current.armNote(voice('7', 0)))
    seek(video, setSeeking, 0)
    act(() => fire(video, 'play'))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce())
    engineResumeThenTick(video, 0.25)
    await act(async () => {})
    expect(ids()).toEqual(['7'])
  })

  it('7 paused, landing 0.03 s early: plays, and the engine resume does not replay it', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 2.05)])
    act(() => result.current.armNote(voice('1', 2.05)))
    seek(video, setSeeking, 2.05, 2.02)
    act(() => fire(video, 'play'))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce())
    engineResumeThenTick(video, 2.27)
    await act(async () => {})
    expect(ids()).toEqual(['1'])
  })

  it('8 arming during a loading note aborts it, does not resume, and holds the new cue', async () => {
    const pending = deferred<{ audio: { url: string; expires_at: string } }>()
    const abort = vi.fn()
    loadAudio.mockImplementationOnce(() => ({ unwrap: () => pending.promise, abort }))
    const { video, setSeeking } = seekableVideo(0.9, true)
    const { result } = mount(video, [voice('1', 1), voice('2', 3)])
    act(() => { fire(video, 'play'); video.currentTime = 1.1; fire(video, 'timeupdate') })
    expect(result.current.state).toBe('loading')
    act(() => result.current.armNote(voice('2', 3)))
    expect(abort).toHaveBeenCalledOnce()
    expect(video.play).not.toHaveBeenCalled()
    expect(result.current.hint?.id).toBe('2')
    pending.resolve({ audio: { url: 'https://media/1.m4a', expires_at: '' } })
    await act(async () => {})
    expect(video.play).not.toHaveBeenCalled()
    expect(ids()).toEqual(['1'])
    seek(video, setSeeking, 3)
    act(() => fire(video, 'play'))
    expect(ids()).toEqual(['1', '2'])
  })

  it('9 D4: arming the second of three same-time rows plays it and the third only', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const notes = [voice('1', 2), voice('2', 2), voice('3', 2)]
    const { result } = mount(video, notes)
    act(() => result.current.armNote(notes[1]))
    seek(video, setSeeking, 2)
    act(() => fire(video, 'play'))
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(2))
    expect(ids()).toEqual(['2', '3'])
  })

  it('10 a processing note, or audio off, never arms', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result, rerender } = mount(video, [voice('1', 1, 'processing')])
    act(() => result.current.armNote(voice('1', 1, 'processing')))
    seek(video, setSeeking, 1)
    rerender({ n: [voice('1', 1)], on: true })
    act(() => fire(video, 'play'))
    await act(async () => {})
    expect(loadAudio).not.toHaveBeenCalled()
  })

  it('11 turning audio off clears the cue', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result, rerender } = mount(video, [voice('1', 1)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    rerender({ n: [voice('1', 1)], on: false })
    rerender({ n: [voice('1', 1)], on: true })
    act(() => fire(video, 'play'))
    await act(async () => {})
    expect(loadAudio).not.toHaveBeenCalled()
  })

  it('11b removing the note, or replacing its asset, each clear the cue', async () => {
    for (const next of [[] as Annotation[], [{ ...voice('1', 1), voice: { ...voice('1', 1).voice!, asset_id: 99 } }]]) {
      loadAudio.mockClear()
      const { video, setSeeking } = seekableVideo(5, false)
      const { result, rerender, unmount } = mount(video, [voice('1', 1)])
      act(() => result.current.armNote(voice('1', 1)))
      seek(video, setSeeking, 1)
      rerender({ n: next, on: true })
      rerender({ n: [voice('1', 1)], on: true })
      act(() => fire(video, 'play'))
      await act(async () => {})
      expect(loadAudio).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('12 the hint shows the armed note while paused at it', () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1), voice('2', 3)])
    expect(result.current.hint).toBeNull()
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    expect(result.current.hint?.id).toBe('1')
    expect(result.current.state).toBe('hinting')
  })

  it('13 suppressResume clears the cue', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    act(() => result.current.suppressResume())
    act(() => fire(video, 'play'))
    await act(async () => {})
    expect(loadAudio).not.toHaveBeenCalled()
  })

  it('13b suppressResume takes the armed note\'s hint with it, and still hints a note ahead', () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1), voice('2', 3)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    expect(result.current.hint?.id).toBe('1')
    act(() => result.current.suppressResume())
    expect(result.current).toMatchObject({ state: 'hinting', hint: { id: '2' } })
  })

  it('11c a replaced asset drops the armed note\'s hint; a re-timed note drops the cue', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result, rerender } = mount(video, [voice('1', 1)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    expect(result.current.hint?.id).toBe('1')
    rerender({ n: [{ ...voice('1', 1), voice: { ...voice('1', 1).voice!, asset_id: 99 } }], on: true })
    expect(result.current).toMatchObject({ state: 'idle', hint: null })

    rerender({ n: [voice('2', 1)], on: true })
    act(() => result.current.armNote(voice('2', 1)))
    seek(video, setSeeking, 1)
    rerender({ n: [voice('2', 1.5)], on: true })
    act(() => fire(video, 'play'))
    await act(async () => {})
    expect(loadAudio).not.toHaveBeenCalled()
  })
})

describe('row ▶: playNote', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    loadAudio.mockReset()
    loadAudio.mockImplementation(({ annotationId }: { annotationId: string }) => ({
      unwrap: () => Promise.resolve({ audio: { url: `https://media/${annotationId}.m4a`, expires_at: '' } }), abort: vi.fn(),
    }))
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('1 while playing: pauses, plays, leaves the video paused at the same time; source is list', async () => {
    const { video } = seekableVideo(7, true)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.playNote(voice('1', 1)))
    expect(video.pause).toHaveBeenCalled()
    expect(result.current.source).toBe('list')
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(result.current.current).toBeNull())
    expect(result.current.source).toBeNull()
    expect(video.play).not.toHaveBeenCalled()
    expect(video.currentTime).toBe(7)
  })

  it('2 during a crossing\'s playing note: stops it without resuming, plays the new one', async () => {
    const { video } = seekableVideo(0.9, true)
    const { result } = mount(video, [voice('1', 1), voice('2', 3)])
    act(() => { fire(video, 'play'); video.currentTime = 1.1; fire(video, 'timeupdate') })
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => result.current.playNote(voice('2', 3)))
    await waitFor(() => expect(result.current.current?.id).toBe('2'))
    act(() => FakeAudio.instances[1].onended?.())
    await waitFor(() => expect(result.current.current).toBeNull())
    expect(video.play).not.toHaveBeenCalled()
  })

  it('3b during a crossing\'s loading note: aborts its request, does not resume, plays the new note', async () => {
    const pending = deferred<{ audio: { url: string; expires_at: string } }>()
    const abort = vi.fn()
    loadAudio.mockImplementationOnce(() => ({ unwrap: () => pending.promise, abort }))
    const { video } = seekableVideo(0.9, true)
    const { result } = mount(video, [voice('1', 1), voice('2', 3)])
    act(() => { fire(video, 'play'); video.currentTime = 1.1; fire(video, 'timeupdate') })
    expect(result.current.state).toBe('loading')
    act(() => result.current.playNote(voice('2', 3)))
    expect(abort).toHaveBeenCalledOnce()
    await waitFor(() => expect(result.current.current?.id).toBe('2'))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    expect(ids()).toEqual(['1', '2'])
    expect(video.play).not.toHaveBeenCalled()
  })

  it('4 Skip and Escape leave the video paused', async () => {
    const { video } = seekableVideo(7, true)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.playNote(voice('1', 1)))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => result.current.skip())
    expect(result.current.current).toBeNull()
    act(() => result.current.playNote(voice('1', 1)))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(video.play).not.toHaveBeenCalled()
  })

  it('11 Pause then Resume work for a ▶ note directly', async () => {
    const { video } = seekableVideo(7, true)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.playNote(voice('1', 1)))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => result.current.pauseCommentary())
    expect(result.current.state).toBe('paused')
    expect(FakeAudio.instances[0].pause).toHaveBeenCalled()
    await act(async () => result.current.resumeCommentary())
    expect(result.current.state).toBe('playing')
    expect(FakeAudio.instances[0].play).toHaveBeenCalledTimes(2)
    expect(video.play).not.toHaveBeenCalled()
  })

  it('6 ▶ on the active note is a no-op', async () => {
    const { video } = seekableVideo(7, false)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.playNote(voice('1', 1)))
    act(() => result.current.playNote(voice('1', 1)))
    expect(loadAudio).toHaveBeenCalledOnce()
  })

  it('7 ▶ on another note keeps the cue, and its hint comes back', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1), voice('2', 3)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    act(() => result.current.playNote(voice('2', 3)))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(result.current.hint?.id).toBe('1'))
    act(() => fire(video, 'play'))
    expect(ids()).toEqual(['2', '1'])
  })

  it('8 no-ops: audio off or not ready', () => {
    const { video } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1, 'processing')], false)
    expect(result.current.canPlayNotes).toBe(false)
    act(() => result.current.playNote(voice('1', 1)))
    expect(loadAudio).not.toHaveBeenCalled()
  })

  it('canPlayNotes is true only with audio on and a video, and the actions no-op without one', () => {
    const { video } = seekableVideo(5, false)
    expect(mount(video, [voice('1', 1)], true).result.current.canPlayNotes).toBe(true)
    expect(mount(video, [voice('1', 1)], false).result.current.canPlayNotes).toBe(false)
    const none = renderHook(() => useVoiceInterjections({ speechId: 1, videoEl: null, notes: [voice('1', 1)], audioEnabled: true, resetKey: 1 }))
    expect(none.result.current.canPlayNotes).toBe(false)
    act(() => { none.result.current.armNote(voice('1', 1)); none.result.current.playNote(voice('1', 1)) })
    expect(loadAudio).not.toHaveBeenCalled()
  })

  it('10 the watchdog shows the ▶ copy and leaves the video paused', async () => {
    vi.useFakeTimers()
    const pending = deferred<{ audio: { url: string; expires_at: string } }>()
    loadAudio.mockImplementationOnce(() => ({ unwrap: () => pending.promise }))
    const { video } = seekableVideo(5, true)
    const { result } = mount(video, [voice('1', 1)])
    act(() => result.current.playNote(voice('1', 1)))
    act(() => vi.advanceTimersByTime(15_001))
    expect(result.current.error).toBe('Could not play this voice commentary.')
    expect(video.play).not.toHaveBeenCalled()
  })
})

/** Adversarial probes: each asserts the behaviour the plan promises ("resumeFloor makes the looseness unable to cause a replay"). */
describe('PROBES: resumeFloor holes', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    loadAudio.mockReset()
    loadAudio.mockImplementation(({ annotationId }: { annotationId: string }) => ({
      unwrap: () => Promise.resolve({ audio: { url: `https://media/${annotationId}.m4a`, expires_at: '' } }), abort: vi.fn(),
    }))
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('P1 playing click, landing 0.03 s early: the same seek\'s seeked must not erase resumeFloor', async () => {
    const { video, setSeeking } = seekableVideo(5, true)
    const { result } = mount(video, [voice('1', 2.05)])
    act(() => result.current.armNote(voice('1', 2.05)))
    seek(video, setSeeking, 2.05, 2.02)
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce())
    engineResumeThenTick(video, 2.27)
    await act(async () => {})
    expect(ids()).toEqual(['1'])
  })

  it('P2 early landing + Pause/Resume commentary (no engine resume): the user\'s Play must not replay it', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 2.05)])
    act(() => result.current.armNote(voice('1', 2.05)))
    seek(video, setSeeking, 2.05, 2.02)
    act(() => fire(video, 'play'))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => result.current.pauseCommentary())
    await act(async () => result.current.resumeCommentary())
    act(() => FakeAudio.instances[0].onended?.())
    await waitFor(() => expect(result.current.current).toBeNull())
    expect(video.play).not.toHaveBeenCalled()
    act(() => { fire(video, 'play'); video.currentTime = 2.27; fire(video, 'timeupdate') })
    await act(async () => {})
    expect(ids()).toEqual(['1'])
  })

  it('P3 armed 0.000 note + video Play gesture during it (D8): the video plays on from 0 and never replays it', async () => {
    const { video, setSeeking } = seekableVideo(4, false)
    const { result } = mount(video, [voice('7', 0)])
    act(() => result.current.armNote(voice('7', 0)))
    seek(video, setSeeking, 0)
    act(() => fire(video, 'play'))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => fire(video, 'play'))
    expect(result.current.current).toBeNull()
    expect(video.paused).toBe(false)
    act(() => { video.currentTime = 0.25; fire(video, 'timeupdate') })
    await act(async () => {})
    expect(ids()).toEqual(['7'])
    expect(video.play).not.toHaveBeenCalled()
  })
})

describe('the video\'s Play cancels a note (2026-11-13 amendment)', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    loadAudio.mockReset()
    loadAudio.mockImplementation(({ annotationId }: { annotationId: string }) => ({
      unwrap: () => Promise.resolve({ audio: { url: `https://media/${annotationId}.m4a`, expires_at: '' } }), abort: vi.fn(),
    }))
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('a paused ▶ note: Play stops it and the video plays on from the slider; the note still plays at its own time', async () => {
    const { video } = seekableVideo(10, false)
    const { result } = mount(video, [voice('1', 30)])
    act(() => result.current.playNote(voice('1', 30)))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => result.current.pauseCommentary())
    expect(result.current.state).toBe('paused')
    const audio = FakeAudio.instances[0]
    act(() => fire(video, 'play'))
    expect(result.current).toMatchObject({ state: 'idle', current: null, source: null, error: null })
    expect(video.paused).toBe(false)
    expect(video.currentTime).toBe(10)
    expect(audio.removeAttribute).toHaveBeenCalledWith('src')
    expect(video.pause).toHaveBeenCalledOnce()
    act(() => { video.currentTime = 10.25; fire(video, 'timeupdate') })
    act(() => { video.currentTime = 29.9; fire(video, 'timeupdate') })
    await act(async () => {})
    expect(ids()).toEqual(['1'])
    act(() => { video.currentTime = 30.1; fire(video, 'timeupdate') })
    expect(ids()).toEqual(['1', '1'])
    expect(result.current.source).toBe('crossing')
  })

  it('a paused crossing note: Play stops it and drops its queue, and neither replays', async () => {
    const { video } = seekableVideo(0.9, true)
    const { result } = mount(video, [voice('1', 1), voice('2', 1.05)])
    act(() => { fire(video, 'play'); video.currentTime = 1.1; fire(video, 'timeupdate') })
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => result.current.pauseCommentary())
    act(() => fire(video, 'play'))
    expect(result.current.current).toBeNull()
    expect(video.paused).toBe(false)
    act(() => { video.currentTime = 1.35; fire(video, 'timeupdate') })
    await act(async () => {})
    expect(ids()).toEqual(['1'])
    expect(video.play).not.toHaveBeenCalled()
  })

  it('a loading note: Play aborts its request, and the late URL starts no audio', async () => {
    const pending = deferred<{ audio: { url: string; expires_at: string } }>()
    const abort = vi.fn()
    loadAudio.mockImplementationOnce(() => ({ unwrap: () => pending.promise, abort }))
    const { video } = seekableVideo(0.9, true)
    const { result } = mount(video, [voice('1', 1)])
    act(() => { fire(video, 'play'); video.currentTime = 1.1; fire(video, 'timeupdate') })
    expect(result.current.state).toBe('loading')
    act(() => fire(video, 'play'))
    expect(abort).toHaveBeenCalledOnce()
    expect(result.current.state).toBe('idle')
    expect(video.paused).toBe(false)
    await act(async () => { pending.resolve({ audio: { url: 'https://media/1.m4a', expires_at: '' } }) })
    expect(FakeAudio.instances).toHaveLength(0)
  })

  it('an armed note at the playhead does not start when Play cancels a ▶ note', async () => {
    const { video, setSeeking } = seekableVideo(5, false)
    const { result } = mount(video, [voice('1', 1), voice('2', 3)])
    act(() => result.current.armNote(voice('1', 1)))
    seek(video, setSeeking, 1)
    act(() => result.current.playNote(voice('2', 3)))
    await waitFor(() => expect(result.current.state).toBe('playing'))
    act(() => fire(video, 'play'))
    expect(result.current).toMatchObject({ state: 'idle', current: null, hint: null })
    act(() => { video.currentTime = 1.25; fire(video, 'timeupdate') })
    await act(async () => {})
    expect(ids()).toEqual(['2'])
    expect(video.paused).toBe(false)
  })
})
