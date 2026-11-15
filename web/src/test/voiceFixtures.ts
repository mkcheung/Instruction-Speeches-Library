import type { Annotation, AnnotationVoice } from '@/features/annotation/types'

export type VoiceNoteOverrides = Partial<Omit<Annotation, 'voice'>> & { voice?: Partial<AnnotationVoice> | null }

/** A ready voice note shaped like the API payload (AnnotationResource). asset_id defaults to Number(id). */
export function voiceNote(id: string, start: number, { voice, ...rest }: VoiceNoteOverrides = {}): Annotation {
  const assetId = voice?.asset_id ?? Number(id)
  // NaN never equals itself, so the engine's identity check would treat the note as replaced.
  if (voice !== null && !Number.isFinite(assetId)) throw new Error(`voiceNote('${id}'): pass voice.asset_id for a non-numeric id`)
  return {
    id, timing_type: 'point', start_seconds: start, duration_seconds: 2, kind: 'observation', topic: null,
    body: `voice ${id}`, lock_version: 0, client_uuid: `uuid-${id}`, ...rest,
    voice: voice === null ? null
      : { audio_status: 'ready', transcript_status: 'ready', failure_code: null, ...voice, asset_id: assetId },
  }
}
