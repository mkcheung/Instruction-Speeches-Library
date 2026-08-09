import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { SpeechPoster } from '@/components/speech/SpeechPoster'
import type { Speech } from '@/features/speech/types'

function speechWith(overrides: Partial<Speech>): Speech {
  return {
    id: 1,
    ulid: '01ABC',
    title: 'My speech',
    description: null,
    delivered_on: null,
    change_note: null,
    created_at: '2026-01-01T00:00:00Z',
    primary_video: null,
    ...overrides,
  }
}

/**
 * STEP-04-every-video-plays.md §9.5: "a portrait video produces a portrait
 * poster, not a sideways one" is the #1 acceptance criterion here — assert
 * real width/height attributes off the API's numbers, never a hardcoded
 * 16:9 default.
 */
describe('SpeechPoster', () => {
  it('falls back to NoPosterPlaceholder when speech.poster is absent', () => {
    const { container } = render(<SpeechPoster speech={speechWith({})} />)
    // NoPosterPlaceholder renders an aria-hidden div, not a <picture>.
    expect(container.querySelector('picture')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('renders a portrait poster with the real (non-16:9) dimensions as HTML attributes', () => {
    const { container } = render(
      <SpeechPoster
        speech={speechWith({
          poster: {
            url: 'https://example.com/poster-640.jpg',
            width: 360,
            height: 640,
            variants: [
              { url: 'https://example.com/poster-320.jpg', width: 320, format: 'jpeg' },
              { url: 'https://example.com/poster-640.jpg', width: 640, format: 'jpeg' },
              { url: 'https://example.com/poster-320.webp', width: 320, format: 'webp' },
              { url: 'https://example.com/poster-640.webp', width: 640, format: 'webp' },
            ],
          },
        })}
      />,
    )

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('width')).toBe('360')
    expect(img?.getAttribute('height')).toBe('640')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect(img?.getAttribute('decoding')).toBe('async')

    const picture = container.querySelector('picture')
    expect(picture?.style.aspectRatio).toBe('360 / 640')
  })

  it('groups variants by format into separate <source> srcsets (webp first, jpeg fallback)', () => {
    const { container } = render(
      <SpeechPoster
        speech={speechWith({
          poster: {
            url: 'https://example.com/poster-640.jpg',
            width: 640,
            height: 360,
            variants: [
              { url: 'https://example.com/poster-320.jpg', width: 320, format: 'jpeg' },
              { url: 'https://example.com/poster-640.jpg', width: 640, format: 'jpeg' },
              { url: 'https://example.com/poster-1280.jpg', width: 1280, format: 'jpeg' },
              { url: 'https://example.com/poster-320.webp', width: 320, format: 'webp' },
              { url: 'https://example.com/poster-640.webp', width: 640, format: 'webp' },
              { url: 'https://example.com/poster-1280.webp', width: 1280, format: 'webp' },
            ],
          },
        })}
      />,
    )

    const sources = container.querySelectorAll('source')
    expect(sources).toHaveLength(2)

    const webpSource = [...sources].find((s) => s.getAttribute('type') === 'image/webp')
    const jpegSource = [...sources].find((s) => s.getAttribute('type') === 'image/jpeg')

    expect(webpSource?.getAttribute('srcset')).toBe(
      'https://example.com/poster-320.webp 320w, https://example.com/poster-640.webp 640w, https://example.com/poster-1280.webp 1280w',
    )
    expect(jpegSource?.getAttribute('srcset')).toBe(
      'https://example.com/poster-320.jpg 320w, https://example.com/poster-640.jpg 640w, https://example.com/poster-1280.jpg 1280w',
    )
  })
})
