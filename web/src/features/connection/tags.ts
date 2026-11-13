/** Profile edits refresh identity-bearing connection projections without changing timeline invalidation. */
export const PROFILE_CHANGE_CONNECTION_TAGS = ['Friends', 'FriendRelationship', 'ConnectionsRail', 'PendingConnections'] as const

/** Relationship transitions additionally affect timeline access and commentary projections,
 * and the profile page's random friends sample. A profile edit leaves the sample alone, so
 * saving your own details doesn't reshuffle the friends beside them. */
export const CONNECTION_TAGS = [...PROFILE_CHANGE_CONNECTION_TAGS, 'ProfileTimeline', 'FriendSample'] as const
