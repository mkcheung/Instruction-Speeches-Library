import { StrictMode, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverlayStack } from '@/components/annotation/OverlayStack'
import type { VideoJsAdapterOptions } from '@/shared/media/videojs-adapter'

const fake = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/shared/media/videojs-adapter', () => ({ createVideoJsPlayer: fake.create }))
import { VideoPlayer } from './VideoPlayer'

function makePlayer(video: HTMLVideoElement, options: VideoJsAdapterOptions) {
  const root = document.createElement('div')
  // video.js copies the tech's attributes to its wrapper. VideoPlayer must
  // keep the test ID on the actual video, not this generated root.
  root.setAttribute('data-testid', video.getAttribute('data-testid')!)
  video.replaceWith(root)
  root.append(video)
  video.src = options.initialUrl
  const listeners = new Map<string, () => void>()
  const readyCallbacks: (() => void)[] = []
  let presentationHost: Element | null = null
  let disposed = false
  return {
    video,
    options,
    el: () => root,
    ready: (callback: () => void) => {
      presentationHost = root.querySelector('[data-testid="owner-commentary-host"]')
      readyCallbacks.push(callback)
    },
    // Keep callbacks callable after disposal: a late adapter notification
    // must be rejected by VideoPlayer itself, rather than by this fake.
    releaseReady: () => readyCallbacks.splice(0).forEach((callback) => callback()),
    isDisposed: () => disposed,
    on: (event: string, callback: () => void) => listeners.set(event, callback),
    off: (event: string) => listeners.delete(event),
    emit: (event: string) => listeners.get(event)?.(),
    dispose: vi.fn(() => {
      expect(presentationHost).not.toBeNull()
      expect(presentationHost?.parentNode).toBeNull()
      expect(root.querySelector('[data-testid="owner-commentary-host"]')).toBeNull()
      expect(listeners.has('fullscreenchange')).toBe(false)
      disposed = true
      root.remove()
    }),
  }
}

type PlayerProps = ComponentProps<typeof VideoPlayer>
type FakePlayer = ReturnType<typeof makePlayer>
function players(): FakePlayer[] {
  return fake.create.mock.results.map((result) => result.value as FakePlayer)
}

// Exercise two real React DOM portals: VideoPlayer owns the outer host;
// this separate consumer owns the real OverlayStack inside a React-owned
// target. Source eligibility/registration guards belong to SpeechWatch's
// production route tests and are deliberately not reimplemented here.
function PresentationHarness({
  sourceKey = 'speech-1:asset-11', initialUrl = 'https://media/one',
  enabled = true, anchor = 'default', targetVersion = 1, text = 'Reviewer commentary',
  refreshUrl = async () => '', onPlayerReady, onSourceRefreshed,
}: {
  sourceKey?: string
  initialUrl?: string
  enabled?: boolean
  anchor?: 'top' | 'default'
  targetVersion?: number
  text?: string
  refreshUrl?: PlayerProps['refreshUrl']
  onPlayerReady?: PlayerProps['onPlayerReady']
  onSourceRefreshed?: PlayerProps['onSourceRefreshed']
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  return <>
    <VideoPlayer key={sourceKey} initialUrl={initialUrl} refreshUrl={refreshUrl}
      onPlayerReady={onPlayerReady} onSourceRefreshed={onSourceRefreshed}
      presentation={<div data-testid="feedback-frame"><div data-testid="positioner">
        <div key={targetVersion} ref={setTarget} data-testid="reviewer-preview-target" />
      </div></div>} />
    {target && enabled && createPortal(<OverlayStack annotations={[{
      id: 'written', timing_type: 'range', start_seconds: 2, duration_seconds: 4,
      body: text, kind: 'observation', topic: null, voice: null,
      lock_version: 0, client_uuid: 'written',
    }]} activeIds={new Set(['written'])} currentTime={3} anchor={anchor} />, target)}
  </>
}

describe('owned fullscreen presentation host', () => {
  beforeEach(() => { fake.create.mockReset().mockImplementation(makePlayer) })

  it('attaches the portal to player.el and detaches it before every StrictMode disposal', () => {
    const view = render(<StrictMode><VideoPlayer initialUrl="https://media/one" refreshUrl={async () => ''}
      presentation={<button>Owned commentary</button>} /></StrictMode>)
    const players = fake.create.mock.results.map((result) => result.value as ReturnType<typeof makePlayer>)
    expect(players).toHaveLength(2)
    expect(players[0].dispose).toHaveBeenCalledOnce()
    expect(players[1].el().contains(screen.getByRole('button', { name: 'Owned commentary' }))).toBe(true)
    expect(screen.getAllByTestId('owner-commentary-host')).toHaveLength(1)
    view.unmount()
    expect(players[1].dispose).toHaveBeenCalledOnce()
  })

  it('switches fullscreen presentation without recreating the video or portal button', () => {
    function Harness() {
      const [fullscreen, setFullscreen] = useState(false)
      return <VideoPlayer initialUrl="https://media/one" refreshUrl={async () => ''}
        onHtmlFullscreenChange={setFullscreen} presentation={<button>{fullscreen ? 'Fullscreen controls' : 'Inline controls'}</button>} />
    }
    const view = render(<Harness />)
    const player = fake.create.mock.results[0].value as ReturnType<typeof makePlayer>
    const button = screen.getByRole('button', { name: 'Inline controls' })
    const video = screen.getByTestId('speech-video')
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: player.el() })
    act(() => player.emit('fullscreenchange'))
    expect(screen.getByRole('button', { name: 'Fullscreen controls' })).toBe(button)
    expect(screen.getByTestId('speech-video')).toBe(video)
    expect(fake.create).toHaveBeenCalledOnce()
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    act(() => player.emit('fullscreenchange'))
    expect(screen.getByRole('button', { name: 'Inline controls' })).toBe(button)
    view.unmount()
  })

  it('reclaims the same React-owned portal when the source recreates the player', () => {
    const renderPlayer = (url: string) => <VideoPlayer initialUrl={url} refreshUrl={async () => ''} presentation={<button>Commentary</button>} />
    const view = render(renderPlayer('https://media/one'))
    const button = screen.getByRole('button', { name: 'Commentary' })
    const first = fake.create.mock.results[0].value as ReturnType<typeof makePlayer>
    view.rerender(renderPlayer('https://media/two'))
    const second = fake.create.mock.results[1].value as ReturnType<typeof makePlayer>
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second.el().contains(button)).toBe(true)
    expect(screen.getAllByTestId('owner-commentary-host')).toHaveLength(1)
    view.unmount()
  })

  it('owns a nested external overlay through deferred readiness and every StrictMode disposal', () => {
    const onPlayerReady = vi.fn()
    const view = render(<StrictMode><PresentationHarness onPlayerReady={onPlayerReady} /></StrictMode>)
    const [discarded, current] = players()
    expect(players()).toHaveLength(2)
    expect(discarded.dispose).toHaveBeenCalledOnce()
    expect(discarded.isDisposed()).toBe(true)
    expect(discarded.video).not.toBe(current.video)
    expect(onPlayerReady).not.toHaveBeenCalled()
    const host = screen.getByTestId('owner-commentary-host')
    const target = screen.getByTestId('reviewer-preview-target')
    const stack = screen.getByTestId('overlay-stack')
    expect(host.parentNode).toBe(current.el())
    expect(within(host).getByTestId('feedback-frame')).toContainElement(target)
    expect(target.parentNode).toBe(screen.getByTestId('positioner'))
    expect(target).toContainElement(stack)
    expect(stack).toHaveAttribute('aria-hidden', 'true')
    expect(within(target).getByText('Reviewer commentary')).toHaveAttribute('data-visible', 'true')
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    expect(screen.getAllByTestId('reviewer-preview-target')).toHaveLength(1)
    expect(screen.getByTestId('speech-video')).toBe(current.video)
    act(() => discarded.releaseReady())
    expect(onPlayerReady).not.toHaveBeenCalled()
    act(() => current.releaseReady())
    expect(onPlayerReady).toHaveBeenCalledExactlyOnceWith(current)
    view.unmount()
    expect(current.dispose).toHaveBeenCalledOnce()
    expect(host).not.toBeInTheDocument()
    expect(target).toBeEmptyDOMElement()
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overlay-stack')).not.toBeInTheDocument()
    expect(screen.queryByTestId('owner-commentary-host')).not.toBeInTheDocument()
  })

  it('preserves the concrete video, host and target during tab, text and anchor presentation updates', () => {
    const view = render(<PresentationHarness />)
    const [player] = players()
    const video = player.video
    video.currentTime = 3
    const host = screen.getByTestId('owner-commentary-host')
    const target = screen.getByTestId('reviewer-preview-target')
    const stack = screen.getByTestId('overlay-stack')
    view.rerender(<PresentationHarness text="Edited commentary" anchor="top" />)
    expect(screen.getByTestId('overlay-stack')).toBe(stack)
    expect(within(target).getByText('Edited commentary')).toBeInTheDocument()
    expect(stack).not.toHaveClass('justify-end')
    // Essay and Transcript disable the external consumer while the nested
    // target stays mounted in the actual presentation host.
    for (const tab of ['essay', 'transcript']) {
      view.rerender(<PresentationHarness enabled={false} text={tab} />)
      expect(target).toBeEmptyDOMElement()
      expect(screen.queryByTestId('overlay-stack')).not.toBeInTheDocument()
      expect(screen.getByTestId('reviewer-preview-target')).toBe(target)
    }
    view.rerender(<PresentationHarness text="Edited commentary" />)
    expect(within(target).getByText('Edited commentary')).toBeInTheDocument()
    expect(screen.getByTestId('overlay-stack')).toHaveClass('justify-end')
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    expect(screen.getByTestId('owner-commentary-host')).toBe(host)
    expect(screen.getByTestId('speech-video')).toBe(video)
    expect(video.currentTime).toBe(3)
    expect(fake.create).toHaveBeenCalledOnce()
    expect(player.dispose).not.toHaveBeenCalled()
    view.unmount()
  })

  it('reconciles an external overlay into a replaced nested target without recreating the player', () => {
    const view = render(<PresentationHarness />)
    const [player] = players()
    const oldTarget = screen.getByTestId('reviewer-preview-target')
    const host = screen.getByTestId('owner-commentary-host')
    view.rerender(<PresentationHarness targetVersion={2} text="Replacement commentary" />)
    const target = screen.getByTestId('reviewer-preview-target')
    expect(target).not.toBe(oldTarget)
    expect(oldTarget).not.toBeInTheDocument()
    expect(oldTarget).toBeEmptyDOMElement()
    expect(target).toContainElement(screen.getByTestId('overlay-stack'))
    expect(within(target).getByText('Replacement commentary')).toBeInTheDocument()
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    expect(host.parentNode).toBe(player.el())
    expect(screen.getByTestId('speech-video')).toBe(player.video)
    expect(fake.create).toHaveBeenCalledOnce()
    view.unmount()
    expect(target).toBeEmptyDOMElement()
  })

  it('reuses the nested host and target for a new initial URL but rejects the disposed generation ready callback', () => {
    const firstReady = vi.fn()
    const nextReady = vi.fn()
    const view = render(<PresentationHarness onPlayerReady={firstReady} />)
    const [first] = players()
    const host = screen.getByTestId('owner-commentary-host')
    const target = screen.getByTestId('reviewer-preview-target')
    const stack = screen.getByTestId('overlay-stack')
    view.rerender(<PresentationHarness initialUrl="https://media/one-renewed" onPlayerReady={nextReady} />)
    const [, second] = players()
    expect(players()).toHaveLength(2)
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second.video).not.toBe(first.video)
    expect(screen.getByTestId('speech-video')).toBe(second.video)
    expect(second.options.initialUrl).toBe('https://media/one-renewed')
    expect(host.parentNode).toBe(second.el())
    expect(screen.getByTestId('owner-commentary-host')).toBe(host)
    expect(screen.getByTestId('reviewer-preview-target')).toBe(target)
    expect(screen.getByTestId('overlay-stack')).toBe(stack)
    expect(first.el()).not.toContainElement(target)
    act(() => first.releaseReady())
    expect(firstReady).not.toHaveBeenCalled()
    expect(nextReady).not.toHaveBeenCalled()
    act(() => second.releaseReady())
    expect(nextReady).toHaveBeenCalledExactlyOnceWith(second)
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    view.unmount()
    expect(second.dispose).toHaveBeenCalledOnce()
    expect(target).toBeEmptyDOMElement()
  })

  it('remounts the player and nested portal across source identity keys even when the URL is identical', () => {
    const firstReady = vi.fn()
    const nextReady = vi.fn()
    const view = render(<PresentationHarness onPlayerReady={firstReady} />)
    const [first] = players()
    const oldHost = screen.getByTestId('owner-commentary-host')
    const oldTarget = screen.getByTestId('reviewer-preview-target')
    view.rerender(<PresentationHarness sourceKey="speech-2:asset-22" text="Second source commentary" onPlayerReady={nextReady} />)
    const [, second] = players()
    const target = screen.getByTestId('reviewer-preview-target')
    expect(players()).toHaveLength(2)
    expect(first.options.initialUrl).toBe(second.options.initialUrl)
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second.video).not.toBe(first.video)
    expect(screen.getByTestId('owner-commentary-host')).not.toBe(oldHost)
    expect(target).not.toBe(oldTarget)
    expect(oldHost).not.toBeInTheDocument()
    expect(oldTarget).toBeEmptyDOMElement()
    expect(second.el()).toContainElement(target)
    expect(within(target).getByText('Second source commentary')).toBeInTheDocument()
    expect(screen.queryByText('Reviewer commentary')).not.toBeInTheDocument()
    act(() => first.releaseReady())
    expect(firstReady).not.toHaveBeenCalled()
    expect(nextReady).not.toHaveBeenCalled()
    act(() => second.releaseReady())
    expect(nextReady).toHaveBeenCalledExactlyOnceWith(second)
    expect(screen.getAllByTestId('owner-commentary-host')).toHaveLength(1)
    expect(screen.getAllByTestId('reviewer-preview-target')).toHaveLength(1)
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    view.unmount()
  })

  it('uses the latest ready callback without constructing another player', () => {
    const initialReady = vi.fn()
    const latestReady = vi.fn()
    const view = render(<PresentationHarness onPlayerReady={initialReady} />)
    const [player] = players()
    view.rerender(<PresentationHarness onPlayerReady={latestReady} />)
    expect(initialReady).not.toHaveBeenCalled()
    expect(latestReady).not.toHaveBeenCalled()
    act(() => player.releaseReady())
    expect(initialReady).not.toHaveBeenCalled()
    expect(latestReady).toHaveBeenCalledExactlyOnceWith(player)
    expect(fake.create).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('forwards same-player URL refresh callbacks without recreating the nested presentation', async () => {
    const originalRefresh = vi.fn(async () => 'https://media/obsolete-refresh')
    const currentRefresh = vi.fn(async () => 'https://media/one-signed-refresh')
    const originalReattach = vi.fn()
    const currentReattach = vi.fn()
    const onPlayerReady = vi.fn()
    const view = render(<PresentationHarness refreshUrl={originalRefresh}
      onPlayerReady={onPlayerReady} onSourceRefreshed={originalReattach} />)
    const [player] = players()
    act(() => player.releaseReady())
    player.video.currentTime = 3
    const host = screen.getByTestId('owner-commentary-host')
    const target = screen.getByTestId('reviewer-preview-target')
    const stack = screen.getByTestId('overlay-stack')
    view.rerender(<PresentationHarness refreshUrl={currentRefresh}
      onPlayerReady={onPlayerReady} onSourceRefreshed={currentReattach} />)
    const freshUrl = await player.options.refreshUrl()
    expect(freshUrl).toBe('https://media/one-signed-refresh')
    expect(originalRefresh).not.toHaveBeenCalled()
    expect(currentRefresh).toHaveBeenCalledOnce()
    // This is the adapter callback boundary, not a replacement refresh
    // implementation: the unchanged adapter suite exercises retry/error,
    // seek restoration and caption reattachment on loadedmetadata.
    act(() => player.options.onSourceRefreshed?.())
    expect(originalReattach).not.toHaveBeenCalled()
    expect(currentReattach).toHaveBeenCalledOnce()
    expect(onPlayerReady).toHaveBeenCalledExactlyOnceWith(player)
    expect(player.options.initialUrl).toBe('https://media/one')
    expect(screen.getByTestId('speech-video')).toBe(player.video)
    expect(player.video.currentTime).toBe(3)
    expect(screen.getByTestId('owner-commentary-host')).toBe(host)
    expect(screen.getByTestId('reviewer-preview-target')).toBe(target)
    expect(screen.getByTestId('overlay-stack')).toBe(stack)
    expect(fake.create).toHaveBeenCalledOnce()
    expect(player.dispose).not.toHaveBeenCalled()
    view.unmount()
  })

  it('ignores a ready callback that arrives after final unmount', () => {
    const onPlayerReady = vi.fn()
    const view = render(<PresentationHarness onPlayerReady={onPlayerReady} />)
    const [player] = players()
    const target = screen.getByTestId('reviewer-preview-target')
    view.unmount()
    act(() => player.releaseReady())
    expect(player.dispose).toHaveBeenCalledOnce()
    expect(player.isDisposed()).toBe(true)
    expect(onPlayerReady).not.toHaveBeenCalled()
    expect(target).toBeEmptyDOMElement()
    expect(screen.queryByTestId('owner-commentary-host')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overlay-stack')).not.toBeInTheDocument()
  })
})
