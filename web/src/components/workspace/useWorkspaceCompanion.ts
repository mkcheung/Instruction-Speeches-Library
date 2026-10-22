import { useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useGetMeQuery } from '@/features/auth/authApi'
import { navItemsFor } from '@/lib/roles'
import { activityForRoute } from './activityForRoute'
import { WorkspaceCompanionContext } from './workspaceCompanionContext'
import type { WorkspaceSceneId } from './types'

/** Ordinary pages always retain the actual visible NavLink-derived scene. */
export function useWorkspaceCompanionScene(): WorkspaceSceneId | null {
  const location = useLocation()
  const { data } = useGetMeQuery()
  const context = useContext(WorkspaceCompanionContext)
  const fallback = activityForRoute(location.pathname, navItemsFor(data?.user))
  return context?.entry?.locationKey === location.key ? context.entry.scene : fallback
}

/** The caller supplies its real rendered watch-branch scene, including null.
 * Stable callbacks prevent the provider update from re-registering its caller. */
export function usePublishWorkspaceCompanion(scene: WorkspaceSceneId | null): void {
  const { key } = useLocation()
  const context = useContext(WorkspaceCompanionContext)
  const [publisher] = useState(() => Symbol('workspace-companion'))
  const publish = context?.publish
  const clear = context?.clear

  useEffect(() => {
    publish?.(key, publisher, scene)
    return () => clear?.(key, publisher)
  }, [key, publisher, scene, publish, clear])
}
