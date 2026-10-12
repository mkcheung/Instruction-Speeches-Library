import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import { annotationApi } from '@/features/annotation/annotationApi'
import { speechApi } from '@/features/speech/speechApi'
import type {
  InviteReviewerPayload,
  PublishReviewResponse,
  Review,
  ReviewerDirectoryResponse,
  ReviewRosterResponse,
  ReviewSections,
  RevokeReviewPayload,
  RosterReview,
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
    /** IMPLEMENTATION-PLANS.md §7.2.3 — owner-only, same 404-never-403
     * non-owner treatment as `listSpeechReviews`, but with NO status
     * filter: every review row for the speech, including revoked/
     * declined/abandoned, is what powers `ReviewerRoster`'s four groups.
     * Deliberately a separate endpoint/cache-key rather than a query
     * param on `listSpeechReviews` — see the plan's §7.2.3 for why that
     * would make the access-granting-only guarantee a convention instead
     * of a structural one. */
    listReviewRoster: builder.query<RosterReview[], number>({
      query: (speechId) => `/api/speeches/${speechId}/review-roster`,
      transformResponse: (response: ReviewRosterResponse) => response.reviews,
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
    /**
     * IMPLEMENTATION-PLANS.md §7.2.6's traced bug: `withdrawReview` used
     * to take a bare review id, which was enough for its OWN tag but gave
     * nothing to invalidate the `speechApi` slice's cached `Speech` with.
     * Widened to carry `speechId` so the cross-slice dispatch below can
     * run. Was an exported hook with zero call sites before this change —
     * verified via `grep -rn "useWithdrawReviewMutation" web/src` — so
     * widening the arg shape breaks nothing.
     *
     * `speechApi`'s `Speech` tag lives in a DIFFERENT `createApi` instance
     * (`invalidatesTags` here can only reach `reviewApi`'s own tags), so
     * this explicitly dispatches `speechApi.util.invalidateTags` in
     * `onQueryStarted` — same pattern `publishReview` below already uses
     * to reach `annotationApi`, and `updateCaptionSettings`
     * (`speechApi.ts`) uses to reach `captionApi`. Without this, a coach
     * who withdraws sees `useMyReviewForSpeech` go null (next section),
     * `SpeechWatch`'s feedback tab strip unmount, but the cached `Speech`
     * object survive untouched — so hitting the browser Back button would
     * NOT re-run the owner guard and would NOT show the honest 403;
     * invalidating `Speech` here is what makes that recheck happen.
     */
    // code-review finding: `speechId` is optional, not required — a
    // review's `speech` relation can legitimately come back null (e.g.
    // Dashboard's list doesn't eager-load `withTrashed()`, so a taken-down
    // speech's review arrives with no `speech` at all) and the action must
    // still be reachable; only the cross-slice `Speech`-cache invalidation
    // depends on having an id, and that's a cache-freshness nicety, not a
    // correctness requirement for the withdraw itself.
    withdrawReview: builder.mutation<Review, { id: number; speechId?: number }>({
      query: ({ id }) => ({ url: `/api/reviews/${id}/withdraw`, method: 'POST' }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: (_result, _error, arg) => [{ type: 'Review', id: arg.id }, 'Review'],
      async onQueryStarted({ speechId }, { dispatch, queryFulfilled }) {
        if (speechId === undefined) return
        try {
          await queryFulfilled
          dispatch(speechApi.util.invalidateTags([{ type: 'Speech', id: speechId }]))
        } catch {
          // Withdraw failed — leave the Speech cache alone.
        }
      },
    }),
    /** §7.2.5: owner- or admin-tier only. No `speechId` arg, unlike
     * `withdrawReview`/`abandonReview` below — revoking is the SPEECH
     * OWNER's act over someone else's review, so the owner never loses
     * their own reach to the speech the way a reviewer withdrawing from
     * their own review does, and there is no cross-slice `Speech`
     * invalidation to thread it through for. The broad `'Review'` tag
     * this already invalidates covers `listReviewRoster` and
     * `listSpeechReviews` (both `providesTags` it), so the roster row and
     * the owner's commentary-track selector both refetch for free. */
    revokeReview: builder.mutation<Review, { id: number; body?: RevokeReviewPayload }>({
      query: ({ id, body }) => ({ url: `/api/reviews/${id}/revoke`, method: 'POST', body }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: (_result, _error, arg) => [{ type: 'Review', id: arg.id }, 'Review'],
    }),
    /**
     * IMPLEMENTATION-PLANS.md §7.2.6: `POST /api/reviews/{review}/
     * revoke-and-purge` returns **204 No Content** — typed `void`, not
     * `Review`, since parsing an empty body as JSON would silently fail.
     * `body` carries the mandatory reason (`RevokeReviewDialog` requires
     * one for both modes — confirmed server-side, `RevokeReviewRequest`
     * backs this route too and requires `reason` unconditionally here
     * since purge, unlike plain revoke, is never an idempotent retry).
     * No `speechId` arg — same reasoning as `revokeReview` above. */
    revokeAndPurgeReview: builder.mutation<void, { id: number; body?: RevokeReviewPayload }>({
      query: ({ id, body }) => ({ url: `/api/reviews/${id}/revoke-and-purge`, method: 'POST', body }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Review', id: arg.id }, 'Review'],
    }),
    /** Same `speechId`-threading and cross-slice-`Speech`-invalidation
     * reasoning as `withdrawReview` above — abandon is the reviewer's own
     * act too, and unmounts the same tab strip the same way. `speechId` is
     * optional for the same reason: a null `speech` relation must not
     * block the action, only the cache-freshness nicety. */
    abandonReview: builder.mutation<Review, { id: number; speechId?: number }>({
      query: ({ id }) => ({ url: `/api/reviews/${id}/abandon`, method: 'POST' }),
      transformResponse: (response: { review: Review }) => response.review,
      invalidatesTags: (_result, _error, arg) => [{ type: 'Review', id: arg.id }, 'Review'],
      async onQueryStarted({ speechId }, { dispatch, queryFulfilled }) {
        if (speechId === undefined) return
        try {
          await queryFulfilled
          dispatch(speechApi.util.invalidateTags([{ type: 'Speech', id: speechId }]))
        } catch {
          // Abandon failed — leave the Speech cache alone.
        }
      },
    }),
    /**
     * STEP-07-write-commentary.md's frozen contract (4):
     * `POST /api/reviews/{review}/publish` — review-scoped (the route
     * lives under `/reviews/{review}`, not `/speeches/{speech}`), so this
     * lives here rather than in `annotationApi.ts` even though it flips
     * every annotation row in the set. `annotationApi`'s `'Annotations'`
     * tag lives in a different RTK Query slice — cross-slice invalidation
     * is done explicitly via `dispatch(annotationApi.util.invalidateTags)`
     * in `onQueryStarted` rather than `invalidatesTags`, which can only
     * reach tags in this same `createApi` instance.
     */
    publishReview: builder.mutation<PublishReviewResponse, number>({
      query: (id) => ({ url: `/api/reviews/${id}/publish`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Review', id }, 'Review'],
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled
          dispatch(annotationApi.util.invalidateTags([{ type: 'Annotations', id }]))
        } catch {
          // Publish failed — nothing to invalidate.
        }
      },
    }),
  }),
})

export const {
  useListMyReviewsQuery,
  useListSpeechReviewsQuery,
  useListReviewRosterQuery,
  useSearchReviewersQuery,
  useInviteReviewerMutation,
  useAcceptReviewMutation,
  useDeclineReviewMutation,
  useWithdrawReviewMutation,
  useRevokeReviewMutation,
  useRevokeAndPurgeReviewMutation,
  useAbandonReviewMutation,
  usePublishReviewMutation,
} = reviewApi
