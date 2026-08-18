import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import type { AppDispatch } from '@/app/store'
import { useUpdateCaptionsMutation } from '@/features/caption/captionApi'
import { transcriptApi } from '@/features/transcript/transcriptApi'
import { parseVtt, serializeVtt, type CaptionCue } from '@/lib/vtt'

/** One word, matching this codebase's own `AutosaveState` idiom
 * (`useAnnotationEditor.ts`/§10.2) — the E2E test hook lives on this
 * string, rendered as-is near the editor. No `'conflict'` state: §4 of the
 * frozen contract is explicit that captions have no optimistic-locking
 * scheme, so there's nothing to conflict with. */
export type CaptionAutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'offline'

/**
 * STEP-09-VERIFICATION-PLAN.md §4.1 "Projection convergence token": distinct
 * from `CaptionAutosaveState` on purpose — the VTT save (`autosaveState`)
 * and the derived-transcript/search refresh (`transcriptSyncState`) are two
 * different pieces of server state that land at different times. `'idle'`
 * covers both "never edited" and "edit saved, no revision to converge on"
 * (the `revision: null` case, §4.1's own "null when unavailable").
 */
export type TranscriptSyncState = 'idle' | 'polling' | 'synced' | 'timeout'

/** Matches `useCaptionsJob.ts`'s polling magnitude in spirit, not value:
 * that hook waits out a real Whisper run (minutes), so it polls every 4s.
 * `RederiveTranscript` is a small synchronous-ish re-parse of an already
 * fetched VTT (§4.1), so a short 1s interval is appropriate; 10 attempts
 * (~9s wall time across the waits between them) stays inside the plan's
 * "a few seconds to ~10s" bound while still being generous for queue
 * backlog under load. */
const TRANSCRIPT_POLL_INTERVAL_MS = 1000
const TRANSCRIPT_POLL_MAX_ATTEMPTS = 10

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
  const [transcriptSyncState, setTranscriptSyncState] = useState<TranscriptSyncState>('idle')

  const [updateCaptions] = useUpdateCaptionsMutation()
  const dispatch = useDispatch<AppDispatch>()

  const cuesRef = useRef(cues)
  const autosaveStateRef = useRef(autosaveState)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    cuesRef.current = cues
    autosaveStateRef.current = autosaveState
  })

  // Cancellation token, not a boolean: a retry can start a new poll while an
  // old one's `setTimeout`/promise is still in flight, and the old one must
  // become a no-op rather than racing the new one's state updates.
  const pollTokenRef = useRef(0)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRevisionRef = useRef<string | null>(null)

  const invalidateTranscriptAndSearch = useCallback(() => {
    dispatch(transcriptApi.util.invalidateTags([{ type: 'Transcript', id: speechId }, 'Search']))
  }, [dispatch, speechId])

  // A recursive poll can't call itself directly from inside its own
  // `useCallback` initializer (the binding isn't there yet at that point,
  // and the react-compiler lint flags the self-reference besides) — the
  // next attempt is scheduled through this ref instead, always pointing at
  // the current render's closure (kept in sync by the effect below).
  const pollTranscriptRevisionRef = useRef<(expectedRevision: string, token: number, attempt: number) => void>(
    () => {},
  )

  const pollTranscriptRevision = useCallback(
    (expectedRevision: string, token: number, attempt: number) => {
      if (token !== pollTokenRef.current) return
      const request = dispatch(
        transcriptApi.endpoints.getTranscript.initiate({ speechId }, { forceRefetch: true }),
      )
      const scheduleNextAttempt = () => {
        if (attempt >= TRANSCRIPT_POLL_MAX_ATTEMPTS) {
          setTranscriptSyncState('timeout')
          return
        }
        pollTimerRef.current = setTimeout(
          () => pollTranscriptRevisionRef.current(expectedRevision, token, attempt + 1),
          TRANSCRIPT_POLL_INTERVAL_MS,
        )
      }
      request
        .unwrap()
        .then((transcript) => {
          // Unsubscribe THIS poll attempt's own query before doing
          // anything that might invalidate its tag — `invalidateTags`
          // auto-refetches every still-subscribed matching query, and this
          // request would otherwise still be one of them, producing a
          // spurious extra fetch right after the match that ended the poll.
          request.unsubscribe()
          if (token !== pollTokenRef.current) return
          if (transcript.caption_revision === expectedRevision) {
            invalidateTranscriptAndSearch()
            setTranscriptSyncState('synced')
            return
          }
          scheduleNextAttempt()
        })
        .catch(() => {
          request.unsubscribe()
          // A transient fetch failure is not a timeout by itself — keep
          // retrying within the same attempt budget rather than surfacing
          // a false failure for what may just be one dropped request.
          if (token !== pollTokenRef.current) return
          scheduleNextAttempt()
        })
    },
    [dispatch, speechId, invalidateTranscriptAndSearch],
  )

  useEffect(() => {
    pollTranscriptRevisionRef.current = pollTranscriptRevision
  })

  const startTranscriptSync = useCallback(
    (revision: string | null) => {
      pollTokenRef.current += 1
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
      lastRevisionRef.current = revision
      if (revision === null) {
        // §4.1: `revision` is `null` only when unavailable — nothing to
        // converge on, so refresh best-effort instead of polling toward an
        // unreachable target.
        invalidateTranscriptAndSearch()
        setTranscriptSyncState('synced')
        return
      }
      setTranscriptSyncState('polling')
      pollTranscriptRevision(revision, pollTokenRef.current, 1)
    },
    [invalidateTranscriptAndSearch, pollTranscriptRevision],
  )

  /** Manual retry for the "updating transcript…" timeout state (§4.1: "a
   * timeout leaves an honest state with retry/refetch, not a false 'fully
   * saved' claim") — restarts the same bounded poll against the last saved
   * revision rather than silently giving up. */
  const retryTranscriptSync = useCallback(() => {
    if (lastRevisionRef.current === null) return
    startTranscriptSync(lastRevisionRef.current)
  }, [startTranscriptSync])

  useEffect(() => {
    return () => {
      pollTokenRef.current += 1
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [])

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
      const result = await updateCaptions({ speechId, body: { vtt: serializeVtt(cuesRef.current) } }).unwrap()
      // §4.1: the editor's own saved state is real the instant the PUT
      // succeeds — only the SEPARATE transcript/search convergence (below)
      // is asynchronous. Do not treat local corrected text or this
      // `'saved'` flip as evidence the transcript has been re-derived.
      setAutosaveState('saved')
      startTranscriptSync(result.revision)
    } catch {
      setAutosaveState('offline')
    }
  }, [speechId, updateCaptions, startTranscriptSync])

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

  return { cues, autosaveState, editCueText, flushNow, transcriptSyncState, retryTranscriptSync }
}
