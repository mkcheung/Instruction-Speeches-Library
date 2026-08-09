import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type {
  CompletedPart,
  CreateSpeechPayload,
  CreateUploadPayload,
  CreateUploadResponse,
  PlaybackUrlResponse,
  Speech,
  SpeechAsset,
  SpeechListResponse,
  SignPartResponse,
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
} = speechApi
