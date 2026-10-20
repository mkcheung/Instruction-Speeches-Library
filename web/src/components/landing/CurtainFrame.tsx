import { useId, type ReactNode } from 'react'

/**
 * The velvet's vertical folds, in the left curtain's coordinates (each
 * `left` is a share of the curtain's width). The right curtain is drawn as
 * the left one's mirror image (see `.land-curtain-right`).
 */
const FOLDS = [
  { left: '10%', width: '9%', tone: 'deep' },
  { left: '27%', width: '3%', tone: 'sheen' },
  { left: '41%', width: '11%', tone: 'deep' },
  { left: '60%', width: '3%', tone: 'sheen' },
  { left: '73%', width: '9%', tone: 'deep' },
  { left: '94%', width: '6%', tone: 'edge' },
] as const

function Curtain({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`land-curtain land-curtain-${side}`} aria-hidden="true">
      {FOLDS.map((fold) => (
        <div
          key={fold.left}
          className={`land-fold land-fold-${fold.tone}`}
          style={{ left: fold.left, width: fold.width }}
        />
      ))}
    </div>
  )
}

/** The scalloped pelmet across the top of the stage, shown at every width. */
function Valance() {
  const scallopId = useId()
  return (
    <svg className="land-valance" aria-hidden="true" focusable="false" width="100%" height="66">
      <defs>
        <pattern id={scallopId} width="80" height="66" patternUnits="userSpaceOnUse">
          <rect width="80" height="34" fill="#A81E28" />
          <rect x="18" width="10" height="34" fill="#8A1720" />
          <rect x="56" width="8" height="34" fill="#8A1720" />
          <path d="M80,40 A40,22 0 0 1 0,40 Z" fill="#A81E28" stroke="#1F1A17" strokeWidth="2.5" />
          <path d="M73,42 A33,15 0 0 1 7,42" fill="none" stroke="#E9B949" strokeWidth="4" />
          <rect y="32" width="80" height="9" fill="#E9B949" />
          <path d="M0,32 H80 M0,41 H80" stroke="#1F1A17" strokeWidth="2" />
          <circle cx="0" cy="45" r="6" fill="#E9B949" stroke="#1F1A17" strokeWidth="2" />
          <circle cx="80" cy="45" r="6" fill="#E9B949" stroke="#1F1A17" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width="100%" height="66" fill={`url(#${scallopId})`} />
    </svg>
  )
}

/**
 * The theater around the page: the full-bleed root (`#top`, the back-to-top
 * link's target), red curtains down both sides from 900px up, the valance,
 * and the centered column `children` render into.
 *
 * The curtains are `position: absolute` columns spanning the root's full
 * height, never `position: fixed`, and `aria-hidden` like every other piece
 * of decoration here.
 */
export function CurtainFrame({ children }: { children: ReactNode }) {
  return (
    <div id="top" className="land-root font-landing-hand">
      <Curtain side="left" />
      <Curtain side="right" />
      <Valance />
      <div className="land-column">{children}</div>
    </div>
  )
}
