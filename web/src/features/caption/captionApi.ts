import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import { transcriptApi } from '@/features/transcript/transcriptApi'
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
     * server-side and flips its `source` to `'edited'` — this mutation
     * can't invalidate `transcriptApi`'s own `Transcript` tag directly
     * (different `reducerPath`, different cache), so `onQueryStarted`
     * dispatches `transcriptApi`'s own invalidation action once the write
     * actually succeeds. This is the one place `captionApi.ts` reaches
     * into another slice — deliberate, not an accident, and scoped to
     * exactly the cross-resource rule the contract calls out.
     *
     * `'Search'` is invalidated in the SAME dispatch, right alongside
     * `Transcript` — a caption edit re-derives `speech_transcripts.body`,
     * which is exactly what `searchSpeeches`'s `tsvector` match reads, so a
     * pre-warmed Search cache goes stale the moment the write succeeds.
     * There is no separate revision-convergence wait to line up with here:
     * this `onQueryStarted` already invalidates `Transcript` immediately
     * once `queryFulfilled` resolves (no polling in between), so `Search`
     * follows that identical timing rather than waiting on anything else.
     */
    updateCaptions: builder.mutation<Captions, { speechId: number; body: UpdateCaptionsPayload }>({
      query: ({ speechId, body }) => ({
        url: `/api/speeches/${speechId}/captions`,
        method: 'PUT',
        body,
      }),
      transformResponse: (response: { captions: Captions }) => response.captions,
      invalidatesTags: (_result, _error, { speechId }) => [{ type: 'Captions', id: speechId }],
      async onQueryStarted({ speechId }, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled
          dispatch(
            transcriptApi.util.invalidateTags([{ type: 'Transcript', id: speechId }, 'Search']),
          )
        } catch {
          // Write failed — leave the transcript/search caches alone;
          // nothing was re-derived server-side.
        }
      },
    }),
  }),
})

export const { useGetCaptionsQuery, useUpdateCaptionsMutation } = captionApi
