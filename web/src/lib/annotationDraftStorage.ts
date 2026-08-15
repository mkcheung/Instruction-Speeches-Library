import type { AnnotationKind } from '@/features/annotation/types'

export interface AnnotationDraftMirror {
  body: string
  start_seconds: number | null
  duration_seconds: number
  kind: AnnotationKind
  topic: string | null
  updated_at: number
}

function mirrorKey(clientUuid: string): string {
  return `annotation-draft:${clientUuid}`
}

/**
 * STEP-07-write-commentary.md / MODERNIZATION_PLAN.md §8.4, §10.2:
 * "750 ms debounced autosave… plus the synchronous `localStorage` mirror."
 * This mirror is written on EVERY keystroke/nudge, synchronously — never
 * debounced — precisely so it survives an immediate tab close that the
 * 750 ms network debounce would otherwise lose. The network call is what's
 * debounced; this write never is.
 */
export function writeDraftMirror(clientUuid: string, draft: AnnotationDraftMirror): void {
  try {
    localStorage.setItem(mirrorKey(clientUuid), JSON.stringify(draft))
  } catch {
    // Storage unavailable (private mode, quota, disabled) — the mirror is
    // a resilience layer, not a hard requirement; autosave keeps working.
  }
}

export function readDraftMirror(clientUuid: string): AnnotationDraftMirror | null {
  try {
    const raw = localStorage.getItem(mirrorKey(clientUuid))
    if (!raw) return null
    return JSON.parse(raw) as AnnotationDraftMirror
  } catch {
    return null
  }
}

export function clearDraftMirror(clientUuid: string): void {
  try {
    localStorage.removeItem(mirrorKey(clientUuid))
  } catch {
    // ignore
  }
}

function backupKey(clientUuid: string, at: number): string {
  return `annotation-draft-backup:${clientUuid}:${at}`
}

/**
 * §10.2's "never discard the local text": when the three-tier conflict UI's
 * "Use theirs" action replaces the editor's local fields with the server's,
 * the local fields are moved HERE first rather than simply overwritten in
 * place — recoverable, not gone, even though nothing in this step's UI
 * currently surfaces a "restore" affordance for it (a reasonable follow-up,
 * not required by the acceptance list, which only requires the text isn't
 * silently destroyed).
 */
export function backupDiscardedDraft(clientUuid: string, draft: AnnotationDraftMirror): string {
  const key = backupKey(clientUuid, Date.now())
  try {
    localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // ignore
  }
  return key
}

export function readBackup(key: string): AnnotationDraftMirror | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as AnnotationDraftMirror
  } catch {
    return null
  }
}
