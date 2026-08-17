import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import type { MenuPopupProps, MenuPositionerProps, MenuItemProps, MenuPortalProps } from '@base-ui/react/menu'
import { cn } from '@/lib/utils'

/**
 * Thin wrapper around `@base-ui/react`'s `menu` module — same pattern as
 * `alert-dialog.tsx`: styling only, no logic. D2 (PLAN-APP-HEADER.md):
 * `@base-ui/react@1.7.0` is already a dependency, so this adds no new
 * package, and the primitive supplies focus trapping, roving tabindex,
 * `Esc`-to-close and focus restoration for free — exactly demo-script
 * step 5.
 *
 * `MenuItem` (not `MenuLinkItem`) is used for navigation entries too, via
 * its `render` prop pointed at react-router's `Link` — same pattern
 * `Button` already uses (`render={<Link to="/dashboard" />}`) — because
 * `MenuLinkItem` renders a bare `<a>` with no router awareness.
 */
export const DropdownMenuRoot = MenuPrimitive.Root
export const DropdownMenuTrigger = MenuPrimitive.Trigger

export function DropdownMenuPortal(props: MenuPortalProps) {
  return <MenuPrimitive.Portal {...props} />
}

export function DropdownMenuPositioner({ className, ...props }: MenuPositionerProps) {
  return (
    <MenuPrimitive.Positioner className={cn('z-50 outline-none', className)} sideOffset={4} {...props} />
  )
}

export function DropdownMenuPopup({ className, ...props }: MenuPopupProps) {
  return (
    <MenuPrimitive.Popup
      className={cn(
        'z-50 min-w-40 rounded-lg border border-border bg-card p-1 text-card-foreground shadow-lg outline-none',
        'data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-[opacity,transform]',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuItem({ className, ...props }: MenuItemProps) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}
