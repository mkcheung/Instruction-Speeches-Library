import { Link } from 'react-router-dom'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuPopup,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { LogoutMenuItem } from '@/components/layout/LogoutButton'
import { useGetMeQuery } from '@/features/auth/authApi'
import { colorFromId, hueFromId, COLOR_SATURATION, COLOR_LIGHTNESS } from '@/lib/colorFromId'
import { foregroundFor } from '@/lib/initialsContrast'
import { displayNameFor, initialsFor } from '@/lib/displayName'
import { navItemsFor } from '@/lib/roles'

/**
 * The identity chip and its menu (D2/D3/D4/D7). Reads `useGetMeQuery()`
 * itself — deliberately no props, so it can never be handed a stale user
 * (D5's whole "the layout only mounts for authenticated routes" guarantee
 * would be undermined by a header that could receive a cached user for a
 * different session).
 *
 * S1: duplicates the sidebar's nav links here too, because below `lg` the
 * sidebar is hidden and this menu is the only nav left — losing
 * navigation entirely on a phone would be a regression.
 */
export function UserMenu() {
  const { data } = useGetMeQuery()

  if (!data) return null

  const user = data.user
  const name = displayNameFor(user)
  const initials = initialsFor(user)
  // D3's `colorFromId(user.id)` trap: `hueFromId` reads `id.length`, so a
  // raw non-string id silently hashes to 0 for everyone. `user.id` is
  // already typed (and cast server-side to) `string`, but keying off
  // `String(user.id)` explicitly keeps this call site safe even if that
  // ever regresses.
  const idString = String(user.id)
  const background = colorFromId(idString)
  const foreground = foregroundFor({
    h: hueFromId(idString),
    s: COLOR_SATURATION,
    l: COLOR_LIGHTNESS,
  })

  const navItems = navItemsFor(user)

  return (
    <DropdownMenuRoot modal={false}>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={name}
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          style={{ backgroundColor: background, color: foreground }}
          aria-hidden="true"
        >
          {initials}
        </span>
        <span className="hidden max-w-32 truncate sm:inline">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner align="end">
          <DropdownMenuPopup>
            {navItems.map((item) => (
              <DropdownMenuItem key={item.to} render={<Link to={item.to} />}>
                {item.label}
              </DropdownMenuItem>
            ))}
            <div role="separator" className="my-1 h-px bg-border" />
            <LogoutMenuItem />
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  )
}
