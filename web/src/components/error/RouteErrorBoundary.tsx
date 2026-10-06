import type { ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageShell } from '@/components/layout/PageShell'

/**
 * Wraps `<Outlet/>` inside `AppLayout` (not each individual route) — a
 * crash anywhere under the five authenticated routes it hosts (dashboard,
 * speech list/create/watch, profile, account, reviewers, search) is caught
 * here instead of taking down `AppHeader`/`AppSidebar` with it. Placed at
 * this one seam rather than per-route: `SpeechWatch.tsx` (the video
 * annotation overlay — 600+ lines, this app's most complex screen) is the
 * route most likely to actually need this, but every sibling route shares
 * the same header+sidebar shell worth protecting, and a boundary per route
 * would be the same code N times for no additional safety — `AppLayout`'s
 * own `<main>`/`<Outlet/>` split is already exactly the "main content
 * area vs. navigation" line STEP-14 asks to preserve.
 *
 * Visual/copy convention matches `SpeechWatch.tsx`'s own access-denied
 * state (PLAN-ACCESS-DENIED-STATES.md): `PageShell` + `Card` +
 * `CardContent`, `role="alert"` and `text-destructive` because this *is*
 * the genuine-failure case (as opposed to that file's muted
 * permission/absence states), and `Button render={<Link/>}` as the
 * repo's one button-as-link idiom.
 *
 * "Try again" calls `resetError()` — a plain remount of the subtree,
 * which recovers anything transient (e.g. a crash caused by a stale Redux
 * selector result that a fresh render reads past). It deliberately does
 * NOT reload the whole page, unlike `AppErrorBoundary`'s fallback — if the
 * crash was route-local, a full reload is a bigger hammer than necessary.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <PageShell width="content">
          <Card>
            <CardContent
              role="alert"
              className="flex flex-col items-start gap-3 py-6 text-sm text-destructive"
            >
              <p>This page hit an unexpected error. It's been reported.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={resetError}>
                  Try again
                </Button>
                <Button size="sm" variant="outline" render={<Link to="/dashboard" />}>
                  Back to dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </PageShell>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  )
}
