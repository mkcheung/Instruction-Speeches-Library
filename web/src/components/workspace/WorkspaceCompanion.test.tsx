import { StrictMode, useContext, useEffect, useState } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from '@/components/layout/AppLayout'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { createTestStore, renderWithProviders } from '@/test/renderWithProviders'
import { WorkspaceCompanionProvider } from './WorkspaceCompanionProvider'
import { WorkspaceCompanionContext, type WorkspaceCompanionContextValue } from './workspaceCompanionContext'
import { usePublishWorkspaceCompanion, useWorkspaceCompanionScene } from './useWorkspaceCompanion'
import type { WorkspaceSceneId } from './types'

vi.mock('@/components/layout/AppHeader', () => ({ AppHeader: () => <header>Workspace header</header> }))

function mockIdentity() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user: { roles: [], username: 'member' } }), {
      headers: { 'Content-Type': 'application/json' },
    })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function Reader({ label = 'scene' }: { label?: string }) {
  const scene = useWorkspaceCompanionScene()
  return <output aria-label={label}>{scene ?? 'none'}</output>
}

function Publisher({ scene }: { scene: WorkspaceSceneId | null }) {
  usePublishWorkspaceCompanion(scene)
  return null
}

afterEach(() => vi.unstubAllGlobals())

describe('Workspace companion publication and route lifecycle', () => {
  it('safely uses real route fallback without a provider, and ignores query/hash for navigation matching', async () => {
    mockIdentity()
    const { router } = renderWithProviders(<><Reader /><Publisher scene="edit" /></>, { route: '/search?q=voice#results' })
    expect(screen.getByLabelText('scene')).toHaveTextContent('search')
    await act(() => router.navigate('/speeches/9'))
    expect(screen.getByLabelText('scene')).toHaveTextContent('none')
    await act(() => router.navigate(-1))
    expect(screen.getByLabelText('scene')).toHaveTextContent('search')
  })

  it('dedupes the existing identity request across sidebar and page readers', async () => {
    const fetchMock = mockIdentity()
    renderWithProviders(<WorkspaceCompanionProvider><AppSidebar /><Reader /><Reader label="second scene" /></WorkspaceCompanionProvider>, { route: '/dashboard' })
    await screen.findByRole('link', { name: 'Your profile' })
    expect(screen.getByLabelText('scene')).toHaveTextContent('reviews')
    expect(screen.getByLabelText('second scene')).toHaveTextContent('reviews')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('updates decorative state in StrictMode and clears it on publisher removal without creating active navigation', async () => {
    mockIdentity()
    function Watch() {
      const [scene, setScene] = useState<WorkspaceSceneId | null>('reviews')
      const [mounted, setMounted] = useState(true)
      return <>
        {mounted && <Publisher scene={scene} />}
        <Reader />
        <AppSidebar />
        <button onClick={() => setScene('search')}>Transcript</button>
        <button onClick={() => setScene(null)}>Denied response</button>
        <button onClick={() => setMounted(false)}>Unmount watch publisher</button>
      </>
    }
    renderWithProviders(<StrictMode><WorkspaceCompanionProvider><Watch /></WorkspaceCompanionProvider></StrictMode>, { route: '/speeches/9' })
    const user = userEvent.setup()
    expect(screen.getByLabelText('scene')).toHaveTextContent('reviews')
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryAllByRole('link', { current: 'page' })).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Transcript' }))
    expect(screen.getByLabelText('scene')).toHaveTextContent('search')
    await user.click(screen.getByRole('button', { name: 'Denied response' }))
    expect(screen.getByLabelText('scene')).toHaveTextContent('none')
    await user.click(screen.getByRole('button', { name: 'Transcript' }))
    await user.click(screen.getByRole('button', { name: 'Unmount watch publisher' }))
    expect(screen.getByLabelText('scene')).toHaveTextContent('none')
  })

  it('rejects stale location entries and stale cleanup by both location and publisher identity', async () => {
    mockIdentity()
    let context: WorkspaceCompanionContextValue | null = null
    function Capture() {
      const value = useContext(WorkspaceCompanionContext)
      useEffect(() => { context = value }, [value])
      return <Reader />
    }
    const { router } = renderWithProviders(<WorkspaceCompanionProvider><Capture /></WorkspaceCompanionProvider>, { route: '/speeches/9' })
    const firstKey = router.state.location.key
    const oldPublisher = Symbol('old watch')
    const newPublisher = Symbol('new watch')
    act(() => context!.publish(firstKey, oldPublisher, 'edit'))
    expect(screen.getByLabelText('scene')).toHaveTextContent('edit')
    await act(() => router.navigate('/speeches/10?tab=transcript#feedback'))
    const newKey = router.state.location.key
    expect(screen.getByLabelText('scene')).toHaveTextContent('none')
    act(() => context!.publish(newKey, newPublisher, 'search'))
    act(() => context!.clear(firstKey, oldPublisher))
    act(() => context!.clear(newKey, oldPublisher))
    act(() => context!.clear(firstKey, newPublisher))
    expect(screen.getByLabelText('scene')).toHaveTextContent('search')
    act(() => context!.clear(newKey, newPublisher))
    expect(screen.getByLabelText('scene')).toHaveTextContent('none')
  })

  it('ignores entries immediately on query/hash navigation and restores ordinary scenes through history', async () => {
    mockIdentity()
    function RoutePublisher() {
      // Models watch-only mounting; read-hook fallback must not depend on a last click.
      return <><Publisher scene="edit" /><Reader /></>
    }
    const router = createMemoryRouter([{
      element: <AppLayout />,
      children: [
        { path: '/speeches/:id', element: <RoutePublisher /> },
        { path: '/search', element: <Reader /> },
      ],
    }], { initialEntries: ['/search', '/speeches/9'] })
    render(<Provider store={createTestStore()}><RouterProvider router={router} /></Provider>)
    expect(screen.getByLabelText('scene')).toHaveTextContent('edit')
    await act(() => router.navigate('/speeches/9?tab=essay#content'))
    expect(screen.getByLabelText('scene')).toHaveTextContent('edit')
    await act(() => router.navigate('/search'))
    expect(screen.getByLabelText('scene')).toHaveTextContent('search')
    await act(() => router.navigate(-1))
    expect(screen.getByLabelText('scene')).toHaveTextContent('edit')
    await act(() => router.navigate(-2))
    expect(screen.getByLabelText('scene')).toHaveTextContent('search')
  })

  it('keeps callbacks stable and repeated identical publication does not rerender consumers', () => {
    mockIdentity()
    let context: WorkspaceCompanionContextValue | null = null
    const onCommit = vi.fn()
    function Probe() {
      const value = useContext(WorkspaceCompanionContext)
      useEffect(() => { context = value; onCommit() }, [value])
      return null
    }
    renderWithProviders(<WorkspaceCompanionProvider><Probe /></WorkspaceCompanionProvider>, { route: '/speeches/9' })
    const publish = context!.publish
    const clear = context!.clear
    const publisher = Symbol('watch')
    act(() => publish('watch-key', publisher, 'reviews'))
    const afterFirstPublish = onCommit.mock.calls.length
    act(() => publish('watch-key', publisher, 'reviews'))
    expect(onCommit).toHaveBeenCalledTimes(afterFirstPublish)
    expect(context!.publish).toBe(publish)
    expect(context!.clear).toBe(clear)
  })

  it('keeps the existing shell DOM and Outlet form mounted across companion changes', async () => {
    mockIdentity()
    let mounts = 0
    function WatchForm() {
      const [scene, setScene] = useState<WorkspaceSceneId>('reviews')
      usePublishWorkspaceCompanion(scene)
      const [draft, setDraft] = useState(() => { mounts += 1; return '' })
      return <><label>Feedback draft<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label><button onClick={() => setScene('edit')}>Essay</button></>
    }
    const router = createMemoryRouter([{ element: <AppLayout />, children: [{ path: '/speeches/:id', element: <WatchForm /> }] }], { initialEntries: ['/speeches/9'] })
    const { container } = render(<Provider store={createTestStore()}><RouterProvider router={router} /></Provider>)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Feedback draft' }), 'Keep this draft')
    const main = screen.getByRole('main')
    const header = screen.getByRole('banner')
    await user.click(screen.getByRole('button', { name: 'Essay' }))
    expect(screen.getByRole('textbox', { name: 'Feedback draft' })).toHaveValue('Keep this draft')
    expect(screen.getByRole('main')).toBe(main)
    expect(screen.getByRole('banner')).toBe(header)
    expect(mounts).toBe(1)
    expect(container.children).toHaveLength(1)
    expect(main.parentElement?.parentElement).toBe(container.firstElementChild)
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Main' }).querySelector('[data-workspace-scene="edit"]')).not.toBeNull())
  })
})
