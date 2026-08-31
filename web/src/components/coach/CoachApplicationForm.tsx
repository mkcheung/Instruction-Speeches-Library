import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { CoachDocumentUpload } from '@/components/coach/CoachDocumentUpload'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { coachApplicationSchema, type CoachApplicationFormValues } from '@/lib/validation'
import { useSubmitCoachApplicationMutation } from '@/features/coachApplication/coachApplicationApi'
import type { CoachApplication } from '@/features/coachApplication/types'

const STATEMENT_MAX = 2000

/**
 * STEP-12-admin-portal.md's demo script: "Write a statement. Upload two
 * certification PDFs." — one form, two phases, the same shape
 * `SpeechCreate.tsx` uses for "create, then the Uppy dashboard appears."
 * `application` is `null` the first time a Member visits (no draft yet);
 * once the save mutation returns an `id`, the document-upload step renders
 * beneath it, matching the frozen contract's document route needing that
 * id.
 */
export function CoachApplicationForm({
  application,
  onChanged,
}: {
  application: CoachApplication | null
  onChanged: (application: CoachApplication) => void
}) {
  const [submitApplication, { isLoading: isSaving }] = useSubmitCoachApplicationMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const [documentsUploaded, setDocumentsUploaded] = useState((application?.documents.length ?? 0) > 0)

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<CoachApplicationFormValues>({
    resolver: zodResolver(coachApplicationSchema),
    defaultValues: { statement: application?.statement ?? '' },
  })

  const statement = watch('statement') ?? ''
  const remaining = STATEMENT_MAX - statement.length

  const onSaveDraft = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const saved = await submitApplication({ statement: values.statement }).unwrap()
      onChanged(saved)
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  const onSubmitForReview = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const submitted = await submitApplication({ statement: values.statement }).unwrap()
      onChanged(submitted)
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  const hasDraft = !!application

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apply to become a coach</CardTitle>
        <CardDescription>
          An administrator reviews submitted credentials before approving a coach application — this describes the
          badge accurately, it is not a claim that the certificate itself was verified.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormBanner message={formError} />

        <form onSubmit={hasDraft ? onSubmitForReview : onSaveDraft} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="statement">Why do you want to coach?</Label>
            <Textarea
              id="statement"
              rows={6}
              maxLength={STATEMENT_MAX}
              aria-invalid={!!errors.statement}
              {...register('statement')}
            />
            <div className="flex items-center justify-between">
              <FieldMessage message={errors.statement?.message} />
              <span
                className="text-xs text-muted-foreground"
                aria-live="polite"
                data-testid="statement-remaining"
              >
                {remaining} characters left
              </span>
            </div>
          </div>

          {!hasDraft && (
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save draft and continue'}
            </Button>
          )}
        </form>

        {hasDraft && application && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>Certification documents</Label>
              <p className="text-sm text-muted-foreground">
                Upload up to two PDFs — certificates or other proof of coaching credentials.
              </p>
              <CoachDocumentUpload
                applicationId={application.id}
                onUploaded={() => setDocumentsUploaded(true)}
              />
              {application.documents.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {application.documents.map((document) => (
                    <li key={document.id} className="text-muted-foreground">
                      {document.original_filename}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Button type="button" onClick={onSubmitForReview} disabled={isSaving || !documentsUploaded}>
              {isSaving ? 'Submitting…' : 'Submit application'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
