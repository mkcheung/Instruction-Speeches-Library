import { useCallback, useState } from 'react'

function readPreference(key: string | null, defaultValue: boolean): boolean {
  if (!key) return defaultValue
  try {
    const stored = localStorage.getItem(key)
    return stored === 'true' ? true : stored === 'false' ? false : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * A generic per-user, device-local boolean preference (e.g. the coach's voice
 * auto-play). The caller supplies the storage key prefix and the default.
 *
 * Deliberately `localStorage`, not the server-side `users.preferences`
 * namespaces (`UserPreferenceWriter`): reads are synchronous, need no
 * endpoint, and cannot collide with the speaker's per-speech server
 * preference (PLAN-COACH-VOICE-PREVIEW.md D7). Cross-device sync would mean
 * a new server namespace; swapping the storage is confined to this file.
 */
export function useLocalBooleanPreference({ key: prefix, userId, defaultValue }: {
  /** Prefix without a trailing colon; the stored key is `${key}:${userId}`. */
  key: string
  userId: string | undefined
  defaultValue: boolean
}): [boolean, (next: boolean) => void] {
  const key = userId ? `${prefix}:${userId}` : null

  const [value, setValue] = useState(() => readPreference(key, defaultValue))
  // React's own "adjusting state during render" pattern (not an effect —
  // an effect that calls setState unconditionally on every run is exactly
  // what the React Compiler's lint flags) for the rare case `userId`
  // changes under an already-mounted instance: re-derive from storage the
  // moment the key itself changes, during render, not after a commit.
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setValue(readPreference(key, defaultValue))
  }

  const update = useCallback(
    (next: boolean) => {
      setValue(next)
      if (!key) return
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // Storage unavailable — the preference just doesn't persist across
        // reloads; not worth surfacing an error for.
      }
    },
    [key],
  )

  return [value, update]
}
