import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { Captions, UpdateCaptionsPayload } from '@/features/caption/types'

/**
 * STEP-09-FROZEN-CONTRACT.md §4: a new slice, not folded into
 * `transcriptApi.ts` — captions are an editable resource (the speaker
 * fixes Whisper's mistakes), transcript is a read/search-only projection
 * derived from them, "same split logic that kept `reviewApi`/
 * `annotationApi`/`essayApi` separate" per the contract's own wording. Own
 * `tagTypes: ['Captions']`, own `baseQueryWithCsrfRetry` wiring, same as
 * every other domain slice in this codebase.
 *
 * Routes:
 *   GET /api/speeches/{speech}/captions          -> { captions: {...} }
 *   PUT /api/speeches/{speech}/captions           -> { captions: {...} }
 *
 * No `lock_version` on the PUT body — §4 is explicit that captions have no
 * optimistic-locking scheme, unlike `essayApi.ts`/`annotationApi.ts`.
 */
export const captionApi = createApi({
  reducerPath: 'captionApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Captions'],
  endpoints: (builder) => ({
    /**
     * ✅ `transformResponse` unwraps the `{ captions: ... }` envelope,
     * reconciled against the real `CaptionController::show` (see
     * `features/caption/types.ts`'s header comment for the two fields the
     * frozen contract's own `...` didn't spell out: the `'unavailable'`
     * status value and `failure_code`/`updated_at`). Deliberately typed
     * enveloped rather than bare, per the contract's explicit warning
     * about STEP-08's `essay_lock_version: undefined` bug.
     */
    getCaptions: builder.query<Captions, { speechId: number }>({
      query: ({ speechId }) => `/api/speeches/${speechId}/captions`,
      transformResponse: (response: { captions: Captions }) => response.captions,
      providesTags: (_result, _error, { speechId }) => [{ type: 'Captions', id: speechId }],
    }),

    /**
     * `PUT /api/speeches/{speech}/captions`, body `{ vtt }`. §6.12/§8 of
     * the contract: editing a caption line re-derives `speech_transcripts`
     * server-side and flips its `source` to `'edited'` — but that
     * derivation is asynchronous (`RederiveTranscript`, dispatched off the
     * write, §4.1), so this response is NOT proof the transcript/search
     * projections are current yet.
     *
     * This mutation therefore does NOT invalidate `transcriptApi`'s
     * `Transcript`/`Search` tags itself. An earlier version of this file
     * did exactly that from `onQueryStarted` right after `queryFulfilled`
     * — a real premature-invalidation bug (found in code review) that
     * fired those caches before the server had actually finished
     * re-deriving anything. STEP-09-VERIFICATION-PLAN.md §4.1's
     * "Projection convergence token" replaces it: `useCaptionEditor.ts`
     * (the actual PUT caller) reads this response's `revision` and polls
     * `transcriptApi`'s `getTranscript` until `caption_revision` matches
     * it, invalidating `Transcript`/`Search` only on that match (or
     * surfacing an honest timeout otherwise). That poll lives with the
     * caller, not here, because only the caller's component can render the
     * "still updating" state a fire-and-forget cache-layer effect cannot.
     */
    updateCaptions: builder.mutation<Captions, { speechId: number; body: UpdateCaptionsPayload }>({
      query: ({ speechId, body }) => ({
        url: `/api/speeches/${speechId}/captions`,
        method: 'PUT',
        body,
      }),
      transformResponse: (response: { captions: Captions }) => response.captions,
      invalidatesTags: (_result, _error, { speechId }) => [{ type: 'Captions', id: speechId }],
    }),
  }),
})

export const { useGetCaptionsQuery, useUpdateCaptionsMutation } = captionApi
