import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialogRoot, AlertDialogTrigger, AlertDialogPortal, AlertDialogBackdrop,
  AlertDialogPopup, AlertDialogTitle, AlertDialogDescription,
} from '@/components/ui/alert-dialog'

/** The destructive-confirmation shell. The caller owns all state: open, typed word, error and pending. */
export function ConfirmDialog({
  open, onOpenChange, trigger, testId, title, description, children,
  confirm, error, canConfirm, pending, actionLabel, pendingLabel, onCancel, onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Renders a destructive `sm` trigger; omit when the parent opens the dialog. */
  trigger?: { label: ReactNode; disabled?: boolean }
  testId: string
  title: ReactNode
  description: ReactNode
  children?: ReactNode
  /** Renders the "Type WORD to confirm" field when set. */
  confirm?: { word: string; inputId: string; value: string; onChange: (value: string) => void }
  error?: string | null
  canConfirm: boolean
  pending: boolean
  actionLabel: ReactNode
  pendingLabel: ReactNode
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <AlertDialogTrigger {...(trigger.disabled !== undefined ? { disabled: trigger.disabled } : {})}
          render={<Button type="button" variant="destructive" size="sm" />}>
          {trigger.label}
        </AlertDialogTrigger>
      )}
      <AlertDialogPortal>
        <AlertDialogBackdrop />
        <AlertDialogPopup data-testid={testId}>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {children}
          {confirm && (
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor={confirm.inputId}>
                Type <span className="font-mono font-semibold">{confirm.word}</span> to confirm
              </Label>
              <Input id={confirm.inputId} value={confirm.value}
                onChange={(event) => confirm.onChange(event.target.value)} autoComplete="off" />
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={!canConfirm || pending} onClick={onConfirm}>
              {pending ? pendingLabel : actionLabel}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialogPortal>
    </AlertDialogRoot>
  )
}
