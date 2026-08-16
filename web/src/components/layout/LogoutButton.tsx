import { Button } from '@/components/ui/button'
import { useLogoutMutation } from '@/features/auth/authApi'

/**
 * Same standalone-widget precedent as `NotificationBell` (no shared
 * header/nav exists yet — any authenticated page mounts what it needs).
 *
 * A client-side `navigate('/login')` was tried first and produces a redirect
 * loop: `invalidatesTags: ['Me']` marks the cache stale but the revalidation
 * fetch hasn't resolved yet when `RequireGuest` mounts on `/login`, so it
 * briefly serves the pre-logout cached user, treats that as "still logged
 * in," and bounces to `/onboarding` — which then gets the real 401 and
 * bounces back. A full navigation sidesteps this entirely: it throws away
 * every RTK Query cache (not just the `Me` tag), so `/login` starts from
 * nothing instead of stale data.
 */
export function LogoutButton() {
  const [logout, { isLoading }] = useLogoutMutation()

  const handleLogout = async () => {
    await logout().unwrap()
    window.location.assign('/login')
  }

  return (
    <Button type="button" variant="outline" disabled={isLoading} onClick={handleLogout}>
      Log out
    </Button>
  )
}
