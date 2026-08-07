import { cn } from '@/lib/utils'

/** A single field-level error message, styled to match the destructive
 * aria-invalid ring on `Input`/`Textarea`. */
export function FieldMessage({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

/** The form-level fallback banner `applyServerErrors` returns a string for
 * (an unmatched top-level `message`, or a non-422 failure). */
export function FormBanner({
  message,
  variant = 'destructive',
  className,
}: {
  message?: string | null
  variant?: 'destructive' | 'success'
  className?: string
}) {
  if (!message) return null
  return (
    <div
      role="status"
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        variant === 'destructive'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        className,
      )}
    >
      {message}
    </div>
  )
}
