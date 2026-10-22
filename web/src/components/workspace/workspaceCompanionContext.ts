import { createContext } from 'react'
import type { WorkspaceSceneId } from './types'

/** A display-only publication belongs to one mounted publisher and location. */
export interface WorkspaceCompanionEntry {
  locationKey: string
  publisher: symbol
  scene: WorkspaceSceneId | null
}

export interface WorkspaceCompanionContextValue {
  entry: WorkspaceCompanionEntry | null
  publish: (locationKey: string, publisher: symbol, scene: WorkspaceSceneId | null) => void
  clear: (locationKey: string, publisher: symbol) => void
}

export const WorkspaceCompanionContext = createContext<WorkspaceCompanionContextValue | null>(null)
