import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import { captionApi } from '@/features/caption/captionApi'
import type {
  CompletedPart,
  CreateSpeechPayload,
  CreateUploadPayload,
  CreateUploadResponse,
  PlaybackUrlResponse,
  SetPosterFramePayload,
  Speech,
  SpeechAsset,
  SpeechListResponse,
  SignPartResponse,
  TranscodeDepthResponse,
} from '@/features/speech/types'

/**
 * STEP-03-upload-and-watch.md (§9, §6.11). The multipart PUT of the actual
 * bytes never goes through this slice — `fetchBaseQuery`/RTK Query has no
 * upload-progress API — only the presign/complete/abort/status endpoints
 * do. `UploadDashboard.tsx` drives Uppy's `@uppy/aws-s3` against these.
 */
export const speechApi = createApi({
  reducerPath: 'speechApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Speech', 'SpeechAsset'],
  endpoints: (builder) => ({
    listSpeeches: builder.query<SpeechListResponse, void>({
      query: () => '/api/speeches',
      providesTags: (result) =>
        result
          ? [...result.speeches.map((s) => ({ type: 'Speech' as const, id: s.id })), 'Speech']
          : ['Speech'],
    }),
    getSpeech: builder.query<Speech, number>({
      query: (id) => `/api/speeches/${id}`,
      transformResponse: (response: { speech: Speech }) => response.speech,
      providesTags: (_result, _error, id) => [{ type: 'Speech', id }],
    }),
    createSpeech: builder.mutation<Speech, CreateSpeechPayload>({
      query: (body) => ({ url: '/api/speeches', method: 'POST', body }),
      transformResponse: (response: { speech: Speech }) => response.speech,
      invalidatesTags: ['Speech'],
    }),
    createUpload: builder.mutation<CreateUploadResponse, { speechId: number; body: CreateUploadPayload }>({
      query: ({ speechId, body }) => ({
        url: `/api/speeches/${speechId}/assets/uploads`,
        method: 'POST',
        body,
      }),
    }),
    signPart: builder.mutation<
      SignPartResponse,
      { speechId: number; assetId: number; uploadId: string; partNumber: number }
    >({
      query: ({ speechId, assetId, uploadId, partNumber }) => ({
        url: `/api/speeches/${speechId}/assets/${assetId}/uploads/${uploadId}/parts/${partNumber}`,
        method: 'POST',
      }),
    }),
    completeUpload: builder.mutation<
      { asset: SpeechAsset },
      { speechId: number; assetId: number; uploadId: string; parts: CompletedPart[] }
    >({
      query: ({ speechId, assetId, uploadId, parts }) => ({
        url: `/api/speeches/${speechId}/assets/${assetId}/uploads/${uploadId}/complete`,
        method: 'POST',
        body: { parts },
      }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Speech', id: arg.speechId }],
    }),
    abortUpload: builder.mutation<void, { speechId: number; assetId: number; uploadId: string }>({
      query: ({ speechId, assetId, uploadId }) => ({
        url: `/api/speeches/${speechId}/assets/${assetId}/uploads/${uploadId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Speech', id: arg.speechId }],
    }),
    retryAsset: builder.mutation<{ asset: SpeechAsset }, { speechId: number; assetId: number }>({
      query: ({ speechId, assetId }) => ({
        url: `/api/speeches/${speechId}/assets/${assetId}/retry`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Speech', id: arg.speechId }],
    }),
    /** §9.3's refresh-on-403 handler calls this directly (not through a
     * hook) so the player controls exactly when a fresh URL is fetched —
     * see shared/media/videojs-adapter.ts. */
    getPlaybackUrl: builder.query<PlaybackUrlResponse, { speechId: number; assetId: number }>({
      query: ({ speechId, assetId }) => `/api/speeches/${speechId}/assets/${assetId}/playback-url`,
    }),
    /** STEP-04 §9.5's backpressure gauge — global, not speech-scoped.
     * Polled unconditionally at a slow interval by whatever renders it
     * (`StatusBadge`); a background GET every few seconds is cheap enough
     * not to need gating on "is anything actually processing right now." */
    getTranscodeDepth: builder.query<TranscodeDepthResponse, void>({
      query: () => '/api/queue/transcode-depth',
    }),
    /** STEP-04 §9.5's frame-picking endpoint — poster regeneration happens
     * async in the background, so this only invalidates the speech (the
     * next poll of `getSpeech`/`listSpeeches` picks up the regenerated
     * poster once it's ready); callers should not block on this resolving
     * before showing the new poster. */
    setPosterFrame: builder.mutation<
      { asset: SpeechAsset },
      { speechId: number; assetId: number; body: SetPosterFramePayload }
    >({
      query: ({ speechId, assetId, body }) => ({
        url: `/api/speeches/${speechId}/assets/${assetId}/poster-frame`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Speech', id: arg.speechId }],
    }),
    /** captions-settings gap fix: `PATCH /speeches/{speech}/caption-
     * settings`, the missing write surface for `speeches.captions_enabled`
     * (STEP-09 shipped the column read-only). `invalidatesTags` covers this
     * slice's own `Speech` cache; `onQueryStarted` additionally invalidates
     * `captionApi`'s `Captions` tag once the write succeeds — same
     * cross-slice-dispatch pattern `captionApi.ts`'s own `updateCaptions`
     * uses to reach into `transcriptApi`, for the same reason: toggling
     * captions off can move the caption asset itself (a `processing` row
     * moving to `failed`/`captions_disabled`), and a stale
     * `getCaptions` cache would keep showing the old status until an
     * unrelated refetch happened to occur. */
    updateCaptionSettings: builder.mutation<Speech, { speechId: number; captions_enabled: boolean }>({
      query: ({ speechId, captions_enabled: captionsEnabled }) => ({
        url: `/api/speeches/${speechId}/caption-settings`,
        method: 'PATCH',
        body: { captions_enabled: captionsEnabled },
      }),
      transformResponse: (response: { speech: Speech }) => response.speech,
      invalidatesTags: (_result, _error, arg) => [{ type: 'Speech', id: arg.speechId }],
      async onQueryStarted({ speechId }, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled
          dispatch(captionApi.util.invalidateTags([{ type: 'Captions', id: speechId }]))
        } catch {
          // Write failed — leave the captions cache alone.
        }
      },
    }),
  }),
})

export const {
  useListSpeechesQuery,
  useGetSpeechQuery,
  useCreateSpeechMutation,
  useCreateUploadMutation,
  useSignPartMutation,
  useCompleteUploadMutation,
  useAbortUploadMutation,
  useRetryAssetMutation,
  useLazyGetPlaybackUrlQuery,
  useGetTranscodeDepthQuery,
  useSetPosterFrameMutation,
  useUpdateCaptionSettingsMutation,
} = speechApi
