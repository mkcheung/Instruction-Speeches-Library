import { describe, expect, it } from 'vitest'
import type { Annotation, CommentaryPlaybackMode } from '@/features/annotation/types'
import { isCommentaryPlaybackMode, projectCommentary } from './commentaryPlayback'

const written: Annotation = {
  id: 'written', body: 'Written feedback', start_seconds: 2, duration_seconds: 5,
  kind: 'observation', topic: null, lock_version: 0, client_uuid: 'written', voice: null,
}
const voice: Annotation = {
  ...written, id: 'voice', body: '', client_uuid: 'voice',
  voice: { asset_id: 2, audio_status: 'ready', transcript_status: 'pending', failure_code: null },
}
const ids = (rows: readonly Annotation[]) => rows.map((row) => row.id)

describe('commentary playback projection', () => {
  it.each<{
    mode: CommentaryPlaybackMode; timed: string[]; readable: string[]; markers: string[]; audio: boolean; transcript: boolean
  }>([
    { mode: 'all', timed: ['written'], readable: ['written', 'voice'], markers: ['voice'], audio: true, transcript: true },
    { mode: 'written', timed: ['written'], readable: ['written'], markers: [], audio: false, transcript: false },
    { mode: 'voice', timed: [], readable: ['voice'], markers: ['voice'], audio: true, transcript: false },
    { mode: 'off', timed: [], readable: [], markers: [], audio: false, transcript: false },
  ])('$mode keeps display, navigation and audio independent', ({ mode, timed, readable, markers, audio, transcript }) => {
    const source = Object.freeze([written, voice])
    const result = projectCommentary(source, mode)
    expect(ids(result.timedWritten)).toEqual(timed)
    expect(ids(result.readable)).toEqual(readable)
    expect(ids(result.navigation)).toEqual(readable)
    expect(ids(result.markers)).toEqual(markers)
    expect(result.playAudio).toBe(audio)
    expect(result.showVoiceTranscript).toBe(transcript)
    expect(source).toHaveLength(2)
  })

  it('keeps erased point text readable and seekable without a fabricated duration cue', () => {
    const preserved: Annotation = { ...voice, timing_type: 'point', id: 'preserved', body: 'Former reviewer feedback', voice: null }
    expect(ids(projectCommentary([preserved], 'written').readable)).toEqual(['preserved'])
    expect(projectCommentary([preserved], 'voice').readable).toEqual([])
    for (const mode of ['all', 'written'] as const) {
      const projection = projectCommentary([preserved], mode)
      expect(ids(projection.navigation)).toEqual(['preserved'])
      expect(projection.timedWritten).toEqual([])
      expect(projection.voices).toEqual([])
      expect(projection.markers).toEqual([])
    }
  })

  it('does not accept legacy or malformed modes as canonical settings', () => {
    for (const value of ['play', 'text', 'none', null, undefined, {}, 'ALL']) {
      expect(isCommentaryPlaybackMode(value)).toBe(false)
    }
    for (const value of ['all', 'written', 'voice', 'off']) {
      expect(isCommentaryPlaybackMode(value)).toBe(true)
    }
  })
})
