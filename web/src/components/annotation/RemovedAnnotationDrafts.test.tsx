import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RemovedAnnotationDrafts } from './RemovedAnnotationDrafts'
import { discoverAnnotationRecovery, writeAnnotationRecovery, type AnnotationRecoveryRecord } from '@/lib/annotationRecovery'
import type { Annotation } from '@/features/annotation/types'
const scope = { userId: 'coach', speechId: 8, reviewId: 3, rowId: '7' }
const record: AnnotationRecoveryRecord = { version: 2, scope, instanceId: 'tab-a', clientUuid: 'note-a', revision: 1,
  updatedAt: 1, fields: { start: '1', end: '2', body: 'Unsaved text from another tab' }, lockVersion: 1, uncertain: null }
describe('recovery after a saved row is removed', () => {
  beforeEach(() => localStorage.clear())
  it('makes preserved text visible when its saved row disappears without re-adding it', () => {
    writeAnnotationRecovery(record)
    const view = render(<RemovedAnnotationDrafts userId="coach" speechId={8} reviewId={3} annotations={[{ id: '7' } as Annotation]} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    view.rerender(<RemovedAnnotationDrafts userId="coach" speechId={8} reviewId={3} annotations={[]} />)
    expect(screen.getByRole('textbox')).toHaveValue(record.fields.body)
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    expect(discoverAnnotationRecovery(scope)).toHaveLength(1)
  })
  it('discards only the explicitly chosen scoped record', async () => {
    const user = userEvent.setup()
    writeAnnotationRecovery(record)
    const otherScope = { ...scope, userId: 'other-account' }
    writeAnnotationRecovery({ ...record, scope: otherScope })
    render(<RemovedAnnotationDrafts userId="coach" speechId={8} reviewId={3} annotations={[]} />)
    await user.click(screen.getByRole('button', { name: 'Discard preserved draft' }))
    expect(discoverAnnotationRecovery(scope)).toHaveLength(0)
    expect(discoverAnnotationRecovery(otherScope)).toHaveLength(1)
  })
  it('keeps an unresolved original submission preserved', () => {
    writeAnnotationRecovery({ ...record, uncertain: { clientUuid: record.clientUuid, annotationId: '7', lockVersion: 1,
      fields: record.fields, startMs: 1000, endMs: 2000, timingChanged: false } })
    render(<RemovedAnnotationDrafts userId="coach" speechId={8} reviewId={3} annotations={[]} />)
    expect(screen.getByRole('button', { name: 'Discard preserved draft' })).toBeDisabled()
    expect(screen.getByText(/unresolved outcome/)).toBeVisible()
  })
})
