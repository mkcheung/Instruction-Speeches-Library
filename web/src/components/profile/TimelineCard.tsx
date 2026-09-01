import { Link } from 'react-router-dom'
import { SpeechPoster } from '@/components/speech/SpeechPoster'
import { ArcStrip } from '@/components/profile/ArcStrip'
import type { ProfileTimelineItem } from '@/features/connection/types'
import type { Speech } from '@/features/speech/types'

function formatDeliveredDate(iso: string | null): string | null {
  if (!iso) return null
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
}

function formatDuration(seconds: string | null): string | null {
  if (!seconds) return null
  const total = Math.round(Number(seconds))
  if (!Number.isFinite(total) || total <= 0) return null
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes} min ${secs} sec`
}

/**
 * §6.7.4's timeline card, rebalanced from Facebook's ~739px text-card
 * proportions down to ~447px by dropping the engagement row and comment
 * thread and narrowing the feed to 580px (the hero to 326px). Reuses
 * `SpeechPoster` unchanged for the 16:9 hero.
 *
 * One primary link ("Watch with your commentary →") per card — §6.7.4's
 * accessibility rule ("one primary link per card, not five").
 *
 * Reconciled against the real `ProfileTimelineController::show`: poster
 * arrives as a TOP-LEVEL `item.poster` (not nested under `speech`, as an
 * earlier pre-backend guess had it), with only `{url, width, height}` —
 * no `variants` array, so no srcset. `SpeechPoster` degrades correctly
 * (plain `<img src>`, no `<source>` tags) when `variants` is empty, so
 * this just supplies `variants: []` when building its `Speech` prop.
 */
export function TimelineCard({ item }: { item: ProfileTimelineItem }) {
  const { speech } = item
  const posterSpeech: Speech = {
    id: speech.id,
    ulid: speech.ulid,
    title: speech.title,
    description: null,
    delivered_on: speech.delivered_on,
    change_note: null,
    created_at: speech.delivered_on ?? '',
    captions_enabled: false,
    primary_video: null,
    poster: item.poster ? { ...item.poster, variants: [] } : undefined,
  }

  const deliveredDate = formatDeliveredDate(speech.delivered_on)
  const duration = formatDuration(speech.duration_seconds)

  return (
    <article className="overflow-hidden rounded-none border-y border-border bg-card sm:rounded-lg sm:border">
      <SpeechPoster speech={posterSpeech} className="aspect-video w-full" />

      <div className="flex flex-col gap-2 p-4">
        <p className="text-[13px] text-muted-foreground">
          🔒 Private · visible to you because you reviewed it
        </p>

        <h3 className="text-[15px] font-semibold">{speech.title}</h3>

        <p className="text-[13px] text-muted-foreground">
          {[deliveredDate, duration].filter(Boolean).join(' · ')}
        </p>

        {item.arc && item.arc.length > 1 && <ArcStrip chain={item.arc} />}

        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p className="font-medium">Your commentary</p>
          <p className="text-muted-foreground">
            {item.commentary.notes_count} {item.commentary.notes_count === 1 ? 'note' : 'notes'}
            {item.commentary.has_essay ? ' · essay' : ''}
          </p>
        </div>

        <Link
          to={`/speeches/${speech.id}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Watch with your commentary →
        </Link>
      </div>
    </article>
  )
}
