/**
 * STEP-12-FROZEN-CONTRACT.md §9. The backend (§12's Filament/coach-
 * application build) is out of this build's scope and, as of this file,
 * unbuilt — only the envelope key (`{ coachApplication: ... }`), the three
 * routes, and the notification `type` strings are pinned by the frozen
 * contract. The resource's exact field set below is inferred from the
 * backend section of STEP-12.md (`coach_applications`' state machine,
 * `application_documents`' own table) the same way `reviewApi.ts`'s
 * `PublishReviewResponse` comment flags an inferred shape — reconcile
 * against the real `CoachApplicationResource`/`ApplicationDocumentResource`
 * once they exist.
 */

/** `draft → submitted → under_review → approved | rejected`, plus
 * `rejected → draft` (reusing the row, §12's backend section) and
 * `withdrawn` (the applicant's own opt-out, mirrored on `ReviewStatus`'s
 * `abandoned`/`revoked` precedent). */
export type CoachApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'withdrawn'

/** `application_documents` row, scanned asynchronously (§12's backend
 * section: "queued, not synchronous on upload"). `pending_scan` is the
 * state a just-uploaded document sits in until the queued ClamAV job
 * finishes. */
export type ApplicationDocumentStatus = 'pending_scan' | 'clean' | 'infected'

export interface ApplicationDocument {
  id: number
  original_filename: string
  status: ApplicationDocumentStatus
  created_at: string
}

export interface CoachApplication {
  id: number
  status: CoachApplicationStatus
  statement: string | null
  /** Set only once an admin has decided (`approved`/`rejected`) — the
   * reason accompanying that decision (STEP-12.md demo script: "Approve,
   * with a reason"). */
  decision_reason: string | null
  submitted_at: string | null
  decided_at: string | null
  documents: ApplicationDocument[]
}

/** `POST /api/coach-applications` body. Per the frozen contract this one
 * route both creates the caller's draft and (called again once documents
 * are attached) submits it — there is no separate `/submit` route pinned,
 * consistent with `open_slot`'s "one open row per user" design where the
 * write is an idempotent upsert against whichever row the caller currently
 * has open. */
export interface CoachApplicationPayload {
  statement: string
}
