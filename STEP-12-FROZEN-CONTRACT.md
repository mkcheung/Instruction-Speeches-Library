# STEP-12 Frozen Contract

Resolves every gap the four parallel readiness agents (backend/frontend/database-infra/
cross-cutting-RBAC) surfaced, into concrete decisions, before any build agent writes code.
Method matches STEP-07/08/09/11's frozen-contract precedent. **Read-only review pass — no
code was written or modified to produce this document.** All load-bearing claims below were
independently spot-checked by direct grep/read, not taken on an agent's word alone.

## 0. Headline finding, carried over unchanged

**§11.1's legal groundwork remains entirely unaddressed** ([[project-state]], STEP-11 entry).
STEP-12 doesn't touch it and doesn't need to — noted so it isn't lost in this document.

## 1. This is a from-scratch build, not a tuning pass

Confirmed by direct grep, zero hits for all of: `filament/filament` (composer.json),
`app/Filament`, `clamav` (repo-wide outside vendor/node_modules), `RoleAssignmentService`,
`UserDeletionService`, `LastAdministratorException`, `pg_advisory`/`hashtext(` in `app/`,
`Content-Disposition`/`X-Content-Type-Options` anywhere in `api/app`. §7.4 (last-admin lock,
suspend/soft-delete/erase safeguards) is 0% built. This is the largest from-scratch build
since STEP-04.

## 2. ⚠️ Security-critical: `Gate::before`'s `$mustFallThrough` list, verified current contents

Direct read of `api/app/Providers/AppServiceProvider.php:188-227` (not the plan's stale
description) — current list: `review.accept/decline/publish/withdraw/abandon`,
`speech.invite`, `annotation.create/update/delete`, `voice.*` (5 abilities),
`review.clearAnnotations`, `readAnnotations`, `essay.update/publish`, `caption.update`,
`user.delete/erase/demote`, `role.grantSuperAdmin/revokeSuperAdmin`, `viewDirectory`.

**Confirmed missing, must be added the moment these abilities are `Gate::define`'d, in the
same commit — never after**: `role.assign`, `role.revoke` (generic, per §7.4 point 6 —
distinct from the existing `grantSuperAdmin`/`revokeSuperAdmin` pair), `user.suspend`. This
is the exact bug class the plan's own history names (rev 2 omitted `user.delete`); both the
backend and cross-cutting review agents independently flagged it as the single highest-risk
item in this step. **Decision: the PR that adds `RoleAssignmentService` and any
`user.suspend`-gated controller action must add these three strings to
`$mustFallThrough` in the identical commit, with a test asserting an admin gets 403/false
from each** — not a follow-up task.

## 3. `RoleAssignmentService` — lock key and shape

`hashtext('admin_roster')` is unclaimed (confirmed: no other `pg_advisory*` call site
anywhere in `app/`, only an unrelated hit in `vendor/symfony/.../PdoSessionHandler.php`).
**Decision:** use it verbatim per §7.4. `RoleAssignmentService` gets two public methods,
`assign(User $actor, User $target, string $role)` and `revoke(...)`, both wrapping the same
`pg_advisory_xact_lock(hashtext('admin_roster'))` + re-count pattern §7.4 gives for deletion,
reused rather than re-derived. Coach approval calls `assign($admin, $applicant, 'coach')`
through this service — never `assignRole()` directly, per the plan's own non-negotiable.

## 4. `UserPolicy` / `AccountPolicy` — new classes, confirmed nothing to extend

No `UserPolicy`/`AccountPolicy` exists (`app/Policies/` currently holds only
`AnnotationPolicy`, `ReviewPolicy`, `SpeechPolicy`). **Decision:** `UserPolicy@delete`
(moderation, admin-only, excludes self, excludes last-admin via the service call) and
`AccountPolicy@eraseSelf` (rights, already partially covered by STEP-11's
`AccountErasureService` — extend, don't duplicate, the "unless last admin" clause per §7.1's
capability matrix row).

## 5. `application_documents` — genuinely new, not "speech_assets-shaped" reuse

Confirmed: sha256 hashing and magic-byte validation do not exist anywhere in this codebase
today (`SpeechUploadController` only does randomized-path `Str::uuid()` keys). **Decision:**
build `application_documents` validation from scratch — `%PDF-` magic-byte check, sha256 on
write, 10MB size cap, page-count cap via a lightweight PDF parser (not shelling to a
full-page-render tool). Model the *interface seam* on `TranscoderContract`/`FakeTranscoder`
(confirmed canonical pattern, already copied twice for captions and voice): a
`ClamScannerContract` + `FakeClamScanner` (CI/testing) + real `ClamdScanner`, bound in
`AppServiceProvider::register()` the same conditional way.

**Scan lifecycle, resolved:** `application_documents.status` gets the enum
`pending_scan → clean | infected`, CHECK-constrained (this codebase's established
enum-as-CHECK convention). Scan is **queued, not synchronous on upload** — mirrors
`GenerateCaptions`/transcode jobs, not a blocking request. The admin queue only surfaces
`clean` documents; `infected` ones are quarantined (row kept, storage purged, `status`
stays `infected`) and never open, sandboxed or not.

**Storage disk, resolved:** neither `media` nor `media_public` (confirmed: both exist,
both are S3-compatible buckets on the same origin family the panel could run behind) —
**a new disk**, e.g. `application_documents`, configured so its signed URLs are only ever
handed out with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`
forced at generation time, never through the `media_public` browser-direct-signed-URL path.
This would be the **first place in this codebase setting these two headers at all** — no
existing controller does (confirmed by repo-wide grep), so there is nothing to copy; build
directly from §6.8's non-negotiables.

## 6. Migration template, confirmed exact file to copy

`api/database/migrations/2026_08_20_100001_create_reports_table.php` — driver-branched raw
`DB::statement`, named `ck_<table>_<col>` CHECK constraints, separate `CREATE INDEX`
statements. `coach_applications`' `uq_coach_app_live` partial-unique-index shape has its
closest precedent in `2026_08_18_110002_add_voice_audio_to_annotations.php` (WHERE-clause
partial indexes) and `2026_08_08_150002_create_speeches_table.php`'s
`uq_speeches_successor`. Copy both patterns into one migration file.

## 7. `compose.yaml` / clamav — the plan's own framing is stale, corrected here

**Confirmed by direct count:** `condition: service_healthy` already appears 18 times in
`compose.yaml`, established since S0/S1 — every current service with a dependency already
uses it. STEP-12.md's claim that clamav "is where healthcheck + `service_healthy` stops
being optional" is **factually wrong about this repo's current state** and should not be
repeated to a build agent as if novel. **The real teaching point, corrected:** clamav
(`clamd` daemon, not one-shot `clamscan`, so the queued scan job can hit a warm socket
repeatedly rather than reload signatures per file) is the **first service whose own
healthcheck is actually load-bearing for a genuinely slow startup** (freshclam DB load can
take minutes) rather than a fast liveness check that basically always passes immediately —
worth keeping in the CP/retrospective framing, but state it accurately.

## 8. Test-driver gap for the last-admin concurrency test

`phpunit.xml` pins sqlite; `pg_advisory_xact_lock` has no sqlite equivalent, and this is
genuinely new — no PHPUnit/Pest-level Postgres-only test exists yet. **Decision:** follow
the existing shell-script precedent (`scripts/verify-postgres-caption-schema.sh`,
`scripts/verify-postgres-voice-schema.sh`, already in `ci.yml`) rather than inventing a new
mechanism — add `scripts/verify-postgres-last-admin-lock.sh`, wired into `ci.yml` alongside
the other two, firing two concurrent deletes at the last two admins.

## 9. Frontend contract — envelope keys, routes, notification types (pinned, not guessed)

Confirmed: every existing RTK Query slice uses `{ resourceName: T }` singular / plural
convention with `transformResponse` (STEP-08's real bug was exactly a missed instance of
this). **Pinned for `coachApplicationApi.ts`:**

- Routes: `POST /api/coach-applications` (create/submit draft), `GET
  /api/coach-applications/me`, `POST /api/coach-applications/{id}/documents` (multipart,
  two files), matching this codebase's existing REST-under-`/api` convention.
- Envelope: `{ coachApplication: CoachApplication }` for singular reads/writes, matching
  camelCase-in-JSON precedent (`speechApi`/`essayApi` — confirmed convention), snake_case on
  the wire only inside nested DB-shaped fields.
- Notification `type` strings: `coach_application.approved` / `coach_application.rejected`
  (matching existing `review.*` dot-notation precedent) — `NotificationBell.tsx`'s
  `describe()` switch (confirmed enumerated, not generic-fallback-safe) needs a new case for
  each, added in the same PR as the backend notification class.
- Route paths: `/become-a-coach` (applicant form + status, one route, tab/step-gated by
  application status) — no separate status route, avoiding an extra guessable path.
- Upload: extend `UploadDashboard.tsx`'s existing Uppy pattern with `allowedFileTypes:
  ['application/pdf']`, `maxNumberOfFiles: 2` — confirmed the only two knobs that differ
  from the existing speech-upload instance; no new upload library needed.
- Coach badge: renders on `PublicProfile.tsx` (confirmed currently absent everywhere),
  reusing the existing `<Badge>` component `ReviewerDirectory`/`InviteReviewerDialog` already
  use for the same credential string — not a new component.

## 10. What's already correct and needs no new code

- Admin-categorical-denial (`ReviewPolicy::accept` et al., `AnnotationPolicy`'s essay-write
  gates) is already built and already has direct-API-call tests
  (`AnnotationWriteHttpTest.php:435,475`, `EssayHttpTest.php:220`) — STEP-12 extends this
  test file with the same assertions for coach-application actions, doesn't invent the
  pattern.
- `audit_log` (STEP-11) is genuinely append-only and its `action` column is deliberately
  free-text specifically so STEP-12 can add new action values with no migration — confirmed
  by the migration's own comment. Reuse as-is; call sites go in controllers/services per the
  existing convention (`ReportController`, `PrivacyExportController`,
  `AccountErasureService`), never in a policy.
- Reviewer directory wiring (`User::scopeReviewerCandidates`) already reacts to any
  `assignRole('coach')` immediately — confirmed live today via the `artisan
  user:grant-role` stand-in. STEP-12's approval flow just needs to call
  `RoleAssignmentService::assign` instead; no directory-side change required.
- `users.preferences` JSON (§6.9's per-user notification defaults) already exists
  (`2026_08_18_110003_add_preferences_to_users.php`).
- Notification mail+db infrastructure (`app/Notifications/`, `ReviewInvited.php` etc.)
  already established; add `CoachApplicationApproved`/`Rejected` as siblings.
- `PurgeExpiredExportsCommand` is the exact template for the 90-day certification-document
  purge command (storage-before-row deletion order, `--force-age` flag to prove the query
  without waiting).

Related: [[project-state]] · [[feedback-subagent-claim-verification]] ·
[[feedback-parallel-agent-seams]]
