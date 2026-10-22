import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RevokeReviewDialog } from '@/components/review/RevokeReviewDialog'
import { useListReviewRosterQuery, useRevokeAndPurgeReviewMutation, useRevokeReviewMutation } from '@/features/review/reviewApi'
import type { RosterReview } from '@/features/review/types'
import { reviewerLabel } from '@/lib/reviewerLabel'
import { formatTimestamp } from '@/lib/time'

/**
 * IMPLEMENTATION-PLANS.md §7.2.4's four groups, read from the new
 * owner-only `review-roster` endpoint (`listReviewRoster` — unlike
 * `listSpeechReviews`, which the commentary track selector uses, this one
 * is NOT status-filtered: every row for the speech, including revoked/
 * declined/abandoned, since the speaker needs to see all of it). Mounted
 * above `InviteReviewerPanel` in `SpeechWatch`'s "Reviewers" tab.
 *
 * Revocation is orthogonal to status (§7.2.4: "there is no `revoked`
 * status, only `revoked_at`") — a revoked row can carry any status, so
 * every group below checks `revoked_at === null` explicitly rather than
 * assuming status alone sorts rows into the right bucket.
 *
 * Closed is read-only in v1 (no reinvite affordance — deferred per
 * §7.2.4) — its rows render a sub-label distinguishing the four ways a
 * row can land there, and nothing else.
 *
 * `RosterReview` doesn't carry its own `speech_id` (the endpoint is
 * already speech-scoped, so the field would be redundant on the resource
 * — same reasoning the plan gives for omitting `speech` entirely), and
 * neither do the revoke/revokeAndPurge mutations below: unlike
 * `withdrawReview`/`abandonReview` (the reviewer's own exit, which needs
 * `speechId` for the cross-slice `Speech`-tag invalidation §7.2.6 fixes),
 * revoking is the OWNER's act and never costs the owner their own reach
 * to the speech — see `reviewApi.ts`'s comment on `revokeReview`.
 */
export function ReviewerRoster({ speechId }: { speechId: number }) {
  const { data: reviews, isLoading, isError } = useListReviewRosterQuery(speechId)

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading reviewers…</p>
  }

  // code-review finding: this used to fall straight through to the
  // empty-roster message on a failed fetch (network/500) — isLoading
  // settles false either way, so "nobody has ever been invited" and "the
  // request errored" rendered identically, with no way to tell them apart
  // or retry. A later fix replaced the error with a full-page message —
  // correct for the first load, but `invalidatesTags` triggers a
  // background REFETCH after every revoke/purge, and a transient failure
  // on one of those (`isError` can be true even while `reviews` still
  // holds the last-good array — RTK Query doesn't clear `data` on a
  // refetch failure) was discarding a perfectly good, already-rendered
  // roster behind the error message. Only show the blocking error when
  // there is no data to fall back on; a background-refetch failure gets a
  // quieter, non-blocking notice instead.
  if (isError && reviews === undefined) {
    return <p className="text-sm text-destructive">Couldn&rsquo;t load reviewers — try again.</p>
  }

  const rows = reviews ?? []
  const awaitingReply = rows.filter((r) => r.status === 'invited' && r.revoked_at === null)
  const workingOnIt = rows.filter(
    (r) => (r.status === 'accepted' || r.status === 'in_progress') && r.revoked_at === null,
  )
  const feedbackDelivered = rows.filter((r) => r.status === 'published' && r.revoked_at === null)
  const closed = rows.filter(
    (r) => r.revoked_at !== null || r.status === 'declined' || r.status === 'abandoned',
  )

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No reviewers yet.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      {isError && (
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t refresh the list — showing the last loaded version.
        </p>
      )}
      <RosterGroup title="Awaiting a reply" reviews={awaitingReply} actions="revoke-only" />
      <RosterGroup title="Working on it" reviews={workingOnIt} actions="both" />
      <RosterGroup title="Feedback delivered" reviews={feedbackDelivered} actions="both" />
      <RosterGroup title="Closed" reviews={closed} actions="none" />
    </div>
  )
}

function RosterGroup({
  title,
  reviews,
  actions,
}: {
  title: string
  reviews: RosterReview[]
  actions: 'revoke-only' | 'both' | 'none'
}) {
  if (reviews.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="flex flex-col gap-2">
        {reviews.map((review) => (
          <RosterRow key={review.id} review={review} actions={actions} />
        ))}
      </div>
    </section>
  )
}

/** §7.2.4's per-row sub-label for the Closed group — the one place these
 * four facts ("declined", "abandoned", "you revoked", "an admin revoked")
 * are distinguished; everywhere else revocation is orthogonal to status. */
function closedSubLabel(review: RosterReview): string {
  if (review.revoked_at !== null) {
    const when = formatTimestamp(review.revoked_at)
    const who = review.revoked_by_is_self ? 'You removed their access' : 'An administrator removed their access'
    const base = when ? `${who} ${when}` : who
    return review.revocation_reason ? `${base} — ${review.revocation_reason}` : base
  }
  if (review.status === 'declined') return 'Declined your invitation'
  if (review.status === 'abandoned') return 'Stopped working on this'
  return ''
}

function RosterRow({
  review,
  actions,
}: {
  review: RosterReview
  actions: 'revoke-only' | 'both' | 'none'
}) {
  const [revoke, { isLoading: isRevoking }] = useRevokeReviewMutation()
  const [revokeAndPurge, { isLoading: isPurging }] = useRevokeAndPurgeReviewMutation()

  const handleRevoke = async (reason: string) => {
    await revoke({ id: review.id, body: { reason } }).unwrap()
  }
  const handlePurge = async (reason: string) => {
    await revokeAndPurge({ id: review.id, body: { reason } }).unwrap()
  }

  return (
    <Card className="workspace-notebook-surface workspace-notebook-panel">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 py-3">
        <CardTitle className="text-sm font-medium">
          {reviewerLabel(review.reviewer) ?? 'Former reviewer'}
        </CardTitle>
        <Badge variant="secondary">{review.status}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 py-0 pb-3">
        {actions === 'none' && (
          <p className="text-sm text-muted-foreground">{closedSubLabel(review)}</p>
        )}
        {actions !== 'none' && (
          <div className="flex flex-wrap items-center gap-2">
            <RevokeReviewDialog review={review} mode="revoke" isSubmitting={isRevoking} onConfirm={handleRevoke} />
            {actions === 'both' && (
              <RevokeReviewDialog
                review={review}
                mode="purge"
                isSubmitting={isPurging}
                onConfirm={handlePurge}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
