import { NoPosterPlaceholder } from '@/components/speech/NoPosterPlaceholder'
import type { Speech, SpeechPosterVariant } from '@/features/speech/types'
import { cn } from '@/lib/utils'

/**
 * STEP-04-every-video-plays.md §9.5: a real `<picture>` built off
 * `speech.poster.variants` (one generated asset row per width/format
 * combination), sized off the ACTUAL poster dimensions the API reports —
 * never a hardcoded 16:9 — because a portrait source video must produce a
 * portrait poster. `width`/`height` are real HTML attributes (not CSS) so
 * the browser reserves layout space before the image loads (the CLS
 * requirement), and `aspect-ratio` on the wrapper keeps that reservation
 * correct even if CSS later stretches the box to fill a card.
 *
 * Falls back to the unchanged `NoPosterPlaceholder` (still deliberately
 * 16:9 — that's the correct, intentional shape for the "no image exists"
 * state, not this component's job to change) when `speech.poster` is
 * absent.
 */
export function SpeechPoster({ speech, className }: { speech: Speech; className?: string }) {
  const poster = speech.poster
  if (!poster) {
    return <NoPosterPlaceholder ulid={speech.ulid} title={speech.title} className={className} />
  }

  const byFormat = poster.variants.reduce<Record<string, SpeechPosterVariant[]>>((acc, variant) => {
    ;(acc[variant.format] ??= []).push(variant)
    return acc
  }, {})

  const srcSetFor = (format: string) =>
    (byFormat[format] ?? [])
      .slice()
      .sort((a, b) => a.width - b.width)
      .map((variant) => `${variant.url} ${variant.width}w`)
      .join(', ')

  const webpSrcSet = srcSetFor('webp')
  const jpegSrcSet = srcSetFor('jpeg')

  return (
    <picture
      className={cn('block overflow-hidden rounded-md', className)}
      style={{ aspectRatio: `${poster.width} / ${poster.height}` }}
    >
      {webpSrcSet && <source type="image/webp" srcSet={webpSrcSet} />}
      {jpegSrcSet && <source type="image/jpeg" srcSet={jpegSrcSet} />}
      <img
        src={poster.url}
        width={poster.width}
        height={poster.height}
        loading="lazy"
        decoding="async"
        alt=""
        className="h-full w-full object-cover"
      />
    </picture>
  )
}
