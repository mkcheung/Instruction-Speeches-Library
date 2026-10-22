import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnnotationList, type AnnotationListProps } from '@/components/annotation/AnnotationList'
import { ToastProvider, Toaster } from '@/components/ui/toast'
import type { Annotation } from '@/features/annotation/types'
import { formatSpokenTimecode } from '@/lib/time'

const api = vi.hoisted(() => ({
  deleteAnnotation: vi.fn(),
  retrying: false,
}))

vi.mock('@/features/annotation/annotationApi', () => ({
  useDeleteAnnotationMutation: () => [api.deleteAnnotation, { isLoading: false }],
  useCreateAnnotationMutation: () => [vi.fn(), { isLoading: false }],
  useRestoreVoiceAnnotationMutation: () => [vi.fn(), { isLoading: false }],
  useRestorePointAnnotationMutation: () => [vi.fn(), { isLoading: false }],
  useUpdateAnnotationMutation: () => [vi.fn(), { isLoading: false }],
  useLazyGetVoiceAudioUrlQuery: () => [vi.fn(), { isFetching: false }],
  useRetryVoiceTranscriptMutation: () => [vi.fn(), { isLoading: api.retrying }],
}))

function note(id: number, overrides: Partial<Annotation> = {}): Annotation {
  return { id: String(id), timing_type: 'range', start_seconds: id * 10, duration_seconds: 5, kind: 'observation', topic: null,
    body: `Note body ${id}`, lock_version: 1, client_uuid: `uuid-${id}`, voice: null, ...overrides }
}
const notes = (count: number) => Array.from({ length: count }, (_, index) => note(index + 1))

function listProps(annotations: Annotation[], extra: Partial<AnnotationListProps> = {}): AnnotationListProps {
  return { annotations, speechId: 1, reviewId: 2, userId: '3', videoEl: null, currentId: null, open: true, onSeek: vi.fn(),
    onLiveChange: vi.fn(), onLiveRemove: vi.fn(), ...extra }
}
function ui(props: AnnotationListProps) {
  return <ToastProvider><AnnotationList {...props} /><Toaster /></ToastProvider>
}
function renderList(annotations: Annotation[], extra: Partial<AnnotationListProps> = {}) {
  const props = listProps(annotations, extra)
  const rendered = render(ui(props))
  return { ...rendered, props, update: (next: Partial<AnnotationListProps>) => rendered.rerender(ui({ ...props, ...next })) }
}
const toggleFor = (id: number) => screen.getByRole('button', { name: new RegExp(`details, annotation at ${formatSpokenTimecode(id * 10)}$`) })
const rowIds = () => within(screen.getByRole('list', { name: 'Your commentary' })).getAllByRole('listitem').map((item) => item.getAttribute('data-annotation-id'))

describe('AnnotationList pagination', () => {
  beforeEach(() => { api.retrying = false; api.deleteAnnotation.mockReset(); localStorage.clear() })

  it('pages six saved notes at a time inside one named list with truthful range text', async () => {
    const user = userEvent.setup()
    renderList(notes(13))
    expect(screen.getAllByRole('list', { name: 'Your commentary' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Saved notes (13)' })).toHaveAttribute('aria-expanded', 'true')
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(screen.getByText('Notes 1–6 of 13 · Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(rowIds()).toEqual(['7', '8', '9', '10', '11', '12'])
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(rowIds()).toEqual(['13'])
    expect(screen.getAllByText('Notes 13–13 of 13 · Page 3 of 3').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('hides paging for one page, shows an empty message, and keeps the list mounted when folded', () => {
    const { container, update } = renderList(notes(6))
    expect(screen.queryByRole('navigation', { name: 'Saved notes pages' })).not.toBeInTheDocument()
    update({ open: false })
    expect(screen.getByRole('button', { name: 'Saved notes (6)' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Your commentary' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('ol')).toHaveLength(1)
    expect(container.querySelectorAll('li[data-annotation-id]')).toHaveLength(6)
    update({ annotations: [], open: true })
    expect(screen.getByText('No saved notes yet.')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Saved notes pages' })).not.toBeInTheDocument()
  })

  it('classifies erased-audio points as point rows and orders equal starts by id', () => {
    renderList([note(2, { start_seconds: 10 }), note(1, { start_seconds: 10, timing_type: 'point', voice: null })])
    expect(rowIds()).toEqual(['1', '2'])
    expect(screen.getByText('Voice note · Audio unavailable')).toBeInTheDocument()
  })

  it('reveals an off-page note by identity, focuses its toggle and re-reveals on a new token', async () => {
    const onOpenChange = vi.fn()
    const onRevealResult = vi.fn()
    const { update } = renderList(notes(13), { open: false, onOpenChange, onRevealResult })
    update({ revealRequest: { id: '12', token: 1 } })
    expect(onOpenChange).toHaveBeenCalledWith(true)
    update({ open: true, revealRequest: { id: '12', token: 1 } })
    expect(rowIds()).toEqual(['7', '8', '9', '10', '11', '12'])
    expect(toggleFor(12)).toHaveFocus()
    expect(toggleFor(12)).toHaveAttribute('aria-expanded', 'true')
    expect(onRevealResult).toHaveBeenCalledTimes(1)
    expect(onRevealResult).toHaveBeenLastCalledWith({ id: '12', token: 1, status: 'revealed' })
    await act(async () => { toggleFor(12).blur() })
    update({ open: true, revealRequest: { id: '12', token: 2 } })
    expect(toggleFor(12)).toHaveFocus()
    expect(onRevealResult).toHaveBeenLastCalledWith({ id: '12', token: 2, status: 'revealed' })
  })

  it('announces an unavailable note instead of opening stale details', () => {
    const onRevealResult = vi.fn()
    renderList(notes(3), { revealRequest: { id: '99', token: 1 }, onRevealResult })
    expect(screen.getByText('That note is no longer available.')).toBeInTheDocument()
    expect(onRevealResult).toHaveBeenCalledWith({ id: '99', token: 1, status: 'unavailable' })
    expect(screen.queryByRole('button', { name: /^Hide details/ })).not.toBeInTheDocument()
  })

  it('locks paging during an edit, defers an off-page reveal, then reveals only on request', async () => {
    const user = userEvent.setup()
    const onHoldChange = vi.fn()
    const { update } = renderList(notes(13), { onHoldChange })
    await user.click(screen.getByRole('button', { name: /^Edit, annotation at 20 second/ }))
    expect(onHoldChange).toHaveBeenLastCalledWith({ editing: true, operating: false, locked: true })
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByText('Save or cancel this edit to change pages.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saved notes (13)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Edit, annotation at 30 second/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Hide details, annotation at 20 second/ })).toBeDisabled()

    update({ revealRequest: { id: '12', token: 7 } })
    expect(screen.getByText('Save or cancel this edit, then show the selected note.', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show selected note' })).toBeDisabled()
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6'])

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onHoldChange).toHaveBeenLastCalledWith({ editing: false, operating: false, locked: false })
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6'])
    await user.click(screen.getByRole('button', { name: 'Show selected note' }))
    expect(rowIds()).toEqual(['7', '8', '9', '10', '11', '12'])
    expect(toggleFor(12)).toHaveFocus()
  })

  it('allows a same-page read-only reveal during a hold without remounting the editor', async () => {
    const user = userEvent.setup()
    const { update } = renderList(notes(13))
    await user.click(screen.getByRole('button', { name: /^Edit, annotation at 20 second/ }))
    const editor = screen.getByRole('textbox', { name: 'Commentary' })
    update({ revealRequest: { id: '4', token: 3 } })
    expect(toggleFor(4)).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Commentary' })).toBe(editor)
  })

  it('retains the edited page and editor through insertion, deletion and its own row disappearing', async () => {
    const user = userEvent.setup()
    const data = notes(13)
    const { update } = renderList(data)
    await user.click(screen.getByRole('button', { name: /^Edit, annotation at 20 second/ }))
    const editor = screen.getByRole('textbox', { name: 'Commentary' })
    await user.type(editor, ' draft')

    // A new earlier note arrives and a neighbour is removed: the page is held and re-sorted without remount.
    update({ annotations: [note(99, { start_seconds: 1 }), ...data.filter((item) => item.id !== '3')] })
    expect(rowIds()).toEqual(['1', '2', '4', '5', '6'])
    expect(screen.getByText('Editing page held · 5 saved notes shown · 13 saved total')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Commentary' })).toBe(editor)
    expect(document.querySelector('li[data-annotation-id="1"]')).not.toHaveAttribute('aria-posinset')

    // The edited row itself disappears remotely: local work is kept and the row is flagged.
    update({ annotations: data.filter((item) => item.id !== '2') })
    expect(screen.getByRole('textbox', { name: 'Commentary' })).toBe(editor)
    expect(editor).toHaveValue('Note body 2 draft')
    expect(screen.getByText('1 unavailable note being edited')).toBeInTheDocument()
    expect(screen.getByText('Editing page held · 5 saved notes shown · 12 saved total')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(rowIds()).toEqual(['1', '3', '4', '5', '6', '7'])
  })

  it('feeds the FULL annotation set to overlap validation, not just the displayed page', async () => {
    const user = userEvent.setup()
    renderList(notes(13))
    await user.click(screen.getByRole('button', { name: /^Edit, annotation at 10 second/ }))
    const start = screen.getByLabelText('Start')
    const end = screen.getByLabelText('End')
    await user.clear(start); await user.type(start, '2:00')
    await user.clear(end); await user.type(end, '2:03')
    expect(within(screen.getByRole('list', { name: 'Conflicting feedback' })).getByText(/Feedback at 2:00/)).toBeInTheDocument()
  })

  it('holds paging while a delete is in flight, but not for the Undo toast window', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    api.deleteAnnotation.mockReturnValue({ unwrap: () => new Promise<void>((done) => { finish = done }) })
    const onPendingChange = vi.fn()
    renderList(notes(13), { onPendingChange })
    await user.click(toggleFor(2))
    await user.click(screen.getByRole('button', { name: /^Delete annotation at 20 second/ }))
    expect(onPendingChange).toHaveBeenCalledWith('delete-2', true)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByText('Wait for the current operation to finish to change pages.')).toBeInTheDocument()
    await act(async () => { finish() })
    expect(onPendingChange).toHaveBeenLastCalledWith('delete-2', false)
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
  })

  it('holds paging during an in-flight transcript retry reported by the row', () => {
    const failed = note(1, { timing_type: 'point', body: '', voice: { asset_id: 1, audio_status: 'ready', transcript_status: 'failed', failure_code: 'x' } })
    const onPendingChange = vi.fn()
    const { update } = renderList([failed, ...notes(13).slice(1)], { onPendingChange })
    api.retrying = true
    update({})
    expect(onPendingChange).toHaveBeenCalledWith('transcript-retry-1', true)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    api.retrying = false
    update({})
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
  })

  it('offers Show saved note for an acknowledged off-page save, only once it exists in the dataset', async () => {
    const user = userEvent.setup()
    const data = notes(12)
    const { update } = renderList(data)
    update({ acknowledgedSave: { id: '13', token: 1 } })
    expect(screen.queryByRole('button', { name: 'Show saved note' })).not.toBeInTheDocument()
    update({ acknowledgedSave: { id: '13', token: 1 }, annotations: [...data, note(13)] })
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6'])
    await user.click(screen.getByRole('button', { name: 'Show saved note' }))
    expect(rowIds()).toEqual(['13'])
    expect(screen.queryByRole('button', { name: 'Show saved note' })).not.toBeInTheDocument()
  })

  it('offers Show current note off-page without moving focus or paging on its own', async () => {
    const user = userEvent.setup()
    const { update } = renderList(notes(13))
    update({ currentId: '9' })
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(document.body).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Show current note' }))
    expect(rowIds()).toEqual(['7', '8', '9', '10', '11', '12'])
    expect(toggleFor(9)).toHaveFocus()
  })

  it('moves focus to the next surviving row summary when the focused row is deleted', async () => {
    const user = userEvent.setup()
    api.deleteAnnotation.mockReturnValue({ unwrap: () => Promise.resolve() })
    renderList(notes(3))
    await user.click(toggleFor(2))
    await user.click(screen.getByRole('button', { name: /^Delete annotation at 20 second/ }))
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(toggleFor(3)).toHaveFocus()
  })

  it('shows the empty message even while Saved notes is folded', () => {
    renderList([], { open: false })
    expect(screen.getByText('No saved notes yet.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Saved notes (0)' })).toBeInTheDocument()
    expect(document.querySelector('ol')).toBeNull()
  })

  it('falls back to the row when the reveal target toggle is disabled by its own edit', async () => {
    const user = userEvent.setup()
    const { update } = renderList(notes(3))
    await user.click(screen.getByRole('button', { name: /^Edit, annotation at 20 second/ }))
    update({ revealRequest: { id: '2', token: 5 } })
    expect(document.querySelector('li[data-annotation-id="2"]')).toHaveFocus()
  })

  it('clamps the stored page so a later growth does not jump back to the old page', async () => {
    const user = userEvent.setup()
    const data = notes(13)
    const { update } = renderList(data)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    update({ annotations: data.slice(0, 6) })
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6'])
    update({ annotations: data })
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('clears selection and expansion when a poll removes the row remotely', () => {
    const data = notes(4)
    const onSelectedChange = vi.fn()
    const { update } = renderList(data, { onSelectedChange, revealRequest: { id: '3', token: 1 } })
    expect(document.querySelector('li[data-annotation-id="3"]')).toHaveAttribute('data-selected', 'true')
    update({ onSelectedChange, revealRequest: { id: '3', token: 1 }, annotations: data.filter((item) => item.id !== '3') })
    expect(onSelectedChange).toHaveBeenLastCalledWith(null)
    update({ onSelectedChange, revealRequest: { id: '3', token: 1 }, annotations: data })
    expect(document.querySelector('li[data-annotation-id="3"]')).not.toHaveAttribute('data-selected')
    expect(toggleFor(3)).toHaveAttribute('aria-expanded', 'false')
  })

  it('lets the saved-note notice be dismissed, and clears it on a page change, while folded or open', async () => {
    const user = userEvent.setup()
    const data = notes(13)
    const { update } = renderList(data, { open: false })
    update({ open: false, acknowledgedSave: { id: '13', token: 1 } })
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('button', { name: 'Show saved note' })).not.toBeInTheDocument()
    update({ open: false, acknowledgedSave: { id: '13', token: 2 } })
    expect(screen.getByRole('button', { name: 'Show saved note' })).toBeInTheDocument()
    update({ open: true, acknowledgedSave: { id: '13', token: 2 } })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.queryByRole('button', { name: 'Show saved note' })).not.toBeInTheDocument()
  })

  it('keeps the live announcement region outside the hidden body', () => {
    const { container } = renderList(notes(3), { open: false })
    const body = container.querySelector('[hidden]')!
    expect(body.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('p.sr-only[role="status"]')).not.toBeNull()
  })
})
