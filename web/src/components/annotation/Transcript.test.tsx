import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transcript } from './Transcript'
import type { Annotation } from '@/features/annotation/types'

function annotation(id: string, start_seconds: number): Annotation {
  return {
    id,
    start_seconds,
    duration_seconds: 6,
    kind: 'observation',
    topic: null,
    body: `body-${id}`,
    lock_version: 0,
    client_uuid: `uuid-${id}`,
  }
}

/** `<li>` has no accessible name of its own, so tests locate a row via its
 * button's text and walk up, rather than querying `listitem` by name. */
function rowFor(bodyText: string | RegExp): HTMLElement {
  const li = screen.getByRole('button', { name: bodyText }).closest('li')
  if (!li) throw new Error(`no <li> ancestor for button matching ${String(bodyText)}`)
  return li
}

describe('Transcript', () => {
  it('renders rows in an <ol>, timecoded', () => {
    render(
      <Transcript
        annotations={[annotation('a', 83)]}
        activeIds={new Set()}
        currentTime={0}
        onSeek={() => {}}
      />,
    )
    expect(screen.getByRole('list').tagName).toBe('OL')
    expect(screen.getByText('1:23')).toBeInTheDocument()
  })

  it('marks the active row aria-current', () => {
    const annotations = [annotation('a', 0), annotation('b', 10)]
    render(<Transcript annotations={annotations} activeIds={new Set(['b'])} currentTime={10} onSeek={() => {}} />)
    expect(rowFor(/body-b/)).toHaveAttribute('aria-current', 'true')
    expect(rowFor(/body-a/)).not.toHaveAttribute('aria-current')
  })

  it('falls back to the nearest PRECEDING cue when nothing is active', () => {
    const annotations = [annotation('a', 0), annotation('b', 10), annotation('c', 30)]
    render(<Transcript annotations={annotations} activeIds={new Set()} currentTime={15} onSeek={() => {}} />)
    // currentTime=15 is past b's start (10) but before c's start (30) —
    // nearest preceding is b, never the future cue c.
    expect(rowFor(/body-b/)).toHaveAttribute('aria-current', 'true')
    expect(rowFor(/body-c/)).not.toHaveAttribute('aria-current')
  })

  it('marks nothing current before the first cue has been reached', () => {
    const annotations = [annotation('a', 10)]
    render(<Transcript annotations={annotations} activeIds={new Set()} currentTime={0} onSeek={() => {}} />)
    expect(rowFor(/body-a/)).not.toHaveAttribute('aria-current')
  })

  it('calls onSeek with the annotation start time on row click', async () => {
    const onSeek = vi.fn()
    const user = userEvent.setup()
    render(
      <Transcript
        annotations={[annotation('a', 42)]}
        activeIds={new Set()}
        currentTime={0}
        onSeek={onSeek}
      />,
    )
    await user.click(screen.getByRole('button', { name: /body-a/ }))
    expect(onSeek).toHaveBeenCalledWith(42)
  })

  it('shows a fallback message when there are no annotations', () => {
    render(<Transcript annotations={[]} activeIds={new Set()} currentTime={0} onSeek={() => {}} />)
    expect(screen.getByText(/no commentary on this track/i)).toBeInTheDocument()
  })
})
