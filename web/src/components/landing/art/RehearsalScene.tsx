import { useId } from 'react'
import './art.css'

/** Each empty seat's x. The back row is drawn at 82% scale. */
const BACK_ROW_SEAT_XS = [44, 100.4, 156.8, 213.2, 269.6, 326, 382.4, 438.8, 495.2, 551.6, 608, 664.4, 720.8] as const
const FRONT_ROW_SEAT_XS = [36, 104.8, 173.6, 242.4, 311.2, 380, 448.8, 517.6, 586.4, 655.2, 724] as const

/**
 * Act I, "The empty house": the speaker shaking behind a lectern on a bare
 * stage, a ghost light beside him and rows of empty seats in front.
 *
 * Fills its parent; the page's wrapper supplies the frame and aspect ratio.
 * `xMinYMid slice` crops a narrow frame from the right, so the speaker and
 * the ghost light stay in view.
 *
 * The jitter runs for 3.5s, replays on hover, and only plays when the visitor
 * hasn't asked for reduced motion (art.css).
 */
export function RehearsalScene() {
  const titleId = useId()
  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      viewBox="0 0 760 520"
      preserveAspectRatio="xMinYMid slice"
      className="land-art-stage-nervous"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <title id={titleId}>A nervous speaker shakes behind a lectern, alone on a big empty stage in front of rows of empty seats</title>
      {/* Back wall, with the lighting batten along the top */}
      <rect width="760" height="300" fill="#4A413E" />
      <path d="M40,70 h44 M120,58 h30 M200,86 h52 M150,150 h40 M60,214 h30 M350,176 h44 M470,80 h40 M560,130 h50 M650,60 h44 M690,190 h36 M520,232 h40 M236,236 h34" stroke="#3F3734" strokeWidth="4" strokeLinecap="round" />
      <rect width="760" height="22" fill="#2E2321" />
      <path d="M0,22 H760" stroke="#1F1A17" strokeWidth="2.5" />
      <circle cx="88" cy="136" r="64" fill="#F3E4A8" opacity=".12" />
      {/* Stage floor, with a tape mark */}
      <rect y="300" width="760" height="110" fill="#7E6750" />
      <path d="M0,318 H760 M0,338 H760 M0,361 H760 M0,387 H760" stroke="#6B5642" strokeWidth="2" />
      <path d="M0,300 H760" stroke="#1F1A17" strokeWidth="2.5" />
      <ellipse cx="88" cy="392" rx="62" ry="10" fill="#F3E4A8" opacity=".18" />
      <path d="M578,372 l24,13 M602,372 l-24,13" stroke="#D8CFC0" strokeWidth="4" strokeLinecap="round" />
      {/* Ghost light: one bare bulb on a stand */}
      <path d="M88,148 V380 M88,364 L68,396 M88,364 L108,396" fill="none" stroke="#1F1A17" strokeWidth="4" strokeLinecap="round" />
      <circle className="land-art-ink" cx="88" cy="136" r="11" fill="#F3E4A8" />
      <path d="M77,136 h22 M88,125 v22 M80,128 l16,16 M96,128 l-16,16" fill="none" stroke="#1F1A17" strokeWidth="1.6" strokeLinecap="round" />
      {/* Stage edge, then the dark house */}
      <rect y="410" width="760" height="14" fill="#4E3A28" />
      <path d="M0,410 H760" stroke="#1F1A17" strokeWidth="2.5" />
      <rect y="424" width="760" height="96" fill="#2A2321" />
      {/* The speaker behind the lectern. The shake lines and sweat drops are drawn in, so the nerves still read when the jitter is off */}
      <g transform="translate(280 262) scale(.88)">
        <g className="land-art-jitter">
          <g filter="url(#land-art-wobble)">
            <path d="M-12,104 Q-2,120 -16,136 M12,104 Q2,120 16,136" fill="none" stroke="#1F1A17" strokeWidth="12" strokeLinecap="round" />
            <path d="M-12,104 Q-2,120 -16,136 M12,104 Q2,120 16,136" fill="none" stroke="#2E3A59" strokeWidth="7" strokeLinecap="round" />
            <ellipse className="land-art-ink" cx="-19" cy="139" rx="12" ry="6" fill="#1F1A17" transform="rotate(15 -19 139)" />
            <ellipse className="land-art-ink" cx="19" cy="139" rx="12" ry="6" fill="#1F1A17" transform="rotate(-15 19 139)" />
            <path className="land-art-ink" fill="#2E3A59" d="M-28,92 L-30,110 L30,110 L28,92 Z" />
            <path className="land-art-ink" fill="#2A9D8F" d="M-24,46 Q-32,80 -29,98 L29,98 Q32,80 24,46 Z" />
            <path d="M-22,58 Q-40,66 -30,80 M22,58 Q40,66 30,80" fill="none" stroke="#1F1A17" strokeWidth="12" strokeLinecap="round" />
            <path d="M-22,58 Q-40,66 -30,80 M22,58 Q40,66 30,80" fill="none" stroke="#2A9D8F" strokeWidth="7" strokeLinecap="round" />
            <path className="land-art-ink" fill="#C68B59" d="M-40,74 L40,74 L34,92 L-34,92 Z" />
            <path className="land-art-ink" fill="#9C6A3E" d="M-4,92 L4,92 L4,141 L-4,141 Z" />
            <circle className="land-art-ink" cx="-30" cy="78" r="6.5" fill="#D9A27A" />
            <circle className="land-art-ink" cx="30" cy="78" r="6.5" fill="#D9A27A" />
            <use href="#land-art-hero-head" />
            <path className="land-art-ink" fill="#E4572E" d="M0,53 L-12,47 L-12,59 Z M0,53 L12,47 L12,59 Z" />
            <circle className="land-art-ink" cx="0" cy="53" r="3" fill="#E4572E" />
            <circle cx="-13" cy="8" r="3" fill="#1F1A17" />
            <circle cx="13" cy="8" r="3" fill="#1F1A17" />
            <path className="land-art-lineonly" d="M-24,-6 L-8,-13 M8,-13 L24,-6" />
            <path className="land-art-lineonly" d="M-12,28 q3,-4 6,0 t6,0 t6,0 t6,0" />
            <path className="land-art-lineonly" d="M-26,112 q-5,6 0,12 M-33,109 q-6,9 0,18 M26,112 q5,6 0,12 M33,109 q6,9 0,18" />
            <path className="land-art-lineonly" d="M-50,72 q-5,6 0,12 M-57,69 q-6,9 0,18 M50,72 q5,6 0,12 M57,69 q6,9 0,18" />
            {/* Sweat drops. .land-art-ink's stroke-width overrides this group's 1.8, as in the approved render */}
            <g fill="#CFE8F7" className="land-art-ink" strokeWidth="1.8">
              <use href="#land-art-plewd" transform="translate(-62,-50) rotate(135) scale(1.5)" />
              <use href="#land-art-plewd" transform="translate(-75,-22) rotate(105) scale(1.5)" />
              <use href="#land-art-plewd" transform="translate(66,-46) rotate(-135) scale(1.5)" />
              <use href="#land-art-plewd" transform="translate(78,-18) rotate(-105) scale(1.5)" />
            </g>
          </g>
        </g>
      </g>
      {/* Speech balloon */}
      <path className="land-art-ink" fill="#FFFDF6" d="M327,125 L318,178 L348,129 Z" />
      <ellipse className="land-art-ink" cx="360" cy="96" rx="66" ry="34" fill="#FFFDF6" />
      <text x="360" y="101" textAnchor="middle" fontFamily="'Patrick Hand', cursive" fontSize="15" fill="#1F1A17">um… h-hello?</text>
      {/* Empty seats: the back row, then the front row */}
      {BACK_ROW_SEAT_XS.map((x) => (
        <use key={x} href="#land-art-seat" transform={`translate(${x} 452) scale(.82)`} />
      ))}
      {FRONT_ROW_SEAT_XS.map((x) => (
        <use key={x} href="#land-art-seat" transform={`translate(${x} 480)`} />
      ))}
    </svg>
  )
}
