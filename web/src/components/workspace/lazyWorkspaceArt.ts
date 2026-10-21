import { lazy } from 'react'
import type { ComponentType } from 'react'
import type { WorkspaceSceneId } from './types'

type ArtModule = { default: ComponentType<{ scene: WorkspaceSceneId }> }

function NoArt() {
  return null
}

let artChunk: Promise<ArtModule> | undefined

/** A failed optional chunk stays unavailable; navigation must never retry in a loop. */
export function loadWorkspaceArt(): Promise<ArtModule> {
  return (artChunk ??= import('./art/WorkspaceArt').catch(() => ({ default: NoArt })))
}

export const WorkspaceArt = lazy(loadWorkspaceArt)
