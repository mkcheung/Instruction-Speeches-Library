import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation, CommentaryPlaybackMode } from '@/features/annotation/types'
import type { RosterReview } from '@/features/review/types'

const mocks = vi.hoisted(() => ({ roster: vi.fn(), annotations: vi.fn(), preference: vi.fn(), playback: vi.fn(), subtitles: vi.fn(), timed: vi.fn() }))
vi.mock('@/features/review/reviewApi', () => ({ useListReviewRosterQuery: mocks.roster }))
vi.mock('@/features/annotation/annotationApi', () => ({ useGetAnnotationsQuery: mocks.annotations, usePrefetchAnnotations: () => vi.fn() }))
vi.mock('@/hooks/useCommentaryPlaybackPreference', () => ({ useCommentaryPlaybackPreference: mocks.preference }))
vi.mock('@/hooks/useVoiceInterjections', () => ({ useVoiceInterjections: mocks.playback }))
vi.mock('@/hooks/useIosFullscreenSubtitles', () => ({ useIosFullscreenSubtitles: mocks.subtitles }))
vi.mock('@/hooks/useTimedAnnotations', () => ({ useTimedAnnotations: mocks.timed }))
vi.mock('@/hooks/useVideoCurrentTime', () => ({ useVideoCurrentTime: () => 3 }))

import { useCommentaryTrack } from './useCommentaryTrack'

const written: Annotation = { id: 'w', start_seconds: 1, duration_seconds: 5, body: 'Written', kind: 'praise', topic: null, lock_version: 0, client_uuid: 'w', voice: null }
const voice: Annotation = { ...written, id: 'v', body: 'Spoken', voice: { asset_id: 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null } }
const review = { id: 7, status: 'published', revoked_at: null, first_published_at: '2026-10-01', last_published_at: '2026-10-02',
  published_annotations_count: 2, annotations_count: 99, reviewer: { id: 1, name: 'Cora' } } as RosterReview
let source: Annotation[]
let roster: RosterReview[]
let mode: CommentaryPlaybackMode
let ready: boolean
let error: unknown
let isFetching: boolean
let playback: { state: string; current: Annotation | null; hint: Annotation | null }

function mount(visible = true) {
  const hook = renderHook(({ notesVisible }) => useCommentaryTrack(8, null, true, 'owner', notesVisible), { initialProps: { notesVisible: visible } })
  act(() => vi.advanceTimersByTime(651))
  return hook
}

describe('owner commentary projections and presentation', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    source = [written, voice]; roster = [review]; mode = 'all'; ready = true; error = undefined; isFetching = false
    playback = { state: 'idle', current: null, hint: null }
    mocks.roster.mockImplementation(() => ({ currentData: roster, isLoading: false }))
    mocks.annotations.mockImplementation(() => ({ currentData: { review_id: 7, annotations: source, reviewer: review.reviewer }, error, isFetching, refetch: vi.fn() }))
    mocks.preference.mockImplementation(() => ({ mode, ready, select: vi.fn(), accessDenied: false }))
    mocks.playback.mockImplementation(() => playback)
    mocks.timed.mockImplementation((_video, notes: Annotation[]) => new Set(notes.map((note) => note.id)))
  })

  it.each([
    ['all', ['w', 'v'], ['w'], ['v'], ['w', 'v'], true],
    ['written', ['w'], ['w'], [], ['w'], false],
    ['voice', ['v'], [], ['v'], ['v'], true],
    ['off', [], [], [], [], false],
  ] as const)('projects %s independently for reading, overlays, markers, navigation and audio', (nextMode, readable, overlays, markers, navigation, audio) => {
    mode = nextMode
    const { result } = mount(false)
    const ids = (notes: readonly Annotation[]) => notes.map((note) => note.id)
    expect(ids(result.current.annotations)).toEqual(readable)
    expect(ids(result.current.overlayAnnotations)).toEqual(overlays)
    expect(ids(result.current.markerAnnotations)).toEqual(markers)
    expect(ids(result.current.navigationAnnotations)).toEqual(navigation)
    expect(ids(result.current.allAnnotations)).toEqual(['w', 'v'])
    expect(mocks.playback.mock.lastCall?.[0].audioEnabled).toBe(audio)
    expect(mocks.subtitles.mock.lastCall?.[1].map((note: Annotation) => note.id)).toEqual(overlays)
    expect(result.current.options[0].noteCount).toBe(2)
    vi.useRealTimers()
  })

  it('shows voice overlays only after audio starts and hides them immediately in Audio only', () => {
    playback = { state: 'loading', current: voice, hint: null }
    const { result, rerender } = mount(false)
    expect(result.current.overlayVoiceId).toBeUndefined()
    playback.state = 'playing'; rerender({ notesVisible: false })
    expect(result.current.overlayVoiceId).toBe('v')
    playback.state = 'paused'; rerender({ notesVisible: false })
    expect(result.current.overlayVoiceId).toBe('v')
    mode = 'voice'; rerender({ notesVisible: false })
    expect(result.current.overlayVoiceId).toBeUndefined()
    expect(result.current.overlayAnnotations).toEqual([])
    expect(result.current.activeIds.has('v')).toBe(true)
    vi.useRealTimers()
  })

  it('suppresses all feedback before preference hydration without losing reviewer selection', () => {
    ready = false
    const { result } = mount()
    expect(result.current.selected).toBe(7)
    expect(result.current.allAnnotations).toEqual([])
    expect(mocks.playback.mock.lastCall?.[0].audioEnabled).toBe(false)
    expect(localStorage.getItem('commentary-seen:8:7')).toBeNull()
    vi.useRealTimers()
  })

  it('does not mark hidden, Off, loading, or filtered-empty notes seen', () => {
    const { rerender } = mount(false)
    expect(localStorage.getItem('commentary-seen:8:7')).toBeNull()
    mode = 'off'; rerender({ notesVisible: true })
    expect(localStorage.getItem('commentary-seen:8:7')).toBeNull()
    mode = 'written'; source = [voice]; rerender({ notesVisible: true })
    expect(localStorage.getItem('commentary-seen:8:7')).toBeNull()
    mode = 'voice'; playback.hint = voice; rerender({ notesVisible: true })
    expect(localStorage.getItem('commentary-seen:8:7')).toBeNull()
    playback.current = voice; playback.state = 'loading'; rerender({ notesVisible: true })
    expect(localStorage.getItem('commentary-seen:8:7')).toBeNull()
    playback.state = 'playing'; rerender({ notesVisible: true })
    expect(localStorage.getItem('commentary-seen:8:7')).toBe(review.last_published_at)
    vi.useRealTimers()
  })

  it('marks eligible written notes when the real Notes tab becomes visible and deliberate reading in Off', () => {
    mode = 'written'
    const { result, rerender } = mount(false)
    expect(localStorage.getItem('commentary-seen:8:7')).toBeNull()
    rerender({ notesVisible: true })
    expect(localStorage.getItem('commentary-seen:8:7')).toBe(review.last_published_at)
    localStorage.removeItem('commentary-seen:8:7')
    mode = 'off'; rerender({ notesVisible: true })
    act(() => result.current.markRead())
    expect(localStorage.getItem('commentary-seen:8:7')).toBe(review.last_published_at)
    vi.useRealTimers()
  })

  it('retains canonical audio on a transient poll failure and suppresses it on access denial or revocation', () => {
    const { result, rerender } = mount(false)
    error = { status: 500 }; rerender({ notesVisible: false })
    expect(result.current.error).toEqual(error)
    expect(result.current.allAnnotations).toHaveLength(2)
    expect(mocks.playback.mock.lastCall?.[0].audioEnabled).toBe(true)
    error = { status: 403 }; rerender({ notesVisible: false })
    expect(result.current.allAnnotations).toEqual([])
    expect(mocks.playback.mock.lastCall?.[0].audioEnabled).toBe(false)
    error = undefined; roster = []; rerender({ notesVisible: false })
    expect(result.current.selected).toBe('none')
    expect(result.current.options).toEqual([])
    expect(result.current.allAnnotations).toEqual([])
    vi.useRealTimers()
  })

  it('does not mark seen while fetching or crossfading', () => {
    isFetching = true
    const { result, rerender } = mount()
    act(() => result.current.markRead())
    expect(localStorage.getItem('commentary-seen:8:7')).toBeNull()
    isFetching = false; rerender({ notesVisible: true })
    expect(localStorage.getItem('commentary-seen:8:7')).toBe(review.last_published_at)
    vi.useRealTimers()
  })
})
