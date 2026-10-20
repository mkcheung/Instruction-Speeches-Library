import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useLazyGetVoiceAudioUrlQuery } from '@/features/annotation/annotationApi'
import type { Annotation } from '@/features/annotation/types'
import { IDLE_VOICE_PLAYBACK, VoiceInterjectionController } from '@/lib/voiceInterjectionController'

const idleSnapshot = () => IDLE_VOICE_PLAYBACK
const noopSubscribe = () => () => {}
const noop = () => {}
const noopAsync = async () => {}

export function useVoiceInterjections({ speechId, videoEl, notes, audioEnabled, resetKey }: {
  speechId: number
  videoEl: HTMLVideoElement | null
  notes: readonly Annotation[]
  audioEnabled: boolean
  resetKey: string | number
}) {
  const [loadAudioUrl] = useLazyGetVoiceAudioUrlQuery()
  const controller = useMemo(
    () => videoEl ? new VoiceInterjectionController(videoEl,
      (annotationId) => loadAudioUrl({ speechId, annotationId }, false)) : null,
    // A reviewer/account/speech change owns a new lifecycle. Switching between
    // Text + audio and Audio only preserves this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadAudioUrl, speechId, videoEl, resetKey],
  )
  const snapshot = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? idleSnapshot, idleSnapshot)
  useEffect(() => controller?.connect(), [controller])
  useEffect(() => controller?.update(notes, audioEnabled), [audioEnabled, controller, notes])
  // Suppress stale text before the reconciliation effect runs.
  const current = audioEnabled && snapshot.current
    ? notes.find((note) => note.id === snapshot.current!.id
      && note.voice?.asset_id === snapshot.current!.voice?.asset_id && note.voice?.audio_status === 'ready') ?? null
    : null
  return {
    ...snapshot,
    current,
    hint: audioEnabled ? snapshot.hint : null,
    skip: controller?.skip ?? noop,
    pauseCommentary: controller?.pauseCommentary ?? noop,
    resumeCommentary: controller?.resumeCommentary ?? noopAsync,
  }
}
