import { Outlet, Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from 'react-router-dom'
import { Provider } from 'react-redux'
import { store } from '@/app/store'
import Home from '@/routes/Home'
import NotFound from '@/routes/NotFound'
import Spikes from '@/routes/Spikes'
import Register from '@/routes/Register'
import Login from '@/routes/Login'
import ForgotPassword from '@/routes/ForgotPassword'
import ResetPassword from '@/routes/ResetPassword'
import VerifyEmail from '@/routes/VerifyEmail'
import Onboarding from '@/routes/Onboarding'
import ProfileEdit from '@/routes/ProfileEdit'
import Account from '@/routes/Account'
import PublicProfile from '@/routes/PublicProfile'
import ProfileAbout from '@/routes/ProfileAbout'
import ProfileReviewsLeft from '@/routes/ProfileReviewsLeft'
import ProfileReviewsReceived from '@/routes/ProfileReviewsReceived'
import MySpeeches from '@/routes/MySpeeches'
import SpeechCreate from '@/routes/SpeechCreate'
import SpeechWatch from '@/routes/SpeechWatch'
import Dashboard from '@/routes/Dashboard'
import ReviewerDirectory from '@/routes/ReviewerDirectory'
import Search from '@/routes/Search'
import BecomeACoach from '@/routes/BecomeACoach'
import { RequireAuth, RequireGuest, RequireVerified } from '@/components/auth/AuthShell'
import { UnauthenticatedRedirect } from '@/components/auth/UnauthenticatedRedirect'
import { AppLayout } from '@/components/layout/AppLayout'
import { isSpikesEnabled } from '@/lib/spikes-guard'

/** STEP-08's unsaved-changes guard (`useEssayEditor`'s navigation blocker)
 * needs `useBlocker`, which only works under a data router
 * (`createBrowserRouter`/`RouterProvider`) — `useBlocker` throws
 * "must be used within a data router" under the declarative
 * `<BrowserRouter>`/`<Routes>` this app used through STEP-07. `RootLayout`
 * takes over `<BrowserRouter>`'s job of hosting `UnauthenticatedRedirect`
 * next to whichever route actually matched. */
function RootLayout() {
  return (
    <>
      <UnauthenticatedRedirect />
      <Outlet />
    </>
  )
}

/**
 * The `/__spikes` route is only REGISTERED when the guard passes — the
 * first half of the double guard. `Spikes` itself re-checks the guard at
 * render time as the second half, so a force-navigate can't see it even if
 * this registration were ever bypassed.
 */
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />}>
      <Route path="/" element={<Home />} />
      {isSpikesEnabled() && <Route path="/__spikes" element={<Spikes />} />}

      <Route
        path="/register"
        element={
          <RequireGuest>
            <Register />
          </RequireGuest>
        }
      />
      <Route
        path="/login"
        element={
          <RequireGuest>
            <Login />
          </RequireGuest>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <RequireGuest>
            <ForgotPassword />
          </RequireGuest>
        }
      />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      {/* `/verify` must render unauthenticated — a verification link
          opened on a different device is the whole point (§12 S1). */}
      <Route path="/verify" element={<VerifyEmail />} />

      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <Onboarding />
          </RequireAuth>
        }
      />
      {/* STEP-13-FROZEN-CONTRACT.md §9: the first nested-tab-route pattern
          in this app — three sibling routes under `PublicProfile`'s own
          `<Outlet>`, same `<Route>`/`<Outlet>` nesting mechanics as
          `AppLayout`/`RootLayout` below, just not previously used for
          same-page tabs. Real routes, not a `role="tablist"` widget — the
          plan's explicit instruction, since these are URLs people share
          and go back to. */}
      <Route path="/u/:username" element={<PublicProfile />}>
        <Route index element={<ProfileAbout />} />
        <Route path="reviews-left" element={<ProfileReviewsLeft />} />
        <Route path="reviews-received" element={<ProfileReviewsReceived />} />
      </Route>

      {/* D1 — one layout route renders the header/sidebar once for
          all five authenticated routes, instead of a header import
          per page. All five carry identical guards (`RequireAuth` +
          `RequireVerified`), checked route by route before hoisting
          them here — a single differing guard would have made this
          unsafe. */}
      <Route
        element={
          <RequireAuth>
            <RequireVerified>
              <AppLayout />
            </RequireVerified>
          </RequireAuth>
        }
      >
        <Route path="/speeches" element={<MySpeeches />} />
        <Route path="/speeches/new" element={<SpeechCreate />} />
        <Route path="/speeches/:id" element={<SpeechWatch />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/profile" element={<ProfileEdit />} />
        {/* STEP-11-FROZEN-CONTRACT.md §10: own screen, not nested under
            `/profile` — same guard group as every other authenticated
            route here (do not touch the guard structure otherwise). */}
        <Route path="/account" element={<Account />} />
        <Route path="/reviewers" element={<ReviewerDirectory />} />
        {/* STEP-09-FROZEN-CONTRACT.md §5: top-level, not nested under a
            speech — it queries across all of a user's own speeches. */}
        <Route path="/search" element={<Search />} />
        {/* STEP-12-FROZEN-CONTRACT.md §9: one route, tab/step-gated by
            application status inside the page itself — no separate
            status route, avoiding an extra guessable path. */}
        <Route path="/become-a-coach" element={<BecomeACoach />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Route>,
  ),
)

function App() {
  return (
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  )
}

export default App
