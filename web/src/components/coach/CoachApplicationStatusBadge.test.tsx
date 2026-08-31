import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CoachApplicationStatusBadge } from '@/components/coach/CoachApplicationStatusBadge'
import type { CoachApplicationStatus } from '@/features/coachApplication/types'

describe('CoachApplicationStatusBadge', () => {
  it.each([
    ['draft', 'Draft'],
    ['submitted', 'Submitted'],
    ['under_review', 'Under review'],
    ['approved', 'Approved'],
    ['withdrawn', 'Withdrawn'],
    ['rejected', 'Not approved'],
  ] as [CoachApplicationStatus, string][])('renders %s as %s', (status, label) => {
    render(<CoachApplicationStatusBadge status={status} />)
    expect(screen.getByTestId('coach-application-status')).toHaveTextContent(label)
  })
})
