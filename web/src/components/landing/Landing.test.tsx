import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { Landing } from '@/components/landing/Landing'
import { renderWithProviders } from '@/test/renderWithProviders'

const sceneNames = vi.hoisted(() => ({
  rehearsal:
    'A nervous speaker shakes behind a lectern, alone on a big empty stage in front of rows of empty seats',
  fullHouse:
    'The same speaker, now confident, shouts with both arms raised in a spotlight in the middle of a packed theater, with a cheering crowd on every side',
}))

/**
 * The art module is about 50KB of SVG with its own owner; these tests cover
 * the page around it. The stubs keep the module's five exports: scenes with
 * their contract names, and avatars that report which variant they got.
 */
vi.mock('@/components/landing/art', () => ({
  SceneDefs: () => null,
  StageLip: () => null,
  RehearsalScene: () => <svg role="img" aria-label={sceneNames.rehearsal} />,
  FullHouseScene: () => <svg role="img" aria-label={sceneNames.fullHouse} />,
  NoteAvatar: ({ variant }: { variant: string }) => <span data-testid={`avatar-${variant}`} />,
}))

const PRIVACY_RULE =
  'Nobody sees your speech unless you personally invited them. No public list, no way to volunteer.'
const MECHANISM =
  "Upload your speech, invite your reviewers, and as it plays back their notes fade in at the exact second they apply — and fade out again once the moment's passed — so feedback lines up with the part of the speech it's actually about."

/** Renders the page and waits for the lazy art chunk to land, so nothing
 * re-renders after the test ends. */
async function renderLanding() {
  const view = renderWithProviders(<Landing />)
  await screen.findByRole('img', { name: sceneNames.fullHouse })
  return view
}

describe('Landing', () => {
  it('names the product in a single h1', async () => {
    await renderLanding()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Instruction Speeches Library' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('has exactly one Register link and one Log in link', async () => {
    await renderLanding()

    const register = screen.getAllByRole('link', { name: /register/i })
    expect(register).toHaveLength(1)
    expect(register[0]).toHaveAttribute('href', '/register')

    const logIn = screen.getAllByRole('link', { name: /log in/i })
    expect(logIn).toHaveLength(1)
    expect(logIn[0]).toHaveAttribute('href', '/login')
  })

  it('states the privacy rule and the mechanism exactly once each', async () => {
    await renderLanding()

    expect(screen.getAllByText(PRIVACY_RULE)).toHaveLength(1)
    expect(screen.getAllByText(MECHANISM)).toHaveLength(1)
    // `Home.test.tsx`'s own looser queries (`findByText`/`getByText`, which
    // throw on a second match): no microcopy may repeat these phrases.
    expect(screen.getAllByText(/unless you.*invited/i)).toHaveLength(1)
    expect(screen.getAllByText(/fade/i)).toHaveLength(1)
  })

  it('puts the title and both buttons inside the main landmark', async () => {
    await renderLanding()

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(within(main).getByRole('link', { name: /register/i })).toBeInTheDocument()
    expect(within(main).getByRole('link', { name: /log in/i })).toBeInTheDocument()
  })

  it('links back to the top of the page', async () => {
    await renderLanding()

    expect(screen.getByRole('link', { name: /back to the top/i })).toHaveAttribute('href', '#top')
    // The link's target exists, and it's the page root, above the title.
    expect(document.getElementById('top')).toContainElement(screen.getByRole('main'))
  })

  it('renders both scenes and one avatar per note from the art module', async () => {
    await renderLanding()

    expect(screen.getByRole('img', { name: sceneNames.rehearsal })).toBeInTheDocument()

    const notes = within(screen.getByRole('list', { name: /example playback/i })).getAllByRole(
      'listitem',
    )
    expect(notes.map((note) => note.textContent)).toEqual([
      '0:12Breathe here — great pause.',
      '0:42Love this story!',
      '1:15Slow down a touch.',
    ])
    // Avatars a/b/c belong to the notes at 0:12, 0:42 and 1:15.
    await within(notes[0]).findByTestId('avatar-a')
    expect(within(notes[1]).getByTestId('avatar-b')).toBeInTheDocument()
    expect(within(notes[2]).getByTestId('avatar-c')).toBeInTheDocument()
  })
})
