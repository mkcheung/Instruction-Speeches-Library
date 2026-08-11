import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import type { NotificationListResponse } from '@/features/notification/types'

/**
 * STEP-05-invitation-loop.md's notification bell, over
 * `App\Http\Controllers\Api\NotificationController`.
 */
export const notificationApi = createApi({
  reducerPath: 'notificationApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: ['Notification'],
  endpoints: (builder) => ({
    listNotifications: builder.query<NotificationListResponse, void>({
      query: () => '/api/notifications',
      providesTags: ['Notification'],
    }),
    markNotificationRead: builder.mutation<void, string>({
      query: (id) => ({ url: `/api/notifications/${id}/read`, method: 'POST' }),
      invalidatesTags: ['Notification'],
    }),
  }),
})

export const { useListNotificationsQuery, useMarkNotificationReadMutation } = notificationApi
