import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSceneId } from './types'
import { ActivityScene } from './ActivityScene'

const drawing = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'pending' | 'unavailable' | 'throw',
  pending: undefined as Promise<void> | undefined,
  calls: 0,
}))

vi.mock('./lazyWorkspaceArt', () => ({
  WorkspaceArt: ({ scene }: { scene: WorkspaceSceneId }) => {
    drawing.calls += 1
    if (drawing.mode === 'pending') throw drawing.pending
    if (drawing.mode === 'throw') throw new Error('drawing error')
    if (drawing.mode === 'unavailable') return null
    return <svg data-workspace-art={scene} focusable="false" />
  },
}))

afterEach(() => {
  drawing.mode = 'ready'
  drawing.pending = undefined
  drawing.calls = 0
  vi.restoreAllMocks()
})

describe('ActivityScene', () => {
  it.each(['sidebar', 'login', 'compact'] as const)('keeps the %s frame decorative and nonfocusable', (variant) => {
    const scene = variant === 'login' ? 'welcome' : 'reviews'
    const { container } = render(<ActivityScene scene={scene} variant={variant} />)
    const frame = container.firstElementChild!
    expect(frame).toHaveClass('workspace-scene', `workspace-scene--${variant}`)
    expect(frame).toHaveAttribute('data-workspace-scene', scene)
    expect(frame).toHaveAttribute('aria-hidden', 'true')
    expect(frame.querySelector('svg')).toHaveAttribute('data-workspace-art', scene)
    expect(frame.querySelector('[tabindex],button,a,input')).toBeNull()
    expect(frame.children).toHaveLength(1)
  })

  it.each([
    ['sidebar', 'pending'],
    ['sidebar', 'unavailable'],
    ['sidebar', 'throw'],
    ['compact', 'pending'],
    ['compact', 'unavailable'],
    ['compact', 'throw'],
  ] as const)('preserves the reserved %s frame and working form/navigation with %s art', async (variant, mode) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    drawing.mode = mode
    let resolveArt!: () => void
    drawing.pending = new Promise<void>((resolve) => { resolveArt = resolve })
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    const onNavigate = vi.fn((event: React.MouseEvent) => event.preventDefault())
    const user = userEvent.setup()
    const { container } = render(<>
      <ActivityScene scene="reviews" variant={variant} />
      <form onSubmit={onSubmit}><label>Email<input type="email" /></label><button>Log in</button></form>
      <a href="/search" onClick={onNavigate}>Search</a>
    </>)
    const frame = container.querySelector('[data-workspace-scene="reviews"]')!
    expect(frame).toHaveClass(`workspace-scene--${variant}`)
    expect(frame).toBeEmptyDOMElement()
    await user.type(screen.getByLabelText('Email'), 'member@example.test')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await user.click(screen.getByRole('link', { name: 'Search' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledTimes(1)
    if (mode === 'pending') {
      await act(async () => { drawing.mode = 'ready'; resolveArt() })
      expect(frame.querySelector('svg')).toHaveAttribute('data-workspace-art', 'reviews')
      expect(container.querySelector('[data-workspace-scene="reviews"]')).toBe(frame)
    }
  })

  it('recovers only when the scene changes after a rendering failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    drawing.mode = 'throw'
    const { container, rerender } = render(<ActivityScene scene="reviews" variant="sidebar" />)
    const failedAttempts = drawing.calls
    drawing.mode = 'ready'
    rerender(<ActivityScene scene="reviews" variant="sidebar" />)
    expect(drawing.calls).toBe(failedAttempts)
    expect(container.querySelector('svg')).toBeNull()
    rerender(<ActivityScene scene="search" variant="sidebar" />)
    expect(container.querySelector('svg')).toHaveAttribute('data-workspace-art', 'search')
  })
})
