import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { CoachApplication, CoachApplicationPayload } from '@/features/coachApplication/types'

/**
 * STEP-12-FROZEN-CONTRACT.md §9 — a new slice, own `tagTypes`, same
 * `baseQueryWithCsrfRetry` wiring as every other per-domain slice
 * (`essayApi.ts`/`reviewApi.ts`). Every write/read response is enveloped
 * as `{ coachApplication: CoachApplicationResource }` per the frozen
 * contract; `transformResponse` unwraps it on every endpoint below —
 * STEP-08 shipped a real bug from skipping this once (a slice consuming
 * the enveloped shape directly), so this mirrors `essayApi.ts`'s pattern
 * on all three endpoints, not just the reads.
 *
 * Routes (frozen, not guessed):
 *   POST /api/coach-applications              — create/submit the caller's own draft
 *   GET  /api/coach-applications/me            — the caller's own application, if any
 *   POST /api/coach-applications/{id}/documents — multipart, up to two PDFs
 */
export const coachApplicationApi = createApi({
  reducerPath: 'coachApplicationApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['CoachApplication'],
  endpoints: (builder) => ({
    /** No application yet is a real, common state (nobody has applied),
     * surfaced as a 404 from the backend rather than a bare `null` body —
     * callers check `getErrorStatus(error) === 404`, same convention
     * `ReviewerDirectory.tsx` uses for its own 403 case. */
    getMyCoachApplication: builder.query<CoachApplication, void>({
      query: () => '/api/coach-applications/me',
      transformResponse: (response: { coachApplication: CoachApplication }) => response.coachApplication,
      providesTags: ['CoachApplication'],
    }),
    /** Called twice across the applicant's flow: once to create/save the
     * draft statement (returning an `id` the document-upload step needs),
     * and again — after documents are attached — to submit. Both hit this
     * same idempotent-upsert route per the frozen contract's single write
     * endpoint. */
    submitCoachApplication: builder.mutation<CoachApplication, CoachApplicationPayload>({
      query: (body) => ({ url: '/api/coach-applications', method: 'POST', body }),
      transformResponse: (response: { coachApplication: CoachApplication }) => response.coachApplication,
      invalidatesTags: ['CoachApplication'],
    }),
    /** `formData` carries up to two PDFs. Field name assumed `documents[]`
     * (Laravel's array-upload convention) — not itself pinned by the
     * frozen contract, flagged here for reconciliation against the real
     * `StoreApplicationDocumentsRequest` once it exists. */
    uploadCoachApplicationDocuments: builder.mutation<CoachApplication, { id: number; formData: FormData }>({
      query: ({ id, formData }) => ({
        url: `/api/coach-applications/${id}/documents`,
        method: 'POST',
        body: formData,
      }),
      transformResponse: (response: { coachApplication: CoachApplication }) => response.coachApplication,
      invalidatesTags: ['CoachApplication'],
    }),
  }),
})

export const {
  useGetMyCoachApplicationQuery,
  useSubmitCoachApplicationMutation,
  useUploadCoachApplicationDocumentsMutation,
} = coachApplicationApi
