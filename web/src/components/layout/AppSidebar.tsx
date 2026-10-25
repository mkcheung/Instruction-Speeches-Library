import { NavLink } from 'react-router-dom'
import { useGetMeQuery } from '@/features/auth/authApi'
import { primaryNavItemsFor, type NavItem } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { ActivityScene } from '@/components/workspace/ActivityScene'
import { useWorkspaceCompanionScene } from '@/components/workspace/useWorkspaceCompanion'

/**
 * S1-S8 (PLAN-APP-HEADER.md) — the app's primary navigation. A `<nav>`
 * (not `<aside>`, S7: `<aside>` maps to the `complementary` role, which
 * would break `getByRole('navigation')`), `hidden md:flex` (shown from
 * 768px, 224px wide and 256px at `xl`), using the `--sidebar-*` tokens
 * already defined in `index.css` (D8/S7) and lucide icons.
 *
 * Reads `useGetMeQuery()` for roles — no new fetch, RTK Query dedupes
 * with the route guards' own subscription.
 *
 * Shown from `md` (48rem) rather than S5's original `lg`: between 768px
 * and 1024px — a small laptop or a landscape tablet — there is ample room
 * for a 14rem rail. Below `md`, MobileNavigation carries these same primary
 * destinations. Account destinations stay in UserMenu at every viewport.
 *
 * The rail widens one step at `xl` so the nav keeps its proportion beside
 * content that now grows to fill a large window, instead of leaving a thin
 * column stranded next to it.
 */
export function AppSidebar() {
  const { data } = useGetMeQuery()
  const items = primaryNavItemsFor(data?.user)
  const scene = useWorkspaceCompanionScene()

  return (
    <nav
      aria-label="Main"
      className="workspace-sidebar hidden w-56 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-3 md:flex xl:w-64"
    >
      <div className="workspace-sidebar-links">
        {items.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </div>
      {scene && <ActivityScene scene={scene} variant="sidebar" />}
    </nav>
  )
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon

  // PLAN-ADMIN-DASHBOARD.md §7. `NavLink` is a React Router link: it
  // intercepts the click and resolves `to` against this SPA's own router,
  // which has no `/control-panel` route and would render the 404 page
  // inside the app shell. An external destination has to be a real anchor
  // with an absolute href so the browser performs a full navigation to
  // the other origin. `rel="noreferrer"` matters here specifically — the
  // panel is the highest-privilege origin in the system and there is no
  // reason to leak this page's URL to it as a Referer.
  if (item.external) {
    return (
      <a
        href={item.to}
        rel="noreferrer"
        className="workspace-sidebar-link flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Icon className="size-4 shrink-0" />
        {item.label}
      </a>
    )
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'workspace-sidebar-link flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50',
          isActive && 'bg-sidebar-accent',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {item.label}
    </NavLink>
  )
}
