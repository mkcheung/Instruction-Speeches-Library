import { useEffect, useRef } from 'react'
import { compareByStartThenId } from '@/lib/annotationOrder'

/**
 * IMPLEMENTATION-PLANS.md §7.7.6: there is no real frame rate anywhere in
 * this system — `speech_assets` has `duration_seconds`/`width`/`height` and
 * no `frame_rate` column, and the transcoder never normalises fps. This is
 * a NOMINAL step, not a frame-accuracy guarantee: annotation starts are
 * `NUMERIC(10,3)` and the existing nudge step (`AnnotationEditor.tsx`'s
 * `NUDGE_STEP_SECONDS`) is already 0.5s, so `,`/`.` just need to feel like
 * fine positioning at roughly that granularity. ffprobing a real fps into
 * the schema is the honest fix if frame-exactness is ever required.
 */
export const NOMINAL_FRAME_SECONDS = 1 / 30

const SEEK_DELTA_SECONDS = 5

/** Avoids `[`/`]` re-selecting the annotation the playhead is already
 * sitting on/near (float-equality near a just-seeked timestamp) instead of
 * the next/previous one. */
const ADJACENT_EPSILON_SECONDS = 0.05

/** video.js's own `excludeElement` list (STEP-15 §7.7.6) — input TYPES that
 * are themselves controls, not text entry, so typing guards don't need to
 * exclude them. */
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'hidden', 'radio', 'reset', 'submit'])

/**
 * The shared typing guard, ported from video.js's own `excludeElement`
 * (battle-tested, per §7.7.6) rather than reinvented: `isContentEditable`
 * (the essay editor is TipTap/ProseMirror — a `contenteditable` host, NOT a
 * `<textarea>` — so checking only `tagName` would let `J`/`L` fire while a
 * coach is writing their essay), a `<textarea>`, or an `<input>` whose type
 * is actual text entry (i.e. not in the control-type allowlist above).
 */
function isTypingContext(el: Element | null): boolean {
  if (!el) return false
  // `isContentEditable` is the spec-correct check, but jsdom (this repo's
  // vitest environment) doesn't implement it at all — it reads `undefined`
  // even when `contenteditable="true"` is set. Falling back to the
  // attribute itself keeps this hook unit-testable without jsdom and costs
  // nothing in a real browser, where TipTap/ProseMirror set the attribute
  // directly on the editable element anyway.
  if ((el as HTMLElement).isContentEditable) return true
  const editableAttr = el.getAttribute('contenteditable')
  if (editableAttr === 'true' || editableAttr === '') return true
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type || 'text'
    return !NON_TEXT_INPUT_TYPES.has(type)
  }
  // code-review finding (§7.7 alterations): video.js's own `excludeElement`
  // (this hook's ported basis, per the docblock above) never excludes
  // `<select>` either — harmless for video.js, whose own hotkeys never
  // share a key with a real app form control, but this app DOES have a
  // `<select>` right inside the screen this hook is wired into
  // (`AnnotationEditor.tsx`'s "Kind" dropdown, options praise/correction/
  // observation). Without this, pressing "c" to type-ahead to "correction"
  // ALSO called `setToPlayhead()` (silently re-stamping `start_seconds` to
  // the current playhead), and `Space` to open the dropdown ALSO toggled
  // video play/pause via `preventDefault()` on the same keydown, blocking
  // the native open. Treating a focused `<select>` as a typing context
  // (like `<textarea>`) excludes it from the whole map, matching how a
  // native `<select>` already owns its own keyboard interaction.
  if (el.tagName === 'SELECT') return true
  return false
}

/** `Space`-specific extra guard (§7.7.6): native activation key for every
 * button/link/`role=button`, so toggling play/pause there would ALSO
 * activate whatever is focused. */
function isActivationTarget(el: Element | null): boolean {
  if (!el) return false
  if (el.tagName === 'BUTTON') return true
  if (el.tagName === 'A' && el.hasAttribute('href')) return true
  if (el.getAttribute('role') === 'button') return true
  return false
}

function isTextareaTarget(el: Element | null): boolean {
  return !!el && el.tagName === 'TEXTAREA'
}

function eventTargetElement(event: KeyboardEvent): Element | null {
  return event.target instanceof Element ? event.target : document.activeElement
}

export interface KeyboardShortcutAnnotation {
  id: string
  start_seconds: number
}

export interface UseKeyboardShortcutsOptions {
  /** The real `<video>` element — same one `useTimedAnnotations` drives.
   * `null` is a valid, common state (not yet ready / not the owner's
   * player attached yet) and simply makes every action a no-op. */
  videoEl: HTMLVideoElement | null
  /** The ordered annotation set `[`/`]` seek relative to the playhead
   * within — need not already be sorted, this hook sorts with the same
   * `compareByStartThenId` every other display call site uses (§7.7.6:
   * "reuse that ordering… rather than re-deriving it"). */
  annotations: readonly KeyboardShortcutAnnotation[]
  onSeek: (seconds: number) => void
  /** `useAnnotationEditor.ts`'s `setToPlayhead`, for the authoring
   * (reviewer) view only — `undefined` for a read-only viewer (the owner's
   * watch screen has no `AnnotationEditor` to stamp), which simply makes
   * `C`/`Alt+C` a no-op rather than registering a dead shortcut. */
  setToPlayhead?: () => void
  /** Defaults to true; lets a caller disable the whole map (e.g. the video
   * asset isn't ready yet) without conditionally calling the hook itself. */
  enabled?: boolean
}

/**
 * IMPLEMENTATION-PLANS.md §7.7.6, the keyboard map reconciled between
 * `STEP-15` and §8.6: `Space` play/pause, `J`/`L` seek ∓5s, `,`/`.` step
 * ∓1 nominal frame, `[`/`]` prev/next annotation, `C`/`Alt+C` stamp
 * timestamp at the playhead.
 *
 * Registered on `document`, bubble phase, NEVER capture (`addEventListener`
 * with no third-arg `true`) — `Space` is the one key two video.js
 * components also claim, and both deliberately `stopPropagation()`. A
 * focused vjs control's own handler fires first and stops the event before
 * this document-level bubble listener ever sees it, so the two can never
 * double-fire against each other. Capture phase would invert that ordering
 * and break it.
 */
export function useKeyboardShortcuts({
  videoEl,
  annotations,
  onSeek,
  setToPlayhead,
  enabled = true,
}: UseKeyboardShortcutsOptions): void {
  // Refs mirroring the latest render's values so the listener never needs
  // to be torn down and re-attached just because `onSeek`'s closure
  // identity changed (or `annotations` grew by one row) — same pattern as
  // `useAnnotationEditor.ts`'s own latest-value refs.
  const videoElRef = useRef(videoEl)
  const annotationsRef = useRef(annotations)
  const onSeekRef = useRef(onSeek)
  const setToPlayheadRef = useRef(setToPlayhead)

  useEffect(() => {
    videoElRef.current = videoEl
    annotationsRef.current = annotations
    onSeekRef.current = onSeek
    setToPlayheadRef.current = setToPlayhead
  })

  useEffect(() => {
    if (!enabled) return

    const seekToAdjacentAnnotation = (direction: 1 | -1) => {
      const video = videoElRef.current
      const list = annotationsRef.current
      if (!video || list.length === 0) return
      const sorted = [...list].sort(compareByStartThenId)
      const t = video.currentTime

      if (direction === 1) {
        const next = sorted.find((a) => a.start_seconds > t + ADJACENT_EPSILON_SECONDS)
        if (next) onSeekRef.current(next.start_seconds)
      } else {
        let prev: KeyboardShortcutAnnotation | null = null
        for (const a of sorted) {
          if (a.start_seconds < t - ADJACENT_EPSILON_SECONDS) prev = a
          else break
        }
        if (prev) onSeekRef.current(prev.start_seconds)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = eventTargetElement(event)

      // `C` / `Alt+C` — stamp timestamp (§7.7.6). Deliberately NOT folded
      // into the shared typing-guard branch below: inside a `<textarea>` a
      // bare `c` must insert the letter "c" (intercepting it there is "the
      // single most destructive thing this step could ship into a coach's
      // authoring surface"), so only `Alt+C` fires there — checked via
      // `event.code`, never `event.key` (`Option+c` on macOS produces the
      // character "ç", so `event.key` would never match `'c'`).
      if (event.code === 'KeyC') {
        if (isTextareaTarget(target)) {
          if (event.altKey) {
            // Prevent the default so Alt+C doesn't ALSO insert "ç" (or
            // whatever the platform's Option/Alt+C produces) alongside the
            // stamp — this chord is a command, not text entry.
            event.preventDefault()
            setToPlayheadRef.current?.()
          }
          return
        }
        // Outside a textarea, the bare key still obeys the same typing
        // guard as every other shortcut below — contenteditable (the
        // essay editor) and non-exempt inputs get no override at all, only
        // `<textarea>` does, per the carve-out above.
        if (isTypingContext(target)) return
        setToPlayheadRef.current?.()
        return
      }

      if (isTypingContext(target)) return

      switch (event.code) {
        case 'Space': {
          // Space is also native activation for every button/link/
          // role=button — exclude those too, or using Space to activate a
          // focused button would ALSO toggle play/pause.
          if (isActivationTarget(target)) return
          const video = videoElRef.current
          if (!video) return
          event.preventDefault()
          if (video.paused) void video.play()?.catch(() => undefined)
          else video.pause()
          return
        }
        case 'KeyJ': {
          const video = videoElRef.current
          if (!video) return
          video.currentTime = Math.max(0, video.currentTime - SEEK_DELTA_SECONDS)
          return
        }
        case 'KeyL': {
          const video = videoElRef.current
          if (!video) return
          const max = Number.isFinite(video.duration) ? video.duration : Infinity
          video.currentTime = Math.min(max, video.currentTime + SEEK_DELTA_SECONDS)
          return
        }
        case 'Comma': {
          const video = videoElRef.current
          if (!video) return
          video.currentTime = Math.max(0, video.currentTime - NOMINAL_FRAME_SECONDS)
          return
        }
        case 'Period': {
          const video = videoElRef.current
          if (!video) return
          const max = Number.isFinite(video.duration) ? video.duration : Infinity
          video.currentTime = Math.min(max, video.currentTime + NOMINAL_FRAME_SECONDS)
          return
        }
        case 'BracketLeft':
          seekToAdjacentAnnotation(-1)
          return
        case 'BracketRight':
          seekToAdjacentAnnotation(1)
          return
        default:
          return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}
