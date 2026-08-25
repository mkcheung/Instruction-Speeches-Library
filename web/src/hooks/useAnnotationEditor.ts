import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '@/lib/api'
import { readXsrfCookie } from '@/lib/csrf'
import { newClientUuid, tmpAnnotationId, isTmpAnnotationId } from '@/lib/uuid'
import {
  backupDiscardedDraft,
  clearDraftMirror,
  writeDraftMirror,
} from '@/lib/annotationDraftStorage'
import { useAnnotationChannel } from '@/hooks/useAnnotationChannel'
import { useCreateAnnotationMutation, useUpdateAnnotationMutation } from '@/features/annotation/annotationApi'
import { isAnnotationConflict, type Annotation, type AnnotationKind } from '@/features/annotation/types'
import { annotationFieldsEqual as fieldsEqual } from '@/lib/annotationFields'

/** MODERNIZATION_PLAN.md §10.2: "Render the autosave state… as ONE WORD
 * near the textarea… and that attribute is also the primary E2E test
 * hook." */
export type AutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'offline'

interface EditorFields {
  body: string
  /** `null` until the timestamp is stamped (§8.4's `onBeforeInput` rule) —
   * a brand-new draft has no start time until the coach actually types. */
  start_seconds: number | null
  duration_seconds: number
  kind: AnnotationKind
  topic: string | null
}

const DEFAULT_DURATION_SECONDS = 6
/** §8.4: "Debounced autosave (750 ms) as a draft." */
const BODY_DEBOUNCE_MS = 750
/** §8.4: "Debounce the mutation at 300 ms so a held arrow key doesn't emit
 * twenty PATCHes." */
const NUDGE_DEBOUNCE_MS = 300
/** Backend's own CHECK constraint (STEP-06-RETROSPECTIVE.md: `duration_seconds
 * NUMERIC(6,3)`, `CHECK duration_seconds > 0 AND duration_seconds <= 120`). */
const MAX_DURATION_SECONDS = 120
const MIN_DURATION_SECONDS = 0.5

function fieldsFromAnnotation(a: Annotation): EditorFields {
  return {
    body: a.body,
    start_seconds: a.start_seconds,
    duration_seconds: a.duration_seconds,
    kind: a.kind,
    topic: a.topic,
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export interface UseAnnotationEditorOptions {
  speechId: number
  reviewId: number
  /** `null` starts a brand-new draft; an existing row edits it in place —
   * per-row local state, never the composer's create-form state (§8.4:
   * "never loading a row back into the composer… where the legacy
   * `legacy/editNote.php` went wrong"). */
  initial: Annotation | null
  videoEl: HTMLVideoElement | null
  /** Per-user preference (§8.4) — pauses the instant the timestamp
   * stamps, not on every keystroke after. */
  autoPause: boolean
  /** Fires on every LIVE (not-yet-flushed) field change so the panel can
   * merge this row's current state into the ONE shared
   * `useTimedAnnotations` cues array for the live preview — never a
   * second engine instance (the frozen contract is explicit about this). */
  onLiveChange?: (live: Annotation) => void
  /** Fires once, the moment a brand-new draft gets its first real server
   * id — lets the composer swap to a fresh blank draft for the next note. */
  onCreated?: (annotation: Annotation) => void
  /** Fires on every successful save (create or update). */
  onSaved?: (annotation: Annotation) => void
  /** A conflict resolved without the user ever seeing a banner (the ~90%
   * case) — small toast, never a modal. */
  onSilentAdopt?: (annotation: Annotation) => void
}

export interface UseAnnotationEditorResult {
  id: string
  clientUuid: string
  isNew: boolean
  fields: EditorFields
  autosaveState: AutosaveState
  /** The OTHER side's current row, only set while a dirty-editor conflict
   * is unresolved. §10.2: "never a blocking modal" — this is a banner, not
   * a dialog, by construction (it's just data the caller renders inline). */
  conflict: Annotation | null
  /** True once a save has come back 410 Gone — the speech was deleted
   * mid-annotation. The local text is unaffected; this only drives the
   * "your draft is preserved below" messaging. */
  speechDeleted: boolean
  showBoth: boolean
  toggleShowBoth: () => void
  setBody: (body: string) => void
  setKind: (kind: AnnotationKind) => void
  setTopic: (topic: string | null) => void
  setStart: (seconds: number) => void
  nudgeStart: (deltaSeconds: number) => void
  setDuration: (seconds: number) => void
  nudgeDuration: (deltaSeconds: number) => void
  setToPlayhead: () => void
  /** Guarded on `inputType.startsWith('insert')` — §8.4's `onBeforeInput`
   * rule. Covers IME/paste, not Tab/arrows/deletions. */
  handleBeforeInput: (inputType: string | null | undefined) => void
  keepMine: () => void
  useTheirs: () => void
}

/**
 * The composer's per-row state machine (MODERNIZATION_PLAN.md §8.4/§10.1
 * /§10.2). One instance per row being authored — the brand-new draft in
 * `Composer`, and each existing row's in-place editor in `AnnotationRow` —
 * never shared, so two edits in flight never fight over one piece of
 * state.
 */
export function useAnnotationEditor(options: UseAnnotationEditorOptions): UseAnnotationEditorResult {
  const { speechId, reviewId, initial, videoEl, autoPause } = options

  // `clientUuid` is genuinely-needed AT RENDER time (the returned result,
  // JSX keys, etc.), so it's real state seeded once from a lazy
  // initializer — never a ref. The React Compiler's lint forbids reading
  // or writing a ref's `.current` anywhere in the render body (only inside
  // effects/callbacks is allowed), which a ref here would violate on
  // every render via the final `return`.
  const [clientUuid] = useState(() => initial?.client_uuid ?? newClientUuid())
  const [currentId, setCurrentId] = useState(() => initial?.id ?? tmpAnnotationId(clientUuid))
  const [lockVersion, setLockVersion] = useState<number | undefined>(initial?.lock_version)
  const [fields, setFields] = useState<EditorFields>(
    initial ? fieldsFromAnnotation(initial) : {
      body: '',
      start_seconds: null,
      duration_seconds: DEFAULT_DURATION_SECONDS,
      kind: 'observation',
      topic: null,
    },
  )
  const [autosaveState, setAutosaveState] = useState<AutosaveState>(initial ? 'saved' : 'idle')
  const [conflict, setConflict] = useState<Annotation | null>(null)
  const [showBoth, setShowBoth] = useState(false)
  // STEP-07 acceptance list: "Deleting a speech mid-annotation returns 410
  // Gone, not 404, and the client shows 'your draft is preserved below.'"
  // A separate flag rather than a 7th `autosaveState` word — the plan's
  // one-word vocabulary (idle/dirty/saving/saved/conflict/offline) is
  // itself the E2E test hook, so this is additive UI, not a new state.
  const [speechDeleted, setSpeechDeleted] = useState(false)

  const savedSnapshotRef = useRef<EditorFields>(fields)
  const stampedRef = useRef(initial !== null)
  const pausedOnceRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // `flush` (below) needs to re-schedule itself when a newer edit races an
  // in-flight save, but `scheduleSave` is declared AFTER `flush` and itself
  // closes over `flush` — a direct reference either hits the temporal dead
  // zone (if named in `flush`'s dependency array, evaluated eagerly at
  // render time) or goes stale (if omitted). A ref sidesteps both, matching
  // every other latest-value read in this hook.
  const scheduleSaveRef = useRef<(delayMs: number) => void>(() => {})

  // Refs mirroring the latest render's values so the debounced
  // `flush`/unload handler always reads current data without needing to
  // be re-created (and re-armed) on every keystroke. Every WRITE happens
  // inside this one effect (never directly in the render body) — reads
  // happen only inside callbacks/handlers, both required by the React
  // Compiler's ref-usage rules.
  const fieldsRef = useRef(fields)
  const currentIdRef = useRef(currentId)
  const lockVersionRef = useRef(lockVersion)
  const autosaveStateRef = useRef(autosaveState)
  const videoElRef = useRef(videoEl)
  const autoPauseRef = useRef(autoPause)
  const onCreatedRef = useRef(options.onCreated)
  const onSavedRef = useRef(options.onSaved)
  const onSilentAdoptRef = useRef(options.onSilentAdopt)
  const onLiveChangeRef = useRef(options.onLiveChange)
  useEffect(() => {
    fieldsRef.current = fields
    currentIdRef.current = currentId
    lockVersionRef.current = lockVersion
    autosaveStateRef.current = autosaveState
    videoElRef.current = videoEl
    autoPauseRef.current = autoPause
    onCreatedRef.current = options.onCreated
    onSavedRef.current = options.onSaved
    onSilentAdoptRef.current = options.onSilentAdopt
    onLiveChangeRef.current = options.onLiveChange
  })

  const [createAnnotation] = useCreateAnnotationMutation()
  const [updateAnnotation] = useUpdateAnnotationMutation()

  const mirror = useCallback(
    (f: EditorFields) => {
      writeDraftMirror(clientUuid, { ...f, updated_at: Date.now() })
    },
    [clientUuid],
  )

  // Shared by the BroadcastChannel handler below AND the `initial`-prop
  // resync effect further down: both are "this row changed somewhere other
  // than this editor instance" events, and both get the same three-tier
  // treatment (§10.2) — a clean editor silently adopts, a dirty one banners.
  const applyExternalUpdate = useCallback(
    (remote: Annotation) => {
      const isClean = fieldsEqual(fieldsRef.current, savedSnapshotRef.current)
      if (isClean) {
        const next = fieldsFromAnnotation(remote)
        setFields(next)
        savedSnapshotRef.current = next
        setLockVersion(remote.lock_version)
        setCurrentId(remote.id)
        setAutosaveState('saved')
        clearDraftMirror(clientUuid)
        onSilentAdoptRef.current?.(remote)
      } else {
        setConflict(remote)
        setAutosaveState('conflict')
      }
    },
    [clientUuid],
  )

  const broadcastSaved = useAnnotationChannel(
    reviewId,
    useCallback(
      (remote: Annotation) => {
        if (remote.client_uuid !== clientUuid) return
        applyExternalUpdate(remote)
      },
      [clientUuid, applyExternalUpdate],
    ),
  )

  // Resyncs against a SECOND write path for the same row — e.g.
  // TimelineStrip's drag-to-retime, which PATCHes directly rather than
  // through this hook. Without this, an open row editor's `lockVersion`
  // stays frozen at whatever it was on mount; the next autosave from THIS
  // editor then submits a stale version, 409s, and shows a "changed
  // elsewhere" conflict banner for a change the user just made themselves
  // in the same tab. Keyed on `lock_version` (not object identity) so a
  // `serverRows` refetch that returns an equivalent row doesn't re-fire
  // this on every render, and skipped on the very first render (the ref
  // starts seeded with the same value `useState`'s initializer already
  // used) so mounting doesn't immediately treat its own initial value as
  // an external change.
  const lastKnownLockVersionRef = useRef(initial?.lock_version)
  useEffect(() => {
    if (initial === null) return
    if (initial.lock_version === lastKnownLockVersionRef.current) return
    lastKnownLockVersionRef.current = initial.lock_version
    applyExternalUpdate(initial)
  }, [initial, applyExternalUpdate])

  const flush = useCallback(
    async (opts?: { forcedLockVersion?: number }) => {
      const f = fieldsRef.current
      if (!f.body.trim() || f.start_seconds === null) return

      setAutosaveState('saving')
      const isNew = isTmpAnnotationId(currentIdRef.current)

      try {
        if (isNew) {
          const created = await createAnnotation({
            speechId,
            reviewId,
            body: {
              client_uuid: clientUuid,
              body: f.body,
              start_seconds: f.start_seconds,
              duration_seconds: f.duration_seconds,
              kind: f.kind,
              topic: f.topic,
            },
          }).unwrap()
          setCurrentId(created.id)
          setLockVersion(created.lock_version)
          broadcastSaved(created)
          onSavedRef.current?.(created)

          // The row now exists server-side either way, but if the coach
          // kept typing while the create was in flight, `f` (what THIS
          // request sent) no longer matches the live fields. Finalizing to
          // 'saved' here would clear the localStorage backup — which
          // `mirror()` has already overwritten with the newer text — and
          // `onCreated` would remount the composer into a fresh blank
          // draft, discarding the unsent keystrokes with no recoverable
          // copy. Re-flush instead (now via the UPDATE branch, since
          // `currentId` is no longer a tmp id) and defer the "this draft
          // is done" signal until nothing is left unsent.
          if (fieldsEqual(f, fieldsRef.current)) {
            savedSnapshotRef.current = f
            setAutosaveState('saved')
            clearDraftMirror(clientUuid)
            onCreatedRef.current?.(created)
          } else {
            setAutosaveState('dirty')
            scheduleSaveRef.current(0)
          }
        } else {
          const updated = await updateAnnotation({
            speechId,
            reviewId,
            annotationId: currentIdRef.current,
            body: {
              lock_version: opts?.forcedLockVersion ?? lockVersionRef.current ?? 0,
              body: f.body,
              start_seconds: f.start_seconds,
              duration_seconds: f.duration_seconds,
              kind: f.kind,
              topic: f.topic,
            },
          }).unwrap()
          setLockVersion(updated.lock_version)
          broadcastSaved(updated)
          onSavedRef.current?.(updated)

          if (fieldsEqual(f, fieldsRef.current)) {
            savedSnapshotRef.current = f
            setAutosaveState('saved')
            clearDraftMirror(clientUuid)
          } else {
            // Same race as the create branch above: newer edits arrived
            // while this PATCH was in flight. Don't clear the backup or
            // report 'saved' for text that's no longer current — send the
            // newer version immediately instead.
            setAutosaveState('dirty')
            scheduleSaveRef.current(0)
          }
        }
      } catch (err) {
        const status = (err as { status?: number } | undefined)?.status
        const data = (err as { data?: unknown } | undefined)?.data
        if (status === 409 && isAnnotationConflict(data)) {
          const isClean = fieldsEqual(f, savedSnapshotRef.current)
          if (isClean) {
            // Silent-adopt (§10.2's ~90% case) — nothing local was typed
            // since the last successful save, so adopting the server's
            // current row is indistinguishable from "nothing happened" to
            // the user, minus a small toast.
            const c = data.current
            const next = fieldsFromAnnotation(c)
            setFields(next)
            savedSnapshotRef.current = next
            setLockVersion(c.lock_version)
            setCurrentId(c.id)
            setAutosaveState('saved')
            clearDraftMirror(clientUuid)
            onSilentAdoptRef.current?.(c)
          } else {
            // Dirty editor: inline banner, never a modal, and the local
            // text is left completely untouched here.
            setConflict(data.current)
            setAutosaveState('conflict')
          }
        } else if (status === 410) {
          // The speech was deleted mid-annotation (`SpeechDeletedException`,
          // 410 Gone — distinct from a plain 404). The local text is
          // already safe: the synchronous localStorage mirror and `fields`
          // state are both untouched by this branch.
          setSpeechDeleted(true)
          setAutosaveState('offline')
        } else {
          // Any other failure (network down, 5xx, etc.) — the local text
          // stays exactly as typed; nothing here mutates `fields`.
          setAutosaveState('offline')
        }
      }
    },
    [speechId, reviewId, clientUuid, createAnnotation, updateAnnotation, broadcastSaved],
  )

  const scheduleSave = useCallback(
    (delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush()
      }, delayMs)
    },
    [flush],
  )

  useEffect(() => {
    scheduleSaveRef.current = scheduleSave
  }, [scheduleSave])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Live-preview merge point: every field change is reported upward
  // (id/body/timing/kind/topic), NOT gated on the save debounce — the
  // preview must reflect what's on screen right now, not what's persisted.
  useEffect(() => {
    if (fields.start_seconds === null) return
    onLiveChangeRef.current?.({
      id: currentId,
      body: fields.body,
      start_seconds: fields.start_seconds,
      duration_seconds: fields.duration_seconds,
      kind: fields.kind,
      topic: fields.topic,
      lock_version: lockVersion ?? 0,
      client_uuid: clientUuid,
      voice: null,
    })
  }, [currentId, fields, lockVersion, clientUuid])

  const markDirty = useCallback(() => {
    setAutosaveState((s) => (s === 'conflict' ? s : 'dirty'))
  }, [])

  const setBody = useCallback(
    (body: string) => {
      setFields((prev) => {
        const next = { ...prev, body }
        mirror(next)
        return next
      })
      markDirty()
      scheduleSave(BODY_DEBOUNCE_MS)
    },
    [mirror, markDirty, scheduleSave],
  )

  const setKind = useCallback(
    (kind: AnnotationKind) => {
      setFields((prev) => {
        const next = { ...prev, kind }
        mirror(next)
        return next
      })
      markDirty()
      scheduleSave(BODY_DEBOUNCE_MS)
    },
    [mirror, markDirty, scheduleSave],
  )

  const setTopic = useCallback(
    (topic: string | null) => {
      setFields((prev) => {
        const next = { ...prev, topic }
        mirror(next)
        return next
      })
      markDirty()
      scheduleSave(BODY_DEBOUNCE_MS)
    },
    [mirror, markDirty, scheduleSave],
  )

  const setStart = useCallback(
    (seconds: number) => {
      stampedRef.current = true
      setFields((prev) => {
        const next = { ...prev, start_seconds: round3(Math.max(0, seconds)) }
        mirror(next)
        return next
      })
      markDirty()
      scheduleSave(NUDGE_DEBOUNCE_MS)
    },
    [mirror, markDirty, scheduleSave],
  )

  const nudgeStart = useCallback(
    (deltaSeconds: number) => {
      setFields((prev) => {
        const base = prev.start_seconds ?? videoElRef.current?.currentTime ?? 0
        const next = { ...prev, start_seconds: round3(Math.max(0, base + deltaSeconds)) }
        mirror(next)
        return next
      })
      stampedRef.current = true
      markDirty()
      scheduleSave(NUDGE_DEBOUNCE_MS)
    },
    [mirror, markDirty, scheduleSave],
  )

  const setDuration = useCallback(
    (seconds: number) => {
      const clamped = Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, seconds))
      setFields((prev) => {
        const next = { ...prev, duration_seconds: round3(clamped) }
        mirror(next)
        return next
      })
      markDirty()
      scheduleSave(NUDGE_DEBOUNCE_MS)
    },
    [mirror, markDirty, scheduleSave],
  )

  const nudgeDuration = useCallback(
    (deltaSeconds: number) => {
      setFields((prev) => {
        const clamped = Math.min(
          MAX_DURATION_SECONDS,
          Math.max(MIN_DURATION_SECONDS, prev.duration_seconds + deltaSeconds),
        )
        const next = { ...prev, duration_seconds: round3(clamped) }
        mirror(next)
        return next
      })
      markDirty()
      scheduleSave(NUDGE_DEBOUNCE_MS)
    },
    [mirror, markDirty, scheduleSave],
  )

  const setToPlayhead = useCallback(() => {
    setStart(videoElRef.current?.currentTime ?? 0)
  }, [setStart])

  /**
   * §8.4: "Use `onBeforeInput`, not `onKeyDown`… Guard on
   * `inputType.startsWith('insert')` so deletions don't stamp." The
   * component wires the raw DOM event; this function is the guarded,
   * unit-testable half of that rule.
   */
  const handleBeforeInput = useCallback(
    (inputType: string | null | undefined) => {
      if (!inputType?.startsWith('insert')) return
      if (stampedRef.current) return
      stampedRef.current = true
      const seconds = videoElRef.current?.currentTime ?? 0
      setFields((prev) => {
        const next = { ...prev, start_seconds: round3(Math.max(0, seconds)) }
        mirror(next)
        return next
      })
      if (autoPauseRef.current && videoElRef.current && !pausedOnceRef.current) {
        pausedOnceRef.current = true
        videoElRef.current.pause()
      }
    },
    [mirror],
  )

  const keepMine = useCallback(() => {
    if (!conflict) return
    const forced = conflict.lock_version
    setLockVersion(forced)
    setConflict(null)
    setAutosaveState('dirty')
    void flush({ forcedLockVersion: forced })
  }, [conflict, flush])

  const useTheirs = useCallback(() => {
    if (!conflict) return
    // §10.2's "never discard the local text": back the local fields up
    // before switching, so even this explicit "replace mine" action keeps
    // a recoverable copy rather than destroying it.
    backupDiscardedDraft(clientUuid, { ...fieldsRef.current, updated_at: Date.now() })
    const next = fieldsFromAnnotation(conflict)
    setFields(next)
    savedSnapshotRef.current = next
    setLockVersion(conflict.lock_version)
    setCurrentId(conflict.id)
    setConflict(null)
    setAutosaveState('saved')
    clearDraftMirror(clientUuid)
  }, [conflict, clientUuid])

  const toggleShowBoth = useCallback(() => setShowBoth((s) => !s), [])

  // Best-effort flush on tab close (§10.2: "Flush on unload with
  // `fetch(url, { keepalive: true })`; `sendBeacon` cannot set the CSRF
  // header"). A raw `fetch` (not the RTK Query mutation, which can't
  // guarantee completion once the page starts unloading) carrying the
  // same body/headers the debounced save would have sent.
  useEffect(() => {
    const handler = () => {
      if (autosaveStateRef.current !== 'dirty') return
      const f = fieldsRef.current
      if (!f.body.trim() || f.start_seconds === null) return
      const isNew = isTmpAnnotationId(currentIdRef.current)
      const url = isNew
        ? `${API_URL}/api/speeches/${speechId}/annotations`
        : `${API_URL}/api/speeches/${speechId}/annotations/${currentIdRef.current}`
      const token = readXsrfCookie()
      const payload = isNew
        ? {
            client_uuid: clientUuid,
            body: f.body,
            start_seconds: f.start_seconds,
            duration_seconds: f.duration_seconds,
            kind: f.kind,
            topic: f.topic,
          }
        : {
            lock_version: lockVersionRef.current ?? 0,
            body: f.body,
            start_seconds: f.start_seconds,
            duration_seconds: f.duration_seconds,
            kind: f.kind,
            topic: f.topic,
          }
      try {
        void fetch(url, {
          method: isNew ? 'POST' : 'PATCH',
          credentials: 'include',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(token ? { 'X-XSRF-TOKEN': token } : {}),
          },
          body: JSON.stringify(payload),
        })
      } catch {
        // Best-effort on the way out — nothing more to do.
      }
    }
    window.addEventListener('pagehide', handler)
    return () => window.removeEventListener('pagehide', handler)
  }, [speechId, clientUuid])

  return {
    id: currentId,
    clientUuid,
    isNew: isTmpAnnotationId(currentId),
    fields,
    autosaveState,
    conflict,
    speechDeleted,
    showBoth,
    toggleShowBoth,
    setBody,
    setKind,
    setTopic,
    setStart,
    nudgeStart,
    setDuration,
    nudgeDuration,
    setToPlayhead,
    handleBeforeInput,
    keepMine,
    useTheirs,
  }
}
