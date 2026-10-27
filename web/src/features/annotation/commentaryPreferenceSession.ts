import type { Middleware } from '@reduxjs/toolkit'
import { authApi } from '@/features/auth/authApi'
import { isTerminalStatus, type AuthSessionState } from '@/features/auth/authSession'
import { annotationApi } from '@/features/annotation/annotationApi'
import { playbackPreferences } from '@/lib/commentaryPlaybackPreference'
import { getErrorStatus } from '@/lib/errorStatus'

/**
 * Observe identity even when the watch route is unmounted. Cancel queued work
 * before auth's new identity can render, and clear authorized annotation caches.
 *
 * Deliberately conservative and independent of the identity proof: any
 * auth response that names a different user, or ends the session, cancels
 * queued preference work (a stale probe may do so too; cancelling early is
 * safe, resuming late is not). In addition, when the document identity
 * slice is present, its terminal states (lost, replaced, navigating) end
 * the preference identity, so a hard navigation can never leave an old
 * account's queued write alive. Transient quarantine does not.
 */
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
    const result = nextIdentity === undefined ? next(action) : (apply(nextIdentity), next(action))
    const auth = (store.getState() as { authSession?: AuthSessionState }).authSession
    if (auth && isTerminalStatus(auth.status)) apply(null)
    return result
  }

  function apply(nextIdentity: string | null) {
    playbackPreferences.setIdentity(nextIdentity)
    if (identity !== nextIdentity) {
      identity = nextIdentity
      store.dispatch(annotationApi.util.resetApiState())
    }
  }
}
