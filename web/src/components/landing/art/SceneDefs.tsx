import './art.css'

/**
 * The shared drawing kit for the landing page's art: the speaker's head,
 * crowd faces and backs of heads, raised arms, sweat drop, heart, star,
 * theater seat, and the wobble filter that makes outlines look hand-drawn.
 *
 * Render it once per page. The scenes and note avatars point at these ids
 * with `href="#land-art-…"` and `url(#land-art-…)`. It's zero-sized
 * rather than `display: none`, so browsers still resolve the filter.
 *
 * Crowd symbols take hair, skin and shirt colors from a `.land-art-p<n>`
 * class on their `<use>` (art.css), through custom properties.
 */
export function SceneDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={0}
      height={0}
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        {/* Hand-drawn wobble on the speaker's outlines */}
        <filter id="land-art-wobble" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="1.8" />
        </filter>
        {/* The speaker: ears, face and forward quiff */}
        <symbol id="land-art-hero-head" overflow="visible">
          <path className="land-art-ink" fill="#D9A27A" d="M-55,0 q-9,7 0,15 M55,0 q9,7 0,15" />
          <ellipse className="land-art-ink" rx="55" ry="50" fill="#D9A27A" />
          <path className="land-art-ink" fill="#3A2A20" d="M-53,-10 C-52,-40 -25,-52 0,-51 C10,-66 34,-72 46,-58 C40,-60 30,-58 26,-52 C42,-46 52,-30 53,-12 C40,-24 20,-30 0,-30 C-22,-30 -40,-22 -53,-10 Z" />
        </symbol>
        {/* Six crowd faces. Body, head, hair, eyes (shifted by --land-art-look), mouth */}
        <symbol id="land-art-crowd-a" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-30,52 Q-30,16 0,16 Q30,16 30,52 Z" />
          <ellipse className="land-art-ink" rx="26" ry="24" fill="var(--land-art-skin,#E3A87C)" />
          <path className="land-art-ink" fill="var(--land-art-hair,#2B2118)" d="M-26,-4 C-26,-26 26,-26 26,-4 C14,-14 -14,-14 -26,-4 Z" />
          <g className="land-art-eyes">
            <circle cx="-7" cy="4" r="2.4" fill="#1F1A17" />
            <circle cx="7" cy="4" r="2.4" fill="#1F1A17" />
          </g>
          <path className="land-art-lineonly" d="M-5,13 q5,4 10,0" />
        </symbol>
        <symbol id="land-art-crowd-b" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-30,52 Q-30,16 0,16 Q30,16 30,52 Z" />
          <circle className="land-art-ink" cx="0" cy="-22" r="22" fill="var(--land-art-hair,#2B2118)" />
          <ellipse className="land-art-ink" rx="26" ry="24" fill="var(--land-art-skin,#E3A87C)" />
          <g className="land-art-eyes">
            <circle cx="-7" cy="4" r="2.4" fill="#1F1A17" />
            <circle cx="7" cy="4" r="2.4" fill="#1F1A17" />
          </g>
          <ellipse cx="0" cy="14" rx="4" ry="5" fill="#1F1A17" />
        </symbol>
        <symbol id="land-art-crowd-c" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-30,52 Q-30,16 0,16 Q30,16 30,52 Z" />
          <path className="land-art-ink" fill="var(--land-art-hair,#2B2118)" d="M18,-14 C40,-12 44,12 34,30 C30,16 26,4 18,-2 Z" />
          <ellipse className="land-art-ink" rx="26" ry="24" fill="var(--land-art-skin,#E3A87C)" />
          <path className="land-art-ink" fill="var(--land-art-hair,#2B2118)" d="M-26,-2 C-27,-27 27,-27 26,-2 C20,-12 6,-16 -4,-12 C-12,-9 -20,-6 -26,-2 Z" />
          <g className="land-art-eyes">
            <circle cx="-7" cy="4" r="2.4" fill="#1F1A17" />
            <circle cx="7" cy="4" r="2.4" fill="#1F1A17" />
          </g>
          <path className="land-art-ink" fill="#1F1A17" d="M-6,11 Q0,22 6,11 Z" />
        </symbol>
        <symbol id="land-art-crowd-d" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-30,52 Q-30,16 0,16 Q30,16 30,52 Z" />
          <ellipse className="land-art-ink" rx="26" ry="24" fill="var(--land-art-skin,#E3A87C)" />
          <circle className="land-art-ink" cx="0" cy="-29" r="5" fill="#FFF5E6" />
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-27,-4 C-28,-31 28,-31 27,-4 Z" />
          <rect className="land-art-ink" x="-29" y="-10" width="58" height="10" rx="4" fill="var(--land-art-shirt,#3D7DCA)" />
          <g className="land-art-eyes">
            <circle cx="-7" cy="5" r="2.4" fill="#1F1A17" />
            <circle cx="7" cy="5" r="2.4" fill="#1F1A17" />
          </g>
          <path className="land-art-lineonly" d="M-5,14 q5,4 10,0" />
        </symbol>
        <symbol id="land-art-crowd-e" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-30,52 Q-30,16 0,16 Q30,16 30,52 Z" />
          <ellipse className="land-art-ink" rx="26" ry="24" fill="var(--land-art-skin,#E3A87C)" />
          <path className="land-art-ink" fill="var(--land-art-hair,#2B2118)" d="M-28,6 C-30,-30 30,-30 28,6 L22,6 L22,-5 L-22,-5 L-22,6 Z" />
          <g className="land-art-eyes">
            <circle cx="-7" cy="5" r="2.4" fill="#1F1A17" />
            <circle cx="7" cy="5" r="2.4" fill="#1F1A17" />
          </g>
          <ellipse cx="0" cy="15" rx="3.5" ry="4.5" fill="#1F1A17" />
        </symbol>
        <symbol id="land-art-crowd-f" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-30,52 Q-30,16 0,16 Q30,16 30,52 Z" />
          <circle className="land-art-ink" cx="-22" cy="-20" r="13" fill="var(--land-art-hair,#2B2118)" />
          <circle className="land-art-ink" cx="22" cy="-20" r="13" fill="var(--land-art-hair,#2B2118)" />
          <ellipse className="land-art-ink" rx="26" ry="24" fill="var(--land-art-skin,#E3A87C)" />
          <path className="land-art-ink" fill="var(--land-art-hair,#2B2118)" d="M-26,-4 C-26,-26 26,-26 26,-4 C14,-14 -14,-14 -26,-4 Z" />
          <g className="land-art-eyes">
            <circle cx="-7" cy="4" r="2.4" fill="#1F1A17" />
            <circle cx="7" cy="4" r="2.4" fill="#1F1A17" />
          </g>
          <path className="land-art-ink" fill="#1F1A17" d="M-6,11 Q0,22 6,11 Z" />
        </symbol>
        {/* Backs of heads, for the front rows seen from behind */}
        <symbol id="land-art-back-a" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-34,52 Q-34,18 0,18 Q34,18 34,52 Z" />
          <path className="land-art-ink" fill="var(--land-art-skin,#E3A87C)" d="M-27,0 q-8,7 0,14 M27,0 q8,7 0,14" />
          <ellipse className="land-art-ink" rx="27" ry="25" fill="var(--land-art-hair,#2B2118)" />
          <path className="land-art-lineonly" opacity=".55" d="M-6,-10 q6,-6 12,0" />
        </symbol>
        <symbol id="land-art-back-b" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-34,52 Q-34,18 0,18 Q34,18 34,52 Z" />
          <path className="land-art-ink" fill="var(--land-art-skin,#E3A87C)" d="M-27,0 q-8,7 0,14 M27,0 q8,7 0,14" />
          <ellipse className="land-art-ink" rx="27" ry="25" fill="var(--land-art-hair,#2B2118)" />
          <circle className="land-art-ink" cx="0" cy="-27" r="11" fill="var(--land-art-hair,#2B2118)" />
        </symbol>
        <symbol id="land-art-back-c" overflow="visible">
          <path className="land-art-ink" fill="var(--land-art-shirt,#3D7DCA)" d="M-34,52 Q-34,18 0,18 Q34,18 34,52 Z" />
          <path className="land-art-ink" fill="var(--land-art-hair,#2B2118)" d="M-28,0 C-29,-33 29,-33 28,0 L30,30 Q0,40 -30,30 Z" />
        </symbol>
        {/* Raised arms (arm1: one arm). Each is drawn just before a head with the same transform */}
        <symbol id="land-art-arms" overflow="visible">
          <path d="M-18,30 Q-34,8 -36,-24 M18,30 Q34,8 36,-24" fill="none" stroke="#1F1A17" strokeWidth="10" strokeLinecap="round" />
          <path d="M-18,30 Q-34,8 -36,-24 M18,30 Q34,8 36,-24" fill="none" stroke="var(--land-art-shirt,#3D7DCA)" strokeWidth="5.5" strokeLinecap="round" />
          <circle className="land-art-ink" cx="-36" cy="-28" r="6.5" fill="var(--land-art-skin,#E3A87C)" />
          <circle className="land-art-ink" cx="36" cy="-28" r="6.5" fill="var(--land-art-skin,#E3A87C)" />
        </symbol>
        <symbol id="land-art-arm1" overflow="visible">
          <path d="M18,30 Q34,8 36,-24" fill="none" stroke="#1F1A17" strokeWidth="10" strokeLinecap="round" />
          <path d="M18,30 Q34,8 36,-24" fill="none" stroke="var(--land-art-shirt,#3D7DCA)" strokeWidth="5.5" strokeLinecap="round" />
          <circle className="land-art-ink" cx="36" cy="-28" r="6.5" fill="var(--land-art-skin,#E3A87C)" />
        </symbol>
        {/* Sweat drop */}
        <path id="land-art-plewd" d="M0,0 C4,5 5,9 0,11 C-5,9 -4,5 0,0 Z" />
        {/* Hearts and stars over the crowd */}
        <symbol id="land-art-heart" overflow="visible">
          <path className="land-art-ink" fill="#D64561" d="M0,8 C-14,-2 -12,-14 -5,-14 C-2,-14 0,-11 0,-9 C0,-11 2,-14 5,-14 C12,-14 14,-2 0,8 Z" />
        </symbol>
        <symbol id="land-art-star" overflow="visible">
          <path className="land-art-ink" fill="#E9B949" d="M0,-12 L3.5,-4 L12,-3.5 L5.5,2 L7.5,10.5 L0,6 L-7.5,10.5 L-5.5,2 L-12,-3.5 L-3.5,-4 Z" />
        </symbol>
        {/* An empty theater seat */}
        <symbol id="land-art-seat" overflow="visible">
          <path className="land-art-ink" fill="#6E4A50" d="M-26,40 L-26,-4 Q-26,-20 -10,-20 L10,-20 Q26,-20 26,-4 L26,40 Z" />
          <path fill="#5C3D43" d="M-18,38 L-18,-2 Q-18,-12 -8,-12 L8,-12 Q18,-12 18,-2 L18,38 Z" />
          <path className="land-art-ink" fill="#3B2C2E" d="M-31,18 h6 v22 h-6 Z M25,18 h6 v22 h-6 Z" />
        </symbol>
      </defs>
    </svg>
  )
}
