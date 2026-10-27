import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { DataExport, DeleteAccountPayload, RequestExportPayload } from '@/features/privacy/types'

/**
 * STEP-11-FROZEN-CONTRACT.md §7/§8/§10: a new slice, own `tagTypes`, own
 * `baseQueryWithCsrfRetry` wiring — same convention as every other domain
 * slice in this codebase (`essayApi.ts`, `captionApi.ts`).
 *
 * Routes:
 *   POST   /api/privacy/exports              -> { export: DataExportResource }
 *   GET    /api/privacy/exports               -> { exports: DataExportResource[] }
 *   GET    /api/privacy/exports/{id}/download -> { url: string }  (presigned, TTL 10min)
 *   DELETE /api/account                       -> self-scoped, always $request->user()
 *
 * All enveloped identically to every other slice's convention;
 * `transformResponse` unwraps each one. Error bodies are NOT enveloped.
 */
/** Internal descriptor: the backend `{url}` plus the monotonic client time at
 * which the request started, so the UI can bound how long it shows the link
 * (the signature lives 600s server-side; ExportSection shows it for 540s). */
export interface ExportDownloadLink {
  url: string
  requestStartedAtMonotonicMs: number
  /** Position in the module-wide request-start order; unlike a clock it cannot tie, so
   * "started before invalidation" is decidable exactly. */
  requestSeq: number
}

let requestSeqCounter = 0
/** Sequence number of the most recently started download-URL request. */
export const latestExportDownloadRequestSeq = () => requestSeqCounter

export const privacyApi = createApi({
  reducerPath: 'privacyApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['DataExport'],
  endpoints: (builder) => ({
    /** `POST /api/privacy/exports {kind}` — queues `GenerateDataExport`,
     * creates the row `status: 'processing'`. Invalidates the list so
     * `getExports` (which `useExportJob` polls) picks up the new row on its
     * next tick without waiting a full interval. */
    requestExport: builder.mutation<DataExport, RequestExportPayload>({
      query: (body) => ({ url: '/api/privacy/exports', method: 'POST', body }),
      transformResponse: (response: { export: DataExport }) => response.export,
      invalidatesTags: ['DataExport'],
    }),

    /** `GET /api/privacy/exports` — lists mine, both kinds together. Polled
     * by `useExportJob.ts` exactly like `useCaptionsJob.ts`'s pattern (4s
     * interval, stop once every row is terminal). */
    getExports: builder.query<DataExport[], void>({
      query: () => '/api/privacy/exports',
      transformResponse: (response: { exports: DataExport[] }) => response.exports,
      providesTags: ['DataExport'],
    }),

    /**
     * `GET /api/privacy/exports/{id}/download` — 403 if not yours or not
     * ready, else a fresh presigned `{ url }`. Deliberately a plain query,
     * not a mutation: the account page skips this until the export's status
     * is `'ready'`, then renders the resolved `url` as a plain `<a href>` —
     * §7's "no blob-URL step needed client-side" (unlike
     * `useCaptionsJob.ts`'s `useCaptionsBlobUrl`, which exists only because
     * captions have no presigned-URL route; exports do).
     */
    getExportDownloadUrl: builder.query<ExportDownloadLink, number>({
      async queryFn(id, _api, _extraOptions, baseQuery) {
        // Captured immediately before transport so latency counts against the display window.
        const requestStartedAtMonotonicMs = performance.now()
        const requestSeq = ++requestSeqCounter
        const result = await baseQuery({ url: `/api/privacy/exports/${id}/download` })
        if (result.error) return { error: result.error }
        return { data: { url: (result.data as { url: string }).url, requestStartedAtMonotonicMs, requestSeq } }
      },
    }),

    /** `DELETE /api/account` — self-scoped, no id in the URL (§8: "always
     * `$request->user()`, no ownership ambiguity"). Body per
     * `DeleteAccountPayload`'s doc comment. No `transformResponse` — the
     * caller (`DeleteAccountDialog`) only cares whether this resolved or
     * threw, then hard-navigates away regardless of what the success body
     * contains. */
    deleteAccount: builder.mutation<void, DeleteAccountPayload>({
      query: (body) => ({ url: '/api/account', method: 'DELETE', body }),
    }),
  }),
})

export const {
  useRequestExportMutation,
  useGetExportsQuery,
  useGetExportDownloadUrlQuery,
  useDeleteAccountMutation,
} = privacyApi
