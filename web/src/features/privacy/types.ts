/**
 * STEP-11-FROZEN-CONTRACT.md §7 — `data_exports` table /
 * `POST|GET /api/privacy/exports`, `GET /api/privacy/exports/{id}/download`,
 * `DELETE /api/account`. Field names kept snake_case-from-Laravel
 * unconverted, same convention as every other `features/*Api.ts` type file.
 */
export type ExportKind = 'account' | 'reviewer_annotations'
export type ExportStatus = 'processing' | 'ready' | 'failed'

/**
 * `App\Http\Resources\DataExportResource` (name inferred, same caveat as
 * `ReportResource` — the frozen contract pins the table columns and the
 * envelope, not the resource's exact field list). `disk`/`path` are
 * storage-internal (how `MediaUrlSigner` finds the object) and have no
 * reason to reach the client, which only ever needs the id to ask for a
 * fresh presigned URL via `getExportDownloadUrl`.
 */
export interface DataExport {
  id: number
  kind: ExportKind
  status: ExportStatus
  byte_size: number | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

/** `POST /api/privacy/exports` body — §7: `{ kind }`. */
export interface RequestExportPayload {
  kind: ExportKind
}

/**
 * `DELETE /api/account` body — §10 pins this mutation's TypeScript shape
 * as `deleteAccount({ confirm })` without spelling out what the backend
 * does with `confirm` beyond that. Judgment call (flagged in the STEP-11
 * report): sent as a belt-and-suspenders echo of the frontend's own typed
 * `DELETE` confirmation word, mirroring the client-side gate rather than
 * inventing an unrelated shape — if the real backend validates it
 * differently (or ignores it), this is a one-line change.
 */
export interface DeleteAccountPayload {
  confirm: string
}
