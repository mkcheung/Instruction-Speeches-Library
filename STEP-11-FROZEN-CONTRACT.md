# STEP-11 Frozen Contract

Resolves every gap the four parallel readiness agents (backend/frontend/database/cross-cutting)
surfaced, into concrete decisions, before any build agent writes code. Method matches
STEP-07/08/09's frozen-contract precedent.

## 0. ⚠️ HEADLINE FINDING — not resolved by this document

**§11.1's legal groundwork (lawful basis, privacy notice, data-processing terms, data
residency, retention schedule, BIPA/CUBI/COPPA analysis, jurisdiction/minors decision) is
entirely unaddressed anywhere in this repo.** Not partially — zero artifacts exist. §20 Q10
and Q18 are still open. The plan states this in writing: "This is a legal-review task on the
critical path, not an engineering one," and "no engineering artifact stands in for it."

This build proceeds with the engineering half only (erasure, export, reports, audit log),
because that is the actionable, delegable part. **Shipping this step is not the same as
being done with it** — the legal groundwork remains outstanding regardless of code quality
below, and must be surfaced to the user as a standing gap, not silently absorbed.

## 1. `reports` table (new migration, driver-branched raw SQL — CHECK constraints needed)

```
id                bigint identity PK
reportable_type   varchar          -- morph, no FK (mirrors notifications.notifiable precedent)
reportable_id     bigint
reporter_id       bigint NULL, FK users, ON DELETE SET NULL
reason            varchar(32), CHECK IN ('harassment','inappropriate_content','impersonation','spam','other')
detail            varchar(500) NULL
state             varchar(16) default 'open', CHECK IN ('open','actioned','dismissed')
resolved_by_id    bigint NULL, FK users, ON DELETE SET NULL
resolved_at       timestamp NULL
resolution_note   varchar(500) NULL
created_at, updated_at
INDEX (state, created_at)          -- oldest-first admin queue, STEP-12
INDEX (reportable_type, reportable_id)
```

`reportable_type` is `Speech` or `Review` only (STEP-11.md's frontend section: "speeches and
annotation sets" — a review *is* the annotation set). No uniqueness constraint on duplicate
reports from the same reporter — STEP-11.md doesn't require de-duplication and `reports:list`
printing duplicates is harmless; don't add scope not asked for.

**Report authorization: reuse `SpeechPolicy::view`, no new Gate ability.** A user may report a
speech or review iff they could view it (`Gate::allows('view', $speech)` — owner or an
accepted/in_progress/published reviewer with `revoked_at` null, exactly the existing
access-granting population). This is intentionally *permissive*, not something admins need to
be prevented from bypassing, so it does **not** go in `$mustFallThrough`. Route:
`POST /api/reports` with `{ reportable_type: 'speech'|'review', reportable_id, reason, detail? }`,
resolving `reportable_type` server-side to the two allowed model classes only (reject anything
else with 422 — do not let the client name an arbitrary Eloquent class).

`php artisan reports:list` mirrors `MediaReconcileCommand`'s shape: plain `$this->info()` table
output, oldest-open-first, columns id/type/target/reporter/reason/state/created_at.

## 2. `audit_log` table (new migration, raw SQL — first true append-only table in this schema)

```
id           bigint identity PK
actor_id     bigint NULL, FK users, ON DELETE SET NULL
action       varchar(64)          -- free text, not CHECK-enumerated (open action vocabulary, see below)
subject_type varchar NULL         -- morph, no FK, mirrors notifications.notifiable
subject_id   bigint NULL
metadata     json / jsonb         -- driver-branched, TEXT+array-cast on sqlite (speech_transcripts.segments precedent)
ip           varchar(45) NULL
user_agent   varchar(255) NULL
created_at   timestamp NOT NULL
```

**No `updated_at`, no soft delete, no update/delete path anywhere in the model** — `AuditLog`
extends `Model` with `public $timestamps = false` and an explicit `created_at` cast; there is
no `AuditLog::update()`/`::delete()` call anywhere in the codebase, and code review should flag
one if it ever appears. This is a deliberate first for this schema (no existing table is truly
immutable) — don't reach for `SoftDeletes` or `$table->timestamps()` out of habit.

`action` is free-text rather than CHECK-enumerated because §14's trigger list is open-ended
("role assignment, admin viewing a private speech, admin reading a coach's commentary,
takedown, suspension, deletion, export, break-glass") and several of those triggers (admin
viewing, admin reading commentary, takedown, suspension) have **no call site yet** — STEP-12
hasn't built the admin surface. Enumerating a CHECK constraint today would either omit
STEP-12's future actions or require a migration to widen it later; free text with an
`AuditAction` PHP-side const class (not a DB enum) for the ones STEP-11 actually fires is the
right amount of structure now.

**STEP-11 writes `audit_log` at exactly the trigger points it has real code for**:
`account.export.requested`, `account.export.downloaded`, `account.erased`, `report.created`.
It does **not** invent stub audit writes for "admin viewing a private speech" or "admin reading
commentary" — those triggers have no call site until STEP-12 builds the admin viewing surface,
per the cross-cutting agent's finding. Leave a one-line comment in `AuditAction` noting the
remaining §14 triggers are deferred to STEP-12, so nobody mistakes the four above for the full
list.

**Audit writes live in controllers/services, never in a Policy** — per §14's explicit warning
(`Gate::allows()` is invoked speculatively in loops/Filament visibility checks, so a
policy-embedded write logs reads that never happened). Write immediately after the real action
succeeds (inside the same DB transaction where practical, e.g. the erasure job's final step).

## 3. `users.anonymized_at` — new migration, minimal

Add **only** `anonymized_at timestamp NULL` to `users`. Do **not** add `suspended_at`/
`suspended_by_id` this step — confirmed by close-reading STEP-11.md's own Acceptance list
(cross-cutting agent finding #4): suspension is not tested or required by this step's
acceptance criteria, it has no existing code path anywhere, and it's naturally an admin action
that needs STEP-12's not-yet-built admin surface. Adding unused suspension columns now would be
schema for a feature this step doesn't build — MODERNIZATION_PLAN.md's schema section listing
them together is a forward-looking summary, not a same-step requirement. `suspended_at`/
`suspended_by_id` become STEP-12's concern.

## 4. `annotations.audio_asset_id` FK — resolved, not a bug

The FK is `ON DELETE SET NULL` at the DB level, which reads as a contradiction against §11.2's
"cannot SET NULL" prose — it isn't. §11.2's warning is about the *identity-vs-content split*
(you can't SET NULL a voice recording's *identity* the way you SET NULL `reviewer_id`, because
the audio *is* the identity), not about the FK mechanic. The correct, already-working pattern
(`EraseReviewerVoiceNotes.php`) is: explicitly null `annotations.audio_asset_id` **and** delete
the `SpeechAsset` row+storage together, in a claim-then-delete transaction — the FK's own
`SET NULL` is just a defensive backstop in case the asset is ever deleted through some other
path. No migration change. Reuse `EraseReviewerVoiceNotes` directly for the "delete voice-note
audio" step of the account-erasure job (§6 below).

## 5. `connections` — no-op this step, not a defect

The table doesn't exist yet (STEP-13, not built). The erasure job's `connections` step is
written as an explicit **no-op with a comment**, e.g.:

```php
// STEP-13 (social layer) has not shipped yet, so there is no `connections` table to purge.
// When STEP-13 lands, add the hard-delete here — do not silently forget it.
```

STEP-11's own acceptance line ("`profiles` and `connections` are hard-deleted") is therefore
only fully verifiable for `profiles` today; the `connections` half is structurally deferred,
not failing. Say this plainly in the retrospective — don't claim full acceptance-criterion
coverage.

## 6. Account-erasure job — exact order, exact service shape

New `App\Services\Privacy\AccountErasureService`, mirroring `ReviewService`'s shape
(constructor-injected, throws domain exceptions, called from both the artisan command and the
authenticated self-service controller). Method: `plan(User $user): ErasurePlan` (pure, no
writes — row/byte counts only, used by both `--dry-run` and the real run to print identical
structure) and `execute(User $user): ErasurePlan` (does the writes, returns the same shape for
the audit-entry metadata and the printed summary).

**Ordered steps, §11.2 verbatim, with the two subtleties the readiness agents' findings imply
but don't spell out — read carefully, this is the part most likely to hide a bug**:

1. **Revoke sessions** — `DB::table('sessions')->where('user_id', $user->id)->delete()`. No FK
   exists on `sessions.user_id` (confirmed by the database agent), so this is a plain delete,
   not cascade-triggered.

2. **Delete media at storage** — for every `speech_assets` row belonging to a speech this user
   **owns** (`speeches.user_id = $user->id`): delete the storage object(s) first, using the
   same claim-then-delete transactional shape `PurgeVoiceAsset`/`EraseReviewerVoiceNotes`
   already establish (lock row, delete storage, throw if delete fails so the row is never
   removed while bytes remain, then delete the row in a second transaction). This is genuinely
   new code — no existing service purges a speech's video/poster/captions/source assets today.

3. **Delete voice-note audio — two sub-cases, both required, only one of which the plan's
   one-line summary makes obvious**:
   - (a) **Voice notes this user *recorded* as a reviewer on other people's speeches** — call
     `EraseReviewerVoiceNotes::execute($user)` directly. Already correct, already
     storage-safe. Deletes audio + row, keeps the annotation and its transcript.
   - (b) **Voice notes *other* reviewers left on speeches this user owns**, which are about to
     be destroyed anyway by step 4's speech cascade (`speeches` → CASCADE → `reviews` →
     CASCADE → `annotations`). The CASCADE deletes the `annotations` *rows*, but it does
     **not** touch the `speech_assets` rows their `audio_asset_id` pointed at, and it
     absolutely does not touch the storage bytes. Skipping this sub-case is exactly how
     STEP-11's own acceptance criterion #2 ("no orphaned media... walk the storage prefixes")
     would fail on a real, not-hypothetical case: any reviewer voice-noted a speech, then the
     speaker deletes their account. **Before step 4 deletes the speeches**, collect every
     `speech_assets` row of `kind = 'voice_note'` reachable via
     `Annotation::whereIn('review_id', $reviewIdsOnOwnedSpeeches)->whereNotNull('audio_asset_id')`,
     and storage-delete + row-delete each one through the same claim-then-delete shape as (a).
     The annotation row itself is destroyed a moment later by the CASCADE regardless, so there
     is no "keep the row" requirement here (unlike case (a), where the reviewer being erased is
     a different person than the speech owner and the annotation must survive) — this is purely
     about not leaking the storage bytes.

4. **Delete speeches, assets, transcripts, reviews** — hard-delete every `speeches` row where
   `user_id = $user->id`. The existing CASCADE chain (`speech_assets` CASCADE,
   `speech_transcripts` CASCADE, `reviews` CASCADE → `annotations` CASCADE) does the rest at
   the DB level, now safe because steps 2–3 already emptied the storage bytes those rows
   pointed at.

5. **Null authorship** — `Review::where('reviewer_id', $user->id)->update(['reviewer_id' => null])`
   for every review where this user was a *reviewer* (on speeches they don't own, which
   therefore survived step 4). This is a plain UPDATE; the FK already permits it.

6. **Hard-delete profile and connections** — `Profile::where('user_id', $user->id)->delete()`
   explicit statement (the FK's own CASCADE never fires this, because the `users` row is never
   hard-deleted — see §4 finding from the backend agent). `connections`: no-op per §5 above.

7. **Anonymize the user row** — scrub `first_name`/`last_name`/`email` (replace with a
   collision-safe placeholder, e.g. `erased-{id}@erased.invalid`, since `email` is UNIQUE),
   `username` (release it — write a `username_history` row so the handle can't be
   immediately reclaimed for impersonation, per §6.5's existing squatting-protection rationale),
   clear `preferences`, clear 2FA secrets, set `anonymized_at = now()`. Do **not** delete the
   row — it must survive to hold the FK targets that steps 5/6/etc. rely on (`reviews.reviewer_id`
   pointing at surviving reviews elsewhere, `audit_log.actor_id` if this user ever acted as an
   admin, etc.).

8. **Write the audit entry** — `action = 'account.erased'`, `subject_type/id` = the erased
   user, `metadata` = the same row/byte counts the dry-run printed.

Wrap steps 2–7 in as few transactions as the claim-then-delete storage pattern allows (storage
deletes cannot be inside a DB transaction that might roll back after the bytes are already
gone — follow the existing `PurgeVoiceAsset` two-transaction shape exactly, don't invent a
single giant transaction).

**`--dry-run` prints the row/byte counts for all 8 steps without executing any of them** — this
printed order *is* the specification per STEP-11's acceptance criterion, so the command's
`$this->info()` output must name each of the 8 steps above, in this exact order, with a count.

## 7. Export — async job, signed-URL delivery (reuses existing presign infra)

New `data_exports` table (mirrors `speech_assets`' status-enum shape, the established pattern
for "you requested something, it's cooking, now it's ready" per the frontend agent's finding):

```
id          bigint identity PK
user_id     bigint FK users, CASCADE
kind        varchar(24), CHECK IN ('account','reviewer_annotations')
status      varchar(16), CHECK IN ('processing','ready','failed')
disk        varchar
path        varchar NULL
byte_size   bigint NULL
expires_at  timestamp NULL         -- exports are not kept forever
created_at, updated_at
```

`kind = 'account'` = "your speeches and the commentary written about you" (§11.1's
right-of-access/portability requirement — every speech you own, with every review on it
including reviewer identity, published essay text, and published annotation text). `kind =
'reviewer_annotations'` = "download my annotations" mitigation for reviewers (every review
where you are `reviewer_id`, with your own annotations/essay, scoped to speeches you don't
own). Both delivered as a single JSON file written to the private disk.

**Duration bug to avoid**: per the database agent's confirmed finding, `speeches.duration_seconds`
has no writer anywhere and is always null. The export's per-speech duration must be read from
`speech_assets` (`kind='video', is_primary=true`), exactly how `SpeechResource` already does it
— not from the `speeches` column directly, or every exported speech will show a null duration.

Routes: `POST /api/privacy/exports {kind}` → queues `GenerateDataExport` job, creates the row
`status='processing'`, returns `{ export: DataExportResource }`. `GET /api/privacy/exports` →
list mine (both kinds), enveloped `{ exports: DataExportResource[] }`, polled by the frontend
exactly like `useCaptionsJob.ts`'s pattern (4s interval, stop on terminal status). `GET
/api/privacy/exports/{id}/download` → 403 if not yours or not ready, else a presigned
`temporaryUrl` via the existing `MediaUrlSigner`/`Storage::temporaryUrlUsing()` seam (reuse,
don't reinvent — this is the same mechanism every video/poster URL already uses), returned as
`{ url: string }` for the frontend to navigate/`<a href>` to directly — no blob-URL step needed
client-side, resolving the frontend agent's open question. TTL 10 minutes, matching video's
existing convention.

`AuditLog` writes on `POST` (`account.export.requested`) and on the download hitting a fresh
presign (`account.export.downloaded`) — per §14's explicit list.

## 8. RBAC — no new `Gate::before` entries required this step

Every new capability in this step is either self-scoped (export, own-account erasure — always
`$request->user()`, no ownership ambiguity, no Policy needed) or reuses an existing permissive
check (`report.create` via `SpeechPolicy::view`, §1 above). `user.erase` (admin-erasing-someone-
else) stays reserved-but-undefined in `$mustFallThrough` exactly as today — no web endpoint in
this step calls it, since STEP-11's own demo script erases your own account through your own
settings page, not an admin action. **Do not define `Gate::define('user.erase', ...)` this
step** — that would be building a policy with no controller to enforce it, the inverse of the
recurring "ability defined, fall-through forgotten" bug class this codebase has hit twice
before. Leave it for STEP-12, which is where the admin-triggered path belongs.

## 9. "Former reviewer" disambiguation

`ReviewResource` currently returns `'reviewer' => null` when `reviewer_id` is null (no label
logic exists yet). Add: when `reviewer_id IS NULL`, render `'reviewer' => ['display_name' =>
'Former reviewer']` inline in the resource — a literal string, never derived from a stored
snapshot (§11.2 is explicit this would defeat the erasure). "Positionally disambiguated" means
the **track selector's list order is stable** (`ORDER BY reviews.id ASC`, already the natural
PK order, already covered well enough by the existing `(speech_id, status)` index per the
backend agent's finding — no new index needed) so two "Former reviewer" entries always appear
in the same relative order across requests; it does not mean appending "#1"/"#2" to the label —
the plan's own wording is "disambiguated positionally," not "disambiguated by numbering," and
the two entries are already distinguishable by which review/track a user clicks into, not by
the label text.

## 10. Frontend contract (new slices, per `web/src/features/*Api.ts` convention)

`web/src/features/report/reportApi.ts` — `POST /api/reports`, response `{ report: ReportResource }`
via `transformResponse` (copy `essayApi.ts`'s exact envelope-unwrap shape). Error body
unenveloped (matches every other slice).

`web/src/features/privacy/privacyApi.ts` — `requestExport(kind)`, `getExports()` (polled),
`getExportDownloadUrl(id)`, `deleteAccount({ confirm })`. All enveloped identically
(`{ export: ... }` / `{ exports: [...] }` / `{ url: ... }`).

UI placement (per the frontend agent's findings, reuse directly):
- Report button: `SpeechWatch.tsx`'s header row (speech-level) and `TrackSelector` (review-level),
  both already have `speechId`/`reviewId` in scope.
- Account settings: new `/account` route nested in the existing `RequireAuth`+`RequireVerified`+
  `AppLayout` group in `App.tsx` — do not bolt onto `ProfileEdit.tsx`, this is higher-stakes and
  deserves its own screen per the frontend agent's recommendation.
- Deletion confirmation: copy `ClearAnnotationsDialog.tsx`'s typed-confirmation `AlertDialogRoot`
  shape verbatim, new confirm word (`DELETE`), `AlertDialogDescription` itemizing consequences
  — explicitly including "every reviewer's commentary on your speeches is destroyed" per
  STEP-11.md's own frontend requirement to state this plainly.
- Export status/download: copy `useCaptionsJob.ts`'s render-time-adjusted polling-interval hook
  shape (`useExportJob`), terminal on `ready`/`failed`, matching `StatusBadge.tsx`'s existing
  status-to-UI mapping conventions.
- Post-deletion session cleanup: copy `LogoutMenuItem`'s exact pattern — hard
  `window.location.assign('/login')`, `resetApiState()` on `authApi`/`profileApi`/new
  `privacyApi`, three-outcome handling (success/already-401/genuine-failure).

## 11. Explicitly out of scope for this step (confirmed by cross-cutting readiness agent)

Suspension (backend or frontend), the admin report queue UI (STEP-12), `connections` hard-delete
(STEP-13 dependency, no-op placeholder only), and any registration-time terms-acceptance
checkbox retrofit (a product/legal decision, not resolved by this contract — flag it, don't
build a guess at it).
