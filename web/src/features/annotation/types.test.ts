import { describe, expect, it } from 'vitest'
import { isPlayableVoiceNote, isSamePlayableVoiceNote, type Annotation, type AnnotationVoice } from '@/features/annotation/types'
import { voiceNote } from '@/test/voiceFixtures'

function note(audio: AnnotationVoice['audio_status'] | null, id = '1', assetId = 11): Annotation {
  return voiceNote(id, 1, { voice: audio === null ? null : { audio_status: audio, asset_id: assetId } })
}

describe('isPlayableVoiceNote', () => {
  it.each([
    ['no voice', null, false],
    ['processing', 'processing', false],
    ['failed', 'failed', false],
    ['ready', 'ready', true],
  ] as const)('%s', (_name, audio, expected) => {
    expect(isPlayableVoiceNote(note(audio))).toBe(expected)
  })
})

describe('isSamePlayableVoiceNote', () => {
  it('rejects the same id with a different asset', () => {
    expect(isSamePlayableVoiceNote(note('ready', '1', 11), '1', 12)).toBe(false)
  })

  it('rejects an undefined asset id against a voice note', () => {
    expect(isSamePlayableVoiceNote(note('ready', '1', 11), '1', undefined)).toBe(false)
  })

  it('rejects the same id and asset while processing', () => {
    expect(isSamePlayableVoiceNote(note('processing', '1', 11), '1', 11)).toBe(false)
  })

  it('accepts the same id and asset when ready', () => {
    expect(isSamePlayableVoiceNote(note('ready', '1', 11), '1', 11)).toBe(true)
  })
})
