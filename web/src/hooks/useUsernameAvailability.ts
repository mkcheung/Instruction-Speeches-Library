import { useEffect, useState } from 'react'
import { useLazyCheckUsernameAvailabilityQuery } from '@/features/profile/profileApi'
import { usernameSchema } from '@/lib/validation'

export type UsernameAvailabilityState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'taken' }
  /** The availability endpoint isn't there (yet) or errored — the server's
   *  422-on-submit is the fallback source of truth, per STEP-01-identity.md
   *  ("don't assume one exists; check, and if it doesn't, just surface the
   *  422 on submit"). */
  | { status: 'unknown' }

const DEBOUNCE_MS = 400

/**
 * Debounced "is this username free" check. Only fires client-side shape
 * validation passes (no point asking the server about something already
 * known to be malformed). Treats a missing/erroring endpoint as `unknown`
 * rather than `taken`, so it never blocks submission — the server's 422 on
 * submit is always the fallback authority.
 */
interface AsyncResult {
  forUsername: string
  status: 'available' | 'taken' | 'unknown'
}

export function useUsernameAvailability(username: string): UsernameAvailabilityState {
  const [trigger] = useLazyCheckUsernameAvailabilityQuery()
  const [result, setResult] = useState<AsyncResult | null>(null)

  const isWellFormed = usernameSchema.safeParse(username).success

  useEffect(() => {
    if (!isWellFormed) return

    // Each effect run owns one request. Cleanup flips `current` so replies
    // from a superseded run (input changed, A->B->A, unmount) are ignored on
    // both promise branches; username text alone cannot tell two runs for
    // the same name apart.
    let current = true

    // The setState calls below run inside the setTimeout/promise
    // callbacks, i.e. asynchronously relative to the effect itself — only
    // a *synchronous* setState in the effect body trips
    // react-hooks/set-state-in-effect. "Checking" is derived below from
    // `result` not yet matching `username`, so no synchronous call is
    // needed to enter that state.
    const timer = setTimeout(() => {
      trigger(username)
        .unwrap()
        .then((response) => {
          if (current) setResult({ forUsername: username, status: response.available ? 'available' : 'taken' })
        })
        .catch(() => {
          if (current) setResult({ forUsername: username, status: 'unknown' })
        })
    }, DEBOUNCE_MS)

    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [username, trigger, isWellFormed])

  if (!isWellFormed) return { status: 'idle' }
  if (!result || result.forUsername !== username) return { status: 'checking' }
  return { status: result.status }
}
