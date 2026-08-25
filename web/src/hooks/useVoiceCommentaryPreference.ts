import { useCallback, useRef, useState } from 'react'
import {
  useGetVoiceCommentaryPreferenceQuery,
  useUpdateVoiceCommentaryPreferenceMutation,
} from '@/features/annotation/annotationApi'
import type { VoiceCommentaryMode } from '@/features/annotation/types'

interface StoredVoicePreference {
  mode: VoiceCommentaryMode
  experienced: boolean
}

function keyFor(userId: string | undefined, speechId: number): string | null {
  return userId ? `voice-commentary:${userId}:${speechId}` : null
}

function read(key: string | null): StoredVoicePreference {
  if (!key) return { mode: 'play', experienced: false }
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<StoredVoicePreference> | null
    if (value && (value.mode === 'play' || value.mode === 'text' || value.mode === 'none')) {
      return { mode: value.mode, experienced: value.experienced === true }
    }
  } catch {
    // Invalid/unavailable local storage falls back to the first-view mode.
  }
  return { mode: 'play', experienced: false }
}

export function useVoiceCommentaryPreference(userId: string | undefined, speechId: number) {
  const key = keyFor(userId, speechId)
  const [preference, setPreference] = useState(() => read(key))
  const [explicitMode, setExplicitMode] = useState<VoiceCommentaryMode | null>(null)
  const explicitSelectionKeyRef = useRef<string | null>(null)
  const [experiencedLocally, setExperiencedLocally] = useState(false)
  const [lastKey, setLastKey] = useState(key)
  const [updateRemote] = useUpdateVoiceCommentaryPreferenceMutation()
  const { data: serverPreference } = useGetVoiceCommentaryPreferenceQuery(
    { speechId },
    { skip: !userId },
  )

  if (key !== lastKey) {
    setLastKey(key)
    setPreference(read(key))
    setExplicitMode(null)
    setExperiencedLocally(false)
  }

  const persist = useCallback(
    (next: StoredVoicePreference) => {
      try {
        if (key) localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // The server remains authoritative when storage is unavailable.
      }
      void updateRemote({ speechId, ...next })
    },
    [key, speechId, updateRemote],
  )

  // RTK Query may retain the previous argument's last successful `data`
  // while a new speech is loading. Never let speech A's mode leak into
  // speech B during that handoff.
  const currentServerPreference =
    serverPreference?.voice_commentary.speech_id === speechId
      ? serverPreference.voice_commentary
      : null
  const effective = currentServerPreference ?? preference

  const select = useCallback(
    (mode: VoiceCommentaryMode) => {
      const next = { mode, experienced: true }
      explicitSelectionKeyRef.current = key
      setPreference(next)
      setExplicitMode(mode)
      persist(next)
    },
    [key, persist],
  )

  /** First interruption defaults to Play for this session, but makes the
   * next visit Text only unless the user already made an explicit choice. */
  const markExperienced = useCallback(() => {
    if (explicitSelectionKeyRef.current === key || effective.experienced || experiencedLocally) return
    setExperiencedLocally(true)
    persist({ mode: 'text', experienced: true })
  }, [effective.experienced, experiencedLocally, key, persist])

  // Automatic first-experience persistence is for the next visit. Keep
  // this mounted viewing session in Play even after the server refetches
  // the newly stored Text preference, so a second note already queued in
  // the same crossing is not cut off. An explicit user choice still wins
  // immediately.
  return { mode: explicitMode ?? (experiencedLocally ? 'play' : effective.mode), select, markExperienced }
}
