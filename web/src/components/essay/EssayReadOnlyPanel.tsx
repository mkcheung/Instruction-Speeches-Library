import { skipToken } from '@reduxjs/toolkit/query/react'
import { useGetEssayQuery } from '@/features/essay/essayApi'

/**
 * STEP-08-FROZEN-CONTRACT.md's frontend section, speaker/track-selector
 * half: "the essay tab shows the selected reviewer's published essay
 * read-only, or an honest empty state… if unpublished — same idiom as the
 * existing 'hasn't left commentary yet' stub" (`TrackSelector.tsx`).
 * `reviewId`/`reviewerName` come from the SAME `useCommentaryTrack`
 * selection `TrackSelector`'s radiogroup already drives — no second
 * selector, no second query for "who's selected."
 *
 * `getEssay` itself enforces the publish gate server-side (row-level rule
 * layered on `readAnnotations`: the speaker only sees `essay_html`/
 * `essay_text` once `essay_published_at` is set) — this component doesn't
 * duplicate that check to decide WHETHER to fetch, only to decide what
 * empty-state copy to show once the (already-gated) response arrives.
 */
export function EssayReadOnlyPanel({
  speechId,
  reviewId,
  reviewerName,
}: {
  speechId: number
  reviewId: number | null
  reviewerName: string | undefined
}) {
  const { data, error, isFetching } = useGetEssayQuery(reviewId === null ? skipToken : { speechId, reviewId })

  if (reviewId === null) {
    return <p className="text-sm text-muted-foreground">Pick a reviewer to see their essay.</p>
  }

  if (isFetching && !data) {
    return <p className="text-sm text-muted-foreground">Loading essay…</p>
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-[var(--color-danger)]">
        Couldn't load this reviewer's essay. Try again, or pick another track.
      </p>
    )
  }

  if (!data || !data.essay_published_at || !data.essay_html) {
    return (
      <p className="text-sm text-muted-foreground">{reviewerName ?? 'This reviewer'} hasn't published an essay yet.</p>
    )
  }

  return (
    <div
      data-testid="essay-readonly-content"
      // Already sanitized server-side, AND re-sanitized on this exact read
      // path (R14's "read" half) — the actual security boundary is that
      // server-side allowlist pass, not this render.
      dangerouslySetInnerHTML={{ __html: data.essay_html }}
      className="prose prose-sm max-w-none"
    />
  )
}
