import { Badge } from '@/components/ui/badge'
import type { CoachApplicationStatus } from '@/features/coachApplication/types'

/**
 * STEP-12-FROZEN-CONTRACT.md §9 / STEP-12-admin-portal.md's frontend
 * section: applicant-facing status display. This codebase has no shared
 * `<StatusStepper>` abstraction (confirmed — `StatusBadge.tsx` is a plain
 * per-status `if`/`return` chain, not a lookup table), so this follows
 * that same shape rather than inventing one: one badge variant per
 * `CoachApplicationStatus`, `data-testid="coach-application-status"` so
 * tests can find it the same way `speech-card-status` is found.
 */
export function CoachApplicationStatusBadge({ status }: { status: CoachApplicationStatus }) {
  if (status === 'draft') {
    return (
      <Badge variant="secondary" data-testid="coach-application-status">
        Draft
      </Badge>
    )
  }

  if (status === 'submitted') {
    return (
      <Badge variant="secondary" data-testid="coach-application-status">
        Submitted
      </Badge>
    )
  }

  if (status === 'under_review') {
    return (
      <Badge variant="outline" data-testid="coach-application-status">
        Under review
      </Badge>
    )
  }

  if (status === 'approved') {
    return (
      <Badge variant="default" data-testid="coach-application-status">
        Approved
      </Badge>
    )
  }

  if (status === 'withdrawn') {
    return (
      <Badge variant="outline" data-testid="coach-application-status">
        Withdrawn
      </Badge>
    )
  }

  // rejected
  return (
    <Badge variant="destructive" data-testid="coach-application-status">
      Not approved
    </Badge>
  )
}
