import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useListSpeechReviewsQuery } from '@/features/review/reviewApi'
import type { Review } from '@/features/review/types'
import { cn } from '@/lib/utils'

const NO_COMMENTARY = 'none' as const

/**
 * STEP-05-invitation-loop.md's speaker-facing track selector — a real
 * ARIA radiogroup offering every reviewer whose review is on the speech,
 * plus "No commentary" as a genuine selectable option (not a placeholder).
 * `listSpeechReviews` (`GET /api/speeches/{speech}/reviews`) is already
 * filtered server-side to access-granting, non-revoked reviews (§7.3), so
 * every row that comes back is a real option — nothing to re-filter here.
 * Owner-only; callers must gate rendering on `speech.user_id === current
 * user's id` themselves — per the plan this "is not rendered for
 * reviewers at all."
 *
 * Annotations don't exist until STEP-06, so picking a reviewer's track
 * here only updates local selection state and shows the honest stubbed
 * empty state ("X hasn't left commentary yet") — wiring a real player
 * track is STEP-06's job.
 */
export function TrackSelector({ speechId }: { speechId: number }) {
  const { data: reviews, isLoading } = useListSpeechReviewsQuery(speechId)
  const [selected, setSelected] = useState<number | typeof NO_COMMENTARY>(NO_COMMENTARY)

  const options: Array<{ key: number | typeof NO_COMMENTARY; label: string; review: Review | null }> = [
    { key: NO_COMMENTARY, label: 'No commentary', review: null },
    ...(reviews ?? []).map((review) => ({
      key: review.id,
      label: review.reviewer?.name ?? 'Reviewer',
      review,
    })),
  ]

  const selectedOption = options.find((option) => option.key === selected)

  if (isLoading) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commentary track</CardTitle>
        <CardDescription>Choose whose commentary to watch alongside the video.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Choose commentary track" className="flex flex-wrap gap-2">
          {options.map((option) => {
            const isChecked = option.key === selected
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={isChecked}
                onClick={() => setSelected(option.key)}
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

        {selectedOption?.review && (
          <p className="text-sm text-muted-foreground">
            {selectedOption.review.reviewer?.name ?? 'This reviewer'} hasn't left commentary yet.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
