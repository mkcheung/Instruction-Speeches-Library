# Code review and implementation plan

Status: **design decisions resolved and independently checked; ready for later authorized implementation.** Reviewed 2026-10-26 against `development` at `230708c`. The tracked tree was unchanged; the pre-existing untracked [DRY/efficiency follow-up plan](PLAN-DRY-EFFICIENCY-FOLLOW-UP.md) was preserved. Three explorer agents reviewed backend correctness, frontend async/cache behavior, and jobs/storage. An independent explorer validated the findings (§7). A later design pass resolved the execution choices in §8; its final review is recorded in §10. This remains a planning-only change.

This is a correctness-first companion to that twelve-candidate plan, not a replacement or a claim that its work has executed. Its A1 predecessor-disclosure and A2 Clamd-transport investigations remain open. The completed [Friends](PLAN-DRY-FRIENDS-AND-CONNECTIONS.md) and [platform](PLAN-DRY-PLATFORM.md) refactors are the current baseline.

**Execution boundary:** only this document changes. No implementation, tests, builds, application execution, browser/network requests, service startup, database mutation, scan, purge, staging, commit or deployment occurs in this review. Findings below have source-supported paths; none was reproduced at runtime during this audit. Severity describes the proposed review priority, not a measured incident frequency.

## 0. Executor handoff

This document is ready for a later authorized implementation of **R1–R11 only**, including the narrow document-work migration/recovery mechanism specified in §8.3. Other tasks in the earlier DRY/efficiency plan are references and remain outside scope. Its A2 transport redesign is explicitly deferred; R6 uses a hard worker budget, not a new Clamd protocol implementation. The audit-only boundary above describes the current planning phase and does not prohibit tests or implementation after the user authorizes that later phase.

1. Inspect current HEAD, working changes and applicable instructions. Preserve unrelated work. Verify source assumptions against this `230708c` baseline; do not reset the checkout.
2. Read the selected decisions in §8 before assigning workers. They resolve the alternatives in the earlier finding descriptions. Record any source drift requiring a revised decision and have the explorer check it before dependent edits.
3. Assign exclusive ownership using §5 and the concrete file groups in §8. R6's document-work contract/migration must be handed off before R4/R5 integrate dispatch; R1 must be handed off before R10/R11 adopt identity proof.
4. Add failing behavioral regressions, then implement the assigned repair. Preserve the listed contracts and exclusions. An unreproduced counterexample must be corrected or withdrawn in the plan rather than forcing a fix through.
5. Run the focused checks in §9. Each worker reports files changed, reproduced behavior, chosen design, commands/results, and remaining limitations to the main agent.
6. After all workers release their files, dispatch an independent explorer to review the combined implementation in context. Repair findings and rerun affected checks.
7. Run full static/unit suites and the isolated PostgreSQL/browser acceptance lanes in §9. Record fresh results, skips and environment limits; do not reuse historical pass counts.
8. Update this document with completion/evidence and stop only task-created services. Leave staging, commit, deployment and real-user cleanup outside scope.

## 1. Prioritized findings

| ID | Priority | Finding | Evidence and proposed scope |
| --- | --- | --- | --- |
| R1 | P1 | Private caches can survive expired-session relogin across users | Auth/profile reset is partial; characterize with real-store A→expiry→B fixtures, then centralize identity-boundary quarantine/reset |
| R2 | P1 | Delayed essay conflict can replace newer local typing | Clean-adopt uses sent HTML rather than live HTML; repair the acknowledgement decision within the essay hook |
| R3 | P1 | Username mutation uses stale state and non-atomic history writes | Fresh locked user, atomic rename/history and narrowly mapped unique-race validation |
| R4 | P2 | Coach-document upload ignores failed persistence | Check writes before metadata/jobs; characterize batch failure and compensate only owned paths |
| R5 | P2 | Coach creation, upload admission and decisions can race | Serialize active operations with fresh state; establish lock order before changing transactions |
| R6 | P1 retention/reliability | Failed infected-document cleanup becomes terminal | Durable negative verdict plus retryable explicit-path cleanup; bytes currently remain private |
| R7 | P2 | Partial poster replacement can remove a healthy primary | Publish a replacement poster set only when its designated primary survived; keep sprite semantics separate |
| R8 | P2, small | Essay word counts discard literal `0` tokens | Reuse a narrow plain-text counter after a zero-token regression; retain distinct projections |
| R9 | P2 | Old username-availability replies can leave current input checking forever | Fence obsolete promise callbacks while preserving debounce and fallback submission |
| R10 | P2 | Export links lack current-row attribution, renewal and read-error recovery | Current-argument URL state, bounded freshness and retry; preserve plain-anchor downloads |
| R11 | P2, small | Profile read failures render endless Loading | Distinguish pending, settled failure and missing required data; accessible retry |

The strongest new DRY boundaries are identity-aware private-cache lifecycle handling and whitespace word counting. Other findings call for focused repairs, not generic async hooks, state-machine mergers or transaction engines. Query/bundle/input-copy optimizations already have separate tasks in the earlier follow-up plan and are not duplicated here.

## 2. Frontend privacy and data integrity

### R1. Quarantine private API data at authoritative identity boundaries

**Source path:** [UnauthenticatedRedirect:107](web/src/components/auth/UnauthenticatedRedirect.tsx#L107) resets auth/profile only, then performs SPA navigation. Ordinary [Login:41](web/src/routes/Login.tsx#L41) also navigates without a page reload. [store:20](web/src/app/store.ts#L20) registers additional private speech/review/notification/essay/caption/transcript/privacy/coach caches. Existing connection and commentary middleware reset only their own bounded domains. [privacyApi:37](web/src/features/privacy/privacyApi.ts#L37) keys the export list by `void`; [useExportJob:26](web/src/hooks/useExportJob.ts#L26) can consume cached terminal rows without polling; [ExportSection:35](web/src/components/account/ExportSection.tsx#L35) consumes cached per-export signed URLs.

**Counterexample to reproduce:** A opens Account and resolves a ready export URL. A protected request returns 401 after session expiry. B logs in through the same SPA before cache eviction and opens Account. A's export row and still-valid signed URL can render from the untouched privacy cache, bypassing a fresh backend ownership check. This concerns client-side cache adoption; the backend download route still checks ownership. Normal explicit logout's hard navigation is a different path.

**Selected change:** use the general identity proof, request fencing and hard document boundary in §8.1, without merging API slices. Account for all registered private caches and transient/persisted domain state. Keep private rendering gated until data belongs to the authoritative current viewer. Old successes, failures and mutation callbacks must not repopulate/adopt A's state after B is established; aborting alone is not proof that an old write did not commit. General authenticated identity is distinct from Friends eligibility: connectionSession's eligibility excludes administrative roles/missing usernames, which must not make an authenticated admin or incomplete-onboarding user anonymous to the rest of the platform.

Do not reset every slice on every DOM 401. Preserve anonymous `/me` probes, public routes, guest-loop prevention, Friends' late-A-401 protection, retryable `/me` failures and commentary identity fencing. Do not erase user drafts/localStorage as cache cleanup; preserve their existing account/scope partitioning. Audit successful login, expiry, explicit logout and cross-tab changes separately before selecting the exact lifecycle owner.

**Acceptance:** existing [UnauthenticatedRedirect tests](web/src/components/auth/UnauthenticatedRedirect.test.tsx), [Login tests](web/src/routes/Login.test.tsx), [connectionSession tests](web/src/features/connection/connectionSession.test.ts), [commentaryPreferenceSession tests](web/src/features/annotation/commentaryPreferenceSession.test.ts) and [ExportSection tests](web/src/components/account/ExportSection.test.tsx). Add a real configured-store test with mocked HTTP for A→expiry→B, private list/detail caches, signed URLs, pending A successes/rejections/401s after B, same-user revalidation, admin/incomplete-onboarding identities, 5xx identity uncertainty and guest/public navigation. Prove no A data flashes and no current-B cache is cleared by an obsolete event. Later add an isolated browser relogin case. This is broader than adding reset calls to the current component and warrants its own integration review.

### R2. Preserve new typing when an earlier essay save conflicts

**Evidence:** [useEssayEditor:98](web/src/hooks/useEssayEditor.ts#L98) captures sent `currentHtml`; [line 128](web/src/hooks/useEssayEditor.ts#L128) compares that sent text with `savedSnapshotRef` to decide clean adoption, then line 135 replaces live text. The current [clean-adopt test:188](web/src/hooks/useEssayEditor.test.tsx#L188) resolves immediately and does not cover edits during the request.

**Counterexample:** initial saved text A; `setHtml(A)` schedules a PUT, as in the existing test. While it is pending, the user types B. Its delayed 409 returns server text C. Sent A still equals the saved snapshot, so the clean-adopt branch replaces newer B with C.

**Proposed change:** decide adoption using current live content/revision and the response's request context at acknowledgement. Preserve newer local edits and show the existing conflict actions when appropriate. Keep genuinely clean silent adoption, Keep mine, Use theirs, lock-version handling, 410 behavior and cache invalidation. Stay inside the essay hook; do not import the annotation save-certainty rule or merge autosave engines.

**Acceptance:** extend that hook suite and [EssayEditorPanel tests](web/src/components/essay/EssayEditorPanel.test.tsx); retain [essay browser tests](web/tests/essay-editor.spec.ts). Use controlled promises for a delayed 409 after newer typing, edit-back-to-baseline, unchanged clean adoption, explicit conflict resolution and a later stale response. Separately characterize overlapping saves and unmount flushes before proposing a single-flight redesign; the absence of a guard is not by itself proof of every possible data-loss scenario.

### R9. Ignore obsolete username-availability responses

**Evidence:** [useUsernameAvailability:47](web/src/hooks/useUsernameAvailability.ts#L47) allows every old success/failure to replace one stored result. At lines 63–65, a result for A while input is B derives `checking`; no dependency changes to restart B. Clearing the debounce timer at cleanup does not cancel a request already started.

**Counterexample:** request A starts, then B starts and resolves; A resolves last. B's completed result is replaced with A, leaving unchanged input B checking indefinitely.

**Proposed change:** use an effect/request generation or equivalent current-input fence for both promise branches; optionally abort obsolete transport as an optimization. Preserve 400 ms debounce, malformed-input skip, `unknown` on current-request error and server-authoritative submit validation. A→B→A needs request identity, not just comparing username text. Do not create a generic debounce/request hook for this one repair.

**Acceptance:** add a proposed dedicated hook test (none exists today) with controlled promises, both response orders, obsolete rejection, A→B→A, invalid input and unmount. Retain [Onboarding tests](web/src/routes/Onboarding.test.tsx). Unsubscription from a lazy query does not establish that its attached promise callback is suppressed; test the actual callback contract.

### R10. Attribute and renew export links, and recover read errors

**Evidence:** [ExportSection:35](web/src/components/account/ExportSection.tsx#L35) reads `data`, which may retain the prior argument's URL while a new export ID loads. Lines 64–74 can render that URL without current-row attribution. Errors/retry are omitted. The [download endpoint:60](api/app/Http/Controllers/Api/PrivacyExportController.php#L60) verifies owner/status/export retention and signs a ten-minute URL; the mounted frontend query has no renewal policy.

**Selected change:** render only current-export/current-viewer URL data, with the nine-minute manual-renewal policy in §8.4 and recoverable URL-resolution failures. Keep the plain-anchor download contract and distinguish signature lifetime from the export row's `expires_at`. Test with a clock; do not assume refetch-on-focus alone guarantees freshness for a continuously focused page. Remove/suppress stale hrefs while renewal fails.

Do not route exported bytes through the app, remove backend 403/410 checks, generalize media refresh engines, or automatically navigate to stale URLs. R1's authoritative viewer boundary must apply before this URL is rendered. Backend URL resolution writes an audit event; consider that when choosing renewal frequency rather than polling needlessly.

**Acceptance:** extend [ExportSection tests](web/src/components/account/ExportSection.test.tsx), [useExportJob tests](web/src/hooks/useExportJob.test.tsx) and, if needed, [DataExportHttpTest](api/tests/Feature/Privacy/DataExportHttpTest.php). Cover a delayed new-export URL, old success/rejection, current fetch error/retry, signature age/renewal, export-retention 410 and viewer transitions. Mock HTTP/time rather than downloading actual personal data. This is a correctness/freshness task, not proof of live S3 behavior.

### R11. Render settled profile read failures distinctly

**Evidence:** [ProfileEdit:43](web/src/routes/ProfileEdit.tsx#L43) only takes loading/data from its identity/profile queries. After `/me` succeeds, its dependent public-profile GET can settle with 404, 500 or network failure; at [line 125](web/src/routes/ProfileEdit.tsx#L125), absent profile data still returns Loading. An initial `/me` non-401 failure is intercepted by the outer [RequireAuth guard](web/src/components/auth/AuthShell.tsx#L23) before this page renders; improving that separate auth-error presentation is outside R11.

**Proposed change:** once current identity is established, distinguish pending profile data, a settled profile-read failure and missing required profile/username data. Expose an accessible failure/retry state while keeping existing independent form, avatar and username errors. Never present stale data from a different username or session. Preserve the outer auth guard and existing onboarding routing decisions; do not treat every missing username as a network failure or build a new shared loading framework.

**Acceptance:** extend [ProfileEdit tests](web/src/routes/ProfileEdit.test.tsx) for initial read failure, retry recovery, missing username, profile 404 and identity/username transitions. Retain form reset/save and mutation error behavior. Coordinate R1's private-data gate.

## 3. Backend atomicity and admission

### R3. Lock fresh username state and commit history atomically

**Evidence:** [UsernameService:23](api/app/Services/UsernameService.php#L23) checks no-op/cooldown on the passed model, queries occupancy/history, inserts history at line 78, then saves without a transaction/lock at line 87. Its comment at lines 40–42 overstates race protection.

**Counterexamples:** two snapshots from an account with no username can claim A then B while both think this is the first claim, bypassing cooldown/history. Two users can pass the same-name availability query before the unique constraint rejects one with an unhandled database exception. A save failure after history insertion leaves history for a rename that did not happen.

**Proposed change:** inside a focused transaction, fetch/lock the fresh user before no-op/cooldown/availability/history decisions. Commit history and rename together. Map only the expected username uniqueness race to the existing username validation response after rollback; propagate unrelated database failures. Preserve canonical normalization, permanent history ownership, error messages and same-name no-op.

Audit callers' returned-model behavior: [ProfileController:59](api/app/Http/Controllers/Api/ProfileController.php#L59) uses the return, while [OnboardingController:35](api/app/Http/Controllers/Api/OnboardingController.php#L35) ignores it and subsequently saves names before refreshing. If the service switches to a fresh model, keep that sequence correct without broad unrelated writes. Do not assume a different per-user lock alone prevents two different users claiming the same name; the unique constraint still arbitrates that race.

**Acceptance:** [UsernameHistoryTest](api/tests/Feature/Identity/UsernameHistoryTest.php), [UsernameNormalizationTest](api/tests/Feature/Identity/UsernameNormalizationTest.php) and onboarding tests. Add stale-snapshot no-op/first-claim/cooldown cases, rollback after save failure, history integrity and controller response cases. Later use independent PostgreSQL connections for competing same-user changes and different-user same-name claims; require correct success/validation outcomes, no false history and no generic 500. SQLite sequential tests cannot establish lock/race behavior.

### R4. Require successful document storage before publishing scan work

**Evidence:** [CoachApplicationController:138](api/app/Http/Controllers/Api/CoachApplicationController.php#L138) ignores `put()` at line 141, then inserts `pending_scan`, dispatches a job and returns 201. The application-documents disk uses `throw => false`. [ScanApplicationDocument:50](api/app/Jobs/ScanApplicationDocument.php#L50) returns on missing storage, leaving the row pending. Current per-file validation/writes also allow the first file to persist before a second fails validation.

**Selected change:** characterize false/throw writes and second-file failure, then implement all-or-nothing metadata admission for one request as specified in §8.2. This intentionally corrects existing partial-success behavior. Prevalidate the full batch before storage side effects, stage writes outside the transaction, and dispatch scans after commit. Storage is outside database rollback: compensate only exact paths created by this attempt that were not committed as document references, and report failed compensation. Distinguish rollback/admission failure from an after-commit enqueue exception: preserve committed pending rows/objects, return committed-admission success, and recover scan work through §8.3. Never delete every attempt path merely because `DB::transaction` threw. Do not hide remote I/O inside a retryable closure.

Keep ownership 404, allowed statuses, PDF magic/page/size/hash validation, randomized paths and private disk. Do not reuse a broad upload/cleanup abstraction. Update the scan job's current comment claiming its caller already uses a transaction, so documentation matches the final flow.

**Acceptance:** extend [CoachApplicationHttpTest](api/tests/Feature/CoachApplication/CoachApplicationHttpTest.php) with false/throw storage, second-file validation/write failure, database admission failure, compensation failure and no row/job pointing to a failed write. Include an after-commit enqueue failure: committed rows/bytes survive and their scan work can be recovered without duplicated documents. Assert batch response and retry semantics explicitly. Use fake storage/queue and owned disposable fixture paths only. Retain successful upload/count/ownership tests. This worker must coordinate R5 rather than add conflicting transaction boundaries.

### R5. Serialize active coach-application creation, admission and decisions

**Evidence:** [store:53](api/app/Http/Controllers/Api/CoachApplicationController.php#L53) locks an existing application query, but an empty result does not serialize first creation; the live-application unique index still rejects a racing insert. [uploadDocuments:117](api/app/Http/Controllers/Api/CoachApplicationController.php#L117) checks status/count without a parent transaction/lock. [CoachApplicationDecisionService:26](api/app/Services/CoachApplicationDecisionService.php#L26) transitions the passed, potentially stale application; [model:69](api/app/Models/CoachApplication.php#L69) checks its in-memory status. Active [Filament actions:183](api/app/Filament/Resources/CoachApplicationResource.php#L183) authorize and call that service.

**Counterexamples:** concurrent first requests both observe no application; concurrent uploads pass the same two-document budget; stale approve/reject models can both pass transition guards, leaving contradictory final status/role/audit effects. A parent lock only in upload does not protect against unlocked decision writers.

**Proposed change:** use a stable existing applicant/user serialization point for absent-row creation, fresh application locking/rechecks for active admission and decisions, and the same boundary at every active conflicting writer. Preserve draft creation followed by second-call submission, rejected-row reuse, terminal 409s, owner 404 and all Gate/service role checks. Define duplicate decision outcomes explicitly; stale model snapshots cannot authorize a second terminal transition.

**Selected lock order:** use the operation-specific order in §8.2, verified against [RoleAssignmentService:107](api/app/Services/RoleAssignmentService.php#L107), moderation and erasure paths during the design pass. Recheck source drift before implementation; do not merely wrap today's calls in another transaction. Keep role assignment and application/audit decisions atomic, notifications after the outermost successful commit, and external document writes outside retryable sections with explicit compensation. Model `beginReview`/`withdraw` currently have no active application callers; do not add routes or redesign unused transitions.

**Acceptance:** coach HTTP tests, [PanelModerationTest](api/tests/Feature/Admin/PanelModerationTest.php) and existing role-service tests. Add deterministic stale-model decision cases and later isolated PostgreSQL competing first-create/upload/decision cases. Prove the document cap, final status, expected single winning decision, corresponding role/audit/notification effects and no unhandled expected unique race. Exercise rollback and lock ordering. One owner should handle R4/R5; a small named application-operation helper is optional only after the shared fresh-state boundary is established.

## 4. Jobs, media and shared plain-text rules

### R6. Make an infected verdict durable and its cleanup retryable

**Evidence:** [ScanApplicationDocument:68](api/app/Jobs/ScanApplicationDocument.php#L68) ignores a false delete, then stamps infected. Entry at lines 44–47 skips infected rows on redelivery; [retention command:43](api/app/Console/Commands/PurgeExpiredApplicationDocumentsCommand.php#L43) excludes them. Failed deletion leaves bytes without retry through those paths. [ApplicationDocumentDownloadController:35](api/app/Http/Controllers/ApplicationDocumentDownloadController.php#L35) permits only clean rows, so this is retention/cleanup failure, not demonstrated download exposure.

**Proposed change:** first persist the negative verdict durably, then perform checked exact-path cleanup with a bounded retry/recovery path. An infected-row redelivery must clean only, never rescan or adopt a later clean completion. Preserve audit row/hash, missing-object success and download denial. An already-cleared empty path is terminal cleanup success and must never be passed to filesystem deletion. Reuse [StorageObjectRemover](api/app/Services/StorageObjectRemover.php) only as an explicit-path primitive for nonempty owned paths, not as a claim/status policy. Account for false and thrown deletes, failure after verdict persistence and duplicate worker deliveries. Define terminal failure reporting and retained cleanup evidence; do not leave a new dispatch failure as the sole recovery path.

**Selected budget:** the current timeout is 120 against a default Redis reservation of 90. Change this job to 60 seconds, use a 75-second work lease, and require an effective consumer reservation of at least 90 seconds with working process timeout support (§8.3). No live environment values were inspected. This bounds worker execution, not the existing in-process Clamd transport loops. Earlier A2 remains deferred; do not claim a total transport deadline or change unrelated queue lanes.

**Acceptance:** extend [ScanApplicationDocumentTest](api/tests/Feature/CoachApplication/ScanApplicationDocumentTest.php) for false/throw/missing deletes, durable infected redelivery, bounded retry, dispatch/terminal failure and stale clean completion. Confirm infected rows never become downloadable. If the retention command changes, add a proposed dedicated command test; none currently covers this command. Fake scanner/storage tests establish lifecycle behavior, not Clamd protocol correctness. No real infected uploads or user-storage purges are part of implementation validation.

### R7. Preserve a working primary when poster replacement is incomplete

**Evidence:** [FfmpegTranscoder:407](api/app/Services/Transcoding/FfmpegTranscoder.php#L407) marks only the designated 640 WebP primary. Individual generation/probe/storage failures drop variants at lines 390–397 and 470–475. Any surviving poster still causes the old poster set to be deleted at lines 499/516–519, even when all replacements are nonprimary. [SpeechResource:38](api/app/Http/Resources/SpeechResource.php#L38) then finds no primary and omits poster output.

**Proposed change:** characterize initial derivation versus replacing an existing healthy set; require the designated replacement primary to survive before publishing a replacement poster set. Preserve the old set when that condition fails. Keep an already-successful sprite's replacement independent, initial video success independent of poster failure, unique-primary transaction behavior and scratch ownership. Do not add sprite generation to early-return paths that currently skip it, or invent another primary format/width.

Paths currently depend on speech/frame/width rather than an attempt UUID. Preserving database rows alone is not a promise of byte-atomic rollback for same-frame writes. Test distinct-frame and same-frame behavior, avoid deleting colliding pre-existing paths, and do not claim complete object rollback. If immutable generation keys are needed for a broader guarantee, scope that separately with ownership/publication evidence. No orphan-storage sweep or remote-data cleanup is implied by this task.

**Acceptance:** extend [FfmpegTranscoderTest](api/tests/Feature/Speech/FfmpegTranscoderTest.php) for primary-only generation/probe/upload failure with secondary variants succeeding. Assert existing primary/API poster survival, all-success replacement, sprite behavior, initial no-poster behavior and scratch cleanup. Failed scratch allocation/Process exceptions remain distinct from best-effort variant failures. Tests should inspect the intended failure path, not merely the final ready-video flag.

### R8. Count literal zero words consistently

**Evidence:** [EssayService:119](api/app/Services/EssayService.php#L119) uses callback-less `array_filter(preg_split(...))`, discarding a standalone `0`. [TranscriptDeriver:48](api/app/Services/Captions/TranscriptDeriver.php#L48) already documents and fixes that exact falsey-token defect by rejecting only empty strings.

**Proposed change:** add essay regressions, then retain zero tokens. A narrow shared plain-text whitespace counter can prevent recurrence across the two services. Keep HTML sanitization/block spacing at EssayService and cue/segment/whitespace/WPM logic at TranscriptDeriver. Do not feed HTML into the helper or merge projections. Preserve each caller's current invalid-input/fallback handling unless a separately demonstrated correction is needed. This is small DRY work with a concrete correctness reason, not a performance claim.

**Acceptance:** [EssayHttpTest](api/tests/Feature/Essay/EssayHttpTest.php), [TranscriptDeriverTest](api/tests/Unit/Captions/TranscriptDeriverTest.php) and proposed focused helper coverage. Assert `<p>we scored 0 goals</p>` counts four, zero-only counts one, empty text counts zero, and Unicode whitespace is handled consistently. Retain the 30,000-word round trip, sanitization/block boundaries and transcript zero/WPM regressions. Do not rewrite existing stored counts in a data migration during this refactor.

## 5. Segmentation after explicit implementation authorization

| Wave / owner | Tasks and exclusive files | Exit gate / coordination |
| --- | --- | --- |
| 0, frontend identity owner | R1; identity middleware/store/cache registry plus integration tests | Prove account isolation and late-response protection before adopting R10/R11 changes; no API-slice merger |
| 0, essay editor owner | R2; useEssayEditor and panel/hook tests | Deferred-409 regression and preserved conflict actions; leave broader serialization conditional |
| 0, backend identity owner | R3; UsernameService, identity tests and caller adjustments | Fresh-state/rollback tests, then isolated PostgreSQL race evidence |
| 1, coach application owner | R4/R5; controller, decision service, application/role integration tests | One owner for overlapping transaction changes; lock-order map and side-effect/compensation contract first |
| 1, scanner lifecycle owner | R6; scan job/cleanup and tests | Coordinate committed upload dispatch with R4; coordinate deadlines with previous A2; durable negative verdict before cleanup |
| 1, poster owner | R7; FfmpegTranscoder and tests | Exclusive ownership separate from earlier plan's voice adapters; verify partial replacement and path semantics |
| 1, text rule owner | R8; EssayService/TranscriptDeriver/helper and tests | Keep frontend essay ownership separate; no broader backend projection changes |
| 2, frontend forms owner | R9/R11; availability hook, ProfileEdit and tests | R11 adopts R1's authoritative identity boundary; preserve onboarding and independent form state |
| 2, export UI owner | R10; ExportSection/privacy query behavior and tests | R1 handoff for shared privacy fixture and current-viewer proof; bounded URL renewal |
| Integration, independent explorer | Whole selected implementation plus earlier plan tasks actually selected | Review identity, async outcomes, locks, notifications, storage publication, retries and contract changes together; repair findings before final checks |

These are ownership groups, not a demand to run every task in parallel. R4/R5 share a controller; R1/R10 share privacy integration fixtures; R1/R11 share identity assumptions. The earlier follow-up's D2 export projection, D3 speech metadata, E3 voice copying and other tasks remain separate. Avoid two owners editing one file, and do not run both plans as an undifferentiated refactor sweep.

## 6. Validation for later implementation

- Add meaningful failing regression/characterization cases before behavior repairs. The source evidence here is not a fresh test result, syntax check or platform-functionality claim.
- Backend: focused Pest first with explicit SQLite memory settings, then full Pest with sufficient PHP memory, Pint `--test` and configured PHPStan. Existing package scripts/paths must be rechecked when work begins. Use disposable isolated PostgreSQL connections for R3/R5 locks/races; SQLite cannot prove them. Include visibility/ownership/status matrices and required rollback/side-effect assertions.
- Frontend: focused Vitest with controlled promises/timers and real-store mocked HTTP where indicated; then full Vitest, typecheck, ESLint and production build. Fake-hook tests alone cannot prove cache partitioning. Keep guest, stale-identity, conflict and cache-invalidation regressions.
- Browser: isolated fixtures/config for relogin, essay typing/conflict, profile recovery and export-link attribution. Inspect setup/reset/seed side effects before use. Execute nonzero cases, record skips/flakiness, and distinguish mocked recorder/local media from real hardware/S3/queue behavior.
- Storage/media: fake storage/Process/scanner tests prove branch and lifecycle behavior. Real binaries/models/Clamd/S3 are separate opt-in evidence, using only named disposable targets and available dependencies. No model download, deployment, user scan, broad purge or development-data reset is authorized by these plans.
- Report fresh passes/skips and every untested boundary. Preserve the developer stack and unrelated work; stop only task-created services. No staging/commit or broad formatting sweep is implied.

Readability acceptance is part of each repair: replace misleading claims in UsernameService and ScanApplicationDocument comments, name live/request/committed state distinctly, and keep ownership, failure codes and side effects visible at callers. Shared helpers must remove one actual duplicated rule without concealing differing contracts. No generic state engine, global authorization helper, storage sweep, queue redesign or mass comment rewrite is proposed.

## 7. Independent plan-review record

An independent explorer validated all eleven findings and their proposals against current source, with separate frontend and media/jobs subreviews. Reports returned to the main agent, which checked the relevant code and incorporated these corrections:

| Review finding | Correction incorporated |
| --- | --- |
| A transaction can throw from an enqueue callback after metadata has already committed | R4 separates rollback compensation from post-commit dispatch failure; committed rows/objects survive and scan requeue/recovery must be tested |
| Friends eligibility excludes some valid authenticated identities | R1 requires general authenticated identity and adds admin/incomplete-onboarding tests, preserving Friends-specific gates |
| The outer auth guard handles initial `/me` failure before ProfileEdit can render | R11 is limited to dependent profile-read failure after identity succeeds; separate auth-error UX is excluded |
| Sprite independence could be read as expanding generation on existing early-return paths | R7 explicitly preserves the all-posters-failed early return and only separates an already-successful sprite replacement |
| Cleared document paths must not reach a deletion primitive | R6 treats empty paths as terminal cleanup success and requires nonempty owned paths |

The final independent report found no blocking false positive or remaining plan error. It confirmed the source-supported paths, focused repair boundaries, task ownership and validation gaps. Relative links/line bounds and document whitespace were checked. No application check was run, so the report does not establish runtime reproduction, passing regressions, measured efficiency gains or current platform functionality.

The pre-existing DRY/efficiency follow-up document remains unchanged. Only this review/plan document is added; all implementation and application validation remain unexecuted.

## 8. Selected implementation decisions

These decisions close the design gates identified during the execution-readiness review. Future workers implement them rather than choosing between the earlier alternatives. Proposed new modules below are design targets, not existing files.

### 8.1. R1: general identity proof plus a hard document boundary

Use a fresh document whenever authenticated identity changes. Successful login must use `window.location.replace` for ordinary destinations as well as the existing external admin continuation; successful registration replaces `/verify`. Existing explicit logout already uses a hard navigation. This avoids expanding all endpoint cache keys and prevents A's old Redux store/promises from becoming B's store. Quarantine and request fencing are still required before navigation.

**Ownership and wiring:** the identity worker owns proposed `web/src/features/auth/authSession.ts` (dependency-light reducer/actions/selectors), a middleware factory, store composition, AuthShell/private header gates, UnauthenticatedRedirect, Login/Register/LogoutButton, baseQuery and the existing connection/commentary session adapters. Also own the generation guard around the essay hook's raw pagehide fetch; hand that file to/from the R2 owner explicitly. `authSession` holds generation, status, accepted user and current probe/auth-attempt request identity. It imports no API slices/store. Store composition injects auth matchers and the registered API tuple into middleware placed before domain/API middleware. Registry: profile, speech, review, notification, annotation, essay, caption, transcript, report, privacy, coachApplication and connection; auth is managed separately. Friends eligibility is derived from accepted identity, never its authority.

| Event | Required action |
| --- | --- |
| Initial document `/me` | Accept only the latest current-generation probe; bind this document to that user ID. Admin, roleless and missing-username users remain valid identities |
| Current login/register/logout starts | Advance auth-attempt generation; quarantine private rendering/writes; exclude probes started before/during that changing-cookie operation |
| Current login/register succeeds | Hard replace the selected safe destination; do not publish the new account as ready in the old document |
| Auth attempt fails | Keep form error and make one fresh probe after the attempt settles; a network/5xx failure does not establish anonymous identity |
| Current private request returns 401 | Quarantine and coalesce one fresh `/me`; the request's 401 alone does not prove logout |
| Fresh probe confirms anonymous | Protected route: hard replace login. Previously authenticated public route: reload the safe public path once. An initially anonymous document's expected 401 never causes a reload loop |
| Fresh probe returns another user ID | Hard reload the current safe route; do not expose the new identity to old private state |
| Fresh probe returns the same ID | Resume accepted proof without resetting every domain merely for revalidation |
| Stale probe/private response/logout completion | Cannot change identity, navigate, replay a write or clear current state |
| Current logout succeeds or confirms already logged out | Preserve hard navigation to login; ordinary logout errors stay errors |
| Cross-tab success or focus/visibility restoration | Broadcast only a nonce/change signal after current login/register/logout success (BroadcastChannel, storage-event fallback). Receivers quarantine and probe; restoration probes catch changes outside that path |
| Page leaves / BFCache restores a prior document | Synchronously hide private UI on pagehide; on persisted pageshow advance generation, quarantine and force fresh proof before resuming. Different/anonymous identity follows the hard-navigation rules |

**Transport rules:** default API operations to private; mark only code-owned public/auth-control exceptions explicitly. `/me` is a probe; login/register/logout are auth controls; public-profile/availability and forgot/reset-password requests retain their public behavior. Auth-control exceptions are not a general bypass for missing session state. Capture generation/viewer at private request start; check proof before transport, after CSRF awaits and before any 419 replay. Obsolete responses return a session-change error, not successful old data or an unqualified 401 broadcast. Qualify/replace the current DOM event with generation context. Apply the same owner/generation check to raw essay pagehide/unmount writes. Already-sent writes may have committed; preserve existing uncertain-outcome recovery. Suppress playback/private header content while quarantined; do not clear account-scoped saved drafts/localStorage.

Pagehide UI hiding must not itself invalidate a legitimate same-user exit flush: keep the current owner/generation available to the guarded essay beacon until that exit submission is captured. An auth-changing operation has already invalidated such writes and must suppress them. On BFCache restoration, the prior proof is unusable until a fresh probe settles; hiding must take effect before a restored private frame can appear. Include Back/Forward restoration in unit/browser acceptance and report whether the browser actually exercised BFCache.

**Return path:** `getPostLoginDestination` currently returns `from` verbatim ([roles.ts:218](web/src/lib/roles.ts#L218)); it is not a sanitizer. Validate an internal same-origin pathname before hard navigation, rejecting scheme-relative/external paths, backslashes/control characters and auth/guest loops. Persist only that validated pathname in one sessionStorage key when expiry requires login, consume it once, and fall back to the normal dashboard/onboarding destination if unavailable. Retain existing destination precedence/admin continuation. No draft content or credentials enter the key/channel.

**Handoff evidence:** real-store tests must cover the entire event matrix, registration, late 401/success/CSRF callbacks, admin/incomplete identities, failed proof and guarded raw editor writes. Browser evidence must observe an actual new document after relogin. Existing unit fixtures must supply accepted identity where needed; do not add a production bypass to keep old fixtures passing.

### 8.2. R4/R5: atomic admission and a fixed lock order

Introduce proposed `api/app/Services/CoachApplicationSubmissionService.php` for named `saveOrSubmit` and `addDocuments` operations. Controllers retain HTTP validation/envelopes; decisions stay in CoachApplicationDecisionService. No generic transaction/state engine.

| Operation | Lock order |
| --- | --- |
| Save/submit application | Fresh applicant user → latest application |
| Admit staged documents | Fresh applicant user → addressed application → new document rows |
| Approve/reject | `admin_roster` → fresh applicant user → addressed application → existing role/audit writes |
| Document work/recovery | Document row only; never subsequently acquire application/user/roster locks |

This order agrees with current roster-first role/moderation writes and user→review erasure, which does not subsequently acquire the roster. After obtaining the roster, read the actor again with fresh roles, without adding an actor-row lock. Reauthorize existing `role.assign` against the locked applicant before a decision or duplicate success; preserve role allowlists and approval's self-assignment 422. Nested acquisition of the same transaction-level advisory lock is safe.

**Store contract stays two-step:** no application creates draft; draft/rejected submits that row; submitted/under_review retains statement-update behavior; approved/withdrawn returns 409. Two competing first POSTs therefore yield one draft response followed by one submitted response on the same ID. Do not promise two draft no-ops or add a new request/idempotency contract.

**Decision contract:** submitted/under_review has one terminal winner. Repeating that same terminal decision is a no-op retaining its first reason/time, with no duplicate role mutation/audit/notification. An opposite decision, draft or withdrawn returns controlled 409. Reapplication from rejected remains supported. Register a winner-only notification at the outermost `DB::afterCommit`; rollback/repeat produces none. Own both coach decision notification classes: capture immutable application ID/reason, preserve wire keys and the approved notification's current-notifiable username URL. A notification enqueue failure logs committed decision/audit identity for targeted replay; never rerun role/decision effects or promise exactly-once email delivery.

**Upload contract:** preflight ownership/status/count, validate every PDF/hash before writes, then stage fresh UUID paths outside transactions. Under user→application locks, recheck admission and insert all metadata together. Register `ApplicationDocumentWork::ensureQueued(id)` after commit for each document. Use the one R6 work protocol below, not another outbox/dispatcher.

| Failure point | Chosen outcome |
| --- | --- |
| Any batch validation fails | 422; no files/rows/jobs |
| Storage returns false | Controlled 503; no admitted rows/jobs; compensate only exact uncommitted attempt paths |
| Storage throws | Compensate proved-uncommitted owned paths, then propagate/report the exception |
| Locked status/count/ownership fails | Existing 404/409/422; roll back all metadata and compensate uncommitted paths |
| Database fails before commit | Roll back; compensate paths proved unreferenced |
| Commit outcome is uncertain | Preserve bytes until a fresh database check can prove absence of a committed reference |
| Enqueue fails after commit or process dies before callback | Preserve committed rows/bytes; log; normal 201 means metadata admitted, and scheduled document-work recovery queues scanning |

Return the committed admission snapshot, with new documents pending scan. Post-commit enqueue exceptions must not escape into rollback compensation. Failed compensation is logged with the exact owned target. This design does not claim crash-safe automatic reclamation of unrecorded objects staged before admission; no storage sweep is added. Required extra regressions: outer-transaction rollback suppresses notices, fresh actor demotion during lock wait, same/opposite duplicate decisions and exact winning audit/role effects.

### 8.3. R6: one durable document-work protocol

The R6 owner supplies proposed `api/app/Services/ApplicationDocumentWork.php`, the scan job changes, one additive application-document migration/model casts, a recovery command/schedule and tests. R4/R5 call its `ensureQueued(int $documentId)` only after commit. Hand off this interface/schema before those workers integrate dispatch.

Add five work fields without changing the status enum: nullable UUID `work_claim_id`; nullable timestamps `work_lease_until`, `work_next_attempt_at`, `work_dispatched_at`; integer `work_attempts` default 0. Existing `pending_scan` and `infected` rows are durable work intent. Null scheduling fields mean not yet scheduled/due; eligible legacy rows can be initialized through the same protocol. No live migration, historical scan or cleanup runs in this design pass or its fake-fixture validation.

**Enqueue:** lock the document; recheck eligible status, nonempty owned path, attempt budget, due time and no active lease. Record the wake-up attempt time in `work_dispatched_at`; enqueue outside the transaction. That timestamp means an enqueue attempt, not guaranteed broker receipt. Throttle wakeups to five minutes. Do not increment attempts or acquire worker leases during enqueue. Log push failures and leave durable intent/dispatch timestamp for a later retry; don't overwrite newer worker state. Payload carries document ID only, never an expiring queued token.

**Claim/work/finalize:**

1. A delivery freshly locks/checks the row. Missing/clean/exhausted/not-due/actively leased rows do no work. Any empty path skips filesystem access: infected means cleanup already complete; pending_scan remains pending without inventing a clean verdict, including a delivery after retention cleared its path.
2. On actual work start, generate a claim UUID, increment this phase's attempts and set a 75-second lease. Capture phase/disk/path/hash. External scan/delete happens outside transactions; finalization compares token, phase and unchanged storage identity.
3. A clean scan marks clean only through that comparison. A negative scan commits infected first, clears the scan claim/lease, resets attempts to 0 for cleanup, sets next-attempt due now and clears the old dispatch timestamp. After commit request a cleanup wakeup; its failure cannot undo infected status.
4. An infected delivery never scans. Check/delete only its persisted nonempty owned path; missing is success. Successful finalization clears path to `''`, preserving infected status/hash/audit. False/throw deletes retain the path and trigger retry handling. Retention/path changes invalidate stale finalization; a stale clean result cannot overwrite infected or restore a path.

The separate cleanup delivery is an intentional lifecycle correction: negative verdict durability precedes byte cleanup. No immediate-cleanup SLA is claimed under queue backlog. Queued duplicates/backlog spend no attempt budget until a claim succeeds; document-only recovery never reverses the application lock order.

**Retry policy:** three actual starts per phase, with minimum delays of 60 then 300 seconds after starts one and two. On those claims, set conservative next eligibility to lease expiry plus that attempt's delay; a crash therefore cannot cause immediate retry. On caught failure, only the current token owner clears its claim and records the next due time; rethrow for failed-delivery visibility. Do not assume timeout/kill runs finally or reliably mutates metadata. A third unsuccessful start exhausts that phase with no automatic next eligibility; retain pending/infected status/path, log exhaustion and stop automatic retries. Negative scan resets the counter for the distinct cleanup phase.

**Recovery:** proposed `coach:recover-document-work` runs every five minutes, selects at most 100 eligible IDs, preferring never-dispatched then oldest-dispatched/ID, and calls the same rechecking helper. Concurrent command runs cannot bypass the row-level throttle. It queues work rather than deleting/scanning directly. `--document-id=123 --retry-exhausted` permits targeted reset of an exhausted phase only, refusing active leases and bulk resets; preserve status/path and queue that named document. No such command is run now.

**Budget:** job timeout **60 seconds**, broker `tries = 1`, `failOnTimeout = true`, work lease **75 seconds**, effective consumer reservation **at least 90 seconds**. Keep the existing default queue/connection/supervisors unchanged. Durable metadata owns retries rather than competing broker retries. Before queued validation, verify actual consumer settings and PCNTL timeout support; defaults alone are not evidence. This is a hard process budget. Clamd's per-read/non-progress behavior remains earlier A2, outside this implementation; do not claim a proved in-process transport deadline.

Required new coverage includes enqueue loss after commit, long backlog/duplicates, active/expired leases, three-start limits/backoff/exhaustion and targeted reset, negative verdict despite enqueue failure, false/throw/missing/empty cleanup, stale clean/path/hash changes, recovery cap/fair ordering and concurrent invocations. Tests use owned fake data; real queued timeout evidence requires its own isolated worker fixture.

### 8.4. R10: manual renewal after a conservative display window

Keep the backend `{url}` response and plain-anchor download. Change only the frontend endpoint result to an internal `{url, requestStartedAtMonotonicMs}` descriptor, capturing time immediately before baseQuery. Use current-argument `currentData` and R1's accepted viewer.

Display a resolved link for at most **540 seconds from client request start**, against the backend's 600-second signing TTL. This leaves sixty seconds headroom and conservatively counts network latency. At expiry remove the href and show **Refresh download link**. Its button force-refetches, then exposes a fresh anchor; no automatic click or background polling. Resolution writes a backend audit event, so avoid periodic audit-generating renewal.

Invalidate the href on blur, visibility-hidden or pagehide, requiring explicit refresh after restoration; this conservatively avoids relying only on elapsed-clock behavior across suspension. Maintain an immediate validity ref/activation guard alongside React rendering, so an event-to-render gap cannot activate the old href. Advance a link-presentation generation on export/viewer changes or invalidation; a response started before invalidation cannot re-enable the link. BFCache restoration keeps it invalid until fresh identity proof and explicit refresh. Also recheck age on activation for throttled timers. An already-old response stays hidden without an automatic retry loop. Current errors expose Retry; a retention 410 says a new export is required. Failed renewal never re-exposes the old href. Test delayed responses, fake monotonic time, old export IDs, renewal/failure, hide/restore/click, viewer transitions and retention separately. No signed-URL parser, byte proxy or backend API change is needed.

## 9. Execution checks and fixture prerequisites

Commands below are instructions for the later implementation; none has run in this design pass. Existing `api/vendor`/`web/node_modules` and required PHP/Node tools are prerequisites. If unavailable, report that boundary; do not run `composer setup`, development migrations, dependency upgrades or a reset script as a shortcut.

From `api`, the focused command shape is:

```sh
DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL='' php -d memory_limit=2G vendor/bin/pest --compact tests/Feature/Identity
```

Use that command with the following targets as appropriate; run one target at a time and include new tests in the same suite:

| Tasks | Existing targets / proposed additions |
| --- | --- |
| R3 | `tests/Feature/Identity`, `tests/Feature/Onboarding` |
| R4/R5/R6 | `tests/Feature/CoachApplication`, `tests/Feature/Admin/RoleAssignmentServiceTest.php`, `tests/Feature/Admin/PanelModerationTest.php`; add document-work/service/recovery tests |
| R7 | `tests/Feature/Speech/FfmpegTranscoderTest.php` |
| R8 | `tests/Feature/Essay/EssayHttpTest.php`, `tests/Unit/Captions/TranscriptDeriverTest.php`; add shared-counter coverage |

From `web`, for example:

```sh
npm test -- src/hooks/useEssayEditor.test.tsx src/components/essay/EssayEditorPanel.test.tsx
```

R1 also requires new real-store session tests plus existing auth/connection/commentary session suites and new-document browser evidence. R9 requires its new hook suite plus Onboarding tests; R10 the ExportSection/useExportJob suites; R11 ProfileEdit. Any new filename is a deliverable, not evidence that coverage already exists. The R1 owner must update shared test-store proof fixtures and hand that setup to other frontend workers.

After integrated review, run full gates from their respective directories:

```sh
# api
DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL='' php -d memory_limit=2G vendor/bin/pest --compact
vendor/bin/pint --test
php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G --debug --no-progress

# web
npm test
npm run typecheck
npm run lint
npm run build
```

Also check the complete changed/new-file diff and document whitespace. Record command, driver, passes/skips, warnings and failure evidence; no pass counts are preassigned.

**PostgreSQL:** create a new disposable `code_review_verify_<run_id>` database on an isolated local test service, empty DB_URL, `APP_ENV=testing`, separate cache/storage/session paths and fake mail/storage. Add a proposed guarded `scripts/verify-code-review-concurrency.php` that checks actual driver/database identity before migrations/fixtures; refuse nonempty initialization targets and development databases. Use independent connections/barriers, bounded lock/statement waits and retained unique fixtures for R3 rename races and R5 first-create/upload/decision/actor-demotion ordering. Don't repurpose an old verification database or point RefreshDatabase at development. Document-work claims/recovery need driver contention coverage as well.

**Browser:** add a proposed isolated `web/playwright.code-review.config.ts` and guarded fixture setup for a new `code_review_browser_<run_id>` database. The default Playwright config depends on shared warmup/auth setup and is not this lane. Use dedicated API/frontend ports checked free at execution time, `reuseExistingServer: false`, unique cookies and accounts, fake mail/storage/scanner, Chromium/WebKit, retained traces and nonzero executed cases. Never let default setup seed/reset the developer stack. Cover actual hard-document A→B relogin, registration, safe return paths, essay conflict typing, profile retry and export attribution/renewal. Keep queued document timeout validation separate from synchronous browser fixtures. Any real binary/model/S3/Clamd checks remain optional separate evidence; this plan's completion does not claim those without execution.

## 10. Design-pass review

Three design explorers resolved identity/export behavior, coach transactions and document-work recovery against current source. They reported selected decisions and no code/app/data changes. The main agent reconciled their contracts into §8 and added the scope/dependency checklist and runnable check guidance in §§0/9.

An independent explorer checked the selected designs against source and reported no blocking design contradiction. The main agent incorporated logout-start fencing, BFCache proof restoration with essay exit-flush ordering, conservative export-link invalidation/activation guards, cleared-path handling for both document phases, and explicit first/second retry delays with third-attempt exhaustion. Relative links/anchors, command target paths and whitespace were checked. These are design checks; no application regression, queued timeout or browser result is claimed.

Only this plan was edited in the design pass. The earlier DRY/efficiency plan remains unchanged; no implementation or application checks were executed.
