import { authSessionActions, authSessionSignals } from './authSession'

/** Cross-tab change signal. It carries only a random nonce, never identity, drafts or credentials. */
export const AUTH_CHANGE_CHANNEL = 'isl-auth-session'
export const AUTH_CHANGE_STORAGE_KEY = 'isl.auth.change'

function nonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

let channel: BroadcastChannel | null = null

/** After a CURRENT login/register/logout success: tell other tabs to quarantine and re-prove identity. */
export function broadcastAuthChange(): void {
  const value = nonce()
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel ??= new BroadcastChannel(AUTH_CHANGE_CHANNEL)
      channel.postMessage({ nonce: value })
    }
  } catch { /* fall through to the storage event */ }
  try { window.localStorage.setItem(AUTH_CHANGE_STORAGE_KEY, value) } catch { /* storage unavailable */ }
}

interface Dispatcher { dispatch: (action: never) => unknown }

/**
 * Wires the document-level events of the §8.1 matrix: pagehide, BFCache
 * restoration, cross-tab signals (BroadcastChannel with a storage-event
 * fallback; a nonce seen on both is applied once) and focus/visibility
 * restoration probes (throttled).
 */
export function installAuthSessionBrowserListeners(
  store: Dispatcher,
  { refocusThrottleMs = 2000, now = () => Date.now() }: { refocusThrottleMs?: number; now?: () => number } = {},
): () => void {
  const send = (action: unknown) => store.dispatch(action as never)
  const seen = new Set<string>()
  let lastRefocus = Number.NEGATIVE_INFINITY

  const onPageHide = () => send(authSessionActions.pageHidden())
  const onPageShow = (event: PageTransitionEvent) => {
    send(event.persisted ? authSessionActions.pageRestored() : authSessionActions.pageShown())
  }
  const onRefocus = () => {
    if (document.visibilityState === 'hidden') return
    const t = now()
    if (t - lastRefocus < refocusThrottleMs) return
    lastRefocus = t
    send(authSessionSignals.refocus())
  }
  const onExternal = (value: unknown) => {
    if (typeof value !== 'string' || value === '' || seen.has(value)) return
    seen.add(value)
    send(authSessionActions.externalChange())
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTH_CHANGE_STORAGE_KEY) onExternal(event.newValue)
  }

  // One object both sends and receives: a channel never delivers to the object that posted, so this
  // tab does not react to its own broadcast (a second same-name object in this tab would).
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel ??= new BroadcastChannel(AUTH_CHANGE_CHANNEL)
      channel.onmessage = (event: MessageEvent) => onExternal((event.data as { nonce?: unknown } | null)?.nonce)
    }
  } catch { channel = null }

  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('focus', onRefocus)
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onRefocus)
  return () => {
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('focus', onRefocus)
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('visibilitychange', onRefocus)
    channel?.close()
    channel = null
  }
}
