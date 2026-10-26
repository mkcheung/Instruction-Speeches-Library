/** Profile edits refresh identity-bearing connection projections without changing timeline invalidation. */
export const PROFILE_CHANGE_CONNECTION_TAGS = ['Friends', 'FriendRelationship', 'ConnectionsRail', 'PendingConnections'] as const

/** Relationship transitions additionally affect timeline access and commentary projections. */
export const CONNECTION_TAGS = [...PROFILE_CHANGE_CONNECTION_TAGS, 'ProfileTimeline'] as const
