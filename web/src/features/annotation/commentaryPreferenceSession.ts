import type { Middleware } from '@reduxjs/toolkit'
import { authApi } from '@/features/auth/authApi'
import { annotationApi } from '@/features/annotation/annotationApi'
import { playbackPreferences } from '@/lib/commentaryPlaybackPreference'
import { getErrorStatus } from '@/lib/errorStatus'

/** Observe identity even when the watch route is unmounted. Cancel queued work
 * before auth's new identity can render, and clear authorized annotation caches. */
export const commentaryPreferenceSession: Middleware = (store) => {
  let identity: string | null = null
  return (next) => (action) => {
    let nextIdentity: string | null | undefined
    if (authApi.endpoints.getMe.matchFulfilled(action) || authApi.endpoints.login.matchFulfilled(action)) {
      nextIdentity = String(action.payload.user.id)
    } else if (authApi.endpoints.logout.matchFulfilled(action) || authApi.util.resetApiState.match(action)
      || (authApi.endpoints.getMe.matchRejected(action) && getErrorStatus(action.payload) === 401)) {
      nextIdentity = null
    }
    if (nextIdentity !== undefined) {
      playbackPreferences.setIdentity(nextIdentity)
      if (identity !== nextIdentity) {
        identity = nextIdentity
        store.dispatch(annotationApi.util.resetApiState())
      }
    }
    return next(action)
  }
}
