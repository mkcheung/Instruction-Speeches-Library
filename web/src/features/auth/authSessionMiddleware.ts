import type { Middleware } from '@reduxjs/toolkit'
import type { authApi as AuthApi } from './authApi'
import {
  authSessionActions as actions,
  authSessionSignals as signals,
  isTerminalStatus,
  SESSION_CHANGED,
  selectAuthSession,
  type AuthSessionState,
} from './authSession'
import type { CurrentUser } from './types'

/** The slice of an RTK Query API this middleware needs: its cache can be dropped as a unit. */
export interface ResettableApi {
  reducerPath: string
  util: { resetApiState: () => unknown }
}

export interface AuthSessionMiddlewareOptions {
  authApi: typeof AuthApi
  /** Every registered private cache (profile, speech, review, notification, annotation, essay, caption,
   * transcript, report, privacy, coachApplication, connection). Auth is managed separately. */
  privateApis: readonly ResettableApi[]
  /** Tell other tabs the account changed (nonce only). */
  broadcast?: () => void
  /** A 401-triggered re-proof that confirms the SAME user may not repeat sooner than this. */
  reproofIntervalMs?: number
  now?: () => number
}

type Root = { authSession: AuthSessionState }
type AnyAction = { type: string; payload?: unknown; meta?: { requestId?: string; condition?: boolean } }

const SESSION_ERROR_RE = /^([A-Za-z]+)\/execute(?:Query|Mutation)\/rejected$/

function statusOf(payload: unknown): number | string {
  if (typeof payload === 'object' && payload !== null && 'status' in payload) {
    const status = (payload as { status: unknown }).status
    if (typeof status === 'number' || typeof status === 'string') return status
  }
  return 'unknown'
}

function isUser(value: unknown): value is CurrentUser {
  return typeof value === 'object' && value !== null && 'id' in value
    && (value as { id: unknown }).id !== undefined && (value as { id: unknown }).id !== null
}

/**
 * Event matrix of §8.1. Placed BEFORE every domain/API middleware.
 *
 * Probe discipline: only the latest `/me` request started in the current
 * generation, with no login/register/logout in flight, may settle identity.
 * A stale or tainted probe never changes identity; it triggers a fresh probe.
 */
export function createAuthSessionMiddleware(options: AuthSessionMiddlewareOptions): Middleware {
  const { authApi, privateApis, broadcast, reproofIntervalMs = 1000, now = () => Date.now() } = options
  const { getMe, login, register, logout } = authApi.endpoints

  return (store) => {
    /** requestId -> generation at start, plus whether the probe is a background (focus) check. */
    const probes = new Map<string, { generation: number; background: boolean }>()
    const attemptIds = new Set<string>()
    /** APIs holding rejections caused by our own fence; they are refetched on same-user resumption. */
    const fenced = new Set<string>()
    let nextProbeBackground = false
    let lastReproofAt = Number.NEGATIVE_INFINITY

    const session = () => selectAuthSession(store.getState() as Root)
    const startProbe = (background = false) => {
      nextProbeBackground = background
      // RTK deduplicates an already pending request: its completion re-enters this middleware.
      void store.dispatch(getMe.initiate(undefined, { subscribe: false, forceRefetch: true }) as never)
      nextProbeBackground = false
    }
    const dropPrivateCaches = () => {
      for (const api of privateApis) store.dispatch(api.util.resetApiState() as never)
    }
    const resumeFenced = () => {
      for (const path of fenced) {
        const api = privateApis.find((candidate) => candidate.reducerPath === path)
        if (api) store.dispatch(api.util.resetApiState() as never)
      }
      fenced.clear()
    }
    const pauseMedia = () => {
      if (typeof document === 'undefined') return
      document.querySelectorAll('video,audio').forEach((element) => {
        try { (element as HTMLMediaElement).pause() } catch { /* jsdom: not implemented */ }
      })
    }

    return (next) => (rawAction) => {
      const action = rawAction as AnyAction

      // --- our own fence leaving a rejection behind -------------------------------------------------
      const fencedMatch = SESSION_ERROR_RE.exec(action.type)
      if (fencedMatch && typeof action.payload === 'object' && action.payload !== null
        && (action.payload as { error?: unknown }).error === SESSION_CHANGED) {
        const result = next(rawAction)
        const s = session()
        if ((s.status === 'accepted' || s.status === 'anonymous') && s.attempts === 0) {
          // Proof was already restored for the same user (or the anonymous document re-confirmed) before this obsolete rejection landed: refetch now.
          const api = privateApis.find((candidate) => candidate.reducerPath === fencedMatch[1])
          if (api) store.dispatch(api.util.resetApiState() as never)
        } else if (!isTerminalStatus(s.status)) {
          fenced.add(fencedMatch[1])
        }
        return result
      }

      // --- explicit signals ------------------------------------------------------------------------
      if (signals.refocus.match(rawAction)) {
        const result = next(rawAction)
        const s = session()
        if (!isTerminalStatus(s.status) && s.attempts === 0 && s.bound && s.documentUserId !== null) {
          store.dispatch(actions.pageShown())
          startProbe(s.status === 'accepted')
        }
        return result
      }
      if (signals.revalidate.match(rawAction)) {
        const result = next(rawAction)
        store.dispatch(actions.quarantined())
        if (session().attempts === 0 && !isTerminalStatus(session().status)) startProbe()
        return result
      }
      if (actions.externalChange.match(rawAction) || actions.pageRestored.match(rawAction)) {
        const result = next(rawAction)
        pauseMedia()
        if (session().attempts === 0) startProbe()
        return result
      }
      if (actions.pageHidden.match(rawAction)) {
        pauseMedia()
        return next(rawAction)
      }
      if (actions.privateUnauthorized.match(rawAction)) {
        const before = session()
        // The server keeps answering 401 for a user /me just re-confirmed (e.g. a route-specific rule):
        // surface that request's own error instead of looping 401 -> probe -> refetch -> 401.
        if (before.status === 'accepted' && now() - lastReproofAt < reproofIntervalMs) return rawAction
        const result = next(rawAction)
        const relevant = rawAction.payload.generation === before.generation && before.attempts === 0
          && ['accepted', 'quarantined', 'uncertain', 'unresolved'].includes(before.status)
        if (relevant) {
          if (before.status === 'accepted') pauseMedia()
          lastReproofAt = now()
          startProbe()
        }
        return result
      }

      // --- login / register / logout attempts -----------------------------------------------------
      const attemptEndpoint = [login, register, logout].find((endpoint) => endpoint.matchPending(action))
      if (attemptEndpoint && action.meta?.requestId) {
        attemptIds.add(action.meta.requestId)
        const result = next(rawAction)
        store.dispatch(actions.attemptStarted(action.meta.requestId))
        pauseMedia()
        return result
      }
      for (const endpoint of [login, register, logout]) {
        const succeeded = endpoint.matchFulfilled(action)
        const rejected = endpoint.matchRejected(action)
        if (!succeeded && !rejected) continue
        const id = action.meta?.requestId
        if (!id || !attemptIds.delete(id)) return next(rawAction)
        const current = session().latestAttemptId === id
        // Logout against an already-ended session ("401") is a successful logout.
        const alreadyLoggedOut = endpoint === logout && rejected && statusOf(action.payload) === 401
        const result = next(rawAction)
        if (!current) {
          store.dispatch(actions.attemptSettled())
          return result
        }
        if (succeeded || alreadyLoggedOut) {
          store.dispatch(actions.attemptSucceeded())
          dropPrivateCaches()
          broadcast?.()
        } else {
          store.dispatch(actions.attemptSettled())
          // Keep the form error; settle identity once with a fresh probe.
          if (session().attempts === 0) startProbe()
        }
        return result
      }

      // --- /me probes -----------------------------------------------------------------------------
      if (getMe.matchPending(action) && action.meta?.requestId) {
        const nextProbeBackgroundAtStart = nextProbeBackground
        probes.set(action.meta.requestId, { generation: session().generation, background: nextProbeBackground })
        const result = next(rawAction)
        store.dispatch(actions.probeStarted({ id: action.meta.requestId, background: nextProbeBackgroundAtStart }))
        return result
      }
      const isMeSuccess = getMe.matchFulfilled(action)
      const isMeFailure = getMe.matchRejected(action)
      if ((isMeSuccess || isMeFailure) && action.meta?.requestId) {
        // Condition rejections are deduplicated calls, not authentication failures.
        if (isMeFailure && action.meta.condition) return next(rawAction)
        const started = probes.get(action.meta.requestId)
        probes.delete(action.meta.requestId)
        const before = session()
        const result = next(rawAction) // RTK's own cache may update; our proof never follows it
        store.dispatch(actions.probeFinished(action.meta.requestId))
        const valid = started !== undefined && started.generation === before.generation
          && before.attempts === 0 && !isTerminalStatus(before.status) && before.probeId === action.meta.requestId
        if (!valid) {
          // Never change identity from a stale or tainted answer. If nothing else will, ask again.
          if (before.attempts === 0 && !isTerminalStatus(before.status)) startProbe()
          return result
        }
        if (isMeSuccess && isUser(action.payload?.user)) {
          store.dispatch(actions.probeAccepted(action.payload.user))
          const after = session()
          if (after.status === 'replaced') { dropPrivateCaches(); pauseMedia() }
          else resumeFenced()
        } else if (isMeFailure && statusOf(action.payload) === 401) {
          store.dispatch(actions.probeAnonymous())
          if (session().status === 'lost') { dropPrivateCaches(); pauseMedia() }
          else resumeFenced()
        } else if (!started.background) {
          // 5xx, network failure or an unreadable body: identity is unknown, not anonymous.
          store.dispatch(actions.probeUncertain({ status: isMeFailure ? statusOf(action.payload) : 'invalid' }))
        }
        return result
      }

      return next(rawAction)
    }
  }
}
