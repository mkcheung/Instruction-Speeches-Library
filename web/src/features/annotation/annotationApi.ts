import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { AnnotationsResponse } from '@/features/annotation/types'

/**
 * STEP-06-watch-commentary.md's frozen contract:
 * `GET /api/speeches/{speech}/annotations?review_id={review_id}`.
 *
 * Errors (403 not authorized, 404 review doesn't belong to this speech,
 * 422 missing/non-integer `review_id`) are deliberately left as RTK
 * Query's normal `error` result rather than papered over with a
 * `transformErrorResponse` that returns an empty list — the contract's
 * "reject rather than silently fall back to 'No commentary'" rule means
 * the consumer (`TrackSelector`) must render a real error state, which
 * needs the error to actually surface.
 */
export const annotationApi = createApi({
  reducerPath: 'annotationApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Annotations'],
  endpoints: (builder) => ({
    getAnnotations: builder.query<AnnotationsResponse, { speechId: number; reviewId: number }>({
      query: ({ speechId, reviewId }) =>
        `/api/speeches/${speechId}/annotations?review_id=${reviewId}`,
      providesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),
  }),
})

export const { useGetAnnotationsQuery, useLazyGetAnnotationsQuery } = annotationApi

/** Hover-prefetch on a radiogroup option, per STEP-06's contract ("prefetch
 * on hover of a radiogroup option"). RTK Query's built-in `usePrefetch`
 * dedupes against an in-flight/cached query for the same arg automatically. */
export const usePrefetchAnnotations = annotationApi.usePrefetch
