import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { FieldMessage } from '@/components/ui/form-message'

/** A labelled control with its field-level error underneath. The control keeps its own id and aria-invalid. */
export function FormField({ id, label, error, children }: { id: string; label: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <FieldMessage message={error} />
    </div>
  )
}
