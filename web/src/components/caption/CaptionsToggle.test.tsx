import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaptionsToggle } from '@/components/caption/CaptionsToggle'

/** A minimal fake `TextTrack` — jsdom doesn't implement the real one, and
 * this component only ever reads/writes `.mode`. */
function fakeTrack(mode: TextTrackMode = 'disabled'): TextTrack {
  return { mode } as unknown as TextTrack
}

describe('CaptionsToggle', () => {
  it('renders nothing when no track is attached yet', () => {
    const { container } = render(<CaptionsToggle track={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reflects the track\'s initial mode', () => {
    render(<CaptionsToggle track={fakeTrack('showing')} />)
    expect(screen.getByTestId('captions-toggle')).toHaveTextContent('Captions on')
    expect(screen.getByTestId('captions-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggling flips the TextTrack.mode independently of any other control', async () => {
    const track = fakeTrack('disabled')
    const user = userEvent.setup()
    render(<CaptionsToggle track={track} />)

    expect(screen.getByTestId('captions-toggle')).toHaveTextContent('Captions off')

    await user.click(screen.getByTestId('captions-toggle'))
    expect(track.mode).toBe('showing')
    expect(screen.getByTestId('captions-toggle')).toHaveTextContent('Captions on')

    await user.click(screen.getByTestId('captions-toggle'))
    expect(track.mode).toBe('disabled')
    expect(screen.getByTestId('captions-toggle')).toHaveTextContent('Captions off')
  })
})
