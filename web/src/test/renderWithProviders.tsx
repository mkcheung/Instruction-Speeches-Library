import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
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
import { coachApplicationApi } from '@/features/coachApplication/coachApplicationApi'

export function createTestStore() {
  return configureStore({
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
      [coachApplicationApi.reducerPath]: coachApplicationApi.reducer,
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
        coachApplicationApi.middleware,
      ),
    // Unit tests do not need frame-batched Redux notifications. Disabling
    // the enhancer also prevents an RTK-owned animation-frame callback from
    // surviving a fake-timer test and firing after jsdom has torn its window
    // globals down (a false-red unhandled cancelAnimationFrame error).
    enhancers: (getDefaultEnhancers) => getDefaultEnhancers({ autoBatch: false }),
  })
}

/**
 * STEP-08 needs `useBlocker` (the unsaved-changes guard) to work under
 * test, which throws "must be used within a data router" under a plain
 * `<MemoryRouter>` — same reason `App.tsx` moved to `createBrowserRouter`.
 * `ui` is mounted as the element of a single catch-all route rather than
 * navigated to, so every existing caller (many of which pass their own
 * nested `<Routes>/<Route>` as `ui` for their own param matching, e.g.
 * `PublicProfile.test.tsx`) keeps working unchanged.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', store = createTestStore() }: { route?: string; store?: ReturnType<typeof createTestStore> } = {},
) {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [route] })
  return {
    store,
    router,
    ...render(
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>,
    ),
  }
}

/** Clears every cookie jsdom is holding, so tests don't leak an
 * `XSRF-TOKEN` from one case into the next. */
export function clearCookies() {
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
  })
}
