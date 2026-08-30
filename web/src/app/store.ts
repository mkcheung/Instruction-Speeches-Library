import { configureStore } from '@reduxjs/toolkit'
import { authApi } from '@/features/auth/authApi'
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

export const store = configureStore({
  reducer: {
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
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
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
    ),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
