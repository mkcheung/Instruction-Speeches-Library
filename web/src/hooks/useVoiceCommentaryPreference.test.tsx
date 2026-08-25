import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateRemote = vi.hoisted(() => vi.fn())
const server = vi.hoisted(() => ({
  data: { voice_commentary: { speech_id: 7, mode: 'none' as 'play' | 'text' | 'none', experienced: true } },
}))
vi.mock('@/features/annotation/annotationApi', () => ({
  useGetVoiceCommentaryPreferenceQuery: () => server,
  useUpdateVoiceCommentaryPreferenceMutation: () => [updateRemote],
}))

import { useVoiceCommentaryPreference } from '@/hooks/useVoiceCommentaryPreference'

describe('useVoiceCommentaryPreference', () => {
  beforeEach(() => {
    localStorage.clear()
    updateRemote.mockReset()
  })

  it('uses the server-loaded mode and updates immediately after an explicit choice', () => {
    server.data.voice_commentary = { speech_id: 7, mode: 'none', experienced: true }
    const { result } = renderHook(() => useVoiceCommentaryPreference('user-1', 7))
    expect(result.current.mode).toBe('none')
    act(() => result.current.select('play'))
    expect(result.current.mode).toBe('play')
    expect(updateRemote).toHaveBeenCalledWith({ speechId: 7, mode: 'play', experienced: true })
  })

  it('stores Text for the next visit without cutting the current Play session short', () => {
    server.data.voice_commentary = { speech_id: 7, mode: 'play', experienced: false }
    const firstVisit = renderHook(() => useVoiceCommentaryPreference('user-1', 7))

    act(() => firstVisit.result.current.markExperienced())
    expect(updateRemote).toHaveBeenCalledWith({ speechId: 7, mode: 'text', experienced: true })

    server.data.voice_commentary = { speech_id: 7, mode: 'text', experienced: true }
    firstVisit.rerender()
    expect(firstVisit.result.current.mode).toBe('play')

    firstVisit.unmount()
    const nextVisit = renderHook(() => useVoiceCommentaryPreference('user-1', 7))
    expect(nextVisit.result.current.mode).toBe('text')
  })

  it('never overwrites an explicit Play choice with the automatic next-visit Text default', () => {
    server.data.voice_commentary = { speech_id: 7, mode: 'play', experienced: false }
    const { result } = renderHook(() => useVoiceCommentaryPreference('user-1', 7))

    act(() => {
      result.current.select('play')
      result.current.markExperienced()
    })

    expect(updateRemote).toHaveBeenCalledTimes(1)
    expect(updateRemote).toHaveBeenCalledWith({ speechId: 7, mode: 'play', experienced: true })
  })

  it('does not leak a retained server result from the previous speech', () => {
    server.data.voice_commentary = { speech_id: 7, mode: 'none', experienced: true }
    const { result, rerender } = renderHook(
      ({ speechId }) => useVoiceCommentaryPreference('user-1', speechId),
      { initialProps: { speechId: 7 } },
    )
    expect(result.current.mode).toBe('none')

    rerender({ speechId: 8 })
    expect(result.current.mode).toBe('play')
  })
})
