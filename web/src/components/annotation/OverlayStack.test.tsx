import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OverlayStack } from './OverlayStack'
import type { Annotation } from '@/features/annotation/types'

function annotation(id: string, start_seconds: number, body = `body-${id}`): Annotation {
  return {
    id,
    start_seconds,
    duration_seconds: 6,
    kind: 'observation',
    topic: null,
    body,
    lock_version: 0,
    client_uuid: `uuid-${id}`,
    voice: null,
  }
}

describe('OverlayStack', () => {
  it('marks an active annotation data-visible="true" and an inactive one "false"', () => {
    const annotations = [annotation('a', 0), annotation('b', 20)]
    render(<OverlayStack annotations={annotations} activeIds={new Set(['a'])} currentTime={2} />)
    expect(screen.getByTestId('overlay-a')).toHaveAttribute('data-visible', 'true')
    // 'b' at 20s is outside [t-12,t+12] for currentTime=2 (window is [-10,14])
    // and not active, so it isn't rendered at all.
    expect(screen.queryByTestId('overlay-b')).not.toBeInTheDocument()
  })

  it('renders an inactive annotation within the [t-12s, t+12s] window as data-visible="false"', () => {
    const annotations = [annotation('a', 10)]
    render(<OverlayStack annotations={annotations} activeIds={new Set()} currentTime={5} />)
    expect(screen.getByTestId('overlay-a')).toHaveAttribute('data-visible', 'false')
  })

  it('excludes an annotation entirely outside the render window and not active', () => {
    const annotations = [annotation('a', 100)]
    render(<OverlayStack annotations={annotations} activeIds={new Set()} currentTime={5} />)
    expect(screen.queryByTestId('overlay-a')).not.toBeInTheDocument()
  })

  it('caps simultaneous visible overlays at three, dropping the oldest-started', () => {
    const annotations = [
      annotation('a', 0),
      annotation('b', 1),
      annotation('c', 2),
      annotation('d', 3),
    ]
    const activeIds = new Set(['a', 'b', 'c', 'd'])
    render(<OverlayStack annotations={annotations} activeIds={activeIds} currentTime={3} />)

    // Newest three (b, c, d) stay visible; the oldest-started (a) is
    // capped out — still rendered (in the window) but not data-visible.
    expect(screen.getByTestId('overlay-a')).toHaveAttribute('data-visible', 'false')
    expect(screen.getByTestId('overlay-b')).toHaveAttribute('data-visible', 'true')
    expect(screen.getByTestId('overlay-c')).toHaveAttribute('data-visible', 'true')
    expect(screen.getByTestId('overlay-d')).toHaveAttribute('data-visible', 'true')
  })

  it('breaks a start_seconds tie by id when applying the cap', () => {
    const annotations = [
      annotation('z', 5),
      annotation('y', 5),
      annotation('x', 5),
      annotation('a', 5),
    ]
    // All four share start_seconds=5 — tie-break is (start_seconds, id),
    // so ascending id order is a, x, y, z; capping to 3 drops the
    // earliest-sorted, 'a'.
    render(
      <OverlayStack
        annotations={annotations}
        activeIds={new Set(['a', 'x', 'y', 'z'])}
        currentTime={5}
      />,
    )
    expect(screen.getByTestId('overlay-a')).toHaveAttribute('data-visible', 'false')
    expect(screen.getByTestId('overlay-x')).toHaveAttribute('data-visible', 'true')
    expect(screen.getByTestId('overlay-y')).toHaveAttribute('data-visible', 'true')
    expect(screen.getByTestId('overlay-z')).toHaveAttribute('data-visible', 'true')
  })

  it('marks the whole overlay container aria-hidden and non-interactive', () => {
    render(<OverlayStack annotations={[]} activeIds={new Set()} currentTime={0} />)
    expect(screen.getByTestId('overlay-stack')).toHaveAttribute('aria-hidden', 'true')
  })

  /** STEP-07-write-commentary.md: the composer's live preview reuses
   * `OverlayStack` unchanged except for `draftIds` → `data-draft="true"`,
   * marking a row provisional with a dashed border (CSS in `index.css`). */
  describe('draftIds (STEP-07)', () => {
    it('marks a node in draftIds with data-draft="true"', () => {
      const annotations = [annotation('a', 0), annotation('b', 0)]
      render(
        <OverlayStack
          annotations={annotations}
          activeIds={new Set(['a', 'b'])}
          currentTime={0}
          draftIds={new Set(['a'])}
        />,
      )
      expect(screen.getByTestId('overlay-a')).toHaveAttribute('data-draft', 'true')
      expect(screen.getByTestId('overlay-b')).not.toHaveAttribute('data-draft')
    })

    it('renders nothing draft-marked when draftIds is omitted (every STEP-06 caller)', () => {
      const annotations = [annotation('a', 0)]
      render(<OverlayStack annotations={annotations} activeIds={new Set(['a'])} currentTime={0} />)
      expect(screen.getByTestId('overlay-a')).not.toHaveAttribute('data-draft')
    })
  })
})
