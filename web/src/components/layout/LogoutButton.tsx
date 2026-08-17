import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useLogoutMutation, authApi } from '@/features/auth/authApi'
import { profileApi } from '@/features/profile/profileApi'
import { getErrorStatus } from '@/lib/errorStatus'
import type { AppDispatch } from '@/app/store'

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
 * The 401 branch used to race `UnauthenticatedRedirect`: `baseQuery.ts`
 * dispatches `auth:unauthenticated` synchronously inside the failing
 * request, strictly before this `catch` block ever runs, so resetting the
 * caches *here* was always a beat too late — `UnauthenticatedRedirect`'s
 * own listener now does the reset itself, before it navigates, which is
 * the only place that can actually win the race. The dispatches below are
 * now redundant-but-harmless defense in depth, not the fix.
 */
export function LogoutMenuItem() {
  const [logout, { isLoading }] = useLogoutMutation()
  const dispatch = useDispatch<AppDispatch>()
  const [error, setError] = useState<string | null>(null)

  const handleLogout = async () => {
    setError(null)
    try {
      await logout().unwrap()
      window.location.assign('/login')
    } catch (caught) {
      if (getErrorStatus(caught) === 401) {
        dispatch(authApi.util.resetApiState())
        dispatch(profileApi.util.resetApiState())
        window.location.assign('/login')
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
