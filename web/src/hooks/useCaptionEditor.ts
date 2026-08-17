import { useCallback, useEffect, useRef, useState } from 'react'
import { useUpdateCaptionsMutation } from '@/features/caption/captionApi'
import { parseVtt, serializeVtt, type CaptionCue } from '@/lib/vtt'

/** One word, matching this codebase's own `AutosaveState` idiom
 * (`useAnnotationEditor.ts`/§10.2) — the E2E test hook lives on this
 * string, rendered as-is near the editor. No `'conflict'` state: §4 of the
 * frozen contract is explicit that captions have no optimistic-locking
 * scheme, so there's nothing to conflict with. */
export type CaptionAutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'offline'

/** §8.4's debounce shape, borrowed from `useAnnotationEditor.ts` — a held
 * keystroke shouldn't fire a PUT per character. Caption editing is a
 * simpler interaction than annotation authoring (no per-field timing
 * nudges, no lock version), so this hook is a fraction of that one's size
 * on purpose, not a 1:1 port. */
const SAVE_DEBOUNCE_MS = 750

/**
 * The caption editor's per-instance state machine. One instance per
 * mounted `CaptionEditor` (STEP-09-FROZEN-CONTRACT.md §5), holding the
 * parsed cue rows in memory and debounced-autosaving edits back to the
 * VTT via `captionApi`'s `updateCaptions`.
 */
export function useCaptionEditor({ speechId, vtt }: { speechId: number; vtt: string }) {
  const [cues, setCues] = useState<CaptionCue[]>(() => parseVtt(vtt))
  const [autosaveState, setAutosaveState] = useState<CaptionAutosaveState>('idle')

  const [updateCaptions] = useUpdateCaptionsMutation()

  const cuesRef = useRef(cues)
  const autosaveStateRef = useRef(autosaveState)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    cuesRef.current = cues
    autosaveStateRef.current = autosaveState
  })

  // Resyncs the in-memory rows if the server's VTT changes out from under
  // an otherwise-clean editor (e.g. a re-derive from a fresh whisper run
  // completing while this tab is open). A dirty/saving editor is left
  // alone — the same "never clobber unsent local edits" rule
  // `useAnnotationEditor.ts` follows, just without a conflict banner since
  // there's no concurrent-writer scenario the contract asks this to guard.
  const lastVttRef = useRef(vtt)
  useEffect(() => {
    if (vtt === lastVttRef.current) return
    lastVttRef.current = vtt
    if (autosaveStateRef.current === 'dirty' || autosaveStateRef.current === 'saving') return
    setCues(parseVtt(vtt))
  }, [vtt])

  const flush = useCallback(async () => {
    if (autosaveStateRef.current !== 'dirty') return
    setAutosaveState('saving')
    try {
      await updateCaptions({ speechId, body: { vtt: serializeVtt(cuesRef.current) } }).unwrap()
      setAutosaveState('saved')
    } catch {
      setAutosaveState('offline')
    }
  }, [speechId, updateCaptions])

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

  // Flush-on-unmount (borrowing `useAnnotationEditor.ts`'s convention,
  // simplified — no `pagehide`/`keepalive` beacon here since a caption
  // edit is not part of any time-pressured "closing the tab mid-typing"
  // acceptance criterion the way annotations/essays are). The RTK Query
  // mutation is dispatched to the store, not scoped to this component's
  // lifetime, so it completes even after unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        void flush()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const editCueText = useCallback(
    (id: string, text: string) => {
      setCues((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)))
      setAutosaveState('dirty')
      scheduleSave(SAVE_DEBOUNCE_MS)
    },
    [scheduleSave],
  )

  /** Saves immediately (delay 0) rather than waiting out the debounce —
   * wired to the row editor's `onBlur`, matching the intuition that
   * leaving a line should save it right away rather than after a fixed
   * timeout that may have already half-elapsed. */
  const flushNow = useCallback(() => {
    scheduleSave(0)
  }, [scheduleSave])

  return { cues, autosaveState, editCueText, flushNow }
}
