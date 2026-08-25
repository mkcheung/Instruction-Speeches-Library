import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnnotationComposerPanel } from '@/components/annotation/AnnotationComposerPanel'
import type { Annotation } from '@/features/annotation/types'
import type { Review } from '@/features/review/types'

const makeVoiceRows = (count: number): Annotation[] => Array.from({ length: count }, (_, index) => ({
  id: String(index + 1),
  start_seconds: index * 10,
  duration_seconds: index + 1,
  kind: 'observation',
  topic: null,
  body: `Transcript ${index + 1}`,
  lock_version: 0,
  client_uuid: `voice-${index + 1}`,
  voice: { asset_id: index + 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null },
}))
let voiceRows = makeVoiceRows(7)

vi.mock('@/features/annotation/annotationApi', () => ({
  useGetAnnotationsQuery: () => ({ data: { annotations: voiceRows } }),
  useClearAnnotationsMutation: () => [vi.fn(() => ({ unwrap: () => Promise.resolve({}) })), { isLoading: false }],
}))
vi.mock('@/features/review/reviewApi', () => ({
  usePublishReviewMutation: () => [vi.fn(() => ({ unwrap: () => Promise.resolve({ published_count: 7 }) })), { isLoading: false }],
}))
vi.mock('@/hooks/useTimedAnnotations', () => ({ useTimedAnnotations: () => new Set<string>() }))
vi.mock('@/hooks/useVideoCurrentTime', () => ({ useVideoCurrentTime: () => 0 }))
vi.mock('@/hooks/useAutoPausePreference', () => ({ useAutoPausePreference: () => [false, vi.fn()] }))
vi.mock('@/components/annotation/OverlayStack', () => ({ OverlayStack: () => null }))
vi.mock('@/components/annotation/TimelineStrip', () => ({ TimelineStrip: () => null }))
vi.mock('@/components/annotation/Composer', () => ({ Composer: () => null }))
vi.mock('@/components/annotation/AnnotationList', () => ({ AnnotationList: () => null }))
vi.mock('@/components/annotation/ClearAnnotationsDialog', () => ({ ClearAnnotationsDialog: () => null }))
vi.mock('@/components/annotation/VoiceRecorder', () => ({ VoiceRecorder: () => <div data-testid="voice-recorder" /> }))

const review = { id: 9, first_published_at: null } as unknown as Review

describe('AnnotationComposerPanel voice authoring', () => {
  beforeEach(() => {
    voiceRows = makeVoiceRows(7)
  })

  it('warns after six notes and sums their full added duration', () => {
    render(
      <AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('7 voice notes')
    expect(screen.getByRole('status')).toHaveTextContent('28 seconds')
    expect(screen.getByTestId('voice-recorder')).toBeInTheDocument()
  })

  it('does not warn at exactly six voice notes', () => {
    voiceRows = makeVoiceRows(6)
    render(
      <AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice onSeek={vi.fn()} />,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not mount the recorder for a Member', () => {
    render(
      <AnnotationComposerPanel speechId={1} review={review} videoEl={null} durationSeconds={100} userId="3" canRecordVoice={false} onSeek={vi.fn()} />,
    )
    expect(screen.queryByTestId('voice-recorder')).not.toBeInTheDocument()
  })
})
