import { Fragment } from 'react'
import './art.css'

/**
 * Each footlight's [x, y] on the stage-front curve (M0,58 Q380,8 760,58).
 * Its beam, bulb and hood are whole-number offsets from that point.
 */
const FOOTLIGHTS = [
  [76, 49],
  [152, 42],
  [228, 37],
  [304, 34],
  [380, 33],
  [456, 34],
  [532, 37],
  [608, 42],
  [684, 49],
] as const

/** The curved front of the stage with its row of footlights. Decorative. */
export function StageLip() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 760 96" style={{ display: 'block', width: '100%', height: '100%' }}>
      <path d="M0,58 Q380,8 760,58 L760,96 L0,96 Z" fill="#9C6A3E" />
      <path d="M0,72 Q380,22 760,72 M0,86 Q380,36 760,86" fill="none" stroke="#83552F" strokeWidth="2" />
      <path d="M0,58 Q380,8 760,58" fill="none" stroke="#2B211B" strokeWidth="3" />
      {FOOTLIGHTS.map(([x, y]) => (
        <Fragment key={x}>
          <path d={`M${x - 30},${y - 26} L${x - 9},${y + 3} L${x + 9},${y + 3} L${x + 30},${y - 26} Z`} fill="#FFE58A" opacity=".45" />
          <ellipse className="land-art-ink" cx={x} cy={y + 4} rx="9" ry="6" fill="#FFE58A" />
          <path d={`M${x - 14},${y + 12} Q${x},${y - 4} ${x + 14},${y + 12} Z`} fill="#2B211B" />
        </Fragment>
      ))}
    </svg>
  )
}
