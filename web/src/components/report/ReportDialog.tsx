import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FormBanner } from '@/components/ui/form-message'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverPositioner, PopoverPopup } from '@/components/ui/popover'
import { useCreateReportMutation } from '@/features/report/reportApi'
import { REPORT_REASONS, type ReportReason, type ReportableType } from '@/features/report/types'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'
import { cn } from '@/lib/utils'

/**
 * STEP-11.md's frontend section / STEP-11-FROZEN-CONTRACT.md §10: "The
 * report button on speeches and annotation sets" — one shared component,
 * mounted twice (`SpeechWatch.tsx`'s header for speech-level,
 * `TrackSelector.tsx` for review-level), each passing its own
 * `reportableType`/`reportableId`. Built on `PopoverPopup`
 * (`components/ui/popover.tsx`), not `AlertDialogPopup` — §10/STEP-11.md's
 * own wording ("a lightweight dialog... this doesn't need the heavy
 * typed-confirmation treatment account-deletion needs") rules out the
 * `role="alertdialog"` treatment `ClearAnnotationsDialog`/
 * `DeleteAccountDialog` use, which is reserved for actions with
 * irreversible consequences. Reporting is reversible from the reporter's
 * side (nothing changes for them) and only needs a confirm-and-submit.
 */
export function ReportDialog({
  reportableType,
  reportableId,
  triggerLabel = 'Report',
  triggerClassName,
}: {
  reportableType: ReportableType
  reportableId: number
  triggerLabel?: string
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [createReport, { isLoading }] = useCreateReportMutation()

  const reset = () => {
    setReason(null)
    setDetail('')
    setError(null)
    setSuccess(false)
  }

  const handleSubmit = async () => {
    if (!reason) {
      setError('Pick a reason first.')
      return
    }
    setError(null)
    try {
      await createReport({
        reportable_type: reportableType,
        reportable_id: reportableId,
        reason,
        detail: detail.trim() || undefined,
      }).unwrap()
      setSuccess(true)
    } catch (caught) {
      setError(extractServerErrorMessage(caught))
    }
  }

  return (
    <PopoverRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger
        render={<Button type="button" variant="outline" size="sm" className={triggerClassName} />}
      >
        {triggerLabel}
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner>
          <PopoverPopup data-testid="report-dialog" aria-label="Report this">
            {success ? (
              <div className="flex flex-col gap-2 p-1">
                <p role="status" className="text-sm">
                  Thanks — this has been reported.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-1">
                <p className="text-sm font-medium">
                  Report this {reportableType === 'speech' ? 'speech' : 'annotation set'}
                </p>
                <FormBanner message={error} />
                <div role="radiogroup" aria-label="Reason" className="flex flex-col gap-1">
                  {REPORT_REASONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={reason === option.value}
                      onClick={() => setReason(option.value)}
                      className={cn(
                        'rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors',
                        reason === option.value
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent hover:bg-muted',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="report-detail">Details (optional)</Label>
                  <Textarea
                    id="report-detail"
                    rows={3}
                    maxLength={500}
                    value={detail}
                    onChange={(event) => setDetail(event.target.value)}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" disabled={isLoading} onClick={() => void handleSubmit()}>
                    {isLoading ? 'Submitting…' : 'Submit report'}
                  </Button>
                </div>
              </div>
            )}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </PopoverRoot>
  )
}
