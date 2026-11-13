import { describe, expect, it } from 'vitest'
import type { Notification } from '@/features/notification/types'
import type { Review } from '@/features/review/types'
import { makeFriend } from '@/test/friendsFixtures'
import { buildFeed, waitingCount } from './profileFeed'

function review(id: number, status: Review['status'], invitedAt: string | null): Review {
  return {
    id, status, invitation_message: null, allow_preview: false, prior_commentary_shared: false,
    invited_at: invitedAt, responded_at: null, first_published_at: null, last_published_at: null,
    last_transition_at: '2026-11-01T00:00:00Z', revoked_at: null, revocation_reason: null,
  }
}

function notification(id: string, type: string, createdAt: string): Notification {
  return { id, type, data: { type, review_id: 3, speech_id: 8 }, read_at: null, created_at: createdAt }
}

describe('buildFeed', () => {
  it('merges friend requests, waiting review invitations and published commentary, newest first', () => {
    const items = buildFeed(
      [makeFriend({ connection_id: 1, requested_at: '2026-11-10T00:00:00Z' }), makeFriend({ connection_id: 2, requested_at: null })],
      [review(5, 'invited', '2026-11-08T00:00:00Z'), review(6, 'accepted', '2026-11-11T00:00:00Z')],
      [notification('a', 'review.published', '2026-11-12T00:00:00Z'), notification('b', 'review.invited', '2026-11-13T00:00:00Z')],
    )
    expect(items.map((item) => item.key)).toEqual(['commentary-a', 'friend-1', 'review-5'])
  })

  it('falls back to the last transition when an invitation has no invited time', () => {
    expect(buildFeed([], [review(7, 'invited', null)], [])[0]).toMatchObject({ key: 'review-7', at: '2026-11-01T00:00:00Z' })
  })
})

describe('waitingCount', () => {
  it('adds the friend request total to the invitations still waiting', () => {
    expect(waitingCount(3, [review(1, 'invited', null), review(2, 'declined', null)])).toBe(4)
  })
})
