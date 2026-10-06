import type { ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Top-level boundary — wraps the whole router in `App.tsx`. Catches
 * anything `RouteErrorBoundary` (inside `AppLayout`, see that file) can't:
 * `RootLayout`, `UnauthenticatedRedirect`, a `RequireAuth`/`RequireGuest`
 * guard, or any unauthenticated route (register/login/public profile/etc.)
 * that renders outside `AppLayout` entirely. If this one fires, the whole
 * app shell is gone, so the fallback is a real full page, not a card
 * dropped into a `<main>` that may not exist.
 *
 * Built on `@sentry/react`'s own `ErrorBoundary` rather than a hand-rolled
 * `componentDidCatch` — it already calls `Sentry.captureException` for us
 * (a no-op when `lib/sentry.ts` never called `Sentry.init`, i.e. no DSN
 * configured, so this is safe in every local dev setup) and is a plain
 * child component with no special interaction with React Router's data
 * router (`createBrowserRouter`/`useBlocker`) — confirmed by reading its
 * source: it renders children or the fallback, nothing router-aware.
 *
 * The fallback's action is a hard `window.location.reload()`, not
 * `resetError()` alone — `resetError()` only clears the boundary's local
 * state and re-renders the same tree, which re-throws immediately for any
 * error that isn't transient (e.g. a bad render from stale cached state).
 * A real reload is the one action that's guaranteed to actually recover.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={() => (
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
          <Card className="max-w-md text-left">
            <CardHeader>
              <CardTitle>Something went wrong</CardTitle>
              <CardDescription>
                This page hit an unexpected error. It's been reported — reloading usually
                clears it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => window.location.reload()}>Reload</Button>
            </CardContent>
          </Card>
        </main>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  )
}
