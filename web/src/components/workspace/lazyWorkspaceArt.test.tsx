import { Suspense } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSceneId } from './types'

afterEach(() => {
  cleanup()
  vi.doUnmock('./art/WorkspaceArt')
  vi.resetModules()
})

describe('lazyWorkspaceArt', () => {
  it('shares one optional chunk across callers and lazy scene instances', async () => {
    const factory = vi.fn(() => ({
      default: ({ scene }: { scene: WorkspaceSceneId }) => <svg data-testid={`art-${scene}`} />,
    }))
    vi.doMock('./art/WorkspaceArt', factory)
    const { loadWorkspaceArt, WorkspaceArt } = await import('./lazyWorkspaceArt')
    const first = loadWorkspaceArt()
    expect(loadWorkspaceArt()).toBe(first)
    await first
    render(<Suspense fallback={null}><WorkspaceArt scene="reviews" /><WorkspaceArt scene="welcome" /></Suspense>)
    expect(await screen.findByTestId('art-reviews')).toBeInTheDocument()
    expect(screen.getByTestId('art-welcome')).toBeInTheDocument()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(loadWorkspaceArt()).toBe(first)
  })

  it('resolves a rejected import to empty decoration without retrying or rejecting', async () => {
    const factory = vi.fn(() => { throw new Error('optional chunk unavailable') })
    vi.doMock('./art/WorkspaceArt', factory)
    const { loadWorkspaceArt, WorkspaceArt } = await import('./lazyWorkspaceArt')
    const first = loadWorkspaceArt()
    const module = await first
    const MissingArt = module.default
    const empty = render(<MissingArt scene="reviews" />)
    expect(empty.container).toBeEmptyDOMElement()
    empty.unmount()
    const { container } = render(<Suspense fallback={<span>Loading decoration</span>}><WorkspaceArt scene="reviews" /></Suspense>)
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(loadWorkspaceArt()).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
  })
})
