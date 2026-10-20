/**
 * Act I's easel sign, carrying the product's privacy rule. On wide screens
 * it stands on the stage, over the top-right of the rehearsal scene; below
 * 760px it drops underneath the scene (see `.land-sign`).
 *
 * The rule stays in ONE element, word for word: `Home.test.tsx` finds it
 * with `findByText`, which fails on a second match.
 */
export function ClosedRehearsalSign() {
  return (
    <div className="land-sign">
      <div className="land-sign-board">
        <p className="land-sign-title font-landing-title">Closed rehearsal</p>
        <div className="land-sign-rule" aria-hidden="true" />
        <p className="land-sign-text">
          Nobody sees your speech unless you personally invited them. No public list, no way to
          volunteer.
        </p>
      </div>
      <svg
        className="land-sign-legs"
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 280 96"
      >
        <path
          d="M64,0 L44,86 M216,0 L236,86"
          fill="none"
          stroke="#1F1A17"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M64,0 L44,86 M216,0 L236,86"
          fill="none"
          stroke="#9C6A3E"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path d="M58,34 H222" fill="none" stroke="#1F1A17" strokeWidth="9" strokeLinecap="round" />
        <path d="M58,34 H222" fill="none" stroke="#9C6A3E" strokeWidth="4.5" strokeLinecap="round" />
        <ellipse cx="44" cy="89" rx="10" ry="3.5" fill="#1F1A17" />
        <ellipse cx="236" cy="89" rx="10" ry="3.5" fill="#1F1A17" />
      </svg>
    </div>
  )
}
