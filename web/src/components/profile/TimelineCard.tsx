import { Link } from 'react-router-dom'
import { SpeechPoster } from '@/components/speech/SpeechPoster'
import { ArcStrip } from '@/components/profile/ArcStrip'
import type { ProfileTimelineItem, ProfileTimelineTab } from '@/features/connection/types'
import type { Speech } from '@/features/speech/types'
import { speechPath } from '@/lib/speechPath'
import { formatCalendarDate } from '@/lib/time'

function formatDuration(seconds: string | null): string | null {
  if (!seconds) return null
  const total = Math.round(Number(seconds))
  if (!Number.isFinite(total) || total <= 0) return null
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes} min ${secs} sec`
}

/**
 * §6.7.4's timeline card, as a compact list row: a square thumbnail beside
 * the text. This replaces the spec's 16:9 hero, which a portrait poster
 * turned into a ~1,030px-tall card. `SpeechPoster` is reused unchanged:
 * fixing both its width and height makes CSS ignore its inline
 * `aspect-ratio` (MySpeeches still relies on the real ratio), and its
 * `object-cover` crops to the square.
 *
 * The copy follows the tab. "Reviews you left" keeps §6.7.4's wording. On
 * "Reviews they left you" the viewer owns the speech and the profile user
 * (`firstName`) is the reviewer, so the card names them: "shared with",
 * not "reviewed by", because that tab also lists reviews accepted but not
 * yet published. Only that tab's link names its review (`?review=`), so
 * the owner's watch page opens this reviewer's track rather than whoever
 * published last.
 *
 * One primary link per card — §6.7.4's accessibility rule ("one primary
 * link per card, not five"); the thumbnail stays decorative.
 *
 * Reconciled against the real `ProfileTimelineController::show`: poster
 * arrives as a TOP-LEVEL `item.poster` (not nested under `speech`, as an
 * earlier pre-backend guess had it), with only `{url, width, height}` —
 * no `variants` array, so no srcset. `SpeechPoster` degrades correctly
 * (plain `<img src>`, no `<source>` tags) when `variants` is empty, so
 * this just supplies `variants: []` when building its `Speech` prop.
 */
export function TimelineCard({ item, tab, firstName }: { item: ProfileTimelineItem; tab: ProfileTimelineTab; firstName: string }) {
  const { speech, commentary } = item
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

  const received = tab === 'received'
  const nothingPublished = commentary.notes_count === 0 && !commentary.has_essay
  const privacyLine = received
    ? `🔒 Your private speech · shared with ${firstName}`
    : '🔒 Private · visible to you because you reviewed it'
  const commentaryLabel = received ? `${firstName}'s commentary` : 'Your commentary'
  const summary = received && nothingPublished
    ? 'Nothing published yet'
    : `${commentary.notes_count} ${commentary.notes_count === 1 ? 'note' : 'notes'}${commentary.has_essay ? ' · essay' : ''}`
  const linkLabel = !received
    ? 'Watch with your commentary →'
    : nothingPublished ? 'Watch your speech →' : `Watch with ${firstName}'s commentary →`
  const meta = [formatCalendarDate(speech.delivered_on), formatDuration(speech.duration_seconds)].filter(Boolean).join(' · ')

  return (
    <article className="flex items-start gap-3 overflow-hidden rounded-none border-y border-border bg-card p-3 sm:gap-4 sm:rounded-lg sm:border sm:p-4">
      <SpeechPoster speech={posterSpeech} className="size-20 shrink-0 text-2xl sm:size-24" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px] text-muted-foreground">{privacyLine}</p>

        <h3 className="line-clamp-2 break-words text-[15px] font-semibold">{speech.title}</h3>

        {meta && <p className="text-[13px] text-muted-foreground">{meta}</p>}

        {item.arc && item.arc.length > 1 && <ArcStrip chain={item.arc} />}

        <p className="flex flex-wrap gap-x-1.5 text-sm">
          <span className="font-medium">{commentaryLabel}</span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{summary}</span>
        </p>

        <Link
          to={speechPath(speech.id, received ? item.review_id : undefined)}
          className="mt-1 self-start text-sm font-medium text-primary hover:underline"
        >
          {linkLabel}
        </Link>
      </div>
    </article>
  )
}
