import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrackSelector, type TrackSelectorProps } from './TrackSelector'
import type { Annotation, CommentaryPlaybackMode } from '@/features/annotation/types'
import type { RosterReview } from '@/features/review/types'
import { projectCommentary } from '@/lib/commentaryPlayback'

vi.mock('@/components/report/ReportDialog', () => ({ ReportDialog: () => <button>Report review</button> }))
const written: Annotation = { id: 'written', start_seconds: 2, duration_seconds: 4, kind: 'praise', topic: null,
  body: 'Written feedback', lock_version: 0, client_uuid: 'w', voice: null }
const voice: Annotation = { ...written, id: 'voice', body: 'Voice transcript', start_seconds: 10,
  voice: { asset_id: 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null } }

function props(mode: CommentaryPlaybackMode = 'all'): TrackSelectorProps {
  const projection = projectCommentary([written, voice], mode)
  return {
    options: [{ key: 1, label: 'Cora Coach', review: { id: 1 } as RosterReview, noteCount: 2, hasUnread: true }],
    optionsLoading: false, selected: 1, onSelect: vi.fn(), onPrefetch: vi.fn(), error: undefined,
    isFetching: false, fetchedReviewerName: 'Cora Coach', annotations: projection.readable,
    activeIds: new Set(), currentTime: 0, onSeek: vi.fn(), mode, onModeChange: vi.fn(),
    preference: { mode, ready: true, loading: false, saving: false, loadError: false, saveError: false,
      accessDenied: false, preference: { speech_id: 8, mode, source: 'saved' }, select: vi.fn(), retry: vi.fn() },
    voicePlayback: { state: 'idle', current: null, hint: null, error: null, skip: vi.fn(), pauseCommentary: vi.fn(), resumeCommentary: vi.fn() },
    disabled: false, allAnnotations: [written, voice], hideReadableBody: projection.hideReadableBody,
    readingKey: `owner:8:1:${mode}`, visible: true, onReadAll: vi.fn(),
  }
}

describe('four-mode commentary controls', () => {
  it('shows reviewer names and exactly four independent playback choices with total published counts', async () => {
    const user = userEvent.setup()
    const p = props()
    p.options.unshift({ key: 'none', label: 'No commentary', review: null, noteCount: 9, hasUnread: true })
    render(<TrackSelector {...p} />)
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2)
    expect(screen.queryByRole('radio', { name: 'No commentary' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Cora Coach.*2 notes total.*new/ })).toBeChecked()
    const modes = within(screen.getByRole('radiogroup', { name: 'Commentary playback' }))
    expect(modes.getAllByRole('radio').map((radio) => radio.textContent || radio.getAttribute('value'))).toHaveLength(4)
    await user.click(modes.getByRole('radio', { name: 'Written notes only' }))
    expect(p.onModeChange).toHaveBeenCalledWith('written')
    expect(p.onSelect).not.toHaveBeenCalled()
  })

  it('supports native radio arrow navigation and a single tab stop in the mode group', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [mode, setMode] = useState<CommentaryPlaybackMode>('all')
      return <TrackSelector {...props(mode)} onModeChange={setMode} />
    }
    render(<Harness />)
    screen.getByRole('radio', { name: 'Text + audio' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Written notes only' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Written notes only' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Audio only' })).not.toHaveFocus()
  })

  it('renders the complete readable list once in Text + audio', () => {
    render(<TrackSelector {...props()} />)
    expect(screen.getByText('Written feedback')).toBeInTheDocument()
    expect(screen.getByText('Voice transcript')).toBeInTheDocument()
    expect(screen.getAllByRole('list', { name: 'Commentary transcript' })).toHaveLength(1)
    expect(screen.queryByText('Read all feedback')).not.toBeInTheDocument()
  })

  it('keeps voice bodies out of Written and Audio only until deliberately expanded', async () => {
    const user = userEvent.setup()
    const p = props('voice')
    const view = render(<TrackSelector {...p} />)
    expect(screen.queryByText('Written feedback')).not.toBeInTheDocument()
    expect(screen.queryByText('Voice transcript')).not.toBeInTheDocument()
    expect(screen.getByText('Voice commentary · Ready')).toBeInTheDocument()
    await user.click(screen.getByText('Read all feedback'))
    await waitFor(() => expect(screen.getByRole('list', { name: 'All feedback' })).toBeInTheDocument())
    expect(screen.getByText('Voice transcript')).toBeInTheDocument()
    expect(p.onReadAll).toHaveBeenCalledOnce()
    expect(p.onModeChange).not.toHaveBeenCalled()
    view.rerender(<TrackSelector {...props('written')} />)
    expect(screen.queryByRole('list', { name: 'All feedback' })).not.toBeInTheDocument()
    expect(screen.getByText('Written feedback')).toBeInTheDocument()
    expect(screen.queryByText('Voice transcript')).not.toBeInTheDocument()
    view.rerender(<TrackSelector {...p} />)
    expect(screen.queryByRole('list', { name: 'All feedback' })).not.toBeInTheDocument()
  })

  it('keeps Report and deliberate reading available in Off, without a default notes list', async () => {
    const user = userEvent.setup()
    const p = props('off')
    render(<TrackSelector {...p} />)
    expect(screen.getByRole('button', { name: 'Report review' })).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    await user.click(screen.getByText('Read all feedback'))
    await waitFor(() => expect(screen.getByRole('list', { name: 'All feedback' })).toBeInTheDocument())
    expect(p.onModeChange).not.toHaveBeenCalled()
  })

  it('uses honest filtered empty states and disables playback when no reviewer is available', () => {
    const p = props('written')
    const view = render(<TrackSelector {...p} annotations={[]} />)
    expect(screen.getByText('No written notes from this reviewer.')).toBeInTheDocument()
    expect(screen.queryByText(/hasn't left/)).not.toBeInTheDocument()
    view.rerender(<TrackSelector {...props('voice')} annotations={[]} />)
    expect(screen.getByText('No audio commentary from this reviewer.')).toBeInTheDocument()
    view.rerender(<TrackSelector {...p} selected="none" options={[]} disabled />)
    expect(screen.getByText('No reviewers available.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Text + audio' })).toBeDisabled()
  })

  it('shows load/save failures with Retry and generic accessible playback controls', async () => {
    const user = userEvent.setup()
    const p = props()
    p.preference.saveError = true
    p.voicePlayback.current = voice
    p.voicePlayback.state = 'playing'
    const view = render(<TrackSelector {...p} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save setting.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await user.click(screen.getByRole('button', { name: 'Pause commentary' }))
    await user.click(screen.getByRole('button', { name: 'Skip commentary' }))
    expect(p.preference.retry).toHaveBeenCalledOnce()
    expect(p.voicePlayback.pauseCommentary).toHaveBeenCalledOnce()
    expect(p.voicePlayback.skip).toHaveBeenCalledOnce()
    view.rerender(<TrackSelector {...p} voicePlayback={{ ...p.voicePlayback, state: 'paused' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Voice commentary paused')
    await user.click(screen.getByRole('button', { name: 'Resume commentary' }))
    expect(p.voicePlayback.resumeCommentary).toHaveBeenCalledOnce()
  })
})
