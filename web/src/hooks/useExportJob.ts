import { useState } from 'react'
import { useGetExportsQuery } from '@/features/privacy/privacyApi'
import type { DataExport } from '@/features/privacy/types'

/**
 * STEP-11-FROZEN-CONTRACT.md §10: "copy `useCaptionsJob.ts`'s render-time-
 * adjusted polling-interval hook shape... terminal on `ready`/`failed`."
 * One list endpoint (`getExports`) serves both export `kind`s at once
 * (§7), so this hook polls the whole list rather than being parameterized
 * per-kind — `Account.tsx` derives each kind's own latest row from the
 * returned array. Polling continues as long as ANY row is still
 * `'processing'`, and stops once every row the user has ever requested is
 * terminal; `requestExport`'s `invalidatesTags: ['DataExport']` forces an
 * immediate refetch the moment a new export is queued, which is what
 * resumes polling from 0 without waiting for a stale interval to tick.
 *
 * `pollingInterval` is adjusted with the "adjusting state when a prop
 * changes" pattern (react.dev/learn/you-might-not-need-an-effect) — set
 * DURING render, not inside a `useEffect`, exactly matching
 * `useCaptionsJob.ts`'s own reasoning (this repo's lint flags a
 * `useEffect` whose body is only ever a derived `setState`).
 */
export function useExportJob() {
  const [pollingInterval, setPollingInterval] = useState(4000)

  const { data, isFetching, refetch } = useGetExportsQuery(undefined, { pollingInterval })

  const desiredPollingInterval = data?.some((row) => row.status === 'processing') ? 4000 : 0
  if (desiredPollingInterval !== pollingInterval) {
    setPollingInterval(desiredPollingInterval)
  }

  return { exports: (data ?? []) as DataExport[], isFetching, refetch }
}

/** The most recently requested export of a given kind, or `undefined` if
 * none has ever been requested this session — `data_exports` rows are
 * append-only per request, so "latest" is the highest `id`. */
export function latestExportOfKind(
  exports: readonly DataExport[],
  kind: DataExport['kind'],
): DataExport | undefined {
  return exports
    .filter((row) => row.kind === kind)
    .reduce<DataExport | undefined>((latest, row) => (!latest || row.id > latest.id ? row : latest), undefined)
}
