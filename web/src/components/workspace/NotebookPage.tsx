import type { ReactNode } from 'react'
import { PageHeader, PageShell, type PageWidth } from '@/components/layout/PageShell'
import { cn } from '@/lib/utils'
import { ActivityScene } from './ActivityScene'
import type { WorkspaceSceneId } from './types'
import './notebook.css'

/** A presentation frame only. Routes retain their hooks, forms and permissions.
 * In particular the canvas does not map semantic tokens around media. */
export function NotebookPage({
  width = 'content', scene, title, description, actions, beforeHeading,
  className, shellClassName, children,
}: {
  width?: PageWidth
  scene: WorkspaceSceneId | null
  title?: string
  description?: ReactNode
  actions?: ReactNode
  beforeHeading?: ReactNode
  className?: string
  shellClassName?: string
  children: ReactNode
}) {
  return (
    <div className={cn('workspace-notebook-page', className)}>
      <PageShell width={width} className={shellClassName}>
        {beforeHeading}
        {title && (
          <div className="workspace-notebook-heading workspace-notebook-surface">
            <PageHeader title={title} description={description} actions={actions} />
            {scene && <ActivityScene scene={scene} variant="compact" />}
          </div>
        )}
        {children}
      </PageShell>
    </div>
  )
}
