import { createAction, createSlice, type Middleware, type PayloadAction } from '@reduxjs/toolkit'
import { useSelector } from 'react-redux'
import { useEffect, useEffectEvent } from 'react'
import { authSessionSignals, selectAuthSession, type AuthSessionState } from '@/features/auth/authSession'
import type { CurrentUser } from '@/features/auth/types'
import { connectionApi } from './connectionApi'
import { getErrorStatus } from '@/lib/errorStatus'
import { hasRole } from '@/lib/roles'

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
    /** Mirror of the document's authoritative identity (`authSession`); never an authority itself. */
    sync: (_state, action: PayloadAction<ConnectionSessionState>) => action.payload,
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

/** Friends eligibility excludes administrative roles and users without usernames. It is derived from the
 * accepted general identity; such users are still authenticated everywhere else. */
function eligible(user: CurrentUser): ConnectionViewer | null {
  if (!user?.id || !user.username?.trim() || !Array.isArray(user.roles) || hasRole(user, 'admin')) return null
  return { id: String(user.id), username: user.username.trim() }
}

function derive(auth: AuthSessionState): Omit<ConnectionSessionState, 'generation' | 'requestId'> {
  const hiding = { viewer: null, error: null }
  if (auth.hidden || auth.probing) return { ...hiding, status: 'loading' }
  switch (auth.status) {
    case 'accepted': return { status: 'ready', viewer: auth.viewer ? eligible(auth.viewer) : null, error: null }
    case 'anonymous': case 'lost': return { ...hiding, status: 'anonymous' }
    case 'uncertain': return { status: 'error', viewer: null, error: auth.error }
    case 'unresolved': return auth.error ? { status: 'error', viewer: null, error: auth.error } : { ...hiding, status: 'unresolved' }
    default: return { ...hiding, status: 'loading' }
  }
}

/**
 * Adapter between the document-wide identity proof and the Friends domain.
 * The Friends cache is dropped whenever the proof's generation or accepted
 * user changes (not for same-user revalidation). Late Friends responses
 * and 401s are fenced in `baseQuery` by the identity captured at request start.
 */
export const connectionSessionMiddleware: Middleware = (store) => {
  let key: string | null = null
  let lastAuth: AuthSessionState | undefined
  const sync = () => {
    const auth = selectAuthSession(store.getState() as { authSession: AuthSessionState })
    // Everything below is a pure function of `auth` (plus the cache key it keeps), and this runs after EVERY
    // action in the app (RTK Query alone dispatches several per request), so skip the derivation while the
    // identity slice is untouched.
    if (auth === lastAuth) return
    lastAuth = auth
    const derived = derive(auth)
    const nextKey = auth.status === 'accepted' && !auth.hidden && auth.viewer
      ? `${auth.generation}:${auth.viewer.id}` : auth.status === 'quarantined' || auth.status === 'uncertain' || auth.hidden
        ? key : `${auth.generation}:`
    if (nextKey !== key) {
      const first = key === null
      key = nextKey
      if (!first) store.dispatch(connectionApi.util.resetApiState())
    }
    const current = (store.getState() as SessionRoot).connectionSession
    if (current.generation !== auth.generation || current.status !== derived.status
      || current.viewer?.id !== derived.viewer?.id || current.viewer?.username !== derived.viewer?.username
      || current.error !== derived.error) {
      store.dispatch(session.actions.sync({ ...derived, generation: auth.generation, requestId: null }))
    }
  }
  return (next) => (action) => {
    if (revalidateConnectionSession.match(action)) {
      store.dispatch(connectionApi.util.resetApiState())
      store.dispatch(authSessionSignals.revalidate())
      return next(action)
    }
    const result = next(action)
    sync()
    return result
  }
}

/** Scoped listeners only exist while the caller is mounted and eligible. */
export function useConnectionRefresh(refetch: () => unknown, enabled: boolean, intervalMs?: number) {
  const refresh = useEffectEvent(() => { if (document.visibilityState === 'visible') refetch() })
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => refresh()
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    const interval = intervalMs !== undefined && intervalMs > 0 ? window.setInterval(onVisible, intervalMs) : undefined
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [enabled, intervalMs])
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
