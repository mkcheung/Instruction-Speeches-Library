import { useId } from 'react'
import './art.css'
import {
  BACK_ROWS,
  BOX_LEFT_LOWER,
  BOX_LEFT_UPPER,
  BOX_RIGHT_LOWER,
  BOX_RIGHT_UPPER,
  FRONT_ROWS,
  MIDDLE_TIER,
  SIDE_ROWS,
  UPPER_TIER,
  type CrowdEntry,
  type CrowdGroup,
} from './crowd'

function CrowdUses({ entries }: { entries: readonly CrowdEntry[] }) {
  return (
    <>
      {entries.map(([symbol, palette, x, y, rotate, scale], i) => (
        <use
          key={i}
          href={`#land-art-${symbol}`}
          className={`land-art-p${palette}`}
          transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}
        />
      ))}
    </>
  )
}

function CrowdGroups({ groups }: { groups: readonly CrowdGroup[] }) {
  return (
    <>
      {groups.map((group, i) => (
        <g key={i} className={group.look === 'r' ? 'land-art-look-r' : 'land-art-look-l'}>
          <CrowdUses entries={group.entries} />
        </g>
      ))}
    </>
  )
}

/** x of each brass stud on a balcony rail: 20 of them, 38 apart. */
const RAIL_STUD_XS = Array.from({ length: 20 }, (_, i) => 19 + i * 38)

function RailStuds({ y }: { y: number }) {
  return (
    <>
      {RAIL_STUD_XS.map((x) => (
        <circle key={x} cx={x} cy={y} r="2.6" fill="#FFE58A" stroke="#1F1A17" strokeWidth="1" />
      ))}
    </>
  )
}

/**
 * Act III, "Full house": the speaker from Act I, arms up in a spotlight on a
 * round stage, shouting to a packed, tiered theater. Audience placement is
 * in crowd.ts.
 *
 * Fills its parent; the page's wrapper supplies the frame and aspect ratio.
 * `xMidYMid slice` crops a narrow frame evenly from both sides.
 */
export function FullHouseScene() {
  const titleId = useId()
  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      viewBox="0 0 760 720"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <title id={titleId}>The same speaker, now confident, shouts with both arms raised in a spotlight in the middle of a packed theater, with a cheering crowd on every side</title>
      {/* Back wall and the lighting bar, with the follow-spot lamp */}
      <rect width="760" height="720" fill="#5C1F27" />
      <rect width="760" height="52" fill="#3A1218" />
      <path d="M0,47 H760" stroke="#1F1A17" strokeWidth="6" />
      <path className="land-art-ink" fill="#2B211B" d="M150,47 h20 l6,15 h-32 Z M590,47 h20 l6,15 h-32 Z" />
      <rect className="land-art-ink" x="362" y="14" width="36" height="30" rx="5" fill="#2B211B" />
      <ellipse className="land-art-ink" cx="380" cy="46" rx="17" ry="5" fill="#FFE58A" />
      {/* Upper tier */}
      <g opacity=".7">
        <CrowdGroups groups={UPPER_TIER} />
      </g>
      {/* First rail, with brass studs */}
      <rect y="110" width="760" height="18" fill="#8E2430" />
      <path d="M0,110 H760" stroke="#E9B949" strokeWidth="5" />
      <path d="M0,107.5 H760 M0,112.5 H760 M0,128 H760" stroke="#1F1A17" strokeWidth="1.5" />
      <RailStuds y={119} />
      {/* Middle tier */}
      <g opacity=".7">
        <CrowdGroups groups={MIDDLE_TIER} />
      </g>
      {/* Second rail */}
      <rect y="192" width="760" height="20" fill="#8E2430" />
      <path d="M0,192 H760" stroke="#E9B949" strokeWidth="5" />
      <path d="M0,189.5 H760 M0,194.5 H760 M0,212 H760" stroke="#1F1A17" strokeWidth="1.5" />
      <RailStuds y={202} />
      {/* Back rows */}
      <CrowdGroups groups={BACK_ROWS} />
      {/* Left boxes: back wall, audience, drape and ledge, twice */}
      <rect x="0" y="216" width="120" height="58" fill="#2E0E13" />
      <CrowdGroups groups={BOX_LEFT_UPPER} />
      <path className="land-art-ink" fill="#A81E28" d="M0,216 H120 V224 Q90,244 60,226 Q30,244 0,224 Z" />
      <rect className="land-art-ink" x="0" y="262" width="122" height="10" fill="#E9B949" />
      <rect x="0" y="272" width="120" height="10" fill="#8E2430" />
      <rect x="0" y="282" width="120" height="58" fill="#2E0E13" />
      <CrowdGroups groups={BOX_LEFT_LOWER} />
      <path className="land-art-ink" fill="#A81E28" d="M0,282 H120 V290 Q90,310 60,292 Q30,310 0,290 Z" />
      <rect className="land-art-ink" x="0" y="328" width="122" height="10" fill="#E9B949" />
      <rect x="0" y="338" width="120" height="10" fill="#8E2430" />
      <path d="M120,216 V348" stroke="#1F1A17" strokeWidth="3" />
      {/* Right boxes */}
      <rect x="640" y="216" width="120" height="58" fill="#2E0E13" />
      <CrowdGroups groups={BOX_RIGHT_UPPER} />
      <path className="land-art-ink" fill="#A81E28" d="M640,216 H760 V224 Q730,244 700,226 Q670,244 640,224 Z" />
      <rect className="land-art-ink" x="638" y="262" width="122" height="10" fill="#E9B949" />
      <rect x="640" y="272" width="120" height="10" fill="#8E2430" />
      <rect x="640" y="282" width="120" height="58" fill="#2E0E13" />
      <CrowdGroups groups={BOX_RIGHT_LOWER} />
      <path className="land-art-ink" fill="#A81E28" d="M640,282 H760 V290 Q730,310 700,292 Q670,310 640,290 Z" />
      <rect className="land-art-ink" x="638" y="328" width="122" height="10" fill="#E9B949" />
      <rect x="640" y="338" width="120" height="10" fill="#8E2430" />
      <path d="M640,216 V348" stroke="#1F1A17" strokeWidth="3" />
      {/* Side rows */}
      <CrowdGroups groups={SIDE_ROWS} />
      {/* Spotlight */}
      <polygon points="364,48 396,48 520,516 240,516" fill="#FFE58A" opacity=".55" />
      {/* Round stage */}
      <path className="land-art-ink" fill="#8C5A32" d="M144,522 A236,52 0 0 0 616,522 L616,542 A236,52 0 0 1 144,542 Z" />
      <ellipse className="land-art-ink" cx="380" cy="522" rx="236" ry="52" fill="#C68B59" />
      <ellipse cx="380" cy="522" rx="214" ry="42" fill="none" stroke="#E9B949" strokeWidth="3" />
      <ellipse cx="380" cy="516" rx="130" ry="24" fill="#FFE58A" opacity=".85" />
      {/* The speaker, arms up and mouth open, with motion lines around him */}
      <g transform="translate(380 375)">
        <g filter="url(#land-art-wobble)">
          <path className="land-art-lineonly" style={{ strokeWidth: 3 }} d="M-84.3,-75.7 L-104.2,-92.4 M-59.9,-97.3 L-74.1,-119.1 M-30.3,-110.7 L-37.5,-135.7 M0,-115 L0,-141 M30.3,-110.7 L37.5,-135.7 M59.9,-97.3 L74.1,-119.1 M108.9,-20.3 L134.7,-23.9 M-108.9,-20.3 L-134.7,-23.9 M107.6,17.9 L133,23.3 M-107.6,17.9 L-133,23.3" />
          <path d="M-14,104 L-34,136 M14,104 L34,136" fill="none" stroke="#1F1A17" strokeWidth="12" strokeLinecap="round" />
          <path d="M-14,104 L-34,136 M14,104 L34,136" fill="none" stroke="#2E3A59" strokeWidth="7" strokeLinecap="round" />
          <ellipse className="land-art-ink" cx="-38" cy="140" rx="13" ry="6.5" fill="#1F1A17" />
          <ellipse className="land-art-ink" cx="38" cy="140" rx="13" ry="6.5" fill="#1F1A17" />
          <path className="land-art-ink" fill="#2E3A59" d="M-28,92 L-30,110 L30,110 L28,92 Z" />
          <path className="land-art-ink" fill="#2A9D8F" d="M-24,46 Q-32,80 -29,98 L29,98 Q32,80 24,46 Z" />
          <path d="M-22,58 Q-60,40 -82,-30 M22,58 Q60,40 82,-30" fill="none" stroke="#1F1A17" strokeWidth="12" strokeLinecap="round" />
          <path d="M-22,58 Q-60,40 -82,-30 M22,58 Q60,40 82,-30" fill="none" stroke="#2A9D8F" strokeWidth="7" strokeLinecap="round" />
          <circle className="land-art-ink" cx="-84" cy="-34" r="8" fill="#D9A27A" />
          <circle className="land-art-ink" cx="84" cy="-34" r="8" fill="#D9A27A" />
          <g transform="rotate(-6)">
            <use href="#land-art-hero-head" />
            <path className="land-art-lineonly" d="M-19,6 q6,-7 12,0 M7,6 q6,-7 12,0" />
            <path className="land-art-ink" fill="#1F1A17" d="M-16,20 Q0,50 16,20 Z" />
          </g>
          <path className="land-art-ink" fill="#E4572E" d="M0,53 L-12,47 L-12,59 Z M0,53 L12,47 L12,59 Z" />
          <circle className="land-art-ink" cx="0" cy="53" r="3" fill="#E4572E" />
        </g>
      </g>
      {/* Shout balloon, its tail pointing at the speaker */}
      <path className="land-art-ink" fill="#FFFDF6" d="M713.7,217.5 L693.7,225.5 L706.4,239.2 L683.3,242.6 L689.8,258.7 L665.6,257.2 L665.2,274.4 L642,268.1 L634.8,285 L614.2,274.5 L600.9,289.8 L584.7,275.8 L566.2,288.2 L555.8,272 L533.7,280.5 L529.8,263.3 L505.9,267.2 L508.8,250.4 L448,318 L494.6,234.4 L472.8,228.7 L488.3,216.7 L470.3,206.5 L490.3,198.5 L477.6,184.8 L500.7,181.4 L494.2,165.3 L518.4,166.8 L518.8,149.6 L542,155.9 L549.2,139 L569.8,149.5 L583.1,134.2 L599.3,148.2 L617.8,135.8 L628.2,152 L650.3,143.5 L654.2,160.7 L678.1,156.8 L675.2,173.6 L699,174.5 L689.4,189.6 L711.2,195.3 L695.7,207.3 Z" />
      <text x="592" y="206" textAnchor="middle" fontFamily="'Luckiest Guy', cursive" fontSize="29" fill="#1F1A17">HELLO,</text>
      <text x="592" y="240" textAnchor="middle" fontFamily="'Luckiest Guy', cursive" fontSize="29" fill="#1F1A17">EVERYONE!</text>
      {/* Front rows, seen from behind */}
      <CrowdUses entries={FRONT_ROWS} />
      {/* Hearts and stars */}
      <use href="#land-art-heart" transform="translate(198 222) rotate(-12) scale(1.2)" />
      <use href="#land-art-heart" transform="translate(676 318) rotate(10) scale(1.1)" />
      <use href="#land-art-heart" transform="translate(52 380) rotate(-6) scale(1.2)" />
      <use href="#land-art-star" transform="translate(272 140) rotate(8) scale(1.2)" />
      <use href="#land-art-star" transform="translate(712 108) rotate(-10) scale(1.1)" />
      {/* Sound effects. x=92 and x=500 keep both inside the phone crop */}
      <g fontFamily="'Luckiest Guy', cursive" fontSize="28" fill="#E9B949" stroke="#1F1A17" strokeWidth="5" strokeLinejoin="round" paintOrder="stroke">
        <text x="92" y="40" transform="rotate(-4 92 40)">CLAP CLAP</text>
        <text x="500" y="40" transform="rotate(4 500 40)">CLAP CLAP</text>
      </g>
    </svg>
  )
}
