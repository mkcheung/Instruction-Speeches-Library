/**
 * STEP-11-FROZEN-CONTRACT.md §1 — `reports` table / `POST /api/reports`.
 * Field names kept snake_case-from-Laravel unconverted, same convention as
 * every other `features/*Api.ts` type file in this codebase.
 */
export type ReportableType = 'speech' | 'review'

/** The five CHECK-constrained reasons §1 defines — exhaustive, the server
 * 422s on anything else. */
export type ReportReason = 'harassment' | 'inappropriate_content' | 'impersonation' | 'spam' | 'other'

export type ReportState = 'open' | 'actioned' | 'dismissed'

/** `App\Http\Resources\ReportResource` (name inferred — not spelled out by
 * the frozen contract beyond "response `{ report: ReportResource }`"; the
 * fields below are exactly the `reports` table's own columns minus the
 * admin-only resolution fields, which STEP-12's admin queue owns and this
 * step's reporter-facing response has no reason to expose). */
export interface Report {
  id: number
  reportable_type: ReportableType
  reportable_id: number
  reason: ReportReason
  detail: string | null
  state: ReportState
  created_at: string
}

/** `POST /api/reports` body — §1 verbatim. `reportable_type` is resolved
 * server-side to the two allowed model classes only; the client never
 * names an arbitrary Eloquent class. */
export interface CreateReportPayload {
  reportable_type: ReportableType
  reportable_id: number
  reason: ReportReason
  detail?: string
}

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
]
