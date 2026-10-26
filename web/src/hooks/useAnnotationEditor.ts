import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAnnotationChannel } from '@/hooks/useAnnotationChannel'
import { useCreateAnnotationMutation, useUpdateAnnotationMutation } from '@/features/annotation/annotationApi'
import { isAnnotationConflict, isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { newClientUuid, tmpAnnotationId } from '@/lib/uuid'
import { isDefinitiveAnnotationFailure } from '@/lib/annotationSaveOutcome'
import { captureAnnotationTime, formatAnnotationTime, parseAnnotationTime, validateAnnotationSelection } from '@/lib/annotationTiming'
import {
  clearAnnotationRecovery, discoverAnnotationRecovery, writeAnnotationRecovery,
  type AnnotationDraftFields, type AnnotationDraftScope, type AnnotationRecoveryRecord, type AnnotationSubmission,
} from '@/lib/annotationRecovery'

/** Retained for the caption/essay editors, whose own autosave contract is unchanged. */
export type AutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'offline'
export type AnnotationSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error' | 'uncertain'

export interface UseAnnotationEditorOptions {
  speechId: number
  reviewId: number
  userId?: string
  initial: Annotation | null
  videoEl: HTMLVideoElement | null
  durationMs?: number | null
  annotations?: readonly Annotation[]
  writable?: boolean
  autoPause?: boolean
  onLiveChange?: (live: Annotation) => void
  onLiveRemove?: (id: string) => void
  onCreated?: (annotation: Annotation) => void
  onSaved?: (annotation: Annotation) => void
  onSilentAdopt?: (annotation: Annotation) => void
  onPendingChange?: (instanceId: string, pending: boolean) => void
  onCancel?: () => void
}

function fieldsFromAnnotation(row: Annotation | null): AnnotationDraftFields {
  return row ? { start: formatAnnotationTime(Math.round(row.start_seconds * 1000)),
    end: formatAnnotationTime(Math.round(row.start_seconds * 1000) + Math.round(row.duration_seconds * 1000)), body: row.body }
    : { start: '', end: '', body: '' }
}
function equalFields(a: AnnotationDraftFields, b: AnnotationDraftFields): boolean {
  return a.start === b.start && a.end === b.end && a.body === b.body
}
function sameTiming(a: AnnotationDraftFields, b: AnnotationDraftFields): boolean {
  return parseAnnotationTime(a.start) === parseAnnotationTime(b.start) && parseAnnotationTime(a.end) === parseAnnotationTime(b.end)
}
function errorMessage(error: unknown): string {
  const failure = error as { status?: number | string; data?: { code?: string; message?: string; errors?: Record<string, string[]> } }
  if (failure.data?.code === 'annotation_overlap') return 'This time overlaps feedback in your review. Refresh the notes and choose a free segment.'
  if (failure.data?.code === 'annotation_busy') return 'Another change is in progress. Your draft is safe; retry the save.'
  if (failure.status === 401 || failure.status === 403) return 'Your review is no longer writable. Your draft remains available here.'
  if (failure.status === 410) return 'This speech has been deleted. Your draft remains available here.'
  if (failure.status === 404) return 'This note or review is unavailable. Your draft remains available here.'
  if (failure.status === 422) return Object.values(failure.data?.errors ?? {}).flat().join(' ') || failure.data?.message || 'Check the annotation fields and try again.'
  return 'The save outcome is uncertain. Retry the original save before changing or discarding this draft.'
}

/** Deliberate, local-first authoring. No debounce, implicit stamp or unload HTTP. */
export function useAnnotationEditor(options: UseAnnotationEditorOptions) {
  const { speechId, reviewId, userId, initial, durationMs = null, annotations, writable = true } = options
  const [instanceId] = useState(newClientUuid)
  const [clientUuid, setClientUuid] = useState(() => initial?.client_uuid ?? newClientUuid())
  const [fields, setFields] = useState(() => fieldsFromAnnotation(initial))
  const [baseline, setBaseline] = useState(() => fieldsFromAnnotation(initial))
  const [lockVersion, setLockVersion] = useState(initial?.lock_version ?? 0)
  const [saveState, setSaveState] = useState<AnnotationSaveState>(initial ? 'saved' : 'idle')
  const [conflict, setConflict] = useState<Annotation | null>(null)
  const [showBoth, setShowBoth] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState<AnnotationSubmission | null>(null)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [recoveries, setRecoveries] = useState<AnnotationRecoveryRecord[]>([])
  const onPendingChange = options.onPendingChange
  const scope = useMemo<AnnotationDraftScope | null>(() => userId ? { userId, speechId, reviewId, rowId: initial?.id ?? null } : null,
    [userId, speechId, reviewId, initial?.id])
  const optionsRef = useRef(options)
  const fieldsRef = useRef(fields)
  const baselineRef = useRef(baseline)
  const uuidRef = useRef(clientUuid)
  const versionRef = useRef(lockVersion)
  const revisionRef = useRef(0)
  const recoveryRef = useRef<AnnotationRecoveryRecord | null>(null)
  const uncertainRef = useRef<AnnotationSubmission | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => { optionsRef.current = options })
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const persist = useCallback((next: AnnotationDraftFields, submission: AnnotationSubmission | null = null) => {
    if (!scope) { setStorageAvailable(false); return }
    const record: AnnotationRecoveryRecord = { version: 2, scope, instanceId, clientUuid: uuidRef.current,
      revision: ++revisionRef.current, updatedAt: Date.now(), fields: next, lockVersion: versionRef.current, uncertain: submission }
    recoveryRef.current = record
    setStorageAvailable(writeAnnotationRecovery(record))
  }, [scope, instanceId])
  const clearOwnRecovery = useCallback(() => {
    if (recoveryRef.current) clearAnnotationRecovery(recoveryRef.current)
    recoveryRef.current = null
  }, [])
  const refreshRecoveries = useCallback(() => {
    setRecoveries(scope ? discoverAnnotationRecovery(scope).filter((record) => record.instanceId !== instanceId) : [])
  }, [scope, instanceId])
  useEffect(() => {
    // Synchronize the externally stored recovery index on mount/context change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshRecoveries()
    window.addEventListener('storage', refreshRecoveries)
    return () => window.removeEventListener('storage', refreshRecoveries)
  }, [refreshRecoveries])

  const dirty = !equalFields(fields, baseline)
  const pending = dirty || saveState === 'saving' || uncertain !== null || conflict !== null
  useEffect(() => { onPendingChange?.(instanceId, pending) }, [instanceId, pending, onPendingChange])
  useEffect(() => () => { optionsRef.current.onPendingChange?.(instanceId, false) }, [instanceId])
  useEffect(() => {
    if (!pending) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [pending])

  const validation = validateAnnotationSelection({ ...fields, durationMs, annotations, excludeId: initial?.id })
  const timingChanged = !sameTiming(fields, baseline)
  const bodyOnly = initial !== null && !timingChanged
  const canSubmit = Boolean(userId && writable && !conflict && saveState !== 'saving'
    && (uncertain || (dirty && (bodyOnly ? fields.body.trim() !== '' : validation.valid))))
  const id = initial?.id ?? tmpAnnotationId(clientUuid)

  const change = useCallback((field: keyof AnnotationDraftFields, value: string) => {
    if (busyRef.current || uncertainRef.current) return
    const next = { ...fieldsRef.current, [field]: value }
    fieldsRef.current = next
    setFields(next)
    setMessage(null)
    setSaveState('dirty')
    persist(next)
  }, [persist])
  const capture = useCallback((field: 'start' | 'end') => {
    const latest = optionsRef.current
    if (!latest.videoEl || busyRef.current || uncertainRef.current) return
    const time = captureAnnotationTime(latest.videoEl.currentTime, latest.durationMs ?? null, latest.videoEl.ended)
    if (time === null) { setMessage('The current video position is unavailable or outside the speech.'); return }
    latest.videoEl.pause()
    change(field, formatAnnotationTime(time))
  }, [change])
  const setToPlayhead = useCallback(() => capture('start'), [capture])

  const adopt = useCallback((remote: Annotation) => {
    const next = fieldsFromAnnotation(remote)
    fieldsRef.current = next; baselineRef.current = next; versionRef.current = remote.lock_version
    setFields(next); setBaseline(next); setLockVersion(remote.lock_version)
    setConflict(null); setSaveState('saved'); setMessage(null)
    clearOwnRecovery()
    optionsRef.current.onLiveRemove?.(remote.id)
    optionsRef.current.onSilentAdopt?.(remote)
  }, [clearOwnRecovery])
  const applyExternal = useCallback((remote: Annotation) => {
    if (remote.id !== optionsRef.current.initial?.id || busyRef.current || uncertainRef.current) return
    if (equalFields(fieldsRef.current, baselineRef.current)) adopt(remote)
    else { setConflict(remote); setSaveState('conflict') }
  }, [adopt])
  const broadcastSaved = useAnnotationChannel(reviewId, applyExternal)
  useEffect(() => {
    if (initial && initial.lock_version !== versionRef.current) applyExternal(initial)
  }, [initial, applyExternal])

  // Only valid selections enter the single shared preview. Invalid edits restore
  // the saved row instead of leaving a stale optimistic geometry behind.
  const previewStartMs = validation.geometry?.startMs
  const previewEndMs = validation.geometry?.endMs
  useEffect(() => {
    if (previewStartMs === undefined || previewEndMs === undefined || (!bodyOnly && !validation.valid) || !fields.body.trim() || (initial && isPointAnnotation(initial))) {
      optionsRef.current.onLiveRemove?.(id)
      return
    }
    optionsRef.current.onLiveChange?.({ ...(initial ?? { kind: 'observation', topic: null, voice: null }), id,
      timing_type: 'range', client_uuid: clientUuid, lock_version: lockVersion, body: fields.body,
      start_seconds: previewStartMs / 1000, duration_seconds: (previewEndMs - previewStartMs) / 1000 })
  }, [fields, validation.valid, previewStartMs, previewEndMs, bodyOnly, id, initial, clientUuid, lockVersion])

  const [createAnnotation] = useCreateAnnotationMutation()
  const [updateAnnotation] = useUpdateAnnotationMutation()
  const submit = useCallback(async () => {
    if (busyRef.current || !canSubmit) return
    const current = fieldsRef.current
    const unchanged = initial !== null && sameTiming(current, baselineRef.current)
    const startMs = parseAnnotationTime(current.start) ?? (unchanged ? Math.round(initial.start_seconds * 1000) : null)
    const endMs = parseAnnotationTime(current.end) ?? (unchanged ? Math.round(initial.start_seconds * 1000) + Math.round(initial.duration_seconds * 1000) : null)
    if (!uncertainRef.current && (startMs === null || endMs === null)) return
    const submission: AnnotationSubmission = uncertainRef.current ?? { clientUuid: uuidRef.current,
      annotationId: initial?.id ?? null, lockVersion: versionRef.current, fields: { ...current },
      startMs: startMs!, endMs: endMs!, timingChanged: !sameTiming(current, baselineRef.current) }
    const wasUncertain = uncertainRef.current !== null
    busyRef.current = true
    setSaveState('saving'); setMessage(null)
    persist(submission.fields, submission) // A reload during the request must reconcile this exact snapshot.
    const context = scope
    try {
      const saved = submission.annotationId === null
        ? await createAnnotation({ speechId, reviewId, body: { client_uuid: submission.clientUuid, body: submission.fields.body,
          start_seconds: submission.startMs / 1000, duration_seconds: (submission.endMs - submission.startMs) / 1000 } }).unwrap()
        : await updateAnnotation({ speechId, reviewId, annotationId: submission.annotationId,
          body: { lock_version: submission.lockVersion, body: submission.fields.body,
            ...(submission.timingChanged ? { start_seconds: submission.startMs / 1000,
              duration_seconds: (submission.endMs - submission.startMs) / 1000 } : {}) } }).unwrap()
      if (!mountedRef.current || optionsRef.current.userId !== context?.userId || optionsRef.current.reviewId !== reviewId
        || optionsRef.current.speechId !== speechId || (optionsRef.current.initial?.id ?? null) !== submission.annotationId) return
      if (saved.client_uuid !== submission.clientUuid || (submission.annotationId !== null && saved.id !== submission.annotationId)
        || saved.body !== submission.fields.body.trim() || Math.round(saved.start_seconds * 1000) !== submission.startMs
        || Math.round(saved.duration_seconds * 1000) !== submission.endMs - submission.startMs) {
        throw { status: 'ACK_MISMATCH' }
      }
      uncertainRef.current = null; setUncertain(null)
      versionRef.current = saved.lock_version; setLockVersion(saved.lock_version)
      // Laravel trims surrounding body whitespace. Adopt that acknowledged
      // canonical representation rather than treating it as an unknown save.
      const acknowledgedFields = fieldsFromAnnotation(saved)
      fieldsRef.current = acknowledgedFields; setFields(acknowledgedFields)
      baselineRef.current = acknowledgedFields; setBaseline(acknowledgedFields)
      setSaveState('saved'); clearOwnRecovery(); broadcastSaved(saved)
      optionsRef.current.onLiveRemove?.(id)
      optionsRef.current.onSaved?.(saved)
      if (submission.annotationId === null) optionsRef.current.onCreated?.(saved)
    } catch (error) {
      if (!mountedRef.current || optionsRef.current.userId !== context?.userId || optionsRef.current.reviewId !== reviewId
        || optionsRef.current.speechId !== speechId) return
      const failure = error as { status?: number | string; data?: unknown }
      if (failure.status === 409 && isAnnotationConflict(failure.data)) {
        uncertainRef.current = null; setUncertain(null)
        setConflict(failure.data.current); setSaveState('conflict'); persist(submission.fields)
      } else if (isDefinitiveAnnotationFailure(error, wasUncertain)) {
        uncertainRef.current = null; setUncertain(null)
        setSaveState('error'); setMessage(errorMessage(error)); persist(submission.fields)
      } else {
        uncertainRef.current = submission; setUncertain(submission)
        setSaveState('uncertain'); setMessage('The original save is still unresolved. Retry that same save when access is available; your draft is frozen to preserve its identity.'); persist(submission.fields, submission)
      }
    } finally { busyRef.current = false }
  }, [canSubmit, initial, scope, speechId, reviewId, createAnnotation, updateAnnotation, persist, clearOwnRecovery, broadcastSaved, id])

  const discard = useCallback(() => {
    if (busyRef.current || uncertainRef.current) return
    const next = fieldsFromAnnotation(optionsRef.current.initial)
    fieldsRef.current = next; baselineRef.current = next
    setFields(next); setBaseline(next); setConflict(null); setMessage(null)
    setSaveState(optionsRef.current.initial ? 'saved' : 'idle')
    clearOwnRecovery(); optionsRef.current.onLiveRemove?.(id); optionsRef.current.onCancel?.()
  }, [id, clearOwnRecovery])
  const keepMine = useCallback(() => {
    if (!conflict || busyRef.current) return
    versionRef.current = conflict.lock_version; setLockVersion(conflict.lock_version)
    baselineRef.current = fieldsFromAnnotation(conflict); setBaseline(baselineRef.current)
    setConflict(null); setSaveState('dirty'); persist(fieldsRef.current)
    setMessage('Your changes are ready for review. Click Save changes to submit them.')
  }, [conflict, persist])
  const useTheirs = useCallback(() => {
    if (!conflict || busyRef.current) return
    // Preserve the current record as a discoverable backup; create a new
    // revision only on a subsequent edit. Never remove a sibling tab's record.
    if (recoveryRef.current) writeAnnotationRecovery({ ...recoveryRef.current, instanceId: newClientUuid() })
    clearOwnRecovery()
    adopt(conflict); refreshRecoveries()
  }, [conflict, adopt, refreshRecoveries, clearOwnRecovery])
  const restore = useCallback((record: AnnotationRecoveryRecord) => {
    if (busyRef.current || uncertainRef.current || !equalFields(fieldsRef.current, baselineRef.current)) return
    uuidRef.current = record.clientUuid; setClientUuid(record.clientUuid)
    fieldsRef.current = record.fields; setFields(record.fields)
    versionRef.current = record.lockVersion; setLockVersion(record.lockVersion)
    uncertainRef.current = record.uncertain; setUncertain(record.uncertain)
    setSaveState(record.uncertain ? 'uncertain' : 'dirty'); setMessage(record.uncertain ? 'Retry the original save to resolve its outcome.' : null)
    persist(record.fields, record.uncertain)
  }, [persist])
  const discardRecovery = useCallback((record: AnnotationRecoveryRecord) => {
    clearAnnotationRecovery(record); refreshRecoveries()
  }, [refreshRecoveries])

  return { id, clientUuid, instanceId, fields, saveState, conflict, showBoth, message, dirty, pending,
    frozen: saveState === 'saving' || uncertain !== null, canSubmit, storageAvailable, recoveries,
    validation: bodyOnly ? { ...validation, valid: fields.body.trim() !== '', errors: {}, conflicts: [] } : validation,
    point: initial !== null && isPointAnnotation(initial),
    setBody: (body: string) => change('body', body), setStart: (start: string) => change('start', start),
    setEnd: (end: string) => change('end', end), captureStart: setToPlayhead,
    captureEnd: () => capture('end'), setToPlayhead, submit, discard, keepMine, useTheirs,
    toggleShowBoth: () => setShowBoth((value) => !value), restore, discardRecovery }
}
export type UseAnnotationEditorResult = ReturnType<typeof useAnnotationEditor>
