import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { MemoryRouter } from 'react-router-dom'
import { authApi } from '@/features/auth/authApi'
import { profileApi } from '@/features/profile/profileApi'
import { speechApi } from '@/features/speech/speechApi'
import { reviewApi } from '@/features/review/reviewApi'
import { notificationApi } from '@/features/notification/notificationApi'
import { annotationApi } from '@/features/annotation/annotationApi'

export function createTestStore() {
  return configureStore({
    reducer: {
      [authApi.reducerPath]: authApi.reducer,
      [profileApi.reducerPath]: profileApi.reducer,
      [speechApi.reducerPath]: speechApi.reducer,
      [reviewApi.reducerPath]: reviewApi.reducer,
      [notificationApi.reducerPath]: notificationApi.reducer,
      [annotationApi.reducerPath]: annotationApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(
        authApi.middleware,
        profileApi.middleware,
        speechApi.middleware,
        reviewApi.middleware,
        notificationApi.middleware,
        annotationApi.middleware,
      ),
  })
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', store = createTestStore() }: { route?: string; store?: ReturnType<typeof createTestStore> } = {},
) {
  return {
    store,
    ...render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
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
