import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhotoOrFallback } from '@/components/profile/FriendPersonAvatar'
import { NoPosterPlaceholder } from '@/components/speech/NoPosterPlaceholder'
import { SpeechPoster } from '@/components/speech/SpeechPoster'
import {
  useAcceptConnectionMutation,
  useDeclineConnectionMutation,
  useGetFriendsQuery,
} from '@/features/connection/connectionApi'
import { connectionErrorMessage, type ConnectionViewer } from '@/features/connection/connectionSession'
import type { Friend } from '@/features/connection/types'
import { useListNotificationsQuery, useMarkNotificationReadMutation } from '@/features/notification/notificationApi'
import type { Notification } from '@/features/notification/types'
import { useAcceptReviewMutation, useDeclineReviewMutation, useListMyReviewsQuery } from '@/features/review/reviewApi'
import type { Review } from '@/features/review/types'
import { useListSpeechesQuery } from '@/features/speech/speechApi'
import type { Speech } from '@/features/speech/types'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'
import { firstName, initialsFromName } from '@/lib/displayName'
import { buildFeed, newestFirst, type FeedItem } from '@/lib/profileFeed'
import { profilePath } from '@/lib/profilePath'
import { speechPath } from '@/lib/speechPath'
import { formatTimestamp } from '@/lib/time'
import { cn, countLabel } from '@/lib/utils'

type Outcome = 'accepted' | 'declined'

const card = 'workspace-notebook-surface workspace-notebook-panel flex flex-col gap-3 p-4'
const primary = 'workspace-notebook-control workspace-notebook-control--primary'
const secondary = 'workspace-notebook-control workspace-notebook-control--secondary'
// A fixed square, like the profile timeline cards: width and height together
// override the poster's own aspect ratio, so a portrait video can't make a tall card.
const thumbnail = 'size-24 shrink-0 text-2xl'

/**
 * The Feed view of "Your profile": friend requests and review requests you
 * can answer in place, and commentary reviewers published on your speeches,
 * newest first. An answered request keeps its card, showing the outcome,
 * until you leave the page, even though the server stops listing it.
 */
export function ProfileFeed({ viewer }: { viewer: ConnectionViewer }) {
  const friendRequests = useGetFriendsQuery({ viewerId: viewer.id, view: 'incoming' }, { refetchOnMountOrArgChange: true })
  const reviews = useListMyReviewsQuery(undefined, { refetchOnMountOrArgChange: true })
  const notifications = useListNotificationsQuery(undefined, { refetchOnMountOrArgChange: true })
  // Posters only; a failure just leaves the commentary cards with a placeholder.
  const speeches = useListSpeechesQuery()
  const [settled, setSettled] = useState<Record<string, { item: FeedItem; outcome: Outcome }>>({})

  const live = useMemo(
    () => buildFeed(friendRequests.currentData?.friends ?? [], reviews.currentData?.invited ?? [], notifications.currentData?.notifications ?? []),
    [friendRequests.currentData, reviews.currentData, notifications.currentData],
  )
  const items = useMemo(() => {
    const liveKeys = new Set(live.map((item) => item.key))
    const answered = Object.values(settled).filter(({ item }) => !liveKeys.has(item.key)).map(({ item }) => item)
    return [...live, ...answered].sort(newestFirst)
  }, [live, settled])
  const speechesById = useMemo(
    () => new Map((speeches.currentData?.speeches ?? []).map((speech) => [speech.id, speech])),
    [speeches.currentData],
  )

  const settle = (item: FeedItem) => (outcome: Outcome) => setSettled((previous) => ({ ...previous, [item.key]: { item, outcome } }))
  const sources = [
    { label: 'friend requests', query: friendRequests },
    { label: 'review requests', query: reviews },
    { label: 'commentary', query: notifications },
  ]
  const failed = sources.filter(({ query }) => query.isError)
  // "Nothing new" only once every source has answered; one empty source alone proves nothing.
  const pending = sources.some(({ query }) => !query.currentData && !query.isError)

  return (
    <section aria-label="Feed" className="flex flex-col gap-4">
      {failed.length > 0 && (
        <div role="alert" className={cn(card, 'items-start text-sm')}>
          <p>Couldn’t load your {failed.map((source) => source.label).join(', ')}.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => failed.forEach(({ query }) => void query.refetch())}>Retry</Button>
        </div>
      )}
      {pending && items.length === 0 && <p role="status" className="text-sm text-muted-foreground">Loading your feed…</p>}
      {!pending && items.length === 0 && failed.length === 0 && (
        <p className={cn(card, 'text-sm text-muted-foreground')}>
          Nothing new. Friend requests, review requests and new commentary on your speeches show up here.
        </p>
      )}
      {items.map((item) => {
        const outcome = settled[item.key]?.outcome
        if (item.kind === 'friend') return <FriendRequestCard key={item.key} friend={item.friend} outcome={outcome} onSettled={settle(item)} />
        if (item.kind === 'review') return <ReviewRequestCard key={item.key} review={item.review} outcome={outcome} onSettled={settle(item)} />
        const speechId = item.notification.data.speech_id
        return <CommentaryCard key={item.key} notification={item.notification} speech={speechId ? speechesById.get(speechId) : undefined} />
      })}
    </section>
  )
}

/** Accept/Decline state shared by both request cards: the mutations differ, the flow doesn't. */
function useAnswer({ accepting, declining, send, describeError, outcome, onSettled, acceptedMessage }: {
  accepting: { isLoading: boolean }
  declining: { isLoading: boolean }
  send: (action: Outcome) => Promise<unknown>
  describeError: (failure: unknown) => string
  outcome?: Outcome
  onSettled: (outcome: Outcome) => void
  acceptedMessage: ReactNode
}) {
  const [error, setError] = useState('')
  const busy = accepting.isLoading || declining.isLoading

  async function act(action: Outcome) {
    if (busy) return
    setError('')
    try {
      await send(action)
      onSettled(action)
    } catch (failure) {
      setError(describeError(failure))
    }
  }

  const footer = (
    <>
      {outcome ? (
        <p role="status" className="font-semibold">{outcome === 'accepted' ? acceptedMessage : 'Request declined.'}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className={primary} disabled={busy} onClick={() => void act('accepted')}>{accepting.isLoading ? 'Accepting…' : 'Accept'}</Button>
          <Button type="button" variant="outline" className={secondary} disabled={busy} onClick={() => void act('declined')}>{declining.isLoading ? 'Declining…' : 'Decline'}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </>
  )
  return { busy, footer }
}

function FriendRequestCard({ friend, outcome, onSettled }: { friend: Friend; outcome?: Outcome; onSettled: (outcome: Outcome) => void }) {
  const [accept, accepting] = useAcceptConnectionMutation()
  const [decline, declining] = useDeclineConnectionMutation()
  const name = friend.person.name
  const { busy, footer } = useAnswer({
    accepting, declining, outcome, onSettled, describeError: connectionErrorMessage,
    send: (action) => (action === 'accepted' ? accept(friend.connection_id) : decline(friend.connection_id)).unwrap(),
    acceptedMessage: `You and ${name} are friends now.`,
  })

  return (
    <article aria-label={`Friend request from ${name}`} className={card} aria-busy={busy}>
      <CardHeading photo={friend.person.avatar_url} name={name} meta={<>{countLabel(friend.mutual_friends_count, 'mutual friend')} · {formatTimestamp(friend.requested_at)}</>}>
        <Link to={profilePath(friend.person.username)} className="font-semibold hover:underline">{name}</Link> sent you a friend request
      </CardHeading>
      <Quote text={friend.note} />
      {footer}
    </article>
  )
}

function ReviewRequestCard({ review, outcome, onSettled }: { review: Review; outcome?: Outcome; onSettled: (outcome: Outcome) => void }) {
  const [accept, accepting] = useAcceptReviewMutation()
  const [decline, declining] = useDeclineReviewMutation()
  const { busy, footer } = useAnswer({
    accepting, declining, outcome, onSettled, describeError: extractServerErrorMessage,
    send: (action) => (action === 'accepted' ? accept(review.id) : decline(review.id)).unwrap(),
    acceptedMessage: <>Accepted. It’s in <Link to="/dashboard" className="underline">My reviews</Link>.</>,
  })
  const owner = review.speech?.owner_name ?? 'Someone'
  const title = review.speech?.title ?? 'Untitled speech'

  return (
    <article aria-label={`Review request from ${owner}`} className={card} aria-busy={busy}>
      <CardHeading photo={null} name={owner} meta={<>Invited {formatTimestamp(review.invited_at ?? review.last_transition_at)}</>}>
        <span className="font-semibold">{owner}</span> asked you to review a speech
      </CardHeading>
      <SpeechLine title={title} poster={review.speech && <NoPosterPlaceholder ulid={review.speech.ulid} title={title} className={thumbnail} />} />
      <Quote text={review.invitation_message} />
      {footer}
    </article>
  )
}

function CommentaryCard({ notification, speech }: { notification: Notification; speech?: Speech }) {
  const [markRead] = useMarkNotificationReadMutation()
  const { review_id: reviewId, speech_id: speechId, speech_title: speechTitle, actor_name: actorName } = notification.data
  const actor = actorName?.trim()
  const reviewer = actor || 'A reviewer'
  const title = speech?.title ?? speechTitle ?? 'your speech'

  return (
    <article aria-label={`Commentary from ${reviewer}`} className={card}>
      <CardHeading photo={null} name={reviewer} meta={formatTimestamp(notification.created_at)}>
        <span className="font-semibold">{reviewer}</span> published commentary on your speech
      </CardHeading>
      <SpeechLine
        title={title}
        poster={speech
          ? <SpeechPoster speech={speech} className={thumbnail} />
          : <NoPosterPlaceholder ulid={`speech-${speechId ?? notification.id}`} title={title} className={thumbnail} />}
      />
      {speechId && reviewId ? (
        <Link
          to={speechPath(speechId, reviewId)}
          onClick={() => { if (!notification.read_at) void markRead(notification.id) }}
          className={cn(primary, 'inline-flex min-h-11 items-center gap-2 self-start rounded-lg border px-4 font-semibold')}
        >
          <Play aria-hidden="true" className="size-4 fill-current" />
          {/* No actor name: "A reviewer" has no first name, so don't print "Watch with A’s". */}
          {actor ? `Watch with ${firstName(actor)}’s commentary` : 'Watch the commentary'}
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">This speech is no longer available.</p>
      )}
    </article>
  )
}

/** Who the card is about: their photo (or initials), what they did, and when. */
function CardHeading({ photo, name, meta, children }: { photo: string | null; name: string; meta: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <PhotoOrFallback
        src={photo}
        className="size-12 shrink-0 rounded-full object-cover"
        fallback={(
          <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
            {initialsFromName(name) || '?'}
          </span>
        )}
      />
      <div className="min-w-0">
        <p className="text-[15px] leading-snug">{children}</p>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>
    </div>
  )
}

function SpeechLine({ poster, title }: { poster: ReactNode; title: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {poster}
      <p className="min-w-0 text-base font-bold break-words">{title}</p>
    </div>
  )
}

/** A note the sender wrote: a friend request's note or a review invitation's message. */
function Quote({ text }: { text: string | null | undefined }) {
  return text ? <p className="rounded-md border border-dashed border-border bg-muted px-3 py-2 text-sm break-words">{text}</p> : null
}
