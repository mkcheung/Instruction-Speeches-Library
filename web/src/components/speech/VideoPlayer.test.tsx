import { StrictMode, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/shared/media/videojs-adapter', () => ({ createVideoJsPlayer: fake.create }))
import { VideoPlayer } from './VideoPlayer'

function makePlayer(video: HTMLVideoElement) {
  const root = document.createElement('div')
  video.replaceWith(root)
  root.append(video)
  const listeners = new Map<string, () => void>()
  let disposed = false
  return {
    el: () => root,
    ready: (callback: () => void) => callback(),
    isDisposed: () => disposed,
    on: (event: string, callback: () => void) => listeners.set(event, callback),
    off: (event: string) => listeners.delete(event),
    emit: (event: string) => listeners.get(event)?.(),
    dispose: vi.fn(() => {
      expect(root.querySelector('[data-testid="owner-commentary-host"]')).toBeNull()
      disposed = true
      root.remove()
    }),
  }
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
})
