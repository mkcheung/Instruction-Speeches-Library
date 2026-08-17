import { Link } from 'react-router-dom'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { UserMenu } from '@/components/layout/UserMenu'

/**
 * D1/D7/D8/R2 (PLAN-APP-HEADER.md). `<header>` landmark, app name, bell,
 * user menu — no `<nav>` and no header links (S1: the sidebar is the nav
 * landmark). Static, not sticky (R2 — a sticky header would fight
 * fullscreen and the timeline strip on `SpeechWatch`). Narrow enough not
 * to need a hamburger at 375px: the display name truncates and hides
 * below `sm:` (D8), leaving the initials circle as the trigger.
 */
export function AppHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4">
      <Link to="/dashboard" className="min-w-0 truncate text-sm font-semibold">
        Instruction Speeches Library
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}
