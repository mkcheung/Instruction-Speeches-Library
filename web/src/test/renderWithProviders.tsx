import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { RouterProvider, createMemoryRouter, type InitialEntry } from 'react-router-dom'
import { createAppStore } from '@/app/createAppStore'
import { acceptedAuthSessionState } from '@/features/auth/authSession'
import type { CurrentUser } from '@/features/auth/types'

/**
 * `viewer` is the proof fixture: the document starts bound to and accepting
 * that user, exactly as after a successful `/me` probe, so private gates
 * open without a production bypass. Omit it for a guest or unresolved
 * document, or let a mocked `/me` response establish identity through the
 * real probe path. The mocked `/me` must name the same user id.
 *
 * Unit tests do not need frame-batched Redux notifications. Disabling the
 * enhancer also prevents an RTK-owned animation-frame callback from
 * surviving a fake-timer test and firing after jsdom has torn its window
 * globals down (a false-red unhandled cancelAnimationFrame error).
 */
export function createTestStore({ viewer }: { viewer?: CurrentUser } = {}) {
  return createAppStore({
    authSession: viewer ? acceptedAuthSessionState(viewer) : undefined,
    autoBatch: false,
    broadcast: () => {},
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
  {
    route = '/',
    viewer,
    store = createTestStore({ viewer }),
  }: { route?: InitialEntry; store?: ReturnType<typeof createTestStore>; viewer?: CurrentUser } = {},
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
