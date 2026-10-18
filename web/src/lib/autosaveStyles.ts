/**
 * `text-[var(--color-success)]` alone measured 3.29:1 against white (needs
 * 4.5:1, WCAG 2.1 AA) — see accessibility-baseline/ follow-up finding
 * surfaced by tests/accessibility.spec.ts. Darkened for light mode only;
 * the dark-mode token wasn't flagged, so it's left as-is. Shared by every
 * "saved" autosave-state indicator (annotation/essay/caption editors) so a
 * future revisit of the color only has one call site to update.
 */
export const AUTOSAVE_SAVED_TEXT_CLASS = 'text-green-700 dark:text-[var(--color-success)]'
