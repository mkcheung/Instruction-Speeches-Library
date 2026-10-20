/**
 * The curtain call. `#top` is `CurtainFrame`'s root. A plain `<a>`, not a
 * router `<Link>`: this is an in-page jump, which the browser handles
 * natively. The arrow is hidden from screen readers so the link is
 * announced as "Back to the top".
 */
export function LandingFooter() {
  return (
    <footer className="land-footer">
      <p className="land-footer-line">Your speech. Your invite list. Your stage.</p>
      <a href="#top" className="land-top-link">
        <span aria-hidden="true">↑ </span>Back to the top
      </a>
    </footer>
  )
}
