import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { CreateReportPayload, Report } from '@/features/report/types'

/**
 * STEP-11-FROZEN-CONTRACT.md §1/§10: a new slice, not folded into
 * `reviewApi.ts`/`speechApi.ts` — reports are their own domain object,
 * reportable against either one, same "own tag types, own
 * `baseQueryWithCsrfRetry` wiring" convention every other slice in this
 * codebase follows (`essayApi.ts`, `captionApi.ts`).
 *
 * Route:
 *   POST /api/reports  ->  { report: ReportResource }
 *
 * Authorization is `SpeechPolicy::view` reused server-side (§1) — no
 * client-side gating needed beyond "don't render the button somewhere the
 * viewer couldn't already see the speech/review."
 */
export const reportApi = createApi({
  reducerPath: 'reportApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: [],
  endpoints: (builder) => ({
    /**
     * `POST /api/reports` — one endpoint for both speech-level (`SpeechWatch`'s
     * header) and review-level (`TrackSelector`'s per-track report) reports;
     * the caller supplies `reportable_type`/`reportable_id`. The success body
     * is `{ report: ReportResource }` (§10, "copy `essayApi.ts`'s exact
     * envelope-unwrap shape"); `transformResponse` unwraps it. The error body
     * on a 422 is NOT enveloped — matches every other slice, so
     * `extractServerErrorMessage`/`applyServerErrors` read `error.data`
     * as-is. No cache invalidation: nothing in this frontend reads reports
     * back — the admin queue is STEP-12, `php artisan reports:list` is the
     * only reader this step ships.
     */
    createReport: builder.mutation<Report, CreateReportPayload>({
      query: (body) => ({ url: '/api/reports', method: 'POST', body }),
      transformResponse: (response: { report: Report }) => response.report,
    }),
  }),
})

export const { useCreateReportMutation } = reportApi
