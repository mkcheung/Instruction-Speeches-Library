import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMyReviewForSpeech } from './useMyReviewForSpeech'
import type { Review, ReviewStatus } from '@/features/review/types'

const query = vi.hoisted(() => vi.fn())
vi.mock('@/features/review/reviewApi', () => ({ useListMyReviewsQuery: query }))

function review(status: ReviewStatus, revokedAt: string | null = null): Review {
  return { id: 7, status, invitation_message: null, allow_preview: false, prior_commentary_shared: false,
    invited_at: null, responded_at: null, first_published_at: null, last_published_at: null,
    last_transition_at: '2026-01-01', revoked_at: revokedAt, revocation_reason: null,
    speech: { id: 4, ulid: 'speech-4', title: 'Speech four', owner_name: null } }
}

describe('own review discovery preserves grant and speech boundaries', () => {
  beforeEach(() => query.mockReset())

  it.each([
    ['invited', false], ['declined', false], ['accepted', true], ['in_progress', true], ['published', true], ['abandoned', false],
  ] as const)('only returns a live %s review when it grants access', (status, grants) => {
    const candidate = review(status)
    query.mockReturnValue({ data: { in_progress: [candidate] }, isLoading: false })
    const { result, rerender } = renderHook(() => useMyReviewForSpeech(4, true))
    expect(result.current.review).toBe(grants ? candidate : null)
    query.mockReturnValue({ data: { in_progress: [{ ...candidate, revoked_at: '2026-01-02' }] }, isLoading: false })
    rerender()
    expect(result.current.review).toBeNull()
  })

  it('keeps strict null revocation and matching speech checks outside status membership', () => {
    const candidate = review('accepted')
    const { revoked_at: omitted, ...missingRevocation } = candidate
    expect(omitted).toBeNull()
    query.mockReturnValue({ data: { in_progress: [missingRevocation, { ...candidate, speech: { ...candidate.speech!, id: 99 } }] }, isLoading: false })
    const { result } = renderHook(() => useMyReviewForSpeech(4, true))
    expect(result.current.review).toBeNull()
  })

  it('retains disabled-query and unresolved loading behavior', () => {
    query.mockReturnValue({ data: undefined, isLoading: true })
    const { result } = renderHook(() => useMyReviewForSpeech(4, false))
    expect(query).toHaveBeenCalledWith(undefined, { skip: true })
    expect(result.current).toEqual({ review: null, isLoading: true })
  })
})
