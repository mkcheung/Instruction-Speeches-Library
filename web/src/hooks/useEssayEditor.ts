import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '@/lib/api'
import { readXsrfCookie } from '@/lib/csrf'
import { useUpdateEssayMutation } from '@/features/essay/essayApi'
import { isEssayConflict, type Essay } from '@/features/essay/types'

/** Same vocabulary as `useAnnotationEditor.ts`'s `AutosaveState`
 * (MODERNIZATION_PLAN.md §10.2's "render the autosave state as ONE WORD…
 * that attribute is also the primary E2E test hook") — the essay editor
 * reuses it verbatim rather than inventing a parallel one. */
export type AutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'offline'

/** STEP-08's frozen contract: "reuse the existing 750ms constant unless it
 * visibly thrashes… don't invent a new number without checking." Nothing
 * in manual testing suggested paragraph-length input thrashes at 750ms, so
 * this is the same value `useAnnotationEditor.ts`'s `BODY_DEBOUNCE_MS`
 * uses, duplicated rather than imported (that constant isn't exported, and
 * the two hooks are otherwise fully independent). */
const HTML_DEBOUNCE_MS = 750

export interface UseEssayEditorOptions {
  speechId: number
  reviewId: number
  /** The essay always exists once the review row does (nullable columns,
   * not a missing resource) — unlike `useAnnotationEditor`'s `initial`,
   * this is never `null` for "brand new"; the caller (`EssayEditorPanel`)
   * gates rendering until `getEssay` has resolved once. */
  initial: Essay
  /** Fires on every successful save. */
  onSaved?: (essay: Essay) => void
  /** A conflict resolved without the user ever seeing a banner. */
  onSilentAdopt?: (essay: Essay) => void
}

export interface UseEssayEditorResult {
  html: string
  autosaveState: AutosaveState
  /** The OTHER side's current essay, only set while a dirty-editor
   * conflict is unresolved — never a blocking modal, just data the caller
   * renders inline (mirrors `AnnotationEditor.tsx`'s banner exactly). */
  conflict: Essay | null
  /** True once a save has come back 410 Gone — the speech was deleted
   * mid-edit. The local text is unaffected. */
  speechDeleted: boolean
  showBoth: boolean
  toggleShowBoth: () => void
  setHtml: (html: string) => void
  keepMine: () => void
  useTheirs: () => void
}

/**
 * The essay's autosave state machine (STEP-08-FROZEN-CONTRACT.md's
 * frontend section) — modeled directly on `useAnnotationEditor.ts`'s
 * debounce → flush → pagehide-beacon shape, minus the pieces that don't
 * apply to a single per-review essay: no tmp-id/create branch (every save
 * is a PUT against a row that already exists), no cross-tab
 * `BroadcastChannel` sync and no second-write-path resync effect (the
 * contract doesn't call for either — an essay has exactly one writer and
 * exactly one write path, unlike annotations' composer+timeline-drag
 * split). One instance per mounted `EssayEditorPanel`.
 */
export function useEssayEditor(options: UseEssayEditorOptions): UseEssayEditorResult {
  const { speechId, reviewId, initial } = options

  const [html, setHtmlState] = useState(initial.essay_html ?? '')
  const [lockVersion, setLockVersion] = useState(initial.essay_lock_version)
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle')
  const [conflict, setConflict] = useState<Essay | null>(null)
  const [showBoth, setShowBoth] = useState(false)
  const [speechDeleted, setSpeechDeleted] = useState(false)

  const savedSnapshotRef = useRef(html)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Same temporal-dead-zone workaround `useAnnotationEditor.ts` uses:
  // `flush` needs to re-schedule itself, `scheduleSave` is declared after
  // `flush` and closes over it — a ref sidesteps both the TDZ and a stale
  // closure.
  const scheduleSaveRef = useRef<(delayMs: number) => void>(() => {})

  const htmlRef = useRef(html)
  const lockVersionRef = useRef(lockVersion)
  const autosaveStateRef = useRef(autosaveState)
  const onSavedRef = useRef(options.onSaved)
  const onSilentAdoptRef = useRef(options.onSilentAdopt)
  useEffect(() => {
    htmlRef.current = html
    lockVersionRef.current = lockVersion
    autosaveStateRef.current = autosaveState
    onSavedRef.current = options.onSaved
    onSilentAdoptRef.current = options.onSilentAdopt
  })

  const [updateEssay] = useUpdateEssayMutation()

  const flush = useCallback(
    async (opts?: { forcedLockVersion?: number }) => {
      const currentHtml = htmlRef.current

      setAutosaveState('saving')
      try {
        const updated = await updateEssay({
          speechId,
          reviewId,
          body: {
            html: currentHtml,
            lock_version: opts?.forcedLockVersion ?? lockVersionRef.current,
          },
        }).unwrap()
        setLockVersion(updated.essay_lock_version)
        onSavedRef.current?.(updated)

        if (htmlRef.current === currentHtml) {
          savedSnapshotRef.current = currentHtml
          setAutosaveState('saved')
        } else {
          // A newer edit arrived while this PUT was in flight — same race
          // `useAnnotationEditor.ts`'s `flush` guards against. Send the
          // newer text immediately rather than reporting 'saved' for text
          // that's no longer current.
          setAutosaveState('dirty')
          scheduleSaveRef.current(0)
        }
      } catch (err) {
        const status = (err as { status?: number } | undefined)?.status
        const data = (err as { data?: unknown } | undefined)?.data
        if (status === 409 && isEssayConflict(data)) {
          const isClean = currentHtml === savedSnapshotRef.current
          if (isClean) {
            // Silent-adopt: nothing local was typed since the last
            // successful save, so adopting the server's current essay is
            // indistinguishable from "nothing happened" to the user.
            const c = data.current
            const nextHtml = c.essay_html ?? ''
            setHtmlState(nextHtml)
            savedSnapshotRef.current = nextHtml
            setLockVersion(c.essay_lock_version)
            setAutosaveState('saved')
            onSilentAdoptRef.current?.(c)
          } else {
            // Dirty editor: inline banner, never a modal, local text left
            // completely untouched.
            setConflict(data.current)
            setAutosaveState('conflict')
          }
        } else if (status === 410) {
          setSpeechDeleted(true)
          setAutosaveState('offline')
        } else {
          setAutosaveState('offline')
        }
      }
    },
    [speechId, reviewId, updateEssay],
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

  /**
   * Best-effort PUT that does not depend on this component still being
   * mounted, or on React state surviving the call. Shared by the `pagehide`
   * beacon and the unmount cleanup below — §10.2's "flush on unload with
   * `fetch(url, { keepalive: true })`; `sendBeacon` cannot set the CSRF
   * header".
   *
   * `pagehide` ONLY — the unmount cleanup deliberately uses `flush()`
   * instead; see the long note there for why `keepalive` is the wrong tool
   * once the page is going to survive.
   *
   * Everything it needs comes from refs, never from the render closure: it
   * fires from a listener registered under `[]` deps, so reading state
   * directly would send whatever was true on first render.
   */
  const beaconSave = useCallback(() => {
    if (autosaveStateRef.current !== 'dirty') return
    const token = readXsrfCookie()
    try {
      void fetch(`${API_URL}/api/speeches/${speechId}/essay`, {
        method: 'PUT',
        credentials: 'include',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { 'X-XSRF-TOKEN': token } : {}),
        },
        body: JSON.stringify({ html: htmlRef.current, lock_version: lockVersionRef.current }),
      })
    } catch {
      // Best-effort on the way out — nothing more to do.
    }
  }, [speechId])

  const beaconSaveRef = useRef(beaconSave)
  useEffect(() => {
    beaconSaveRef.current = beaconSave
  }, [beaconSave])

  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  useEffect(() => {
    return () => {
      if (!timerRef.current) return
      // A debounced save was still pending when this hook went away.
      //
      // Clearing the timer alone — which is all this cleanup used to do —
      // is silent data loss, and the essay editor unmounts far more often
      // than "the user left the page": the Notes/Essay tab strip unmounts
      // the inactive panel, so every tab switch within 750ms of a keystroke
      // threw the words away. Neither guard covers it — `useBlocker` sees
      // no route change and `pagehide` sees no unload — so the text
      // vanished from the server AND from the editor, with no warning.
      // Caught by `web/tests/essay-editor.spec.ts`; structurally invisible
      // to the unit tests, which never unmount the panel.
      clearTimeout(timerRef.current)
      timerRef.current = null

      // `flush()`, deliberately NOT the `pagehide` beacon, even though the
      // beacon is right there and looks like the same job. Two reasons,
      // both of which bite exactly the user this fix exists to protect:
      //
      //  1. `keepalive` caps a request body at 64KB, and over that the
      //     fetch REJECTS rather than sends. STEP-08's own acceptance list
      //     has "a 30,000-word essay round-trips without truncation" —
      //     ~180KB. So the beacon would silently drop precisely the long
      //     essays, and `try { void fetch() } catch {}` cannot even catch
      //     it, because a rejected promise is not a synchronous throw.
      //     `pagehide` has no choice (the page is dying); an unmount does,
      //     because the page is still very much alive.
      //  2. The beacon is a raw `fetch`, so it never runs `invalidatesTags`
      //     and RTK Query keeps serving the pre-save cache entry for
      //     `keepUnusedDataFor` (60s default). Coming back to the Essay tab
      //     inside that window would re-seed the editor from stale data:
      //     the words missing from the screen despite being safe on the
      //     server, and a stale `lock_version` that turns the next
      //     keystroke into a 409 — a conflict banner about a conflict with
      //     yourself. `flush()` goes through the mutation, so the cache is
      //     invalidated and the remount reads what was actually saved.
      //
      // Firing after unmount is fine: the fetch is already in flight and
      // React 18+ drops the resulting state updates silently.
      void flushRef.current()
    }
  }, [])

  const markDirty = useCallback(() => {
    setAutosaveState((s) => (s === 'conflict' ? s : 'dirty'))
  }, [])

  const setHtml = useCallback(
    (next: string) => {
      setHtmlState(next)
      markDirty()
      scheduleSave(HTML_DEBOUNCE_MS)
    },
    [markDirty, scheduleSave],
  )

  const keepMine = useCallback(() => {
    if (!conflict) return
    const forced = conflict.essay_lock_version
    setLockVersion(forced)
    setConflict(null)
    setAutosaveState('dirty')
    void flush({ forcedLockVersion: forced })
  }, [conflict, flush])

  const useTheirs = useCallback(() => {
    if (!conflict) return
    const nextHtml = conflict.essay_html ?? ''
    setHtmlState(nextHtml)
    savedSnapshotRef.current = nextHtml
    setLockVersion(conflict.essay_lock_version)
    setConflict(null)
    setAutosaveState('saved')
  }, [conflict])

  const toggleShowBoth = useCallback(() => setShowBoth((s) => !s), [])

  // Best-effort flush on tab close — mirrored from `useAnnotationEditor.ts`
  // minus the create/update branch (essay only ever PUTs). Uses `beaconSave`,
  // not `flush()` — see that docblock for why the unmount cleanup above
  // deliberately does the opposite.
  useEffect(() => {
    const handler = () => beaconSaveRef.current()
    window.addEventListener('pagehide', handler)
    return () => window.removeEventListener('pagehide', handler)
  }, [])

  return {
    html,
    autosaveState,
    conflict,
    speechDeleted,
    showBoth,
    toggleShowBoth,
    setHtml,
    keepMine,
    useTheirs,
  }
}
