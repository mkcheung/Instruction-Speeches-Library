import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { inviteReviewerSchema, type InviteReviewerFormValues } from '@/lib/validation'
import { useInviteReviewerMutation, useSearchReviewersQuery } from '@/features/review/reviewApi'
import type { ReviewerDirectoryEntry } from '@/features/review/types'
import { cn } from '@/lib/utils'

/**
 * STEP-05-invitation-loop.md's invite composer, built as an inline panel
 * on the speech-watch page (toggled by an "Invite a reviewer" button)
 * rather than a modal dialog — this codebase has no existing dialog
 * wrapper component to match, and a panel needs none of that plumbing.
 *
 * §6.3: with no open reviewer pool, the directory browse/search/filter
 * below is the *only* discovery mechanism, so it's budgeted as a real
 * list (name, username, credential badge) rather than a bare `<select>`.
 */
export function InviteReviewerDialog({
  speechId,
  supersedesId,
  onClose,
  onInvited,
}: {
  speechId: number
  /** Only when the speech being reviewed supersedes an earlier attempt
   * (§6.11) does the "share the previous version's feedback" opt-in
   * render at all. */
  supersedesId?: number
  onClose: () => void
  onInvited?: () => void
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [credential, setCredential] = useState<'' | 'member' | 'coach'>('')
  const [selectedReviewer, setSelectedReviewer] = useState<ReviewerDirectoryEntry | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  const { data, isLoading: isSearching } = useSearchReviewersQuery({
    search: debouncedSearch || undefined,
    credential: credential || undefined,
  })

  const [inviteReviewer, { isLoading: isInviting }] = useInviteReviewerMutation()

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<InviteReviewerFormValues>({
    resolver: zodResolver(inviteReviewerSchema),
    defaultValues: {
      reviewer_id: 0,
      invitation_message: '',
      allow_preview: false,
      prior_commentary_shared: false,
    },
  })

  const handleSelect = (reviewer: ReviewerDirectoryEntry) => {
    setSelectedReviewer(reviewer)
    setValue('reviewer_id', reviewer.id, { shouldValidate: true })
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await inviteReviewer({
        speechId,
        body: {
          reviewer_id: values.reviewer_id,
          message: values.invitation_message || null,
          allow_preview: values.allow_preview,
          prior_commentary_shared: !!supersedesId && values.prior_commentary_shared,
        },
      }).unwrap()
      setSuccess(true)
      onInvited?.()
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  const reviewers = data?.reviewers ?? []

  return (
    <Card data-testid="invite-reviewer-panel">
      <CardHeader>
        <CardTitle>Invite a reviewer</CardTitle>
        <CardDescription>Search the reviewer directory, pick someone, and send them a message.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {success ? (
          <>
            <FormBanner variant="success" message={`Invitation sent to ${selectedReviewer?.name ?? 'the reviewer'}.`} />
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <FormBanner message={formError} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reviewer-search">Search the reviewer directory</Label>
              <Input
                id="reviewer-search"
                placeholder="Search by name or username…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-2" role="group" aria-label="Filter by credential">
              {(['', 'member', 'coach'] as const).map((option) => (
                <Button
                  key={option || 'all'}
                  type="button"
                  size="sm"
                  variant={credential === option ? 'default' : 'outline'}
                  aria-pressed={credential === option}
                  onClick={() => setCredential(option)}
                >
                  {option === '' ? 'All' : option === 'coach' ? 'Coaches' : 'Members'}
                </Button>
              ))}
            </div>

            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-border p-2">
              {isSearching && <p className="text-sm text-muted-foreground">Searching…</p>}
              {!isSearching && reviewers.length === 0 && (
                <p className="text-sm text-muted-foreground">No reviewers found.</p>
              )}
              {reviewers.map((reviewer) => {
                const isSelected = selectedReviewer?.id === reviewer.id
                return (
                  <button
                    key={reviewer.id}
                    type="button"
                    onClick={() => handleSelect(reviewer)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted',
                    )}
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{reviewer.name}</span>
                      <span className="text-xs text-muted-foreground">@{reviewer.username}</span>
                    </span>
                    <Badge variant={reviewer.credential === 'coach' ? 'default' : 'secondary'}>
                      {reviewer.credential === 'coach' ? 'Coach' : 'Member'}
                    </Badge>
                  </button>
                )
              })}
            </div>
            <FieldMessage message={errors.reviewer_id?.message} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invitation_message">Message (optional)</Label>
              <Textarea
                id="invitation_message"
                rows={3}
                placeholder="Tell them what you'd like feedback on…"
                aria-invalid={!!errors.invitation_message}
                {...register('invitation_message')}
              />
              <FieldMessage message={errors.invitation_message?.message} />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border border-input"
                {...register('allow_preview')}
              />
              Let them preview the video before accepting
            </label>

            {!!supersedesId && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border border-input"
                  {...register('prior_commentary_shared')}
                />
                Share the previous version's feedback (anonymized)
              </label>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={isInviting || !selectedReviewer}>
                {isInviting ? 'Sending…' : 'Send invitation'}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
