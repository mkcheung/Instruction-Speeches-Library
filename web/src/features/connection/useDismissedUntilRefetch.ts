import { useCallback, useState } from 'react'

/** Hide completed rows only in the query snapshot that supplied them. */
export function useDismissedUntilRefetch<Id extends string | number>(fulfilledTimeStamp: number | undefined, queryKey: string) {
  const [dismissed, setDismissed] = useState<{ ids: Id[]; snapshot?: number; queryKey?: string }>({ ids: [] })
  const dismiss = useCallback((id: Id) => {
    setDismissed((previous) => ({
      ids: [...(previous.snapshot === fulfilledTimeStamp && previous.queryKey === queryKey ? previous.ids : []), id],
      snapshot: fulfilledTimeStamp,
      queryKey,
    }))
  }, [fulfilledTimeStamp, queryKey])
  const isDismissed = useCallback((id: Id) =>
    dismissed.snapshot === fulfilledTimeStamp && dismissed.queryKey === queryKey && dismissed.ids.includes(id),
  [dismissed, fulfilledTimeStamp, queryKey])
  const reset = useCallback(() => setDismissed({ ids: [] }), [])

  return { dismiss, isDismissed, reset }
}
