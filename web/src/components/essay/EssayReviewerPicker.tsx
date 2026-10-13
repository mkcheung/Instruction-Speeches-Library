import type { CommentarySelection, CommentaryTrackOption } from '@/hooks/useCommentaryTrack'
import { cn } from '@/lib/utils'

/**
 * IMPLEMENTATION-PLANS.md §7.4: `EssayReadOnlyPanel`'s selection
 * (`reviewId`/`reviewerName`) is driven entirely by `useCommentaryTrack`'s
 * `selected`/`options` — the SAME selection the Notes tab's `TrackSelector`
 * radiogroup drives. Before this component existed, a speaker who opened
 * Essay before ever visiting Notes saw `EssayReadOnlyPanel`'s "Pick a
 * reviewer to see their essay" with no picker anywhere on the Essay tab to
 * act on. This is the plan's own second listed fix ("add a compact picker
 * inside the Essay panel") — the cheaper, lower-risk alternative to lifting
 * `TrackSelector`'s whole chip row above the tab strip, which would touch
 * the §12-frozen `Choose commentary track` accessible name's DOM position.
 *
 * Deliberately NOT a second `TrackSelector`: no voice-commentary controls,
 * no transcript, no report dialog — just the "pick who" part, reusing the
 * exact same `options`/`selected`/`onSelect` the Notes tab already gets
 * from the ONE shared `useCommentaryTrack` call in `SpeechWatch`. No new
 * query, no local selection state — selecting here is the same `selected`
 * state Notes reads, so switching tabs keeps the same reviewer chosen.
 *
 * ⚠️ Accessible name: `"Choose commentary track"` is §12's frozen name for
 * `TrackSelector`'s own radiogroup (Playwright-asserted). This component
 * uses a DIFFERENT name — reusing the same one would create two
 * identically-named radiogroups the moment either tab panel ever gained
 * `keepMounted`, a latent strict-mode-violation trap even though only one
 * is mounted at a time today (`TabsPanel` unmounts inactive panels by
 * default in this codebase).
 *
 * No `NO_COMMENTARY` chip: unlike Notes, where "stop showing overlays" is
 * a real destination, the Essay tab already has its own honest empty state
 * (`EssayReadOnlyPanel`'s "Pick a reviewer to see their essay") for
 * exactly the unselected case — a redundant "No commentary" option here
 * would just be a second way to reach the same screen the picker's own
 * absence already reaches.
 */
export function EssayReviewerPicker({
  options,
  selected,
  onSelect,
}: {
  options: CommentaryTrackOption[]
  selected: CommentarySelection
  onSelect: (next: CommentarySelection) => void
}) {
  const reviewerOptions = options.filter((option) => option.review !== null)

  // Nobody to pick between — the panel's own empty state already covers
  // this (and will, since `selected` can only be `NO_COMMENTARY` here).
  if (reviewerOptions.length === 0) return null

  return (
    <div role="radiogroup" aria-label="Choose whose essay to read" className="mb-3 flex flex-wrap gap-2">
      {reviewerOptions.map((option) => {
        const isChecked = option.key === selected
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={isChecked}
            onClick={() => onSelect(option.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              isChecked
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background hover:bg-muted',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
