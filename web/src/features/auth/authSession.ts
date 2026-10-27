import { createAction, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { useSelector } from 'react-redux'
import type { CurrentUser } from './types'

/**
 * Authoritative identity for THIS document (R1, PLAN-CODE-REVIEW-FOLLOW-UP
 * §8.1). Dependency-light on purpose: no API slice, no store. Store
 * composition injects the matchers and registered API tuple into the
 * middleware factory (`authSessionMiddleware.ts`).
 *
 * A document is bound to the first identity an accepted `/me` probe reports
 * (a user id, or anonymous). A later probe naming anyone else makes the
 * document terminal (`replaced` / `lost`) and the app takes a hard
 * navigation; it is never adopted in place. General identity is distinct
 * from Friends eligibility: admins and users without usernames are valid
 * identities here.
 */
export type AuthSessionStatus =
  | 'unresolved' // no accepted probe yet
  | 'accepted' // the bound identity is proven current
  | 'quarantined' // proof withdrawn; a fresh probe will decide
  | 'uncertain' // the fresh probe failed (5xx/network): identity unknown
  | 'anonymous' // proven anonymous and the document was anonymous
  | 'lost' // terminal: authenticated document, session now gone
  | 'replaced' // terminal: another account owns the session now
  | 'navigating' // terminal: login/register/logout succeeded, hard navigation pending

export interface AuthSessionState {
  /** Advances whenever in-flight private work can no longer be trusted. */
  generation: number
  status: AuthSessionStatus
  /** The proven user while `accepted` (retained while quarantined for same-user resumption). */
  viewer: CurrentUser | null
  /** True once the first probe bound this document. */
  bound: boolean
  /** The bound user id, or null for an anonymous document. */
  documentUserId: string | null
  /** The latest `/me` request that may settle identity. */
  probeId: string | null
  /** A foreground `/me` probe is in flight: identity-derived UI that must not outlive a possible change hides. */
  probing: boolean
  /** Login/register/logout requests currently in flight. */
  attempts: number
  /** The most recent auth attempt's request id (older ones are stale). */
  latestAttemptId: string | null
  /** pagehide: private UI is hidden even though proof may survive a same-user exit flush. */
  hidden: boolean
  /** Serializable summary of the last uncertain probe failure. */
  error: { status: number | string } | null
}

const initialState: AuthSessionState = {
  generation: 0,
  status: 'unresolved',
  viewer: null,
  bound: false,
  documentUserId: null,
  probeId: null,
  probing: false,
  attempts: 0,
  latestAttemptId: null,
  hidden: false,
  error: null,
}

/** Test/fixture factory: a document already bound to and accepting `viewer`. Never read by production code. */
export function acceptedAuthSessionState(viewer: CurrentUser): AuthSessionState {
  return { ...initialState, status: 'accepted', viewer, bound: true, documentUserId: String(viewer.id) }
}

export function isTerminalStatus(status: AuthSessionStatus): boolean {
  return status === 'lost' || status === 'replaced' || status === 'navigating'
}

const slice = createSlice({
  name: 'authSession',
  initialState,
  reducers: {
    probeStarted(state, action: PayloadAction<{ id: string; background: boolean }>) {
      state.probeId = action.payload.id
      state.probing = !action.payload.background
    },
    probeFinished(state, action: PayloadAction<string>) {
      if (state.probeId === action.payload) state.probing = false
    },
    probeAccepted(state, action: PayloadAction<CurrentUser>) {
      const user = action.payload
      const id = String(user.id)
      state.error = null
      if (!state.bound) {
        state.bound = true
        state.documentUserId = id
      }
      if (state.documentUserId === id) {
        state.status = 'accepted'
        state.viewer = user
      } else {
        state.status = 'replaced'
        state.viewer = null
        state.generation += 1
      }
    },
    probeAnonymous(state) {
      state.error = null
      if (!state.bound) {
        state.bound = true
        state.documentUserId = null
      }
      if (state.documentUserId === null) {
        state.status = 'anonymous'
      } else {
        state.status = 'lost'
        state.generation += 1
      }
      state.viewer = null
    },
    probeUncertain(state, action: PayloadAction<{ status: number | string }>) {
      state.error = action.payload
      if (state.status === 'quarantined' || state.status === 'uncertain') state.status = 'uncertain'
    },
    quarantined(state) {
      if (state.status === 'accepted' || state.status === 'uncertain') state.status = 'quarantined'
    },
    /** A private request 401 for the current generation: withdraw proof until a probe settles. */
    privateUnauthorized(state, action: PayloadAction<{ generation: number }>) {
      if (action.payload.generation !== state.generation || state.attempts > 0) return
      if (state.status === 'accepted') state.status = 'quarantined'
    },
    attemptStarted(state, action: PayloadAction<string>) {
      state.attempts += 1
      state.generation += 1
      state.latestAttemptId = action.payload
      if (!isTerminalStatus(state.status)) state.status = 'quarantined'
    },
    attemptSettled(state) {
      state.attempts = Math.max(0, state.attempts - 1)
    },
    /** The CURRENT attempt succeeded: this document will be replaced; never publish the new account as ready. */
    attemptSucceeded(state) {
      state.attempts = 0
      state.status = 'navigating'
      state.viewer = null
      state.generation += 1
    },
    /** Another tab changed the account. */
    externalChange(state) {
      state.generation += 1
      if (!isTerminalStatus(state.status)) state.status = state.bound ? 'quarantined' : state.status
    },
    pageHidden(state) {
      state.hidden = true
    },
    /** Back/Forward cache restored a prior document: its proof is unusable until a fresh probe settles. */
    pageRestored(state) {
      state.hidden = false
      state.generation += 1
      state.attempts = 0
      state.status = state.bound ? 'quarantined' : 'unresolved'
      state.probeId = null
      state.probing = false
    },
    pageShown(state) {
      state.hidden = false
    },
  },
})

export const authSessionReducer = slice.reducer
export const authSessionActions = slice.actions

/** Signals handled by the middleware (they also have reducers where state changes). */
export const authSessionSignals = {
  /** Window focus / visibility restoration while accepted: background probe, no quarantine. */
  refocus: createAction('authSession/refocus'),
  /** Explicit retry (e.g. Friends "Retry session"): quarantine and probe. */
  revalidate: createAction('authSession/revalidate'),
}

type Root = { authSession: AuthSessionState }
export const selectAuthSession = (state: Root): AuthSessionState => state.authSession
/** The proven current viewer, or null while unresolved, quarantined, hidden, uncertain, anonymous or terminal. */
export const selectAcceptedViewer = (state: Root): CurrentUser | null => {
  const s = state.authSession
  return s.status === 'accepted' && !s.hidden ? s.viewer : null
}
export const useAuthSession = () => useSelector(selectAuthSession)
export const useAcceptedViewer = () => useSelector(selectAcceptedViewer)

/** True when `user` (e.g. cached `/me` data) is the proven viewer of this document. */
export function isAcceptedViewer(session: AuthSessionState, user: Pick<CurrentUser, 'id'> | undefined | null): boolean {
  return !!user && session.status === 'accepted' && !session.hidden && String(session.viewer?.id) === String(user.id)
}

export interface AuthProof { generation: number; viewerId: string | null }

/** Captured at private-request start; checked before transport, after CSRF awaits, before a 419 replay and on completion. */
export function captureProof(session: AuthSessionState): AuthProof {
  return { generation: session.generation, viewerId: session.bound ? session.documentUserId : null }
}

export function isProofCurrent(session: AuthSessionState, proof: AuthProof): boolean {
  if (session.generation !== proof.generation || isTerminalStatus(session.status)) return false
  return proof.viewerId === null || !session.bound || session.documentUserId === proof.viewerId
}

/** Private transport is refused in terminal documents and, for non-control requests, while an auth attempt changes the cookie. */
export function isPrivateTransportBlocked(session: AuthSessionState): boolean {
  return isTerminalStatus(session.status) || session.attempts > 0
}

/** Proof for writes that outlive the request lifecycle (the essay editor's raw pagehide/unmount flush). */
export interface WriteProof { generation: number; viewerId: string }
export function captureWriteProof(session: AuthSessionState): WriteProof | null {
  // Deliberately ignores `hidden`: a legitimate same-user exit flush happens after pagehide hides the UI.
  return session.status === 'accepted' && session.viewer
    ? { generation: session.generation, viewerId: String(session.viewer.id) }
    : null
}
export function isWriteProofCurrent(session: AuthSessionState, proof: WriteProof): boolean {
  return session.status === 'accepted' && session.generation === proof.generation
    && String(session.viewer?.id) === proof.viewerId
}

/**
 * The same viewer is accepted again (settled, no auth attempt in flight). Unlike `isWriteProofCurrent` it ignores
 * generation, so a same-user cross-tab/BFCache bump that was re-proved does not lose the exit flush; a different
 * user, an attempt, a quarantine or a terminal state still fails.
 */
export function isWriteProofSameViewer(session: AuthSessionState, proof: WriteProof): boolean {
  return session.status === 'accepted' && session.attempts === 0 && String(session.viewer?.id) === proof.viewerId
}

export const SESSION_CHANGED = 'SESSION_CHANGED'
