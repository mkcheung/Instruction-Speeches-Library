import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSceneId } from '../types'
import WorkspaceArt from './WorkspaceArt'

const activities: WorkspaceSceneId[] = ['reviews', 'speeches', 'reviewers', 'upload', 'search', 'profile', 'edit', 'account', 'coach']

describe('WorkspaceArt', () => {
  it.each([...activities, 'welcome' as const])('renders %s as a noninteractive decorative drawing', (scene) => {
    const { container } = render(<WorkspaceArt scene={scene} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).toHaveAttribute('data-workspace-art', scene)
    expect(svg).toHaveAttribute('viewBox', scene === 'welcome' ? '0 0 360 300' : '0 0 184 176')
    expect(svg.style.pointerEvents).toBe('none')
    expect(container.querySelectorAll('a, button, input, [tabindex], image, animate, foreignObject')).toHaveLength(0)
    expect(svg.querySelector('[data-workspace-pose]')).not.toBeNull()
  })

  it('contains ten different posture/face compositions including the portrait study', () => {
    const { container } = render(<>{[...activities, 'welcome' as const].map((scene) => <WorkspaceArt key={scene} scene={scene} />)}</>)
    const poses = [...container.querySelectorAll('[data-workspace-pose]')]
    expect(poses).toHaveLength(10)
    expect(new Set(poses.map((pose) => pose.getAttribute('data-workspace-pose'))).size).toBe(10)
    expect(new Set(poses.map((pose) => pose.innerHTML)).size).toBe(10)
  })

  it('renders repeated instances without any fixed definition IDs or external references', () => {
    const { container } = render(<>{activities.flatMap((scene) => [
      <WorkspaceArt key={`${scene}-a`} scene={scene} />,
      <WorkspaceArt key={`${scene}-b`} scene={scene} />,
    ])}</>)
    expect(container.querySelectorAll('svg')).toHaveLength(18)
    // Plain SVG shapes need no definitions, IDs, filters or referenced assets.
    expect(container.querySelectorAll('[id], defs, use, image, filter, [href], [xlink\\:href]')).toHaveLength(0)
  })
})
