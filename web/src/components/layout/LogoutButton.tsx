import { useState } from 'react'
import { useStore } from 'react-redux'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useLogoutMutation } from '@/features/auth/authApi'
import { hardNavigation } from '@/lib/hardNavigation'
import { getErrorStatus } from '@/lib/errorStatus'
import { selectAuthSession, type AuthSessionState } from '@/features/auth/authSession'

/**
 * D4 (PLAN-APP-HEADER.md) — now a menu item inside `UserMenu` rather than
 * a standalone button (S1/D1 retire the "any authenticated page mounts
 * what it needs" precedent this component's original comment described).
 *
 * Keeps the hard `window.location.assign` navigation on success — it
 * throws away every RTK Query cache in one shot, sidestepping both the
 * single-`createApi`-tag staleness problem AND the fact that `authApi`
 * and `profileApi` are separate `createApi` instances whose caches can't
 * invalidate each other.
 *
 * Fixes the real bug the original had: `await logout().unwrap()` threw on
 * a failed logout with nothing catching it. There are three outcomes, not
 * two — the third is the one that matters:
 *
 *   200            logged out                      -> navigate to /login
 *   401            already logged out (double-click,
 *                  or the session died elsewhere)   -> treat as success,
 *                                                       same navigation
 *   419/5xx/network still logged in                -> do NOT navigate;
 *                                                       surface the error
 *
 * Navigating on that third outcome is what would produce the `/onboarding`
 * bounce D4 warns about: `/login` is `RequireGuest`-wrapped, and
 * `RequireGuest` sends an *authenticated* visitor onward to `/onboarding`.
 * If logout genuinely failed, the session is still alive, so hard-
 * navigating to `/login` unconditionally would hand a still-logged-in
 * user straight into the onboarding wizard.
 *
 * The identity middleware (`authSessionMiddleware`) owns the cache side of
 * this: logout start quarantines private rendering and writes, and a
 * successful (or already-ended) logout drops every private cache and tells
 * other tabs. This component only performs the hard navigation.
 */
export function LogoutMenuItem() {
  const store = useStore()
  const [logout, { isLoading }] = useLogoutMutation()
  const [error, setError] = useState<string | null>(null)

  const handleLogout = async () => {
    setError(null)
    const attempt = logout()
    // A newer auth attempt (or another tab) superseding this one must not navigate.
    const isLatest = () =>
      selectAuthSession(store.getState() as { authSession: AuthSessionState }).latestAttemptId === attempt.requestId
    try {
      await attempt.unwrap()
      if (!isLatest()) return
      hardNavigation.assign('/login')
    } catch (caught) {
      // Already logged out: the identity middleware has quarantined and dropped the
      // private caches for this attempt; only the hard navigation remains.
      if (getErrorStatus(caught) === 401) {
        if (!isLatest()) return
        hardNavigation.assign('/login')
        return
      }

      setError('Could not sign you out — try again.')
    }
  }

  return (
    <>
      <DropdownMenuItem disabled={isLoading} onClick={() => void handleLogout()}>
        {isLoading ? 'Signing out…' : 'Log out'}
      </DropdownMenuItem>
      {error && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
}
