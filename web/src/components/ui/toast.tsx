import { Toast } from '@base-ui/react/toast'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Thin wrapper around `@base-ui/react`'s `toast` module — matching this
 * codebase's established pattern (`button.tsx`, `progress.tsx`,
 * `badge.tsx`) of styling base-ui primitives rather than hand-rolling a
 * toast system. `@base-ui/react` already ships this module as a dependency
 * (`web/package.json`), just unused until STEP-07's 6-second Undo toast.
 */
export const ToastProvider = Toast.Provider
export const useToastManager = Toast.useToastManager

/**
 * Mount ONE `<Toaster />` per `<ToastProvider>` — it renders every active
 * toast from `useToastManager()`. Callers add toasts imperatively via
 * `useToastManager().add({...})` from anywhere inside the same provider
 * (see the delete-then-Undo flow in `AnnotationList`).
 */
export function Toaster({ className }: { className?: string }) {
  const { toasts } = useToastManager()

  return (
    <Toast.Portal>
      <Toast.Viewport className={cn('fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2', className)}>
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className="rounded-lg border border-border bg-card p-3 text-sm text-card-foreground shadow-lg"
          >
            <Toast.Content className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <Toast.Title className="text-sm font-medium" />
                <Toast.Description className="text-xs text-muted-foreground" />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {toast.actionProps && (
                  <Toast.Action {...toast.actionProps} render={<Button type="button" size="xs" variant="outline" />} />
                )}
                <Toast.Close aria-label="Dismiss" render={<Button type="button" size="icon-xs" variant="ghost" />}>
                  ×
                </Toast.Close>
              </div>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  )
}
