import { Suspense } from 'react'
import { DecorativeArtBoundary } from './DecorativeArtBoundary'
import { WorkspaceArt } from './lazyWorkspaceArt'
import type { WorkspaceSceneId } from './types'

export function ActivityScene({ scene, variant }: {
  scene: WorkspaceSceneId
  variant: 'sidebar' | 'login'
}) {
  return (
    <div
      className={`workspace-scene workspace-scene--${variant}`}
      data-workspace-scene={scene}
      aria-hidden="true"
    >
      <DecorativeArtBoundary key={scene}>
        <Suspense fallback={null}>
          <WorkspaceArt scene={scene} />
        </Suspense>
      </DecorativeArtBoundary>
    </div>
  )
}

export default ActivityScene
