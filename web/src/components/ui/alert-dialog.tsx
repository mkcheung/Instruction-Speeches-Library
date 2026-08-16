import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import type {
  AlertDialogBackdropProps,
  AlertDialogPopupProps,
  AlertDialogTitleProps,
  AlertDialogDescriptionProps,
  AlertDialogPortalProps,
} from '@base-ui/react/alert-dialog'
import { cn } from '@/lib/utils'

/**
 * Thin wrapper around `@base-ui/react`'s `alert-dialog` module — same
 * pattern as `toast.tsx`. `role="alertdialog"` comes from the primitive
 * itself; this file only adds styling and this codebase's naming
 * convention (`InviteReviewerDialog.tsx`'s comment notes there was no
 * dialog wrapper to match before this step — this is that wrapper, scoped
 * to the alert-dialog variant STEP-07 actually needs).
 */
export const AlertDialogRoot = AlertDialogPrimitive.Root
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger

export function AlertDialogBackdrop({ className, ...props }: AlertDialogBackdropProps) {
  return (
    <AlertDialogPrimitive.Backdrop
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  )
}

export function AlertDialogPopup({ className, ...props }: AlertDialogPopupProps) {
  return (
    <AlertDialogPrimitive.Popup
      className={cn(
        'fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg',
        className,
      )}
      {...props}
    />
  )
}

export function AlertDialogTitle({ className, ...props }: AlertDialogTitleProps) {
  return <AlertDialogPrimitive.Title className={cn('text-base font-semibold', className)} {...props} />
}

export function AlertDialogDescription({ className, ...props }: AlertDialogDescriptionProps) {
  return <AlertDialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export function AlertDialogPortal(props: AlertDialogPortalProps) {
  return <AlertDialogPrimitive.Portal {...props} />
}
