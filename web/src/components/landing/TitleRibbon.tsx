/** One swallow-tailed end of the banner; the right one is the left one mirrored. */
function RibbonTail({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      className={`land-ribbon-tail land-ribbon-tail-${side}`}
      aria-hidden="true"
      focusable="false"
      width="56"
      height="64"
      viewBox="0 0 56 64"
    >
      <path
        d="M54,1.5 H2 L15,32 L2,62.5 H54 Z"
        fill="#7E141C"
        stroke="#2B211B"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M40,48 L54,62.5 L40,62.5 Z"
        fill="#4E0C12"
        stroke="#2B211B"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The page's one h1: "INSTRUCTION SPEECHES" on a red banner, "LIBRARY" on a
 * gold plate under it. The capitals are CSS `text-transform`; the DOM keeps
 * normal case. The `{' '}` before the `<br />` is load-bearing: without it
 * the accessible name would read "Instruction SpeechesLibrary".
 */
export function TitleRibbon() {
  return (
    <h1 className="land-title font-landing-title">
      <span className="land-ribbon">
        <RibbonTail side="left" />
        <RibbonTail side="right" />
        <span className="land-ribbon-text">Instruction Speeches</span>
      </span>{' '}
      <br />
      <span className="land-library">Library</span>
    </h1>
  )
}
