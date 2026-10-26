import { getErrorStatus } from '@/lib/errorStatus'

/** A rejected retry cannot disprove an earlier commit; overlap is the explicit exception. */
export function isDefinitiveAnnotationFailure(error: unknown, wasUncertain: boolean): boolean {
  const status = getErrorStatus(error)
  const data = typeof error === 'object' && error !== null && 'data' in error ? error.data : undefined
  const code = typeof data === 'object' && data !== null && 'code' in data ? data.code : undefined

  return (!wasUncertain && ((status !== undefined && status >= 400 && status < 500) || code === 'annotation_busy'))
    || (status === 422 && code === 'annotation_overlap')
}
