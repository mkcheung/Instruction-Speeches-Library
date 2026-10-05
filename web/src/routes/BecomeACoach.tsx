import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CoachApplicationForm } from '@/components/coach/CoachApplicationForm'
import { CoachApplicationStatusBadge } from '@/components/coach/CoachApplicationStatusBadge'
import { useGetMyCoachApplicationQuery, useSubmitCoachApplicationMutation } from '@/features/coachApplication/coachApplicationApi'
import type { CoachApplication } from '@/features/coachApplication/types'
import { getErrorStatus } from '@/lib/errorStatus'
import { PageShell } from '@/components/layout/PageShell'

/**
 * STEP-12-FROZEN-CONTRACT.md §9: `/become-a-coach` — one route, tab/step-
 * gated by the application's own status rather than separate routes per
 * status ("avoiding an extra guessable path"). `draft` (or no application
 * yet, a 404 from `GET /api/coach-applications/me`) renders the form;
 * `submitted`/`under_review` render a waiting state; `approved`/`rejected`
 * render the decision; `withdrawn` behaves like `rejected` — both let the
 * applicant start over by resubmitting through the same idempotent
 * `POST /api/coach-applications`.
 */
export default function BecomeACoach() {
  const { data: application, isLoading, isError, error, refetch } = useGetMyCoachApplicationQuery()
  const [restart, { isLoading: isRestarting }] = useSubmitCoachApplicationMutation()
  const [localApplication, setLocalApplication] = useState<CoachApplication | null>(null)

  const noApplicationYet = isError && getErrorStatus(error) === 404
  const otherError = isError && !noApplicationYet

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>
    )
  }

  if (otherError) {
    return (
      <PageShell width="form">
        <Card>
          <CardContent className="py-6 text-sm text-destructive" role="alert">
            Couldn't load your coach application — try again.
          </CardContent>
        </Card>
      </PageShell>
    )
  }

  // `localApplication` wins over the fetched one right after a mutation
  // resolves (draft save, document upload, restart) so the newly returned
  // `id`/status/documents render immediately without waiting on the
  // invalidated query to refetch.
  const current: CoachApplication | null = localApplication ?? (noApplicationYet ? null : application ?? null)

  const handleRestart = async () => {
    if (!current) return
    const restarted = await restart({ statement: current.statement ?? '' }).unwrap()
    setLocalApplication(restarted)
  }

  if (!current || current.status === 'draft') {
    return (
      <PageShell width="form">
        <CoachApplicationForm
          application={current}
          onChanged={(next) => {
            setLocalApplication(next)
            refetch()
          }}
        />
      </PageShell>
    )
  }

  if (current.status === 'submitted' || current.status === 'under_review') {
    return (
      <PageShell width="form">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Your application
              <CoachApplicationStatusBadge status={current.status} />
            </CardTitle>
            <CardDescription>
              An administrator reviews submitted credentials before deciding — you'll get a notification either way.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {current.documents.map((document) => (
                <li key={document.id}>{document.original_filename}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </PageShell>
    )
  }

  if (current.status === 'approved') {
    return (
      <PageShell width="form">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              You're a coach
              <CoachApplicationStatusBadge status={current.status} />
            </CardTitle>
            <CardDescription>Your profile now shows a Coach badge.</CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    )
  }

  // rejected or withdrawn
  return (
    <PageShell width="form">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Your application
            <CoachApplicationStatusBadge status={current.status} />
          </CardTitle>
          {current.decision_reason && <CardDescription>{current.decision_reason}</CardDescription>}
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={handleRestart} disabled={isRestarting}>
            {isRestarting ? 'Starting…' : 'Start a new application'}
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  )
}
