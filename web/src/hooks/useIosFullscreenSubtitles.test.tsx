import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Annotation } from '@/features/annotation/types'
import { useIosFullscreenSubtitles } from './useIosFullscreenSubtitles'

it('clears and restores only the Commentary native track as modes change, and clears it on unmount', () => {
  const video = document.createElement('video')
  const captionTrack = { mode: 'showing' }
  const cues: TextTrackCue[] = []
  const commentaryTrack = {
    mode: 'hidden', cues,
    addCue: (cue: TextTrackCue) => cues.push(cue),
    removeCue: (cue: TextTrackCue) => cues.splice(cues.indexOf(cue), 1),
  }
  video.addTextTrack = vi.fn(() => commentaryTrack as unknown as TextTrack)
  const written: Annotation = { id: 'w', start_seconds: 0, duration_seconds: 3, body: 'Written feedback',
    kind: 'praise', topic: null, lock_version: 0, client_uuid: 'w', voice: null }
  const { rerender, unmount } = renderHook(({ notes }) => useIosFullscreenSubtitles(video, notes), { initialProps: { notes: [written] } })
  act(() => video.dispatchEvent(new Event('webkitbeginfullscreen')))
  expect(commentaryTrack.mode).toBe('showing')
  expect(cues).toHaveLength(1)
  rerender({ notes: [] })
  expect(cues).toHaveLength(0)
  expect(commentaryTrack.mode).toBe('disabled')
  expect(captionTrack.mode).toBe('showing')
  rerender({ notes: [written] })
  expect(cues).toHaveLength(1)
  expect(commentaryTrack.mode).toBe('showing')
  unmount()
  expect(cues).toHaveLength(0)
  expect(commentaryTrack.mode).toBe('disabled')
  expect(captionTrack.mode).toBe('showing')
})
