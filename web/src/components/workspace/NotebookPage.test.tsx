import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotebookPage } from './NotebookPage'
import type { WorkspaceSceneId } from './types'

const drawing = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'pending' | 'unavailable' | 'throw',
  pending: undefined as Promise<void> | undefined,
}))

vi.mock('./lazyWorkspaceArt', () => ({
  WorkspaceArt: ({ scene }: { scene: WorkspaceSceneId }) => {
    if (drawing.mode === 'pending') throw drawing.pending
    if (drawing.mode === 'throw') throw new Error('drawing error')
    if (drawing.mode === 'unavailable') return null
    return <svg data-workspace-art={scene} focusable="false" />
  },
}))

afterEach(() => {
  drawing.mode = 'ready'
  drawing.pending = undefined
  vi.restoreAllMocks()
})

describe('NotebookPage', () => {
  it.each([
    ['form', 'max-w-2xl'],
    ['content', 'max-w-5xl'],
    ['wide', 'max-w-[100rem]'],
    ['full', 'max-w-none'],
  ] as const)('retains the original %s PageShell width and one real heading', (width, widthClass) => {
    const { container } = render(
      <NotebookPage width={width} title="My speeches" scene="speeches">
        <p>Existing panel</p>
      </NotebookPage>,
    )
    expect(container.firstElementChild).toHaveClass('workspace-notebook-page')
    const shell = container.firstElementChild!.firstElementChild!
    expect(shell).toHaveClass(widthClass, 'w-full', 'px-4')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'My speeches' })).toHaveTextContent('My speeches')
    expect(container.querySelectorAll('main,form')).toHaveLength(0)
    expect(container.querySelector('[data-workspace-scene="speeches"]')).toHaveClass('workspace-scene--compact')
    expect(screen.getByText('Existing panel').parentElement).toBe(shell)
  })

  it('retains the verification notice before the heading, live description, and actionable controls', async () => {
    const onAction = vi.fn()
    const { container } = render(
      <NotebookPage scene="reviews" title="My reviews" description={<span>Real review status</span>}
        beforeHeading={<p role="status">Verify your email first.</p>}
        actions={<button onClick={onAction}>Edit profile</button>}>
        <p>Review content</p>
      </NotebookPage>,
    )
    const shell = container.firstElementChild!.firstElementChild!
    expect(shell.firstElementChild).toBe(screen.getByRole('status'))
    expect(shell.children[1]).toContainElement(screen.getByRole('heading', { name: 'My reviews' }))
    expect(screen.getByText('Real review status')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Edit profile' }).closest('[aria-hidden]')).toBeNull()
  })

  it('does not add a title/cameo row when the route owns its media heading and leaves media outside surface tokens', () => {
    const { container } = render(
      <NotebookPage width="wide" scene="reviews" className="route-canvas" shellClassName="existing-shell">
        <section className="workspace-notebook-media">
          <header className="workspace-notebook-surface"><h1>Actual speech title</h1></header>
          <video aria-label="Speech video" />
        </section>
        <div className="workspace-notebook-surface">Feedback</div>
      </NotebookPage>,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(container.querySelector('.workspace-notebook-heading')).toBeNull()
    expect(container.querySelector('[data-workspace-scene]')).toBeNull()
    expect(container.querySelector('video')!.closest('.workspace-notebook-surface')).toBeNull()
    expect(container.querySelector('.route-canvas')!.firstElementChild).toHaveClass('existing-shell', 'max-w-[100rem]')
    expect(container.querySelectorAll('main,form')).toHaveLength(0)
  })

  it('does not fabricate a companion when a route explicitly has no scene', () => {
    const { container } = render(<NotebookPage title="Speech unavailable" scene={null}><p role="alert">Cannot open this speech.</p></NotebookPage>)
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot open this speech.')
    expect(container.querySelector('[data-workspace-scene]')).toBeNull()
  })

  it.each(['pending', 'unavailable', 'throw'] as const)('keeps the existing form, input value and actions usable with %s art', async (mode) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    drawing.mode = mode
    let resolveArt!: () => void
    drawing.pending = new Promise<void>((resolve) => { resolveArt = resolve })
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault())
    const { container } = render(
      <NotebookPage title="Upload a speech" scene="upload">
        <form onSubmit={submit} className="workspace-notebook-surface">
          <label>Title<input /></label><button>Continue to upload</button>
        </form>
      </NotebookPage>,
    )
    const input = screen.getByLabelText('Title')
    const frame = container.querySelector('[data-workspace-scene="upload"]')!
    expect(frame).toBeEmptyDOMElement()
    await userEvent.type(input, 'My first rehearsal')
    await userEvent.click(screen.getByRole('button', { name: 'Continue to upload' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('form')).toHaveLength(1)
    if (mode === 'pending') {
      await act(async () => { drawing.mode = 'ready'; resolveArt() })
      expect(frame.querySelector('svg')).toHaveAttribute('data-workspace-art', 'upload')
      expect(screen.getByLabelText('Title')).toBe(input)
      expect(input).toHaveValue('My first rehearsal')
    }
  })
})
