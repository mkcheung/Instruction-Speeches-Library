import './art.css'

/**
 * The reviewer faces on the Act II timeline notes, in order. Each one is a
 * crowd face and palette from the Act III audience, glancing right.
 */
const FACES = {
  /** the note at 0:12 */
  a: { href: '#land-art-crowd-c', className: 'land-art-p4 land-art-look-r' },
  /** the note at 0:42 */
  b: { href: '#land-art-crowd-f', className: 'land-art-p7 land-art-look-r' },
  /** the note at 1:15 */
  c: { href: '#land-art-crowd-e', className: 'land-art-p2 land-art-look-r' },
} as const

/** A 44×44 reviewer head in its own cream circle with a dark ring. Decorative: the note's text carries the meaning. */
export function NoteAvatar({ variant }: { variant: 'a' | 'b' | 'c' }) {
  const face = FACES[variant]
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="44"
      height="44"
      viewBox="-30 -30 60 60"
      style={{ flex: 'none', display: 'block', borderRadius: '50%', background: '#FFF5E6', boxShadow: '0 0 0 2px #2B211B' }}
    >
      <use href={face.href} className={face.className} transform="translate(0 4) scale(.82)" />
    </svg>
  )
}
