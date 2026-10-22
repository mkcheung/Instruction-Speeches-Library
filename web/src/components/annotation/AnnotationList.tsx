/**
 * Saved notes: the ONE authoritative, chronological, paged `ol` named "Your commentary",
 * together with its Saved notes heading/disclosure, the deletion/Undo coordinator and the
 * one-editor-at-a-time edit lock.
 *
 * ## Contract for the integrating panel (T4)
 *
 * Data boundary
 * - `annotations` is the COMPLETE server dataset. Paging is display-only (six per page);
 *   the full array is what feeds overlap validation (`AnnotationRow` -> `useAnnotationEditor`).
 *   Never pass a page slice. Sorting uses `compareByStartThenId`.
 *
 * Disclosure (panel owns the state; the list renders the heading + toggle + body)
 * - `open` / `onOpenChange`: controlled "Saved notes (N)" disclosure. The list renders
 *   `<hN><button aria-expanded aria-controls={bodyId}>Saved notes (N)</button></hN>` and a body
 *   `<div id={bodyId} hidden={!open}>`; both ids derive from the same `useId()` (optionally
 *   prefixed via `id`), so they are always coherent. The list/mutation owner stays mounted when
 *   folded: closed only sets `hidden` on the body. If `open` is omitted the list owns the state
 *   (`defaultOpen`, default false). The list calls `onOpenChange(true)` itself when a deliberate
 *   reveal needs the section open, and disables the toggle (while open) during any hold.
 * - `headingLevel` (default 3) picks the heading element.
 *
 * Active gate
 * - `active` (default true): false while outer Notes is not the selected reviewer tab. Pauses and
 *   unmounts any preview audio, never unmounts editors. Folded/paged-away/closed-detail rows also
 *   pause audio independently.
 *
 * Reveal / selection (timeline marker, Show selected note, etc.)
 * - `revealRequest: { id, token } | null`. `token` MUST be distinct for every deliberate request
 *   (monotonic counter); the same `id` with a new `token` reveals + refocuses again. A request is
 *   handled once per token. Resolution is against the latest complete set:
 *     * unknown id  -> visible/announced "That note is no longer available." and no stale details;
 *     * held by an open editor or in-flight delete/Undo/transcript-retry and the row is not on the
 *       currently displayed page -> DEFERRED: the id is retained, a visible message and an enabled-
 *       after-settle "Show selected note" button appear; nothing jumps automatically;
 *     * otherwise (a same-page row may be revealed during a hold): select the id, jump to its
 *       chronological page (not while held), expand its read-only details, call
 *       `onOpenChange(true)`, then focus that row's details toggle once the section is open.
 *   Never starts audio or an editor. `onRevealResult` reports `{ id, token, status }` with status
 *   'revealed' | 'deferred' | 'unavailable'. `onSelectedChange(id | null)` mirrors the selection.
 *
 * Saved-note reveal after a save
 * - `acknowledgedSave: { id, token } | null`: the panel passes the ID acknowledged by Composer
 *   `onSaved` or the VoiceRecorder acknowledgement callback (current session only). The list waits
 *   until the ID appears in the full dataset; if that row is not visible on the displayed page it
 *   shows "Note saved" + a "Show saved note" button (never auto-pages). Edits/Undo made inside the
 *   list are NOT acknowledged saves: they still arrive through `onSaved` as today.
 *
 * Reported state
 * - `onHoldChange({ editing, operating, locked })`: on mount and on every change. `editing` = a
 *   saved-row editor is open (any save state); `operating` = delete/Undo/transcript-retry in
 *   flight; `locked` = either. Holds are unioned by operation identity. The Undo toast window is
 *   NOT a hold, only the in-flight Undo request is.
 * - `onPendingChange(instanceId, pending)`: unchanged semantics. Editor instance ids pass straight
 *   through; the list adds `delete-<id>` / `undo-<id>` and the rows report
 *   `transcript-retry-<id>`, all releasing on unmount.
 * - `onSaved`, `onSilentAdopt`, `onLiveChange`, `onLiveRemove`, `onSeek`: unchanged; `onSeek` is
 *   fired by every row's "Go to time" button.
 *
 * Not handled here (left to the panel): tool tabs, timeline, creation state, which marker maps to
 * a reveal token, scope keying (the list resets all internal state when user/speech/review change),
 * outer-tab locks.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnnotationRow } from '@/components/annotation/AnnotationRow'
import { VoiceAnnotationRow } from '@/components/annotation/VoiceAnnotationRow'
import { Button } from '@/components/ui/button'
import { useToastManager } from '@/components/ui/toast'
import { useCreateAnnotationMutation, useDeleteAnnotationMutation, useRestoreVoiceAnnotationMutation, useRestorePointAnnotationMutation } from '@/features/annotation/annotationApi'
import { isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { formatAnnotationTime } from '@/lib/annotationTiming'
import { compareByStartThenId } from '@/lib/annotationOrder'
import { writeAnnotationRecovery } from '@/lib/annotationRecovery'
import { newClientUuid } from '@/lib/uuid'

const UNDO_TIMEOUT_MS = 6000
const PAGE_SIZE = 6
const RETRY_PREFIX = 'transcript-retry-'

export interface AnnotationRevealRequest { id: string; token: number }
export interface AnnotationRevealResult { id: string; token: number; status: 'revealed' | 'deferred' | 'unavailable' }
export interface AcknowledgedSave { id: string; token: number }
export interface SavedNotesHoldState { editing: boolean; operating: boolean; locked: boolean }

export interface AnnotationListProps {
  annotations: readonly Annotation[]
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  autoPause?: boolean
  userId?: string
  durationMs?: number | null
  currentId: string | null
  onSeek: (seconds: number) => void
  onLiveChange: (live: Annotation) => void
  onLiveRemove: (id: string) => void
  onSaved?: (annotation: Annotation) => void
  onSilentAdopt?: (annotation: Annotation) => void
  onPendingChange?: (id: string, pending: boolean) => void
  /** Controlled Saved notes disclosure. Omit for list-owned state. */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  headingLevel?: 2 | 3 | 4
  /** Optional DOM id prefix for the heading/toggle/body. */
  id?: string
  /** False while outer Notes is not selected: pauses preview audio. Defaults to true. */
  active?: boolean
  revealRequest?: AnnotationRevealRequest | null
  onRevealResult?: (result: AnnotationRevealResult) => void
  onSelectedChange?: (id: string | null) => void
  acknowledgedSave?: AcknowledgedSave | null
  onHoldChange?: (hold: SavedNotesHoldState) => void
}

interface HoldEntry { kind: 'edit' | 'delete' | 'undo' | 'retry'; rowId: string | null }
interface Snapshot { ids: string[]; objects: Map<string, Annotation> }
interface HoldState { entries: Map<string, HoldEntry>; snapshot: Snapshot | null }
const NO_HOLD: HoldState = { entries: new Map(), snapshot: null }

export function AnnotationList(props: AnnotationListProps) {
  return <SavedNotes key={`${props.userId ?? ''}:${props.speechId}:${props.reviewId}`} {...props} />
}

function rangeText(page: number, total: number): string {
  const first = page * PAGE_SIZE + 1
  return `Notes ${first}–${Math.min(total, first + PAGE_SIZE - 1)} of ${total} · Page ${page + 1} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`
}

function SavedNotes(props: AnnotationListProps) {
  const { annotations, speechId, reviewId, videoEl, autoPause, currentId, userId, durationMs, onSeek, onLiveChange, onLiveRemove, onSaved,
    onSilentAdopt, open, defaultOpen = false, onOpenChange, headingLevel = 3, active = true, revealRequest, onRevealResult,
    onSelectedChange, acknowledgedSave, onHoldChange } = props
  const baseId = useId()
  const prefix = props.id ?? `saved-notes-${baseId}`
  const toggleId = `${prefix}-toggle`
  const bodyId = `${prefix}-body`
  const [deleteAnnotation] = useDeleteAnnotationMutation()
  const [createAnnotation] = useCreateAnnotationMutation()
  const [restoreVoiceAnnotation] = useRestoreVoiceAnnotationMutation()
  const [restorePointAnnotation] = useRestorePointAnnotationMutation()
  const toastManager = useToastManager()
  const operations = useRef(new Set<string>())
  const latest = useRef(props)
  useEffect(() => { latest.current = props })

  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = open ?? internalOpen
  const setOpen = (value: boolean) => { setInternalOpen(value); onOpenChange?.(value) }
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deferred, setDeferred] = useState<AnnotationRevealRequest | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [dismissedSave, setDismissedSave] = useState<number | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string | null; seq: number } | null>(null)
  const [holdState, setHoldState] = useState<HoldState>(NO_HOLD)

  const sorted = useMemo(() => [...annotations].sort(compareByStartThenId), [annotations])
  const byId = useMemo(() => new Map(sorted.map((annotation) => [annotation.id, annotation])), [sorted])
  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const { entries, snapshot } = holdState
  const held = snapshot !== null
  const editing = [...entries.values()].some((entry) => entry.kind === 'edit')
  const operating = [...entries.values()].some((entry) => entry.kind !== 'edit')
  const holdRowIds = new Set([...entries.values()].map((entry) => entry.rowId).filter((value): value is string => value !== null))
  const editRowIds = new Set([...entries.values()].filter((entry) => entry.kind === 'edit').map((entry) => entry.rowId as string))
  const operatingRowIds = new Set([...entries.values()].filter((entry) => entry.kind !== 'edit' && entry.rowId !== null).map((entry) => entry.rowId as string))

  // Clamp the stored page back into range (never while a page is held), and drop selection/expansion/deferral for
  // rows that vanished from the full dataset and are not retained by a hold.
  if (!held && page !== safePage) setPage(safePage)
  const gone = (rowId: string) => !byId.has(rowId) && !holdRowIds.has(rowId)
  if (selectedId !== null && gone(selectedId)) setSelectedId(null)
  if (deferred !== null && gone(deferred.id)) setDeferred(null)
  if ([...expanded].some(gone)) setExpanded(new Set([...expanded].filter((rowId) => !gone(rowId))))

  // Keep the held snapshot's last-known objects current without freezing version/conflict updates.
  if (snapshot) {
    let objects: Map<string, Annotation> | null = null
    for (const rowId of snapshot.ids) {
      const current = byId.get(rowId)
      if (current && snapshot.objects.get(rowId) !== current) { objects ??= new Map(snapshot.objects); objects.set(rowId, current) }
    }
    if (objects) setHoldState({ entries, snapshot: { ids: snapshot.ids, objects } })
  }

  const missingIds = new Set<string>()
  const rows: Annotation[] = useMemo(() => {
    if (!snapshot) return sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
    const kept: Annotation[] = []
    for (const rowId of snapshot.ids) {
      const current = byId.get(rowId)
      if (current) kept.push(current)
      else if (holdRowIds.has(rowId) && snapshot.objects.has(rowId)) kept.push(snapshot.objects.get(rowId)!)
    }
    return kept.sort(compareByStartThenId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- holdRowIds derives from entries
  }, [snapshot, sorted, byId, safePage, entries])
  for (const row of rows) if (!byId.has(row.id)) missingIds.add(row.id)
  const displayedRef = useRef<Snapshot>({ ids: [], objects: new Map() })
  useLayoutEffect(() => { displayedRef.current = { ids: rows.map((row) => row.id), objects: new Map(rows.map((row) => [row.id, row])) } })

  const beginHold = useCallback((key: string, entry: HoldEntry) => {
    const displayed = displayedRef.current
    setHoldState((previous) => {
      if (previous.entries.has(key)) return previous
      return { entries: new Map(previous.entries).set(key, entry), snapshot: previous.snapshot ?? displayed }
    })
  }, [])
  const endHold = useCallback((key: string) => {
    setHoldState((previous) => {
      if (!previous.entries.has(key)) return previous
      const next = new Map(previous.entries); next.delete(key)
      return next.size === 0 ? NO_HOLD : { entries: next, snapshot: previous.snapshot }
    })
  }, [])

  const onHoldChangeRef = useRef(onHoldChange)
  useEffect(() => { onHoldChangeRef.current = onHoldChange })
  useEffect(() => { onHoldChangeRef.current?.({ editing, operating, locked: editing || operating }) }, [editing, operating])
  const onSelectedRef = useRef(onSelectedChange)
  useEffect(() => { onSelectedRef.current = onSelectedChange })
  useEffect(() => { onSelectedRef.current?.(selectedId) }, [selectedId])

  // ---- pending forwarding + holds -------------------------------------------------------
  useEffect(() => () => { for (const id of operations.current) latest.current.onPendingChange?.(id, false) }, [])
  const mark = useCallback((id: string, pending: boolean) => {
    if (pending) operations.current.add(id); else operations.current.delete(id)
    latest.current.onPendingChange?.(id, pending)
  }, [])
  const handlePending = useCallback((id: string, pending: boolean) => {
    latest.current.onPendingChange?.(id, pending)
    if (id.startsWith(RETRY_PREFIX)) {
      if (pending) beginHold(id, { kind: 'retry', rowId: id.slice(RETRY_PREFIX.length) }); else endHold(id)
    }
  }, [beginHold, endHold])
  const handleEditingChange = useCallback((id: string, isEditing: boolean) => {
    const key = `edit-${id}`
    if (isEditing) beginHold(key, { kind: 'edit', rowId: id }); else endHold(key)
  }, [beginHold, endHold])

  // ---- focus ----------------------------------------------------------------------------
  const summaries = useRef(new Map<string, HTMLButtonElement>())
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const focusedRowRef = useRef<string | null>(null)
  const focusSeq = useRef(0)
  const handledFocus = useRef(0)
  const registerSummary = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) summaries.current.set(id, element); else summaries.current.delete(id)
  }, [])
  useEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest.seq || !isOpen) return
    let element: HTMLElement | null | undefined = focusRequest.id === null ? toggleRef.current : summaries.current.get(focusRequest.id)
    // A disabled details toggle (row being edited or busy) cannot take focus: fall back to the row itself.
    if (element instanceof HTMLButtonElement && element.disabled) element = element.closest<HTMLElement>('li[data-annotation-id]')
    if (!element) return
    handledFocus.current = focusRequest.seq
    element.focus()
    element.scrollIntoView?.({ block: 'nearest' })
  }, [focusRequest, isOpen, rows])
  const requestFocus = (id: string | null) => setFocusRequest({ id, seq: ++focusSeq.current })

  // ---- reveal ---------------------------------------------------------------------------
  const reveal = (request: AnnotationRevealRequest) => {
    const report = (status: AnnotationRevealResult['status']) => onRevealResult?.({ ...request, status })
    if (!byId.has(request.id)) {
      setDeferred(null); setSelectedId(null); setUnavailable(true)
      setAnnouncement(''); report('unavailable')
      return
    }
    setUnavailable(false)
    setSelectedId(request.id)
    const visibleNow = rows.some((row) => row.id === request.id)
    if (held && !visibleNow) {
      setDeferred(request)
      setAnnouncement(editing ? 'Save or cancel this edit, then show the selected note.' : 'Wait for the current operation, then show the selected note.')
      report('deferred')
      return
    }
    setDeferred(null)
    if (!held) setPage(Math.floor(sorted.findIndex((annotation) => annotation.id === request.id) / PAGE_SIZE))
    setExpanded((previous) => new Set(previous).add(request.id))
    if (!isOpen) setOpen(true)
    requestFocus(request.id)
    setAnnouncement(`Showing selected note at ${formatAnnotationTime(Math.round(byId.get(request.id)!.start_seconds * 1000))}.`)
    report('revealed')
  }
  const handledToken = useRef<number | null>(null)
  useEffect(() => {
    if (!revealRequest || handledToken.current === revealRequest.token) return
    handledToken.current = revealRequest.token
    reveal(revealRequest)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gated by token; reveal reads the latest render
  }, [revealRequest])
  const internalToken = useRef(0)
  const revealNow = (id: string) => reveal({ id, token: -(++internalToken.current) })

  // ---- delete / Undo --------------------------------------------------------------------
  const recoverDeletedText = useCallback((annotation: Annotation) => {
    if (!userId || isPointAnnotation(annotation)) return
    writeAnnotationRecovery({ version: 2, scope: { userId, speechId, reviewId, rowId: null }, instanceId: newClientUuid(),
      clientUuid: annotation.client_uuid, revision: 1, updatedAt: Date.now(), lockVersion: 0, uncertain: null,
      fields: { start: formatAnnotationTime(Math.round(annotation.start_seconds * 1000)),
        end: formatAnnotationTime(Math.round(annotation.start_seconds * 1000) + Math.round(annotation.duration_seconds * 1000)), body: annotation.body } })
    window.dispatchEvent(new Event('storage'))
  }, [userId, speechId, reviewId])
  const handleDelete = useCallback(async (annotation: Annotation) => {
    const deleteKey = `delete-${annotation.id}`
    if (operations.current.has(deleteKey)) return
    const order = displayedRef.current.ids
    const index = order.indexOf(annotation.id)
    const nextId = index < 0 ? null : (order[index + 1] ?? order[index - 1] ?? null)
    const hadFocus = focusedRowRef.current === annotation.id
    mark(deleteKey, true); beginHold(deleteKey, { kind: 'delete', rowId: annotation.id })
    try {
      await deleteAnnotation({ speechId, reviewId, annotationId: annotation.id }).unwrap()
      latest.current.onLiveRemove(annotation.id)
      setExpanded((previous) => { if (!previous.has(annotation.id)) return previous; const next = new Set(previous); next.delete(annotation.id); return next })
      setSelectedId((previous) => (previous === annotation.id ? null : previous))
      setDeferred((previous) => (previous?.id === annotation.id ? null : previous))
      if (hadFocus) setFocusRequest({ id: nextId, seq: ++focusSeq.current })
      let undoStatus: 'idle' | 'pending' | 'done' = 'idle'
      toastManager.add({ title: isPointAnnotation(annotation) ? 'Voice note deleted' : 'Note deleted', timeout: UNDO_TIMEOUT_MS,
        actionProps: { children: 'Undo', onClick: () => {
          if (undoStatus !== 'idle') return
          undoStatus = 'pending'
          const undoKey = `undo-${annotation.id}`; mark(undoKey, true); beginHold(undoKey, { kind: 'undo', rowId: null })
          const request = isPointAnnotation(annotation)
            ? (annotation.voice === null ? restorePointAnnotation : restoreVoiceAnnotation)({ speechId, reviewId, annotationId: annotation.id })
            : createAnnotation({ speechId, reviewId, body: { client_uuid: annotation.client_uuid, body: annotation.body,
              start_seconds: annotation.start_seconds, duration_seconds: annotation.duration_seconds, kind: annotation.kind, topic: annotation.topic } })
          void request.unwrap().then((saved) => { undoStatus = 'done'; latest.current.onSaved?.(saved) }).catch((error: unknown) => {
            undoStatus = 'idle'; recoverDeletedText(annotation)
            const overlap = (error as { data?: { code?: string } })?.data?.code === 'annotation_overlap'
            toastManager.add({ title: 'Could not undo', description: overlap ? 'That position is now occupied. Your written text is available under Recoverable drafts.' : 'Try again. Written text is retained under Recoverable drafts.', timeout: 8000 })
          }).finally(() => { mark(undoKey, false); endHold(undoKey) })
        } } })
    } catch {
      toastManager.add({ title: 'Could not delete', description: 'Refresh feedback and try again.', timeout: 4000 })
    } finally { mark(deleteKey, false); endHold(deleteKey) }
  }, [mark, beginHold, endHold, deleteAnnotation, speechId, reviewId, toastManager, restorePointAnnotation, restoreVoiceAnnotation, createAnnotation, recoverDeletedText])

  // ---- paging ---------------------------------------------------------------------------
  const go = (delta: -1 | 1) => {
    const next = safePage + delta
    if (held || next < 0 || next >= pageCount) return
    setPage(next)
    if (acknowledgedSave) setDismissedSave(acknowledgedSave.token)
    setAnnouncement(rangeText(next, total))
  }
  const onExpandedChange = useCallback((id: string, value: boolean) => {
    setExpanded((previous) => {
      if (previous.has(id) === value) return previous
      const next = new Set(previous); if (value) next.add(id); else next.delete(id)
      return next
    })
  }, [])

  const missingCount = [...missingIds].filter((rowId) => editRowIds.has(rowId)).length
  const heldShown = rows.length - missingCount
  const holdReason = editing ? 'Save or cancel this edit to change pages.' : 'Wait for the current operation to finish to change pages.'
  const visibleIds = new Set(rows.map((row) => row.id))
  const currentOffPage = isOpen && currentId !== null && byId.has(currentId) && !visibleIds.has(currentId)
  const savedOffPage = acknowledgedSave && dismissedSave !== acknowledgedSave.token && byId.has(acknowledgedSave.id)
    && !(isOpen && visibleIds.has(acknowledgedSave.id)) ? acknowledgedSave : null
  const Heading = `h${headingLevel}` as 'h3'
  const toggleLocked = isOpen && held
  const canRevealDeferred = deferred !== null && !held
  const rowKey = (annotation: Annotation) => annotation.id

  return <div className="flex flex-col gap-2">
    <Heading className="text-base font-medium">
      <button ref={toggleRef} id={toggleId} type="button" aria-expanded={isOpen} aria-controls={bodyId} disabled={toggleLocked}
        className="min-h-11 text-left" onClick={() => setOpen(!isOpen)}>Saved notes ({total})</button>
    </Heading>
    <div className="flex flex-col gap-1">
      <p role="status" className="sr-only">{announcement}</p>
      {total === 0 && <p className="text-sm text-muted-foreground">No saved notes yet.</p>}
      {unavailable && <p role="status" className="text-sm">That note is no longer available.</p>}
      {deferred && <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
        <span>{editing ? 'Save or cancel this edit, then show the selected note.' : operating ? 'Wait for the current operation, then show the selected note.' : 'A note was selected.'}</span>
        <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={!canRevealDeferred}
          onClick={() => revealNow(deferred.id)}>Show selected note</Button>
      </div>}
      {savedOffPage && <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
        <span>Note saved.</span>
        <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={held}
          onClick={() => { setDismissedSave(savedOffPage.token); revealNow(savedOffPage.id) }}>Show saved note</Button>
        <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setDismissedSave(savedOffPage.token)}>Dismiss</Button>
      </div>}
    </div>
    <div id={bodyId} hidden={!isOpen} className="flex flex-col gap-2">
      {currentOffPage && <div>
        <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={held} onClick={() => revealNow(currentId!)}>Show current note</Button>
      </div>}
      {total > 0 && (pageCount > 1 || missingCount > 0) && <nav aria-label="Saved notes pages" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="tabular-nums">{held
          ? `Editing page held · ${heldShown} saved ${heldShown === 1 ? 'note' : 'notes'} shown · ${total} saved total`
          : rangeText(safePage, total)}</span>
        {missingCount > 0 && <span>{missingCount} unavailable {missingCount === 1 ? 'note' : 'notes'} being edited</span>}
        {pageCount > 1 && <>
          <Button type="button" size="sm" variant="outline" className="min-h-11 min-w-11 aria-disabled:opacity-50" disabled={held}
            aria-disabled={safePage === 0 ? true : undefined} onClick={() => go(-1)}>Previous</Button>
          <Button type="button" size="sm" variant="outline" className="min-h-11 min-w-11 aria-disabled:opacity-50" disabled={held}
            aria-disabled={safePage >= pageCount - 1 ? true : undefined} onClick={() => go(1)}>Next</Button>
        </>}
        {held && <span role="status">{holdReason}</span>}
      </nav>}
      {total > 0 && <ol className="flex flex-col gap-2" aria-label="Your commentary"
        onFocusCapture={(event) => { focusedRowRef.current = (event.target as HTMLElement).closest('li[data-annotation-id]')?.getAttribute('data-annotation-id') ?? null }}
        onBlurCapture={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) focusedRowRef.current = null }}>
        {rows.map((annotation) => {
          const common = {
            annotation, isCurrent: annotation.id === currentId, isSelected: annotation.id === selectedId, expanded: expanded.has(annotation.id),
            onExpandedChange, onSeek, onDelete: handleDelete, editBlocked: held, busy: operatingRowIds.has(annotation.id),
            unavailable: missingIds.has(annotation.id) && editRowIds.has(annotation.id), onEditingChange: handleEditingChange, registerSummary,
            position: held ? undefined : { index: sorted.indexOf(annotation), total },
          }
          return isPointAnnotation(annotation)
            ? <VoiceAnnotationRow key={rowKey(annotation)} {...common} speechId={speechId} reviewId={reviewId} userId={userId}
              audioActive={active && isOpen} onPendingChange={handlePending} />
            : <AnnotationRow key={rowKey(annotation)} {...common} speechId={speechId} reviewId={reviewId} userId={userId}
              videoEl={videoEl} autoPause={autoPause} annotations={annotations} durationMs={durationMs}
              onLiveChange={onLiveChange} onLiveRemove={onLiveRemove} onSaved={onSaved} onSilentAdopt={onSilentAdopt} onPendingChange={handlePending} />
        })}
      </ol>}
    </div>
  </div>
}
