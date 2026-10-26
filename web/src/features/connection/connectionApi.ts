import { createApi } from '@reduxjs/toolkit/query/react'
import { baseQueryWithCsrfRetry } from '@/lib/baseQuery'
import { CONNECTION_TAGS } from './tags'
import type {
  Connection,
  FriendsQueryArgs,
  FriendsResponse,
  FindFriendsQueryArgs,
  FindFriendsResponse,
  FriendRelationshipResponse,
  ConnectionsRailResponse,
  ProfileTimelineResponse,
  ProfileTimelineTab,
  SendConnectionRequestPayload,
} from '@/features/connection/types'

function unwrapConnection(response: { connection: Connection }): Connection {
  return response.connection
}

/** Keep the viewer cache partition while sharing normalization with the HTTP query. */
function normalizedFriendsArgs<T extends { search?: string; cursor?: string | null }>(args: T) {
  return { ...args, search: args.search?.trim() ?? '', cursor: args.cursor ?? null }
}

/**
 * STEP-13-social-layer.md, following `essayApi.ts`/`reviewApi.ts`'s
 * per-domain-slice convention exactly (own `tagTypes`, own
 * `baseQueryWithCsrfRetry` wiring, one slice per domain).
 *
 * Reconciled directly against the real backend
 * (`api/app/Http/Controllers/Api/ConnectionController.php`,
 * `ProfileTimelineController.php`, `routes/api.php`) once it landed —
 * every response either matches the wire shape 1:1 (list endpoints, same
 * convention `searchReviewers` in `reviewApi.ts` uses) or runs through an
 * explicit `transformResponse` (the singular `{connection: ...}`
 * mutation envelope) — the STEP-08 failure mode (mocked tests passing
 * despite a real envelope mismatch) this convention exists to prevent.
 *
 * Routes:
 *   POST /api/connections                          — request (also
 *                                                      re-request after
 *                                                      `declined`)
 *   POST /api/connections/{id}/accept
 *   POST /api/connections/{id}/decline
 *   POST /api/connections/{id}/block
 *   POST /api/connections/{id}/unblock
 *   GET  /api/connections                            — the caller's own
 *                                                      accepted-only rail
 *   GET  /api/u/{username}/timeline?tab=left|received&cursor=...
 */
export const connectionApi = createApi({
  reducerPath: 'connectionApi',
  baseQuery: baseQueryWithCsrfRetry,
  tagTypes: CONNECTION_TAGS,
  endpoints: (builder) => ({
    getFriends: builder.query<FriendsResponse, FriendsQueryArgs>({
      query: (args) => {
        const { view, search, cursor } = normalizedFriendsArgs(args)
        const params = new URLSearchParams({ view })
        if (search) params.set('search', search)
        if (cursor) params.set('cursor', cursor)
        return `/api/friends?${params}`
      },
      serializeQueryArgs: ({ endpointName, queryArgs }) => ({
        endpointName, ...normalizedFriendsArgs(queryArgs),
      }),
      providesTags: ['Friends'],
    }),
    findFriends: builder.query<FindFriendsResponse, FindFriendsQueryArgs>({
      query: (args) => {
        const { search, cursor } = normalizedFriendsArgs(args)
        const params = new URLSearchParams({ search })
        if (cursor) params.set('cursor', cursor)
        return `/api/friends/find?${params}`
      },
      serializeQueryArgs: ({ endpointName, queryArgs }) => ({
        endpointName, ...normalizedFriendsArgs(queryArgs),
      }),
      providesTags: ['Friends'],
    }),
    getFriendRelationship: builder.query<FriendRelationshipResponse, { viewerId: string; targetId: string | number }>({
      query: ({ targetId }) => `/api/friends/relationship/${encodeURIComponent(targetId)}`,
      providesTags: ['FriendRelationship'],
    }),
    getConnectionsRail: builder.query<ConnectionsRailResponse, void>({
      query: () => '/api/connections',
      providesTags: (result) =>
        result
          ? [...result.connections.map((c) => ({ type: 'ConnectionsRail' as const, id: c.id })), 'ConnectionsRail']
          : ['ConnectionsRail'],
    }),

    /** `?state=pending` — incoming requests only, added after the STEP-13
     * reconciliation audit found nothing surfaced the id `accept`/
     * `decline` need. Its own tag (not `ConnectionsRail`) so accepting a
     * request only invalidates the pending list, not the whole rail
     * query — the mutations below invalidate both. */
    getPendingConnectionRequests: builder.query<ConnectionsRailResponse, void>({
      query: () => '/api/connections?state=pending',
      providesTags: (result) =>
        result
          ? [...result.connections.map((c) => ({ type: 'PendingConnections' as const, id: c.id })), 'PendingConnections']
          : ['PendingConnections'],
    }),

    getProfileTimeline: builder.query<
      ProfileTimelineResponse,
      { username: string; tab: ProfileTimelineTab; cursor?: string | null }
    >({
      query: ({ username, tab, cursor }) => {
        const params = new URLSearchParams({ tab })
        if (cursor) params.set('cursor', cursor)
        return `/api/u/${encodeURIComponent(username)}/timeline?${params.toString()}`
      },
      providesTags: (_result, _error, { username, tab }) => [
        { type: 'ProfileTimeline' as const, id: `${username}:${tab}` },
      ],
    }),

    sendConnectionRequest: builder.mutation<Connection, SendConnectionRequestPayload>({
      query: (body) => ({ url: '/api/connections', method: 'POST', body }),
      transformResponse: unwrapConnection,
      invalidatesTags: CONNECTION_TAGS,
    }),

    acceptConnection: builder.mutation<Connection, number>({
      query: (id) => ({ url: `/api/connections/${id}/accept`, method: 'POST' }),
      transformResponse: unwrapConnection,
      invalidatesTags: CONNECTION_TAGS,
    }),

    declineConnection: builder.mutation<Connection, number>({
      query: (id) => ({ url: `/api/connections/${id}/decline`, method: 'POST' }),
      transformResponse: unwrapConnection,
      invalidatesTags: CONNECTION_TAGS,
    }),

    blockConnection: builder.mutation<Connection, number>({
      query: (id) => ({ url: `/api/connections/${id}/block`, method: 'POST' }),
      transformResponse: unwrapConnection,
      invalidatesTags: CONNECTION_TAGS,
    }),

    /** §7 acceptance: unblocking must land on `declined`, never `accepted`
     * — enforced server-side; this mutation just relays the result.
     * ⚠️ Currently unreachable from any UI in this build — `GET
     * /api/connections` only returns `state = 'accepted'` rows, so a
     * blocked connection's id is never available client-side once it
     * disappears from the rail. Exported ready for a future "manage
     * blocked connections" surface once the backend exposes one. */
    unblockConnection: builder.mutation<Connection, number>({
      query: (id) => ({ url: `/api/connections/${id}/unblock`, method: 'POST' }),
      transformResponse: unwrapConnection,
      invalidatesTags: CONNECTION_TAGS,
    }),
  }),
})

export const {
  useGetFriendsQuery,
  useFindFriendsQuery,
  useGetFriendRelationshipQuery,
  useGetConnectionsRailQuery,
  useGetPendingConnectionRequestsQuery,
  useGetProfileTimelineQuery,
  useSendConnectionRequestMutation,
  useAcceptConnectionMutation,
  useDeclineConnectionMutation,
  useBlockConnectionMutation,
  useUnblockConnectionMutation,
} = connectionApi
