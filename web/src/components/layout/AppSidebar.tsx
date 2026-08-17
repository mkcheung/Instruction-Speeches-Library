import { NavLink } from 'react-router-dom'
import { useGetMeQuery } from '@/features/auth/authApi'
import { navItemsFor, type NavItem } from '@/lib/roles'
import { cn } from '@/lib/utils'

/**
 * S1-S8 (PLAN-APP-HEADER.md) — the app's primary navigation. A `<nav>`
 * (not `<aside>`, S7: `<aside>` maps to the `complementary` role, which
 * would break `getByRole('navigation')`), `hidden lg:flex` (S5 — `lg` is
 * the deliberate breakpoint, not `md`), using the `--sidebar-*` tokens
 * already defined in `index.css` (D8/S7) and lucide icons (S7 — already a
 * dependency with zero imports before this).
 *
 * Reads `useGetMeQuery()` for roles — no new fetch, RTK Query dedupes
 * with the route guards' own subscription.
 */
export function AppSidebar() {
  const { data } = useGetMeQuery()
  const items = navItemsFor(data?.user)

  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-3 lg:flex"
    >
      {items.map((item) => (
        <SidebarLink key={item.to} item={item} />
      ))}
    </nav>
  )
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50',
          isActive && 'bg-sidebar-accent',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {item.label}
    </NavLink>
  )
}
