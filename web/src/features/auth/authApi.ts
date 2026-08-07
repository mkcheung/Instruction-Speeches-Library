import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type {
  ForgotPasswordPayload,
  LoginPayload,
  MeResponse,
  RegisterPayload,
  ResetPasswordPayload,
} from '@/features/auth/types'

/**
 * Fortify's own routes (register/login/logout/forgot-password/reset-password
 * /email-verification-notification) are unprefixed — registered by
 * `FortifyServiceProvider` against the `web` middleware group, not under
 * `/api`. `/api/me` is the one custom route the backend added for session
 * probing (`api/routes/api.php`).
 */
export const authApi = createApi({
  reducerPath: 'authApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Me'],
  endpoints: (builder) => ({
    getMe: builder.query<MeResponse, void>({
      query: () => '/api/me',
      providesTags: ['Me'],
    }),
    register: builder.mutation<void, RegisterPayload>({
      query: (body) => ({ url: '/register', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    login: builder.mutation<void, LoginPayload>({
      query: (body) => ({ url: '/login', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: '/logout', method: 'POST' }),
      invalidatesTags: ['Me'],
    }),
    forgotPassword: builder.mutation<void, ForgotPasswordPayload>({
      query: (body) => ({ url: '/forgot-password', method: 'POST', body }),
    }),
    resetPassword: builder.mutation<void, ResetPasswordPayload>({
      query: (body) => ({ url: '/reset-password', method: 'POST', body }),
    }),
    resendVerificationEmail: builder.mutation<void, void>({
      query: () => ({ url: '/email/verification-notification', method: 'POST' }),
    }),
  }),
})

export const {
  useGetMeQuery,
  useLazyGetMeQuery,
  useRegisterMutation,
  useLoginMutation,
  useLogoutMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useResendVerificationEmailMutation,
} = authApi
