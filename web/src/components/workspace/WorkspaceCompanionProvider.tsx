import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { WorkspaceCompanionContext, type WorkspaceCompanionEntry } from './workspaceCompanionContext'
import type { WorkspaceSceneId } from './types'

/** No DOM, routing, permission or media state is introduced by this provider. */
export function WorkspaceCompanionProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<WorkspaceCompanionEntry | null>(null)
  const publish = useCallback((locationKey: string, publisher: symbol, scene: WorkspaceSceneId | null) => {
    setEntry((current) => current?.locationKey === locationKey
      && current.publisher === publisher && current.scene === scene
      ? current
      : { locationKey, publisher, scene })
  }, [])
  const clear = useCallback((locationKey: string, publisher: symbol) => {
    setEntry((current) => current?.locationKey === locationKey && current.publisher === publisher ? null : current)
  }, [])
  const value = useMemo(() => ({ entry, publish, clear }), [entry, publish, clear])

  return <WorkspaceCompanionContext.Provider value={value}>{children}</WorkspaceCompanionContext.Provider>
}
