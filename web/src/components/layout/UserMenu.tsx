import { useState } from 'react'
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
import { useGetPublicProfileQuery } from '@/features/profile/profileApi'
import { colorFromId, hueFromId, COLOR_SATURATION, COLOR_LIGHTNESS } from '@/lib/colorFromId'
import { foregroundFor } from '@/lib/initialsContrast'
import { displayNameFor, initialsFor } from '@/lib/displayName'
import { navItemsFor } from '@/lib/roles'

function AccountAvatar({ url, initials, background, foreground }: {
  url: string | null
  initials: string
  background: string
  foreground: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return <span
    className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
    style={{ backgroundColor: background, color: foreground }}
    aria-hidden="true"
  >
    {url && url !== failedUrl
      ? <img src={url} alt="" className="size-full object-cover" onError={() => setFailedUrl(url)} />
      : initials}
  </span>
}

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
  // /api/me deliberately omits photos. Share the same cached profile query
  // as ProfileEdit so a successful avatar upload refreshes the header too.
  const username = data?.user.username
  const { currentData: profile } = useGetPublicProfileQuery(username ?? '', { skip: !username })

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
  const avatarUrl = profile && String(profile.id) === idString && profile.username === username
    ? profile.avatar_url : null
  const background = colorFromId(idString)
  const foreground = foregroundFor({
    h: hueFromId(idString),
    s: COLOR_SATURATION,
    l: COLOR_LIGHTNESS,
  })

  const navItems = navItemsFor(user)

  return (
    <DropdownMenuRoot modal={false}>
      {/* No `aria-label` here (there used to be one, `aria-label={name}`).
          axe's real baseline scan flagged this trigger for
          `label-content-name-mismatch` (WCAG 2.5.3) — confirmed by
          reproducing it in an isolated harness (fetch-mocked UserMenu,
          real axe-core/playwright scan) and bisecting: at the default
          1280px viewport the name span below IS visually rendered (well
          above the `sm` breakpoint), so the mismatch was never about the
          span being display:none — it was that an `aria-label` makes the
          browser's accessible-name algorithm skip the element's content
          entirely, so axe's "does the visible text appear in the
          accessible name" check fails even though the aria-label string
          and the visible text were identical; the `aria-hidden` avatar
          initials below are correctly excluded from both computations,
          confirmed by removing `aria-label` alone making the violation
          disappear at 1280px.
          But removing `aria-label` alone is NOT the full fix: at a real
          mobile viewport (375px) the name span used to be `hidden ...
          sm:inline` (display:none below `sm`), and the avatar is
          `aria-hidden` — so a narrow viewport then has NO accessible name
          at all, a CRITICAL `button-name` violation axe's default-viewport
          CI run would never catch (confirmed by re-scanning at 375px
          before this second fix). `sr-only sm:not-sr-only` replaces the
          `hidden sm:inline` toggle: the name text stays in the DOM and in
          the accessibility tree at every viewport (screen readers always
          get "Cora Coach"), it is only visually clipped below `sm` for
          layout, same pattern already used by AppLayout's skip link. */}
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
        <AccountAvatar key={idString} url={avatarUrl} initials={initials} background={background} foreground={foreground} />
        <span className="sr-only max-w-32 truncate sm:not-sr-only sm:inline">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner align="end">
          <DropdownMenuPopup>
            {/* PLAN-ADMIN-DASHBOARD.md §7 — this menu is the ONLY
                navigation below `md`, where `AppSidebar`'s rail is
                hidden, so an external item has to be handled here too or
                the admin panel is unreachable on a phone. `<Link>` is a
                React Router link and would resolve `/control-panel`
                against this SPA's router; an external destination needs a
                real anchor with an absolute href. See `NavItem.external`. */}
            {navItems.map((item) => (
              <DropdownMenuItem key={item.to} render={item.external ? <a href={item.to} rel="noreferrer" /> : <Link to={item.to} />}>
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
