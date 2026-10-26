import type { Friend, FriendCandidate, FriendRelationship, FriendRelationshipResponse, FriendsResponse } from '@/features/connection/types'

type FriendOverrides = Partial<Omit<Friend, 'person'>> & { person?: Partial<Friend['person']> }
type CandidateOverrides = Partial<Omit<FriendCandidate, 'person'>> & { person?: Partial<FriendCandidate['person']> }

export function makeFriend({ person, ...overrides }: FriendOverrides = {}): Friend {
  return {
    connection_id: 42,
    person: { id: 142, username: 'jordan', name: 'Jordan Ellis', avatar_url: null, ...person },
    mutual_friends_count: 2,
    requested_at: '2026-01-01T00:00:00Z',
    connected_at: null,
    note: null,
    ...overrides,
  }
}

export function makeCandidate({ person, ...overrides }: CandidateOverrides = {}): FriendCandidate {
  return {
    person: { id: 142, name: 'Jordan Ellis', avatar_url: null, ...person },
    mutual_friends_count: 2,
    ...overrides,
  }
}

export function friendsResponse(friends: Friend[] = [], meta: Partial<FriendsResponse['meta']> = {}): FriendsResponse {
  return { friends, meta: { total: friends.length, next_cursor: null, ...meta } }
}

export function relationship(overrides: Partial<FriendRelationship> = {}): FriendRelationshipResponse {
  return { relationship: { state: 'none', direction: null, connection_id: null, connected_at: null, ...overrides } }
}
