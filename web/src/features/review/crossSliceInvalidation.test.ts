import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewApi } from '@/features/review/reviewApi'
import { speechApi } from '@/features/speech/speechApi'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

const speech = {
  id: 42,
  ulid: '01ABCDEF',
  user_id: 99,
  title: 'A Reviewed Speech',
  description: null,
  delivered_on: null,
  change_note: null,
  created_at: '2026-09-01T00:00:00Z',
  captions_enabled: true,
  primary_video: null,
}

/**
 * IMPLEMENTATION-PLANS.md §7.2.6's traced bug: `withdraw`/`abandon` land
 * on a DIFFERENT RTK Query slice (`speechApi`) than the one the mutation
 * itself lives in (`reviewApi`) — `invalidatesTags` can only reach tags
 * within its own `createApi` instance, so the fix is an explicit
 * `dispatch(speechApi.util.invalidateTags(...))` inside `onQueryStarted`.
 * This exercises that dispatch directly against a real store (not a
 * mocked `reviewApi`), proving the cross-slice tag invalidation actually
 * triggers a refetch of an active `getSpeech` subscription — the
 * mechanism that lets a coach who hits the browser Back button after
 * withdrawing/abandoning see the honest 403 instead of a stale cached
 * `Speech`.
 */
describe('withdraw/abandon cross-slice Speech invalidation', () => {
  let getSpeechCallCount = 0

  function stubFetch(mutationPath: 'withdraw' | 'abandon') {
    getSpeechCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.match(/\/api\/speeches\/42$/) && methodOf(input, init) === 'GET') {
        getSpeechCallCount += 1
        return jsonResponse({ speech })
      }
      if (url.endsWith(`/api/reviews/7/${mutationPath}`) && methodOf(input, init) === 'POST') {
        return jsonResponse({ review: { id: 7, status: mutationPath === 'withdraw' ? 'declined' : 'abandoned' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('withdrawReview invalidates the Speech tag in the OTHER slice, triggering a getSpeech refetch', async () => {
    stubFetch('withdraw')
    const store = createTestStore()

    // Simulate `SpeechWatch` holding an active `getSpeech` subscription —
    // `invalidateTags` only forces a refetch for a query with a live
    // subscriber; an unsubscribed cache entry is just dropped.
    const speechSubscription = store.dispatch(speechApi.endpoints.getSpeech.initiate(42))
    await speechSubscription
    expect(getSpeechCallCount).toBe(1)

    await store.dispatch(reviewApi.endpoints.withdrawReview.initiate({ id: 7, speechId: 42 }))

    await vi.waitFor(() => expect(getSpeechCallCount).toBe(2))

    speechSubscription.unsubscribe()
  })

  it('abandonReview invalidates the Speech tag in the OTHER slice, triggering a getSpeech refetch', async () => {
    stubFetch('abandon')
    const store = createTestStore()

    const speechSubscription = store.dispatch(speechApi.endpoints.getSpeech.initiate(42))
    await speechSubscription
    expect(getSpeechCallCount).toBe(1)

    await store.dispatch(reviewApi.endpoints.abandonReview.initiate({ id: 7, speechId: 42 }))

    await vi.waitFor(() => expect(getSpeechCallCount).toBe(2))

    speechSubscription.unsubscribe()
  })
})
