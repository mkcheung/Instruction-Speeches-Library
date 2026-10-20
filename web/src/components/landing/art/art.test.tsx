import { Fragment, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FullHouseScene, NoteAvatar, RehearsalScene, SceneDefs, StageLip } from '.'

const REHEARSAL_TITLE =
  'A nervous speaker shakes behind a lectern, alone on a big empty stage in front of rows of empty seats'
const FULL_HOUSE_TITLE =
  'The same speaker, now confident, shouts with both arms raised in a spotlight in the middle of a packed theater, with a cheering crowd on every side'

interface Piece {
  name: string
  element: ReactElement
}

const STAGE_LIP: Piece = { name: 'StageLip', element: <StageLip /> }

const AVATARS: Piece[] = (['a', 'b', 'c'] as const).map((variant) => ({
  name: `NoteAvatar ${variant}`,
  element: <NoteAvatar variant={variant} />,
}))

/** Everything that draws with SceneDefs' symbols. */
const DRAWINGS: Piece[] = [
  STAGE_LIP,
  { name: 'RehearsalScene', element: <RehearsalScene /> },
  { name: 'FullHouseScene', element: <FullHouseScene /> },
  ...AVATARS,
]

const ALL_PIECES: Piece[] = [{ name: 'SceneDefs', element: <SceneDefs /> }, ...DRAWINGS]

/**
 * Home.test.tsx expects each of these exactly once on the page, outside the
 * art. Testing Library reads SVG <title> and <text>, so the art can't use them.
 */
const PAGE_PHRASES = [/fade/i, /unless you.*invited/i, /register/i, /log in/i]

function idsIn(root: ParentNode): Set<string> {
  return new Set(Array.from(root.querySelectorAll('[id]'), (el) => el.id))
}

/** Every id that an element points at, through href, url(#…) or aria-labelledby. */
function referencesIn(root: ParentNode): { via: string; id: string }[] {
  const refs: { via: string; id: string }[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const { name, value } of Array.from(el.attributes)) {
      if (name === 'href' || name === 'xlink:href') {
        if (value.startsWith('#')) refs.push({ via: name, id: value.slice(1) })
      } else if (name === 'aria-labelledby') {
        for (const id of value.split(/\s+/).filter(Boolean)) refs.push({ via: name, id })
      } else {
        // fill, filter, clip-path… and inline style
        for (const [, id] of value.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) refs.push({ via: name, id })
      }
    }
  }
  return refs
}

describe('landing art', () => {
  it('names both scenes with their exact titles', () => {
    render(
      <>
        <SceneDefs />
        <RehearsalScene />
        <FullHouseScene />
      </>,
    )

    expect(screen.getByRole('img', { name: REHEARSAL_TITLE })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: FULL_HOUSE_TITLE })).toBeInTheDocument()
    // SceneDefs adds nothing that assistive tech can reach.
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })

  it.each(ALL_PIECES)('$name contains none of the phrases the page tests count', ({ element }) => {
    const { container } = render(element)

    for (const phrase of PAGE_PHRASES) {
      expect(container.textContent).not.toMatch(phrase)
      expect(screen.queryAllByText(phrase)).toHaveLength(0)
    }
  })

  it.each([STAGE_LIP, ...AVATARS])('$name is hidden from assistive tech', ({ element }) => {
    const { container } = render(element)

    const svg = container.firstElementChild
    expect(svg?.tagName).toBe('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('SceneDefs renders exactly one hidden, zero-sized svg', () => {
    const { container } = render(<SceneDefs />)

    expect(container.children).toHaveLength(1)
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true')
    expect(svgs[0]).toHaveAttribute('focusable', 'false')
    expect(svgs[0]).toHaveAttribute('width', '0')
    expect(svgs[0]).toHaveAttribute('height', '0')
    expect(svgs[0]).toHaveStyle({ position: 'absolute', width: '0px', height: '0px', overflow: 'hidden' })
  })

  it('points every href, url(#…) and aria-labelledby at an id that exists', () => {
    const defsIds = idsIn(render(<SceneDefs />).container)
    expect([...defsIds].filter((id) => !id.startsWith('land-art-'))).toEqual([])

    const used = new Set<string>()
    for (const { name, element } of DRAWINGS) {
      const { container } = render(element)
      const ownIds = idsIn(container)
      for (const { via, id } of referencesIn(container)) {
        // A title belongs to its own scene; drawing references may also use SceneDefs.
        const resolves = via === 'aria-labelledby' ? ownIds.has(id) : ownIds.has(id) || defsIds.has(id)
        expect(resolves, `${name}: ${via} → #${id}`).toBe(true)
        used.add(id)
      }
    }

    // Every SceneDefs id is drawn somewhere, which also proves the walk found real references.
    expect([...defsIds].filter((id) => !used.has(id))).toEqual([])
  })

  it('keeps ids unique with all the art on one page', () => {
    const { container } = render(
      <>
        {ALL_PIECES.map(({ name, element }) => (
          <Fragment key={name}>{element}</Fragment>
        ))}
      </>,
    )

    const ids = Array.from(container.querySelectorAll('[id]'), (el) => el.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })

  it.each(ALL_PIECES)('$name prefixes every class with land-art-', ({ element }) => {
    const { container } = render(element)

    const classes = Array.from(container.querySelectorAll('[class]'), (el) => el.getAttribute('class') ?? '')
      .flatMap((value) => value.split(/\s+/))
      .filter(Boolean)
    expect(classes.filter((name) => !name.startsWith('land-art-'))).toEqual([])
  })

  it("puts Act I's jitter group inside the scene that replays it on hover", () => {
    const { container } = render(<RehearsalScene />)

    expect(container.querySelector('svg.land-art-stage-nervous .land-art-jitter')).not.toBeNull()
  })
})
