import { Outlet } from 'react-router-dom'
import { AppHeader } from '@/components/layout/AppHeader'
import { AppSidebar } from '@/components/layout/AppSidebar'

/**
 * D1/D8/S7 (PLAN-APP-HEADER.md) — the layout route `App.tsx` renders once
 * for all five authenticated routes: `min-h-svh flex flex-col`, a
 * visually-hidden skip link as the first focusable element (WCAG 2.4.1),
 * the header, then a `flex flex-1` row wrapper holding the sidebar `<nav>`
 * and `<main id="content" tabIndex={-1} className="flex-1 min-w-0">`
 * around the `<Outlet/>`.
 *
 * `min-w-0` on `<main>` is mandatory, not stylistic (S7 trap 1) — flex
 * items default to `min-width: auto`, so one long unbreakable string in an
 * annotation body would push the sidebar off-layout instead of wrapping.
 *
 * `tabIndex={-1}` on `<main>` is required, not decorative: a bare
 * `href="#content"` scrolls the page but does not move
 * `document.activeElement`, so without it the skip link is theatre and
 * any focus assertion fails.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <AppHeader />
      <div className="flex flex-1">
        <AppSidebar />
        {/* `flex flex-col` here (not just `flex-1`) is what lets R1's
            swept-out page wrappers use `flex-1` themselves instead of a
            percentage height — `<main>` has a definite height from being
            stretched by the row above (S7 trap 2's default
            `align-items: stretch`), and being a flex column in turn makes
            that height something a `flex-1` child can grow into. */}
        <main id="content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
