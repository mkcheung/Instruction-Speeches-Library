import { createAction, createSlice, type Middleware, type PayloadAction } from '@reduxjs/toolkit'
import { useSelector } from 'react-redux'
import { useEffect, useEffectEvent } from 'react'
import { authApi } from '@/features/auth/authApi'
import type { CurrentUser } from '@/features/auth/types'
import { connectionApi } from './connectionApi'
import { getErrorStatus } from '@/lib/errorStatus'

export interface ConnectionViewer { id: string; username: string }
export interface ConnectionSessionState {
  generation: number
  status: 'unresolved' | 'loading' | 'ready' | 'anonymous' | 'error'
  viewer: ConnectionViewer | null
  requestId: string | null
  error: unknown
}
const initialState: ConnectionSessionState = {
  generation: 0, status: 'unresolved', viewer: null, requestId: null, error: null,
}
const session = createSlice({
  name: 'connectionSession', initialState,
  reducers: {
    advance(state, action: PayloadAction<'unresolved' | 'anonymous'>) {
      state.generation += 1
      state.status = action.payload
      state.viewer = null
      state.requestId = null
      state.error = null
    },
    loading(state, action: PayloadAction<string>) {
      state.status = 'loading'
      state.requestId = action.payload
      state.error = null
    },
    resolved(state, action: PayloadAction<ConnectionViewer | null>) {
      state.status = 'ready'
      state.viewer = action.payload
      state.error = null
    },
    failed(state, action: PayloadAction<unknown>) {
      state.status = 'error'
      state.viewer = null
      state.error = action.payload
    },
  },
})
export const connectionSessionReducer = session.reducer
/** Quarantine private data immediately and obtain a fresh authoritative identity. */
export const revalidateConnectionSession = createAction('connectionSession/revalidate')

type SessionRoot = { connectionSession: ConnectionSessionState }
export const selectConnectionSession = (state: SessionRoot) => state.connectionSession
export const selectEligibleConnectionViewer = (state: SessionRoot) =>
  state.connectionSession.status === 'ready' ? state.connectionSession.viewer : null
export const useConnectionSession = () => useSelector(selectConnectionSession)
export const useEligibleConnectionViewer = () => useSelector(selectEligibleConnectionViewer)

function eligible(user: CurrentUser): ConnectionViewer | null {
  if (!user?.id || !user.username?.trim() || !Array.isArray(user.roles)
    || user.roles.some((role) => role === 'admin' || role === 'super_admin')) return null
  return { id: String(user.id), username: user.username.trim() }
}

/** Request IDs belong to a session generation. Auth caches alone are never an
 * authority: old getMe fulfillments can arrive after logout and a new login. */
export const connectionSessionMiddleware: Middleware = (store) => {
  const requests = new Map<string, number>()
  const connectionRequests = new Map<string, number>()
  let logoutRequest: { id: string; generation: number } | null = null
  let loginRequest: string | null = null
  let loginGeneration: number | null = null
  let identity: string | null = null
  const current = () => selectConnectionSession(store.getState() as SessionRoot)
  const clear = (status: 'unresolved' | 'anonymous') => {
    identity = null
    store.dispatch(session.actions.advance(status))
    store.dispatch(connectionApi.util.resetApiState())
  }
  const resolveMe = () => {
    // RTK deduplicates an already pending request. Its obsolete completion will
    // re-enter this path once that request has finished, without a reset loop.
    store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false, forceRefetch: true }) as never)
  }
  return (next) => (action) => {
    if (revalidateConnectionSession.match(action)) {
      clear('unresolved')
      const result = next(action)
      resolveMe()
      return result
    }
    if (typeof action === 'object' && action !== null && 'type' in action
      && typeof action.type === 'string' && action.type.startsWith(`${connectionApi.reducerPath}/execute`)
      && 'meta' in action) {
      const meta = action.meta as { requestId: string }
      if (action.type.endsWith('/pending')) connectionRequests.set(meta.requestId, current().generation)
      else if (action.type.endsWith('/fulfilled') || action.type.endsWith('/rejected')) {
        const generation = connectionRequests.get(meta.requestId)
        connectionRequests.delete(meta.requestId)
        if (generation === current().generation && action.type.endsWith('/rejected')
          && 'payload' in action && getErrorStatus(action.payload) === 401) clear('anonymous')
      }
    }
    if (authApi.endpoints.login.matchPending(action)) {
      clear('unresolved')
      loginRequest = action.meta.requestId
      loginGeneration = current().generation
    }
    if (authApi.endpoints.logout.matchPending(action)) logoutRequest = { id: action.meta.requestId, generation: current().generation }
    if (authApi.util.resetApiState.match(action) || (authApi.endpoints.logout.matchFulfilled(action)
      && logoutRequest?.id === action.meta.requestId && logoutRequest.generation === current().generation)) clear('anonymous')
    if (authApi.endpoints.getMe.matchPending(action)) {
      requests.set(action.meta.requestId, current().generation)
      store.dispatch(session.actions.loading(action.meta.requestId))
    }
    const isMeSuccess = authApi.endpoints.getMe.matchFulfilled(action)
    const isMeFailure = authApi.endpoints.getMe.matchRejected(action)
    if (isMeSuccess || isMeFailure) {
      // Condition rejections are deduplicated calls, not actual auth failures.
      if (isMeFailure && action.meta.condition) return next(action)
      const generation = requests.get(action.meta.requestId)
      requests.delete(action.meta.requestId)
      const accepted = generation === current().generation && action.meta.requestId === current().requestId
      if (!accepted) {
        const result = next(action)
        // A stale action may overwrite RTK's getMe cache, but never our viewer.
        // Hide it until a new authoritative response resolves the session.
        if (current().status !== 'anonymous') {
          store.dispatch(session.actions.loading('revalidating'))
          resolveMe()
        }
        return result
      }
      if (loginRequest !== null && loginGeneration === current().generation) {
        // A probe made during the login POST can still see the previous cookie.
        // The completed login will start a new authoritative probe.
        const result = next(action)
        store.dispatch(session.actions.loading('awaiting-login'))
        return result
      }
      if (isMeSuccess) {
        const viewer = eligible(action.payload.user)
        if (identity !== String(action.payload.user.id)) {
          if (identity !== null) store.dispatch(session.actions.advance('unresolved'))
          store.dispatch(connectionApi.util.resetApiState())
        }
        identity = String(action.payload.user.id)
        const result = next(action)
        store.dispatch(session.actions.resolved(viewer))
        return result
      }
      if (getErrorStatus(action.payload) === 401) clear('anonymous')
      else store.dispatch(session.actions.failed(action.payload ?? action.error))
    }
    if (authApi.endpoints.login.matchFulfilled(action) || authApi.endpoints.login.matchRejected(action)) {
      const accepted = loginRequest === action.meta.requestId && loginGeneration === current().generation
      if (accepted) loginRequest = null
      const result = next(action)
      if (accepted) resolveMe()
      return result
    }
    return next(action)
  }
}

/** Scoped listeners only exist while the caller is mounted and eligible. */
export function useConnectionRefresh(refetch: () => unknown, enabled: boolean) {
  const refresh = useEffectEvent(() => { if (document.visibilityState === 'visible') refetch() })
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => refresh()
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}

export function connectionErrorMessage(error: unknown): string {
  switch (getErrorStatus(error)) {
    case 401: return 'Your session has ended. Sign in again.'
    case 403: return 'Friends are unavailable for this account.'
    case 404: case 409: return 'This person or request is no longer available. Refresh to continue.'
    case 422: return 'This request could not be completed. Refresh and try again.'
    case 429: return 'Too many requests. Wait a moment and try again.'
    default: return 'Unable to connect. Check your connection and try again.'
  }
}
