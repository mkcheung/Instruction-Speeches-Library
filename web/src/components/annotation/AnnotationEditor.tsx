import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { UseAnnotationEditorResult } from '@/hooks/useAnnotationEditor'
import type { AnnotationKind } from '@/features/annotation/types'
import { formatSpokenTimecode, formatTimecode } from '@/lib/time'
import { cn } from '@/lib/utils'

const KINDS: AnnotationKind[] = ['praise', 'correction', 'observation']
const NUDGE_STEP_SECONDS = 0.5

/**
 * The shared textarea + nudge/duration controls + autosave-state word +
 * three-tier conflict banner (MODERNIZATION_PLAN.md §8.4/§10.2). Bound to
 * one `useAnnotationEditor` instance — `Composer` mounts one for a new
 * draft, `AnnotationRow` mounts one PER ROW when expanded in place. Never
 * shared state between the two, which is the whole point of §8.4's "never
 * loading a row back into the composer" rule.
 */
export function AnnotationEditor({
  editor,
  autoFocus,
  label,
}: {
  editor: UseAnnotationEditorResult
  autoFocus?: boolean
  /** e.g. "New note" vs. "Editing note" — purely a heading, no state. */
  label: string
}) {
  const { fields, autosaveState, conflict } = editor

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="annotation-editor">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span
          data-testid="autosave-state"
          data-state={autosaveState}
          className={cn(
            'text-xs',
            autosaveState === 'conflict' && 'text-[var(--color-danger)]',
            autosaveState === 'offline' && 'text-[var(--color-danger)]',
            autosaveState === 'saved' && 'text-[var(--color-success)]',
            (autosaveState === 'idle' || autosaveState === 'dirty' || autosaveState === 'saving') &&
              'text-muted-foreground',
          )}
        >
          {autosaveState}
        </span>
      </div>

      {editor.speechDeleted && (
        <div
          role="alert"
          data-testid="speech-deleted-banner"
          className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2 text-sm"
        >
          This speech has been deleted. Your draft is preserved below.
        </div>
      )}

      {conflict && (
        <div
          role="alert"
          data-testid="conflict-banner"
          className="flex flex-col gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2 text-sm"
        >
          <p>This note changed elsewhere. Your text is safe — pick how to continue.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={editor.keepMine}>
              Keep mine
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={editor.useTheirs}>
              Use theirs
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={editor.toggleShowBoth}>
              {editor.showBoth ? 'Hide' : 'Show both'}
            </Button>
          </div>
          {editor.showBoth && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded border border-border p-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Yours</p>
                <p className="text-sm">{fields.body}</p>
              </div>
              <div className="rounded border border-border p-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Theirs</p>
                <p className="text-sm">{conflict.body}</p>
              </div>
            </div>
          )}
        </div>
      )}

      <Textarea
        autoFocus={autoFocus}
        placeholder="Start typing — the timestamp stamps itself…"
        value={fields.body}
        rows={3}
        onBeforeInput={(e) => {
          const inputType = (e.nativeEvent as InputEvent).inputType
          editor.handleBeforeInput(inputType)
        }}
        onChange={(e) => editor.setBody(e.target.value)}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label>Timestamp</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Nudge start back half a second"
              disabled={fields.start_seconds === null}
              onClick={() => editor.nudgeStart(-NUDGE_STEP_SECONDS)}
            >
              ⟨
            </Button>
            <Input
              type="number"
              step={0.1}
              min={0}
              className="w-24"
              aria-label="Start time in seconds"
              value={fields.start_seconds ?? ''}
              disabled={fields.start_seconds === null}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (Number.isFinite(next)) editor.setStart(next)
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Nudge start forward half a second"
              disabled={fields.start_seconds === null}
              onClick={() => editor.nudgeStart(NUDGE_STEP_SECONDS)}
            >
              ⟩
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={editor.setToPlayhead}>
              Set to playhead
            </Button>
          </div>
          {fields.start_seconds !== null && (
            <span className="sr-only">Annotation at {formatSpokenTimecode(fields.start_seconds)}</span>
          )}
          {fields.start_seconds !== null && (
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              {formatTimecode(fields.start_seconds)}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label>Duration</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Shorten duration by half a second"
              onClick={() => editor.nudgeDuration(-NUDGE_STEP_SECONDS)}
            >
              ⟨
            </Button>
            <Input
              type="number"
              step={0.1}
              min={0.5}
              max={120}
              className="w-20"
              aria-label="Duration in seconds"
              value={fields.duration_seconds}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (Number.isFinite(next)) editor.setDuration(next)
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Extend duration by half a second"
              onClick={() => editor.nudgeDuration(NUDGE_STEP_SECONDS)}
            >
              ⟩
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`kind-${editor.id}`}>Kind</Label>
          <select
            id={`kind-${editor.id}`}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={fields.kind}
            onChange={(e) => editor.setKind(e.target.value as AnnotationKind)}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`topic-${editor.id}`}>Topic</Label>
          <Input
            id={`topic-${editor.id}`}
            className="w-32"
            placeholder="optional"
            value={fields.topic ?? ''}
            onChange={(e) => editor.setTopic(e.target.value || null)}
          />
        </div>
      </div>
    </div>
  )
}
