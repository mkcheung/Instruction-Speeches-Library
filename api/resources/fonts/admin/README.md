# Admin fonts

Self-hosted copies from the existing pinned frontend Fontsource dependencies:
`@fontsource-variable/geist` and `@fontsource/luckiest-guy` (see `web/package-lock.json`).
The adjacent licenses apply. `filament:assets` publishes this directory; no external
font service or additional API Node build is needed.

When updating a font, use the first 16 SHA-256 hex digits of its bytes in the WOFF2
filename and update `index.css`. The stylesheet's content hash versions its entire
published directory, preserving the API origin's immutable cache policy.
