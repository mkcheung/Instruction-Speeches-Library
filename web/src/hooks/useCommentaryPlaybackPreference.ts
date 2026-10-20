import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useDispatch } from 'react-redux'
import type { AppDispatch } from '@/app/store'
import { annotationApi } from '@/features/annotation/annotationApi'
import {
  playbackPreferenceCacheKey,
  playbackPreferences,
  SUPPRESSED_PLAYBACK_PREFERENCE,
} from '@/lib/commentaryPlaybackPreference'
import type { CommentaryPlaybackMode } from '@/features/annotation/types'

const noopSubscribe = () => () => {}
const suppressedSnapshot = () => SUPPRESSED_PLAYBACK_PREFERENCE
const noop = () => {}
const noopSelect: (mode: CommentaryPlaybackMode) => void = () => {}

export function useCommentaryPlaybackPreference(
  userId: string | undefined,
  speechId: number,
  enabled: boolean,
) {
  const dispatch = useDispatch<AppDispatch>()
  const coordinator = useMemo(() => {
    if (!enabled || !userId || !Number.isSafeInteger(speechId) || speechId <= 0) return null
    const args = { userId, speechId }
    return playbackPreferences.get(userId, speechId, () => {
      const requests = new Set<{ abort: () => void }>()
      return {
        async read() {
          const request = dispatch(annotationApi.endpoints.getCommentaryPlaybackPreference.initiate(
            args, { subscribe: false, forceRefetch: true },
          ))
          requests.add(request)
          try { return await request.unwrap() } finally { requests.delete(request) }
        },
        async write(mode) {
          const request = dispatch(annotationApi.endpoints.updateCommentaryPlaybackPreference.initiate({ ...args, mode }))
          requests.add(request)
          try { return await request.unwrap() } finally { requests.delete(request); request.reset() }
        },
        cancel() { requests.forEach((request) => request.abort()); requests.clear() },
        confirmed(preference) {
          // Only acknowledgements reach this callback. Cached data is never used
          // to bypass a successful current-session hydration.
          dispatch(annotationApi.util.upsertQueryEntries([{
            endpointName: 'getCommentaryPlaybackPreference', arg: args, value: preference,
          }]))
          try { localStorage.setItem(playbackPreferenceCacheKey(userId, speechId), JSON.stringify(preference)) } catch {
            // Persistence on the server still works without local storage.
          }
        },
      }
    })
  }, [dispatch, enabled, speechId, userId])

  const state = useSyncExternalStore(
    coordinator?.subscribe ?? noopSubscribe,
    coordinator?.getSnapshot ?? suppressedSnapshot,
    suppressedSnapshot,
  )

  useEffect(() => {
    if (!coordinator) return
    void coordinator.hydrate()
    const onFocus = () => { void coordinator.hydrate() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [coordinator])

  return {
    ...state,
    select: coordinator?.select ?? noopSelect,
    retry: coordinator?.retry ?? noop,
  }
}
