import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VoiceNoteMarkers } from '@/components/annotation/VoiceNoteMarkers'
import type { Annotation } from '@/features/annotation/types'

const voice: Annotation = {
  id: 'voice',
  start_seconds: 25,
  duration_seconds: 5,
  kind: 'observation',
  topic: null,
  body: 'A voice note',
  lock_version: 0,
  client_uuid: 'voice-uuid',
  voice: { asset_id: 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null },
}

describe('VoiceNoteMarkers', () => {
  it('projects voice notes as point markers at their scrubber percentage', () => {
    render(<VoiceNoteMarkers annotations={[voice, { ...voice, id: 'text', voice: null }]} durationSeconds={100} />)
    const markers = screen.getByTestId('voice-note-markers')
    expect(markers.children).toHaveLength(1)
    expect(markers.firstElementChild).toHaveStyle({ left: '25%' })
  })
})
