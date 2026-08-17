/** Narrows an RTK Query error to its HTTP status code, when it has one
 * (a `FetchBaseQueryError` from a real response — not a `SerializedError`
 * from a thrown/network failure, which has no `status` field at all). */
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  const { status } = error as { status?: unknown }
  return typeof status === 'number' ? status : undefined
}
