import { useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldMessage } from '@/components/ui/form-message'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'
import { cn } from '@/lib/utils'

/**
 * One profile detail that edits in place. The value is a button; clicking
 * it swaps in an input with Save and Cancel (Escape cancels). Client rules
 * run as you type and keep Save off. A server rejection, such as a taken
 * username or the 30-day rename limit, shows under the input and keeps the
 * editor open. Focus returns to the value once the editor closes.
 */
export function InlineField({
  label, value, emptyText, multiline = false, display = (current) => current,
  clean = (draft) => draft, error, hint, onSave, valueClassName,
}: {
  label: string
  value: string
  emptyText: string
  multiline?: boolean
  display?: (value: string) => ReactNode
  clean?: (draft: string) => string
  error: (draft: string) => string | null
  hint?: (draft: string) => ReactNode
  onSave: (value: string) => Promise<unknown>
  valueClassName?: string
}) {
  const inputId = useId()
  const hintId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const returnFocus = useRef(false)

  function focusValueOnReturn(node: HTMLButtonElement | null) {
    if (node && returnFocus.current) {
      returnFocus.current = false
      node.focus()
    }
  }

  function close() {
    returnFocus.current = true
    setDraft(null)
    setServerError(null)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (draft === null || saving || error(draft) || clean(draft) === value) return
    setSaving(true)
    setServerError(null)
    try {
      await onSave(clean(draft))
      close()
    } catch (failure) {
      setServerError(extractServerErrorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault()
      close()
    }
  }

  if (draft === null) {
    const shown = value ? display(value) : emptyText
    return (
      <button
        ref={focusValueOnReturn}
        type="button"
        aria-label={`Edit ${label.toLowerCase()}: ${typeof shown === 'string' ? shown : value}`}
        onClick={() => setDraft(value)}
        className={cn(
          'group inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-dashed border-transparent px-2.5 py-1 text-left',
          'hover:border-border hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          valueClassName,
        )}
      >
        <span className={cn('min-w-0 whitespace-pre-line break-words', !value && 'italic text-muted-foreground')}>{shown}</span>
        <Pencil aria-hidden="true" className="size-4 shrink-0 opacity-40 group-hover:opacity-100" />
      </button>
    )
  }

  const problem = error(draft)
  const message = problem ?? serverError
  const shared = {
    id: inputId,
    value: draft,
    autoFocus: true,
    'aria-invalid': Boolean(message),
    'aria-describedby': !message && hint ? hintId : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setServerError(null)
      setDraft(event.target.value)
    },
  }

  return (
    <form onSubmit={save} onKeyDown={cancelOnEscape} noValidate className="flex w-full flex-col gap-2 rounded-lg border border-border bg-muted p-3 text-left">
      <label htmlFor={inputId} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</label>
      {multiline ? <Textarea {...shared} rows={4} /> : <Input {...shared} />}
      <FieldMessage message={message ?? undefined} />
      {!message && hint && <p id={hintId} className="text-xs text-muted-foreground">{hint(draft)}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="workspace-notebook-control workspace-notebook-control--secondary" disabled={saving} onClick={close}>
          Cancel
        </Button>
        <Button type="submit" className="workspace-notebook-control workspace-notebook-control--primary" disabled={saving || Boolean(problem) || clean(draft) === value}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
