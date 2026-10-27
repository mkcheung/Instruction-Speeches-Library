import { configureStore } from '@reduxjs/toolkit'
import { authApi } from '@/features/auth/authApi'
import { authSessionReducer, type AuthSessionState } from '@/features/auth/authSession'
import { createAuthSessionMiddleware } from '@/features/auth/authSessionMiddleware'
import { broadcastAuthChange } from '@/features/auth/authSessionBrowser'
import { profileApi } from '@/features/profile/profileApi'
import { speechApi } from '@/features/speech/speechApi'
import { reviewApi } from '@/features/review/reviewApi'
import { notificationApi } from '@/features/notification/notificationApi'
import { annotationApi } from '@/features/annotation/annotationApi'
import { essayApi } from '@/features/essay/essayApi'
import { captionApi } from '@/features/caption/captionApi'
import { transcriptApi } from '@/features/transcript/transcriptApi'
import { reportApi } from '@/features/report/reportApi'
import { privacyApi } from '@/features/privacy/privacyApi'
import { coachApplicationApi } from '@/features/coachApplication/coachApplicationApi'
import { connectionApi } from '@/features/connection/connectionApi'
import { connectionSessionMiddleware, connectionSessionReducer } from '@/features/connection/connectionSession'
import { commentaryPreferenceSession } from '@/features/annotation/commentaryPreferenceSession'

/** Every private cache. Auth is managed separately and is not in this tuple. */
export const privateApis = [
  profileApi, speechApi, reviewApi, notificationApi, annotationApi, essayApi,
  captionApi, transcriptApi, reportApi, privacyApi, coachApplicationApi, connectionApi,
] as const

export interface CreateAppStoreOptions {
  /** Seed an accepted identity (test fixtures; see `acceptedAuthSessionState`). */
  authSession?: AuthSessionState
  /** Unit tests do not need frame-batched notifications (see renderWithProviders). */
  autoBatch?: boolean
  broadcast?: () => void
}

/**
 * The single composition of reducers and middleware. The identity middleware
 * is placed before every domain/API middleware so it observes (and fences)
 * each action first; the connection and commentary adapters derive from it.
 */
export function createAppStore({ authSession, autoBatch = true, broadcast = broadcastAuthChange }: CreateAppStoreOptions = {}) {
  return configureStore({
    reducer: {
      authSession: authSessionReducer,
      [authApi.reducerPath]: authApi.reducer,
      [profileApi.reducerPath]: profileApi.reducer,
      [speechApi.reducerPath]: speechApi.reducer,
      [reviewApi.reducerPath]: reviewApi.reducer,
      [notificationApi.reducerPath]: notificationApi.reducer,
      [annotationApi.reducerPath]: annotationApi.reducer,
      [essayApi.reducerPath]: essayApi.reducer,
      [captionApi.reducerPath]: captionApi.reducer,
      [transcriptApi.reducerPath]: transcriptApi.reducer,
      [reportApi.reducerPath]: reportApi.reducer,
      [privacyApi.reducerPath]: privacyApi.reducer,
      [coachApplicationApi.reducerPath]: coachApplicationApi.reducer,
      [connectionApi.reducerPath]: connectionApi.reducer,
      connectionSession: connectionSessionReducer,
    },
    preloadedState: authSession ? { authSession } : undefined,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(
        createAuthSessionMiddleware({ authApi, privateApis, broadcast }),
        connectionSessionMiddleware,
        commentaryPreferenceSession,
        authApi.middleware,
        profileApi.middleware,
        speechApi.middleware,
        reviewApi.middleware,
        notificationApi.middleware,
        annotationApi.middleware,
        essayApi.middleware,
        captionApi.middleware,
        transcriptApi.middleware,
        reportApi.middleware,
        privacyApi.middleware,
        coachApplicationApi.middleware,
        connectionApi.middleware,
      ),
    enhancers: (getDefaultEnhancers) => getDefaultEnhancers({ autoBatch }),
  })
}
