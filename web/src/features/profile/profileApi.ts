import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { MeResponse } from '@/features/auth/types'
import type {
  OnboardingStatus,
  OnboardingStep1Payload,
  OnboardingStep2Payload,
  ProfileEditPayload,
  PublicProfile,
  UsernameAvailability,
} from '@/features/profile/types'

/**
 * §6.5: onboarding writes to `profiles`/`users` on every step (resumable —
 * no client-side accumulation), so each step here is its own mutation that
 * invalidates the status query rather than one big submit at the end.
 *
 * There is no `GET /api/profile` for "my own profile with bio/avatar" —
 * `UserResource` (what `/api/me` and the mutations below return)
 * deliberately never carries profile fields (bio, pronouns, location,
 * avatar), only `PublicProfileResource` does. `ProfileEdit.tsx` reads its
 * own bio/avatar the same way anyone else would: `getPublicProfile` against
 * its own username (known from `/api/me`).
 */
export const profileApi = createApi({
  reducerPath: 'profileApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['OnboardingStatus', 'PublicProfile'],
  endpoints: (builder) => ({
    getOnboardingStatus: builder.query<OnboardingStatus, void>({
      query: () => '/api/onboarding',
      providesTags: ['OnboardingStatus'],
    }),
    submitOnboardingStep1: builder.mutation<OnboardingStatus, OnboardingStep1Payload>({
      query: (body) => ({ url: '/api/onboarding/step-1', method: 'POST', body }),
      invalidatesTags: ['OnboardingStatus'],
    }),
    submitOnboardingStep2: builder.mutation<OnboardingStatus, OnboardingStep2Payload>({
      query: (body) => ({ url: '/api/onboarding/step-2', method: 'POST', body }),
      invalidatesTags: ['OnboardingStatus'],
    }),
    /** `body` is a `FormData`, optionally carrying the cropped avatar as
     * `avatar` — omitting it still completes onboarding (§6.5: avatar is
     * skippable; step 3's submission is what sets `onboarding_completed_at`
     * regardless). */
    submitOnboardingStep3: builder.mutation<OnboardingStatus, FormData>({
      query: (body) => ({ url: '/api/onboarding/step-3', method: 'POST', body }),
      invalidatesTags: ['OnboardingStatus'],
    }),
    updateOwnProfile: builder.mutation<MeResponse, ProfileEditPayload & { username?: string }>({
      query: (body) => ({ url: '/api/profile', method: 'PATCH', body }),
      invalidatesTags: (_result, _error, arg) =>
        arg.username ? [{ type: 'PublicProfile' as const, id: arg.username }] : [],
    }),
    /** Mutability rule (§6.5): one change per 30 days, enforced server-side
     * — a too-soon change surfaces as a 422 through the normal contract. */
    updateOwnUsername: builder.mutation<MeResponse, { username: string }>({
      query: (body) => ({ url: '/api/profile/username', method: 'PATCH', body }),
      invalidatesTags: ['OnboardingStatus'],
    }),
    /** `body` is a `FormData` carrying the cropped avatar as `avatar`. */
    updateOwnAvatar: builder.mutation<MeResponse, { formData: FormData; username: string }>({
      query: ({ formData }) => ({ url: '/api/avatar', method: 'POST', body: formData }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'PublicProfile' as const, id: arg.username }],
    }),
    getPublicProfile: builder.query<PublicProfile, string>({
      query: (username) => `/api/u/${encodeURIComponent(username)}`,
      transformResponse: (response: { profile: PublicProfile }) => response.profile,
      providesTags: (_result, _error, username) => [{ type: 'PublicProfile', id: username }],
    }),
    /**
     * Not exposed by the backend as of this writing — no
     * `/api/username-availability` route exists. Callers must treat any
     * failure here (404 included) as "unknown, defer to submit," per
     * STEP-01-identity.md ("don't assume one exists; check, and if it
     * doesn't, just surface the 422 on submit").
     */
    checkUsernameAvailability: builder.query<UsernameAvailability, string>({
      query: (username) => `/api/username-availability?username=${encodeURIComponent(username)}`,
    }),
  }),
})

export const {
  useGetOnboardingStatusQuery,
  useSubmitOnboardingStep1Mutation,
  useSubmitOnboardingStep2Mutation,
  useSubmitOnboardingStep3Mutation,
  useUpdateOwnProfileMutation,
  useUpdateOwnUsernameMutation,
  useUpdateOwnAvatarMutation,
  useGetPublicProfileQuery,
  useLazyCheckUsernameAvailabilityQuery,
} = profileApi
