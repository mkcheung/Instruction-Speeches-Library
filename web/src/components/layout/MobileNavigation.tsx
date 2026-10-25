import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useGetMeQuery } from '@/features/auth/authApi'
import { primaryNavItemsFor } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal,
  DropdownMenuPositioner, DropdownMenuPopup, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

/** Preserve primary navigation when the desktop sidebar collapses. */
export function MobileNavigation() {
  const { data } = useGetMeQuery()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])
  if (!data) return null
  return (
    <div className="shrink-0 md:hidden">
      <DropdownMenuRoot open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon" className="size-11" aria-label="Main navigation" />}>
          <Menu aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner align="start">
            <DropdownMenuPopup aria-label="Main navigation">
              {primaryNavItemsFor(data.user).map((item) => (
                <DropdownMenuItem key={item.to} render={item.external
                  ? <a href={item.to} rel="noreferrer" />
                  : <NavLink to={item.to} end={item.end} />}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>
  )
}
