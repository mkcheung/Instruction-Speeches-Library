import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import type {
  PopoverPopupProps,
  PopoverPositionerProps,
  PopoverPortalProps,
  PopoverTriggerProps,
} from '@base-ui/react/popover'
import { cn } from '@/lib/utils'

/**
 * Thin wrapper around `@base-ui/react`'s `popover` module — same pattern
 * as `alert-dialog.tsx` and `dropdown-menu.tsx`. D6 (PLAN-APP-HEADER.md):
 * rebuilds `NotificationBell`'s panel on this before it moves into the
 * global header, so it stops being a non-conformant disclosure widget
 * (bare `<div>`, no role, no focus handling, no `Esc`, no outside-click)
 * before that defect goes from one page to every page. `modal` defaults
 * to `false` on `PopoverRoot`, which is what's wanted here — a bell menu
 * should not scroll-lock the page.
 */
export const PopoverRoot = PopoverPrimitive.Root

export function PopoverTrigger({ className, ...props }: PopoverTriggerProps) {
  return <PopoverPrimitive.Trigger className={className} {...props} />
}

export function PopoverPortal(props: PopoverPortalProps) {
  return <PopoverPrimitive.Portal {...props} />
}

export function PopoverPositioner({ className, ...props }: PopoverPositionerProps) {
  return (
    <PopoverPrimitive.Positioner className={cn('z-50 outline-none', className)} sideOffset={8} {...props} />
  )
}

export function PopoverPopup({ className, ...props }: PopoverPopupProps) {
  return (
    <PopoverPrimitive.Popup
      className={cn(
        'z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-2 text-card-foreground shadow-lg outline-none',
        'data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-[opacity,transform]',
        className,
      )}
      {...props}
    />
  )
}
