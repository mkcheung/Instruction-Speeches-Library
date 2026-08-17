import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { Essay, UpdateEssayPayload } from '@/features/essay/types'

/**
 * STEP-08-FROZEN-CONTRACT.md's frontend section: a new slice, not folded
 * into `reviewApi.ts` — this codebase already splits review-lifecycle
 * (`reviewApi`) from per-domain-content (`annotationApi`) into separate
 * slices despite both being review-scoped, and the essay is more content
 * than lifecycle. Own `tagTypes: ['Essay']`, own `baseQueryWithCsrfRetry`
 * wiring, same as `annotationApi.ts`/`reviewApi.ts`.
 *
 * Routes (mirrors the annotations convention exactly — reads take an
 * explicit `review_id`, writes derive the caller's own review server-side,
 * never a client-supplied `review_id` on a write):
 *   GET  /api/speeches/{speech}/essay?review_id=...
 *   PUT  /api/speeches/{speech}/essay
 *   POST /api/speeches/{speech}/essay/publish
 */
export const essayApi = createApi({
  reducerPath: 'essayApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Essay'],
  endpoints: (builder) => ({
    /**
     * `EssayResource` itself is a bare resource (no wrapper fields inside
     * it), but the real backend (`EssayController::show`) still wraps the
     * HTTP response body in `{ essay: EssayResource }`, same envelope
     * convention as `annotationApi.ts`'s create/update — reconciled against
     * the actual controller, not assumed. `transformResponse` unwraps it so
     * the rest of the frontend keeps working with a bare `Essay`.
     */
    getEssay: builder.query<Essay, { speechId: number; reviewId: number }>({
      query: ({ speechId, reviewId }) => `/api/speeches/${speechId}/essay?review_id=${reviewId}`,
      transformResponse: (response: { essay: Essay }) => response.essay,
      providesTags: (_result, _error, { reviewId }) => [{ type: 'Essay', id: reviewId }],
    }),

    /**
     * `PUT /api/speeches/{speech}/essay` — body must include `lock_version`
     * (optimistic locking, mirroring §10.2's annotation rule, now against
     * the essay's own separate `essay_lock_version` counter). `reviewId` is
     * only used to invalidate the right cache entry — the route itself has
     * no `review_id`; the row is the caller's own review for this speech,
     * resolved server-side.
     */
    updateEssay: builder.mutation<
      Essay,
      { speechId: number; reviewId: number; body: UpdateEssayPayload }
    >({
      query: ({ speechId, body }) => ({
        url: `/api/speeches/${speechId}/essay`,
        method: 'PUT',
        body,
      }),
      // Reconciled against `EssayController::update`: the success body is
      // `{ essay: EssayResource }`. The 409-conflict body does NOT go
      // through `transformResponse` (that only runs on success), so
      // `isEssayConflict` reads `error.data` as-is against
      // `EssayConflictException::render`'s shape, which is not enveloped —
      // `current` inside it is already a bare `EssayResource`.
      transformResponse: (response: { essay: Essay }) => response.essay,
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Essay', id: reviewId }],
    }),

    /** `POST /api/speeches/{speech}/essay/publish` — idempotent (a second
     * call is a no-op, mirroring `ReviewService::publish`). Reconciled
     * against `EssayController::publish`: same `{ essay: EssayResource }`
     * envelope as the other two endpoints. */
    publishEssay: builder.mutation<Essay, { speechId: number; reviewId: number }>({
      query: ({ speechId }) => ({
        url: `/api/speeches/${speechId}/essay/publish`,
        method: 'POST',
      }),
      transformResponse: (response: { essay: Essay }) => response.essay,
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Essay', id: reviewId }],
    }),
  }),
})

export const { useGetEssayQuery, useUpdateEssayMutation, usePublishEssayMutation } = essayApi
