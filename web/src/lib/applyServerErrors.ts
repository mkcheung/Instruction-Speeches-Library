import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import type { ServerErrorResponse } from '@/features/auth/types'

/**
 * The single `422` error contract, wired into `react-hook-form`'s
 * `setError` (§6.5 / §12 S1: "build it here or every later form
 * re-invents it").
 *
 * Laravel's validation-failure shape is always `{ message, errors: {
 * field: string[] } }`. This walks `errors` and calls `setError(field,
 * ...)` for each one (first message per field — react-hook-form shows one
 * at a time anyway), and returns a string for any error that couldn't be
 * attached to a field: an unmatched top-level `message`, a field name the
 * form doesn't render, or a non-422 failure (network error, 500, etc.).
 * Callers render that string as a form-level banner.
 *
 * Usage:
 *   const [register] = useRegisterMutation()
 *   const { setError, handleSubmit } = useForm<RegisterFormValues>()
 *   const [formError, setFormError] = useState<string | null>(null)
 *
 *   const onSubmit = handleSubmit(async (values) => {
 *     try {
 *       await register(values).unwrap()
 *     } catch (error) {
 *       setFormError(applyServerErrors(error, setError))
 *     }
 *   })
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): string | null {
  const data = extractErrorData(error)

  if (!data) {
    return 'Something went wrong. Please try again.'
  }

  let matchedAny = false

  if (data.errors) {
    for (const [field, messages] of Object.entries(data.errors)) {
      if (messages && messages.length > 0) {
        setError(field as Path<T>, { type: 'server', message: messages[0] })
        matchedAny = true
      }
    }
  }

  if (matchedAny) {
    return null
  }

  return data.message ?? 'Something went wrong. Please try again.'
}

/**
 * For the rare form-less mutation (e.g. the avatar upload step, which has
 * no text fields to attach errors to) — same 422 contract, but every
 * error collapses into a single banner string rather than being routed to
 * `setError`.
 */
export function extractServerErrorMessage(error: unknown): string {
  const data = extractErrorData(error)
  if (!data) return 'Something went wrong. Please try again.'
  if (data.errors) {
    const first = Object.values(data.errors)[0]?.[0]
    if (first) return first
  }
  return data.message ?? 'Something went wrong. Please try again.'
}

function extractErrorData(error: unknown): ServerErrorResponse | null {
  // RTK Query's FetchBaseQueryError shape: { status, data }
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data
    if (isServerErrorResponse(data)) {
      return data
    }
  }
  return null
}

function isServerErrorResponse(value: unknown): value is ServerErrorResponse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const messageOk = candidate.message === undefined || typeof candidate.message === 'string'
  const errorsOk = candidate.errors === undefined || typeof candidate.errors === 'object'
  return messageOk && errorsOk
}
