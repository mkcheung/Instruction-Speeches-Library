import type { NavItem } from '@/lib/roles'
import type { WorkspaceSceneId } from './types'

type Activity = Exclude<WorkspaceSceneId, 'welcome'>

const destinations: Readonly<Record<string, Activity>> = {
  '/dashboard': 'reviews',
  '/speeches': 'speeches',
  '/reviewers': 'reviewers',
  '/speeches/new': 'upload',
  '/search': 'search',
  '/profile': 'edit',
  '/account': 'account',
  '/become-a-coach': 'coach',
}

/**
 * Match the installed NavLink's default case-insensitive pathname comparison.
 * In particular, an `end` link does not normalize a trailing slash. Callers
 * supply useLocation().pathname, so search/hash never enter this comparison.
 * Visibility and permissions belong entirely to the supplied nav inventory.
 */
export function activityForRoute(pathname: string, items: readonly NavItem[]): Activity | null {
  const current = pathname.toLowerCase()
  const active = items.filter((item) => {
    if (item.external) return false
    const target = item.to.toLowerCase()
    const boundary = target !== '/' && target.endsWith('/') ? target.length - 1 : target.length
    return current === target || (!item.end && current.startsWith(target) && current.charAt(boundary) === '/')
  })

  // Never invent a scene priority if a future inventory highlights two links.
  if (active.length !== 1) return null
  const destination = active[0].to.toLowerCase()
  return destinations[destination] ?? (/^\/u\/[^/]+$/.test(destination) ? 'profile' : null)
}
