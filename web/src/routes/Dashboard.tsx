import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  useAcceptReviewMutation,
  useDeclineReviewMutation,
  useListMyReviewsQuery,
} from '@/features/review/reviewApi'
import type { Review } from '@/features/review/types'

/**
 * STEP-05-invitation-loop.md's reviewer dashboard — four sections, read
 * straight off `GET /api/reviews`'s grouped `{ invited, in_progress,
 * published, revoked }` payload (§7.5: the server does the exact sort per
 * section, "invited" oldest-first, the rest newest-first — nothing to
 * re-derive client-side).
 *
 */
export default function Dashboard() {
  const { data, isLoading } = useListMyReviewsQuery()

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const invitations = data?.invited ?? []
  const inProgress = data?.in_progress ?? []
  const published = data?.published ?? []
  const revoked = data?.revoked ?? []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <h1 className="text-2xl font-semibold">My reviews</h1>

      <DashboardSection title="Invitations awaiting response" empty="No pending invitations.">
        {invitations.map((review) => (
          <InvitationCard key={review.id} review={review} />
        ))}
      </DashboardSection>

      <DashboardSection title="In progress" empty="Nothing in progress.">
        {inProgress.map((review) => (
          <ReviewCard key={review.id} review={review} timestampLabel="Started" timestamp={review.last_transition_at} />
        ))}
      </DashboardSection>

      <DashboardSection title="Published work" empty="Nothing published yet.">
        {published.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            timestampLabel="Published"
            timestamp={review.last_published_at ?? review.last_transition_at}
          />
        ))}
      </DashboardSection>

      <DashboardSection title="Revoked" empty="Nothing revoked.">
        {revoked.map((review) => (
          <ReviewCard key={review.id} review={review} timestampLabel="Revoked" timestamp={review.revoked_at} readOnly />
        ))}
      </DashboardSection>
    </div>
  )
}

function DashboardSection({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: ReactNode
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{title}</h2>
      {hasChildren ? (
        <div className="flex flex-col gap-3">{children}</div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}

function formatTimestamp(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleString()
}

function ReviewCard({
  review,
  timestampLabel,
  timestamp,
  readOnly,
}: {
  review: Review
  timestampLabel: string
  timestamp: string | null
  readOnly?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{review.speech?.title ?? 'Untitled speech'}</span>
          <Badge variant={readOnly ? 'destructive' : 'secondary'}>{readOnly ? 'Revoked' : review.status}</Badge>
        </CardTitle>
        <CardDescription>
          {review.speech?.owner_name ? `by ${review.speech.owner_name}` : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {timestamp && (
          <p className="text-xs text-muted-foreground">
            {timestampLabel} {formatTimestamp(timestamp)}
          </p>
        )}
        {readOnly && review.revocation_reason && (
          <p className="text-sm text-muted-foreground">Reason: {review.revocation_reason}</p>
        )}
      </CardContent>
    </Card>
  )
}

function InvitationCard({ review }: { review: Review }) {
  const [accept, { isLoading: isAccepting }] = useAcceptReviewMutation()
  const [decline, { isLoading: isDeclining }] = useDeclineReviewMutation()
  const busy = isAccepting || isDeclining

  return (
    <Card>
      <CardHeader>
        <CardTitle>{review.speech?.title ?? 'Untitled speech'}</CardTitle>
        <CardDescription>
          {review.speech?.owner_name ? `by ${review.speech.owner_name}` : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {review.invitation_message && <p className="text-sm">{review.invitation_message}</p>}
        {review.invited_at && (
          <p className="text-xs text-muted-foreground">Invited {formatTimestamp(review.invited_at)}</p>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => accept(review.id)}>
            {isAccepting ? 'Accepting…' : 'Accept'}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => decline(review.id)}>
            {isDeclining ? 'Declining…' : 'Decline'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
