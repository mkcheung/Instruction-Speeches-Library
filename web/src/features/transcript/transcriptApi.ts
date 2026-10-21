import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { Transcript, SpeechSearchResult } from '@/features/transcript/types'

/**
 * STEP-09-FROZEN-CONTRACT.md §4: read/search-only projection, split from
 * `captionApi.ts` (see that file's header comment for why). Own
 * `tagTypes: ['Transcript', 'Search']`, own `baseQueryWithCsrfRetry`
 * wiring.
 *
 * Routes:
 *   GET /api/speeches/{speech}/transcript   -> { transcript: {...} }
 *   GET /api/speeches/search?q=...           -> { results: SpeechSearchResult[] }
 *
 * Search includes literal title/description/transcript matches and stays
 * in this slice so caption projection convergence can invalidate Search
 * together with Transcript. Highlight parts are plain text from the API;
 * the client never reruns matching or parses HTML.
 */
export const transcriptApi = createApi({
  reducerPath: 'transcriptApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Transcript', 'Search'],
  endpoints: (builder) => ({
    /**
     * ✅ `transformResponse` unwraps the `{ transcript: ... }` envelope,
     * reconciled against the real `TranscriptController::show`. See
     * `features/transcript/types.ts`'s header for the one field the
     * frozen contract's own `...` didn't spell out (`updated_at`,
     * `source: null` on the no-row-yet empty state) and the still-open,
     * higher-risk assumption about `segments`' per-row shape.
     */
    getTranscript: builder.query<Transcript, { speechId: number }>({
      query: ({ speechId }) => `/api/speeches/${speechId}/transcript`,
      transformResponse: (response: { transcript: Transcript }) => response.transcript,
      providesTags: (_result, _error, { speechId }) => [{ type: 'Transcript', id: speechId }],
    }),

    /**
     * `{ results: SpeechSearchResult[] }` preserves normal speech fields
     * and adds search-only highlight parts. Scoped to speeches the caller
     * OWNS, not everything they can merely view as a reviewer;
     * `q` is `required|string|min:1|max:255`
     * server-side (`SearchTranscriptsRequest`). An empty/whitespace-only
     * `q` and queries over 255 codepoints are skipped by `Search.tsx` via
     * `skipToken`, so the 422 that a blank `q` would otherwise produce is
     * never actually reachable from the UI.
     */
    searchSpeeches: builder.query<SpeechSearchResult[], { q: string }>({
      query: ({ q }) => `/api/speeches/search?q=${encodeURIComponent(q)}`,
      transformResponse: (response: { results: SpeechSearchResult[] }) => response.results,
      providesTags: ['Search'],
    }),
  }),
})

export const { useGetTranscriptQuery, useSearchSpeechesQuery, useLazySearchSpeechesQuery } = transcriptApi
