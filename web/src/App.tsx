import { BrowserRouter, Routes, Route } from 'react-router-dom'
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
import PublicProfile from '@/routes/PublicProfile'
import MySpeeches from '@/routes/MySpeeches'
import SpeechCreate from '@/routes/SpeechCreate'
import SpeechWatch from '@/routes/SpeechWatch'
import { RequireAuth, RequireGuest, RequireVerified } from '@/components/auth/AuthShell'
import { UnauthenticatedRedirect } from '@/components/auth/UnauthenticatedRedirect'
import { isSpikesEnabled } from '@/lib/spikes-guard'

/**
 * The `/__spikes` route is only REGISTERED when the guard passes — the
 * first half of the double guard. `Spikes` itself re-checks the guard at
 * render time as the second half, so a force-navigate can't see it even if
 * this registration were ever bypassed.
 */
function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <UnauthenticatedRedirect />
        <Routes>
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
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <RequireVerified>
                  <ProfileEdit />
                </RequireVerified>
              </RequireAuth>
            }
          />
          <Route path="/u/:username" element={<PublicProfile />} />

          <Route
            path="/speeches"
            element={
              <RequireAuth>
                <RequireVerified>
                  <MySpeeches />
                </RequireVerified>
              </RequireAuth>
            }
          />
          <Route
            path="/speeches/new"
            element={
              <RequireAuth>
                <RequireVerified>
                  <SpeechCreate />
                </RequireVerified>
              </RequireAuth>
            }
          />
          <Route
            path="/speeches/:id"
            element={
              <RequireAuth>
                <RequireVerified>
                  <SpeechWatch />
                </RequireVerified>
              </RequireAuth>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </Provider>
  )
}

export default App
