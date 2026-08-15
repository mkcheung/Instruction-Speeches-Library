import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type {
  InviteReviewerPayload,
  Review,
  ReviewerDirectoryResponse,
  ReviewSections,
  RevokeReviewPayload,
  SpeechReviewListResponse,
} from '@/features/review/types'

/**
 * STEP-05-invitation-loop.md. Matched against the real backend as it
 * landed mid-implementation (`api/app/Http/Controllers/Api/
 * ReviewController.php`, `ReviewerDirectoryController.php`) — see
 * `features/review/types.ts`'s header comment for the two gaps found
 * while reconciling (routes not yet registered; no speaker name on the
 * review resource).
 */
export const reviewApi = createApi({
  reducerPath: 'reviewApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Review', 'ReviewerDirectory'],
  endpoints: (builder) => ({
    /** `GET /api/reviews` with no `?section=` — the server returns all
     * four dashboard sections, already sorted, in one payload. */
    listMyReviews: builder.query<ReviewSections, void>({
      query: () => '/api/reviews',
      providesTags: (result) =>
        result
          ? [
              ...Object.values(result)
                .flat()
                .filter((r): r is Review => !!r)
                .map((r) => ({ type: 'Review' as const, id: r.id })),
              'Review',
            ]
          : ['Review'],
    }),
    /** Owner-only — feeds the speaker's track selector. */
    listSpeechReviews: builder.query<Review[], number>({
      query: (speechId) => `/api/speeches/${speechId}/reviews`,
      transformResponse: (response: SpeechReviewListResponse) => response.reviews,
      providesTags: (result) =>
        result
          ? [...result.map((r) => ({ type: 'Review' as const, id: r.id })), 'Review']
          : ['Review'],
    }),
    /** §6.3's reviewer directory — the only discovery mechanism (no open
     * pool). `credential` is optional so "browse everyone" is a real
     * first state, not just a search-only box. `page` is not optional
     * decoration: the endpoint paginates at 20 and reports `last_page`, so
     * without sending it the twenty-first reviewer onward is unreachable in
     * the only place reviewers can be found at all. */
    searchReviewers: builder.query<
      ReviewerDirectoryResponse,
      { search?: string; credential?: 'member' | 'coach'; page?: number }
    >({
      query: ({ search, credential, page }) => {
        const params = new URLSearchParams()
        if (search) params.set('search', search)
        if (credential) params.set('credential', credential)
        if (page && page > 1) params.set('page', String(page))
        const qs = params.toString()
        return `/api/reviewers${qs ? `?${qs}` : ''}`
      },
      providesTags: ['ReviewerDirectory'],
    }),
    inviteReviewer: builder.mutation<Review, { speechId: number; body: InviteReviewerPayload }>({
      query: ({ speechId, body }) => ({
        url: `/api/speeches/${speechId}/reviews`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: ['Review'],
    }),
    acceptReview: builder.mutation<Review, number>({
      query: (id) => ({ url: `/api/reviews/${id}/accept`, method: 'POST' }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: (_result, _error, id) => [{ type: 'Review', id }, 'Review'],
    }),
    declineReview: builder.mutation<Review, number>({
      query: (id) => ({ url: `/api/reviews/${id}/decline`, method: 'POST' }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: (_result, _error, id) => [{ type: 'Review', id }, 'Review'],
    }),
    withdrawReview: builder.mutation<Review, number>({
      query: (id) => ({ url: `/api/reviews/${id}/withdraw`, method: 'POST' }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: (_result, _error, id) => [{ type: 'Review', id }, 'Review'],
    }),
    revokeReview: builder.mutation<Review, { id: number; body?: RevokeReviewPayload }>({
      query: ({ id, body }) => ({ url: `/api/reviews/${id}/revoke`, method: 'POST', body }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: (_result, _error, arg) => [{ type: 'Review', id: arg.id }, 'Review'],
    }),
    abandonReview: builder.mutation<Review, number>({
      query: (id) => ({ url: `/api/reviews/${id}/abandon`, method: 'POST' }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: (_result, _error, id) => [{ type: 'Review', id }, 'Review'],
    }),
  }),
})

export const {
  useListMyReviewsQuery,
  useListSpeechReviewsQuery,
  useSearchReviewersQuery,
  useInviteReviewerMutation,
  useAcceptReviewMutation,
  useDeclineReviewMutation,
  useWithdrawReviewMutation,
  useRevokeReviewMutation,
  useAbandonReviewMutation,
} = reviewApi
