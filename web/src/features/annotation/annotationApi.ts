import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type {
  Annotation,
  AnnotationsResponse,
  CreateAnnotationPayload,
  CreateVoiceAnnotationPayload,
  UpdateAnnotationPayload,
  VoiceAudioUrlResponse,
  VoiceCommentaryMode,
  VoiceCommentaryPreferenceResponse,
} from '@/features/annotation/types'

/**
 * STEP-06-watch-commentary.md's frozen contract:
 * `GET /api/speeches/{speech}/annotations?review_id={review_id}`.
 *
 * Errors (403 not authorized, 404 review doesn't belong to this speech,
 * 422 missing/non-integer `review_id`, and — since STEP-07 widened this
 * endpoint's status-code surface — 410 for a speech that was found but is
 * soft-deleted) are deliberately left as RTK Query's normal `error` result
 * rather than papered over with a `transformErrorResponse` that returns an
 * empty list — the contract's "reject rather than silently fall back to
 * 'No commentary'" rule means the consumer (`TrackSelector`) must render a
 * real error state, which needs the error to actually surface.
 * `TrackSelector`/`useCommentaryTrack` already treat any truthy error
 * uniformly (`Boolean(error)`), so 410 renders as the same error banner as
 * 403/404/422 without needing a status-specific branch.
 */
export const annotationApi = createApi({
  reducerPath: 'annotationApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Annotations', 'VoicePreference'],
  endpoints: (builder) => ({
    getAnnotations: builder.query<AnnotationsResponse, { speechId: number; reviewId: number }>({
      query: ({ speechId, reviewId }) =>
        `/api/speeches/${speechId}/annotations?review_id=${reviewId}`,
      providesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),

    /**
     * STEP-07's frozen contract (1): `POST /speeches/{speech}/annotations`.
     * Idempotent on `client_uuid` — a repeat POST with the same
     * `client_uuid` returns the existing row (200; a genuine new row is
     * 201 — RTK Query doesn't distinguish, both are "success"), which is
     * both how a doubly-fired create is made safe and how the 6-second
     * Undo toast un-deletes a row. `reviewId` is only used to invalidate
     * the right `Annotations` cache entry; the endpoint itself has no
     * `review_id` in its URL (the row's review comes from the caller's own
     * session-resolved review for this speech, server-side). Reconciled
     * against the real backend (`AnnotationController::store`): the
     * response body is `{ annotation: AnnotationResource }`, an envelope —
     * `transformResponse` unwraps it so the rest of the frontend keeps
     * working with a bare `Annotation`.
     */
    createAnnotation: builder.mutation<
      Annotation,
      { speechId: number; reviewId: number; body: CreateAnnotationPayload }
    >({
      query: ({ speechId, body }) => ({
        url: `/api/speeches/${speechId}/annotations`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { annotation: Annotation }) => response.annotation,
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),

    /** STEP-10: small voice recordings go through Laravel directly rather
     * than the multipart object-storage upload protocol. Do not set a
     * Content-Type header: fetch supplies the FormData boundary. */
    createVoiceAnnotation: builder.mutation<
      Annotation,
      { speechId: number; reviewId: number; body: CreateVoiceAnnotationPayload }
    >({
      query: ({ speechId, body }) => {
        const form = new FormData()
        form.append('audio', body.audio, `voice-note.${extensionForMime(body.audio.type)}`)
        form.append('client_uuid', body.client_uuid)
        form.append('start_seconds', String(body.start_seconds))
        if (body.kind) form.append('kind', body.kind)
        if (body.topic !== undefined && body.topic !== null) form.append('topic', body.topic)
        return { url: `/api/speeches/${speechId}/voice-notes`, method: 'POST', body: form }
      },
      transformResponse: (response: { annotation: Annotation }) => response.annotation,
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),

    getVoiceAudioUrl: builder.query<
      VoiceAudioUrlResponse,
      { speechId: number; annotationId: string }
    >({
      query: ({ speechId, annotationId }) =>
        `/api/speeches/${speechId}/annotations/${annotationId}/voice-playback-url`,
    }),

    retryVoiceTranscript: builder.mutation<
      Annotation,
      { speechId: number; reviewId: number; annotationId: string }
    >({
      query: ({ speechId, annotationId }) => ({
        url: `/api/speeches/${speechId}/annotations/${annotationId}/voice-transcript/retry`,
        method: 'POST',
      }),
      transformResponse: (response: { annotation: Annotation }) => response.annotation,
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),

    restoreVoiceAnnotation: builder.mutation<
      Annotation,
      { speechId: number; reviewId: number; annotationId: string }
    >({
      query: ({ speechId, annotationId }) => ({
        url: `/api/speeches/${speechId}/annotations/${annotationId}/restore`,
        method: 'POST',
      }),
      transformResponse: (response: { annotation: Annotation }) => response.annotation,
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),

    updateVoiceCommentaryPreference: builder.mutation<
      VoiceCommentaryPreferenceResponse,
      { speechId: number; mode: VoiceCommentaryMode; experienced: boolean }
    >({
      query: ({ speechId, mode, experienced }) => ({
        url: `/api/me/preferences/voice-commentary/${speechId}`,
        method: 'PATCH',
        body: { mode, experienced },
      }),
      invalidatesTags: (_result, _error, { speechId }) => [{ type: 'VoicePreference', id: speechId }],
    }),
    getVoiceCommentaryPreference: builder.query<VoiceCommentaryPreferenceResponse, { speechId: number }>({
      query: ({ speechId }) => `/api/me/preferences/voice-commentary/${speechId}`,
      providesTags: (_result, _error, { speechId }) => [{ type: 'VoicePreference', id: speechId }],
    }),

    /**
     * STEP-07's frozen contract (2): `PATCH /speeches/{speech}/annotations
     * /{annotation}`. Body must include `lock_version` (§10.2). On a 409
     * conflict the error payload is `{ message, conflictSource, current }`
     * — left as RTK Query's normal `error` result (not papered over) so
     * the composer's three-tier conflict UI can read `error.data`; a 409's
     * body does NOT go through `transformResponse` (that only runs on
     * success), so `isAnnotationConflict` reads `error.data` as-is against
     * the real `AnnotationConflictException::render` shape, which is not
     * enveloped. Reconciled against the real backend
     * (`AnnotationController::update`): the SUCCESS body is
     * `{ annotation: AnnotationResource }`, same envelope as create.
     */
    updateAnnotation: builder.mutation<
      Annotation,
      { speechId: number; reviewId: number; annotationId: string; body: UpdateAnnotationPayload }
    >({
      query: ({ speechId, annotationId, body }) => ({
        url: `/api/speeches/${speechId}/annotations/${annotationId}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: { annotation: Annotation }) => response.annotation,
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),

    /**
     * STEP-07's frozen contract (3): `DELETE /speeches/{speech}/annotations
     * /{annotation}` — single-row, immediate (NOT deferred until the Undo
     * toast expires). The composer is responsible for retaining the
     * deleted row's fields client-side so Undo can replay them via
     * `createAnnotation` with the identical `client_uuid`.
     */
    deleteAnnotation: builder.mutation<
      void,
      { speechId: number; reviewId: number; annotationId: string }
    >({
      query: ({ speechId, annotationId }) => ({
        url: `/api/speeches/${speechId}/annotations/${annotationId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),

    /**
     * STEP-07's frozen contract (5): `DELETE /speeches/{speech}
     * /annotation-sets/me` — clears the caller's own annotation set for
     * this speech. No `authorId` parameter (the backend resolves "your own
     * review" from the session). Reconciled against the real backend
     * (`AnnotationController::clearMine`): confirmed 204/no body, matching
     * what this endpoint was originally built against.
     */
    clearAnnotations: builder.mutation<void, { speechId: number; reviewId: number }>({
      query: ({ speechId }) => ({
        url: `/api/speeches/${speechId}/annotation-sets/me`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'Annotations', id: reviewId }],
    }),
  }),
})

export const {
  useGetAnnotationsQuery,
  useLazyGetAnnotationsQuery,
  useCreateAnnotationMutation,
  useCreateVoiceAnnotationMutation,
  useLazyGetVoiceAudioUrlQuery,
  useRetryVoiceTranscriptMutation,
  useRestoreVoiceAnnotationMutation,
  useUpdateVoiceCommentaryPreferenceMutation,
  useGetVoiceCommentaryPreferenceQuery,
  useUpdateAnnotationMutation,
  useDeleteAnnotationMutation,
  useClearAnnotationsMutation,
} = annotationApi

function extensionForMime(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

/** Hover-prefetch on a radiogroup option, per STEP-06's contract ("prefetch
 * on hover of a radiogroup option"). RTK Query's built-in `usePrefetch`
 * dedupes against an in-flight/cached query for the same arg automatically. */
export const usePrefetchAnnotations = annotationApi.usePrefetch
