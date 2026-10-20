import { useId, type ReactNode } from 'react'

/**
 * One act of the page: a `<section>` named by its h2, which carries a small
 * gold "Act N" tag above the title. The space after the tag keeps the
 * heading's accessible name "Act I The empty house" rather than "Act IThe
 * empty house" (the tag is `display: block`, so the space never shows).
 */
export function Act({
  number,
  title,
  className,
  children,
}: {
  number: 'I' | 'II' | 'III'
  title: string
  /** The act's own spacing class (`land-act-one` and so on). */
  className: string
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section className={className} aria-labelledby={headingId}>
      <h2 id={headingId} className="land-act-heading font-landing-title">
        <span className="land-act-label font-landing-mono">Act {number}</span> {title}
      </h2>
      {children}
    </section>
  )
}
