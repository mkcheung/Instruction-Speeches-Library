import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { UseAnnotationEditorResult } from '@/hooks/useAnnotationEditor'
import { formatAnnotationTime } from '@/lib/annotationTiming'

/** Shared explicit form. Neither typing nor capture submits a request. */
export function AnnotationEditor({ editor, autoFocus, label, existing = false }: {
  editor: UseAnnotationEditorResult
  autoFocus?: boolean
  label: string
  existing?: boolean
}) {
  const formId = useId()
  const { fields, validation, frozen } = editor
  const showValidation = editor.dirty || editor.saveState === 'error' || editor.saveState === 'conflict'
  const length = validation.geometry ? validation.geometry.endMs - validation.geometry.startMs : null
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-3" aria-label={label} data-testid="annotation-editor">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span role="status" className="text-xs text-muted-foreground" data-testid="annotation-save-state" data-state={editor.saveState}>
          {editor.saveState === 'dirty' ? 'Not added or saved' : editor.saveState}
        </span>
      </div>
      {!editor.storageAvailable && <p role="alert" className="text-sm">Local recovery is unavailable. Keep this page open until you save or discard your draft.</p>}
      {editor.conflict && (
        <div role="alert" data-testid="conflict-banner" className="space-y-2 rounded-md border border-border p-2 text-sm">
          <p>This note changed elsewhere. Review both versions before saving.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={editor.keepMine}>Keep mine</Button>
            <Button type="button" size="sm" variant="outline" onClick={editor.useTheirs}>Use theirs</Button>
            <Button type="button" size="sm" variant="ghost" onClick={editor.toggleShowBoth}>{editor.showBoth ? 'Hide' : 'Show both'}</Button>
          </div>
          {editor.showBoth && <div className="grid gap-2 sm:grid-cols-2"><p>Yours: {fields.start}–{fields.end} {fields.body}</p><p>Theirs: {formatAnnotationTime(Math.round(editor.conflict.start_seconds * 1000))} {editor.conflict.body}</p></div>}
        </div>
      )}
      {!editor.point && <div className="grid gap-3 sm:grid-cols-2">
        {(['start', 'end'] as const).map((endpoint) => (
          <div key={endpoint} className="space-y-1">
            <Label htmlFor={`${formId}-${endpoint}`}>{endpoint === 'start' ? 'Start' : 'End'}</Label>
            <div className="flex flex-wrap gap-2">
              <Input id={`${formId}-${endpoint}`} type="text" inputMode="decimal" className="min-w-28 flex-1" placeholder={endpoint === 'start' ? '0:12.500' : '0:18.000'}
                value={fields[endpoint]} disabled={frozen} aria-invalid={showValidation && Boolean(validation.errors[endpoint])}
                aria-describedby={`${formId}-${endpoint}-help`} onChange={(event) => (endpoint === 'start' ? editor.setStart : editor.setEnd)(event.target.value)} />
              <Button type="button" variant="outline" disabled={frozen} aria-label={`Use current time for ${endpoint}`} onClick={endpoint === 'start' ? editor.captureStart : editor.captureEnd}>Use current time</Button>
            </div>
            <p id={`${formId}-${endpoint}-help`} className="text-xs text-muted-foreground">{(showValidation ? validation.errors[endpoint] : undefined) ?? 'Seconds or M:SS.mmm'}</p>
          </div>
        ))}
      </div>}
      {!editor.point && length !== null && <p className="text-xs text-muted-foreground">Length: {(length / 1000).toFixed(3)} seconds</p>}
      <Label htmlFor={`${formId}-body`}>{editor.point ? 'Transcript' : 'Commentary'}</Label>
      <Textarea id={`${formId}-body`} autoFocus={autoFocus} placeholder="Enter your commentary about this segment…" value={fields.body} rows={3}
        disabled={frozen} aria-invalid={showValidation && Boolean(validation.errors.body)} onChange={(event) => editor.setBody(event.target.value)} />
      {showValidation && validation.errors.body && <p className="text-sm text-muted-foreground">{validation.errors.body}</p>}
      {validation.errors.general && <p role="status" className="text-sm text-muted-foreground">{validation.errors.general}</p>}
      {validation.conflicts.length > 0 && <ul aria-label="Conflicting feedback" className="text-sm">
        {validation.conflicts.map((note) => <li key={note.id}>Feedback at {formatAnnotationTime(Math.round(note.start_seconds * 1000))}</li>)}
      </ul>}
      {editor.message && <p role="alert" className="text-sm text-[var(--color-danger)]">{editor.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!editor.canSubmit} onClick={() => void editor.submit()}>
          {editor.saveState === 'saving' ? 'Saving…' : editor.saveState === 'uncertain' ? 'Retry original save' : existing ? 'Save changes' : 'Add annotation'}
        </Button>
        <Button type="button" variant="outline" disabled={frozen} onClick={editor.discard}>{existing ? 'Cancel' : 'Discard new note'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{existing ? 'Saved changes to published feedback are visible to the speaker immediately.' : 'Only you can see added notes until you publish your feedback.'}</p>
      {editor.recoveries.length > 0 && <div className="space-y-2 border-t border-border pt-2" aria-label="Recoverable drafts">
        <p className="text-sm font-medium">Recoverable drafts</p>
        {editor.recoveries.map((record) => <div key={`${record.instanceId}:${record.clientUuid}:${record.revision}`} className="space-y-1 text-sm">
          <p>{new Date(record.updatedAt).toLocaleString()} · {record.fields.start || 'No start'}–{record.fields.end || 'No end'} · {record.fields.body.slice(0, 100)}</p>
          <Button type="button" size="sm" variant="outline" disabled={editor.pending || frozen} onClick={() => editor.restore(record)}>Restore draft</Button>{' '}
          <Button type="button" size="sm" variant="ghost" disabled={frozen || record.uncertain !== null} onClick={() => editor.discardRecovery(record)}>Discard recovered draft</Button>
        </div>)}
        <p className="text-xs text-muted-foreground">Restore a draft explicitly, then review its times before saving. Drafts from another tab are kept separately.</p>
      </div>}
    </section>
  )
}
