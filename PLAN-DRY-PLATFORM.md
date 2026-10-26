# Platform DRY follow-up plan

Status: **assigned implementation completed and validated.** Drafted 2026-10-25 against `development` at `399642e`, following the completed [Friends/connections refactor](PLAN-DRY-FRIENDS-AND-CONNECTIONS.md). Three read-only explorers and an independent validator produced the reviewed plan recorded in §8. The user subsequently authorized explorer-assigned workers, integrated review, repairs and platform validation. Fourteen selected candidates are implemented; conditional M4 remains explicitly deferred. Implementation scope, review and fresh evidence are recorded in §9.

The original planning audit changed only this document; the later implementation request supersedes that read-only boundary. Preserve user data and unrelated work. No staging/commit, deployment, dependency upgrade, development-stack reset or real-user storage cleanup is included. File/line references in the proposal describe the original commit and may move during implementation.

## 1. Findings and scope

The useful targets are rules that several callers must keep consistent: input constraints, review grants, erased identity, save-outcome certainty, preference locking, and media I/O. Short repeated markup or similar-looking lifecycle code is not sufficient reason to add an abstraction.

Most findings were maintainability opportunities. The two source-derived defect candidates were characterized during the later implementation:

| Candidate | Source evidence | Required disposition |
| --- | --- | --- |
| Malformed legacy preference namespace | The canonical writer normalized a non-array namespace; the legacy writer directly assigned a nested offset. Persisted malformed `voice_commentary` data caused an HTTP 500. | B5: reproduced with an HTTP regression before the fix. The shared locked writer now repairs only the explicitly written namespace; read resolution remains fail-closed. |
| Caption input can accept a short copy | Captions rejected only a failed stream-copy return; the transcoder also rejected a nonmatching positive expected byte count. | M1: new short/overlong adapter regressions reproduced ready output before the fix. Captions now check known positive source sizes; unknown-size behavior remains supported. These regressions use process fakes; the separate real FFmpeg/Whisper smoke verifies ordinary complete input, not a live truncated-prefix incident. |

Recommended scope is staged, with a review after each domain. Begin with small domain fragments and pure frontend rules. Do not implement the entire portfolio in one unreviewed sweep. B5/B6 and the media tasks need their additional concurrency/failure evidence before acceptance. M3/M4 are conditional follow-ups with higher risk.

## 2. Backend HTTP and domain tasks

### B1. Share the four identical live-speech lookups

**Evidence:** [AnnotationController:242](api/app/Http/Controllers/Api/AnnotationController.php#L242), [EssayController:129](api/app/Http/Controllers/Api/EssayController.php#L129), [CaptionController:142](api/app/Http/Controllers/Api/CaptionController.php#L142), [TranscriptController:81](api/app/Http/Controllers/Api/TranscriptController.php#L81) each perform `withTrashed → findOrFail → SpeechDeletedException for trashed`.

Introduce a narrow resolver/concern for those four callers. Preserve string route parameters, lookup timing, each controller's authorization order, missing ID 404 and deleted ID 410. This helper resolves state; it does not grant access.

**Exclude** [SpeechController::resolveSpeechForWriter:257](api/app/Http/Controllers/Api/SpeechController.php#L257): it first checks ownership/historical review and hides existence from strangers with 404. Do not replace route-model binding globally or retrofit this helper into other families merely because they resolve a Speech.

**Acceptance:** retain annotation write 404/410 coverage and add the equivalent family matrix for essay/captions/transcript where missing. Retain `SpeechEditDeleteHttpTest` stranger-disclosure regressions. No added lookup/query per request.

### B2. Share the erased-reviewer identity fragment

**Evidence:** [ReviewResource:67](api/app/Http/Resources/ReviewResource.php#L67) and [ReviewRosterResource:72](api/app/Http/Resources/ReviewRosterResource.php#L72) have the same nullable/anonymized reviewer projection.

Extract only a formatter for an already-loaded nullable reviewer. Keep `when(relationLoaded('reviewer'), closure)` at each resource so unloaded relations remain omitted without a lazy load. Loaded null/anonymized reviewers return exactly `{display_name: 'Former reviewer'}`; live reviewers retain exactly `{id, username, name}`, where `name` is the trimmed first-name/last-name combination. Do not add separate first_name/last_name fields. Preserve the two enclosing resource envelopes and their other fields.

`whenLoaded()` cannot replace the outer guard: its null short-circuit would erase the tombstone. Do not snapshot erased names, add role/email fields, switch to display-name fallback, or reuse a broader public-user resource.

**Acceptance:** exercise both resources with unloaded, loaded-null, anonymized and live relations; assert omission versus tombstone and stable field types/order. Use existing `AccountErasureServiceTest` and `ReviewRosterHttpTest` for integration, with lazy-loading protection enabled.

### B3. Share annotation request constraints, keeping admission rules local

**Evidence:** [CreateAnnotationRequest:29](api/app/Http/Requests/Annotation/CreateAnnotationRequest.php#L29), [UpdateAnnotationRequest:28](api/app/Http/Requests/Annotation/UpdateAnnotationRequest.php#L28), [CreateVoiceAnnotationRequest:23](api/app/Http/Requests/Annotation/CreateVoiceAnnotationRequest.php#L23) repeat start-time bounds, kind/topic rules and applicable UUID constraints.

Use small annotation-specific rule fragments/constants. Callers retain `required` versus `sometimes`, create UUID versus update `lock_version`, text body versus audio upload, and their authorization. Do not introduce one generic request class that accidentally accepts fields belonging to another operation.

[AnnotationTiming](api/app/Support/AnnotationTiming.php) remains authoritative for effective timing, overlap and ready-video bounds. Preserve the distinction between request `gt:0` and the service's range minimum of 0.5 seconds; do not import the service minimum into request validation under a behavior-preserving change. Point voice admission has no range duration rule.

**Acceptance:** existing `AnnotationWriteHttpTest`, `AnnotationTimingHttpTest` and `VoiceAnnotationHttpTest`; cover omitted PATCH fields, scalar/nonscalar inputs, maximum numeric storage bounds, metadata defaults, UUID replay and stale-version/overlap ordering. No new global factory defaults.

### B4. Share profile text/avatar field constraints within each language

**Evidence:** [StepTwoRequest:23](api/app/Http/Requests/Onboarding/StepTwoRequest.php#L23) / [UpdateProfileRequest:21](api/app/Http/Requests/UpdateProfileRequest.php#L21), and [UpdateAvatarRequest:20](api/app/Http/Requests/UpdateAvatarRequest.php#L20) / [StepThreeRequest:23](api/app/Http/Requests/Onboarding/StepThreeRequest.php#L23). Frontend [validation.ts:74](web/src/lib/validation.ts#L74) / [ProfileEdit.tsx:24](web/src/routes/ProfileEdit.tsx#L24) duplicate the same three text bounds/messages.

Create small PHP domain fragments for bio/pronouns/location and the avatar image/MIME/size tail. Keep profile-only display_name/timezone/locale rules local. Avatar replacement stays required; onboarding avatar stays optional and nullable. A shared Zod object/shape can be extended for ProfileEdit's display_name; retain inferred types, exact messages, empty strings and caller payload conversion.

The server remains authoritative. Do not generate one language's validation from the other or change endpoint requirements, normalization, EXIF processing, accepted MIME types or onboarding completion.

**Acceptance:** `ValidationContractTest`, `ResumableOnboardingTest`, `AvatarExifStrippingTest`, `ProfileEdit.test.tsx`, `Onboarding.test.tsx`; cover 1000/32/80 text boundaries, omitted/null avatar versus required replacement, and current successful-submit/cache behavior.

### B5. Share the locked preference mutation, then handle malformed legacy data explicitly

**Evidence:** [VoicePreferenceController:31](api/app/Http/Controllers/Api/VoicePreferenceController.php#L31) and [CommentaryPlaybackPreferenceController:31](api/app/Http/Controllers/Api/CommentaryPlaybackPreferenceController.php#L31) re-read and lock the same user before merging a per-speech JSON entry.

A focused preference writer may own the transaction, fresh user-row lookup/lock, mutation and save. Keep namespace-specific mutation/validation and response resolution explicit in each caller, or in clearly named domain operations. Do not accept user-supplied namespace paths. Preserve unrelated preferences, other speech entries, legacy data, mode names and canonical precedence. All external I/O stays outside retryable transactions.

First characterize the scalar legacy namespace case. Recommended repair is to normalize only the addressed invalid namespace before the explicit user's write, as the canonical writer already does; test and label this separately as a behavior correction. Never clear unrelated JSON or weaken [CommentaryPlaybackPreference::resolve](api/app/Support/CommentaryPlaybackPreference.php)'s fail-closed handling of malformed persisted reads. Do not normalize both namespaces as a side effect of saving one.

**Integration dependency:** [verify-commentary-preference-lock.php:60](scripts/verify-commentary-preference-lock.php#L60) constructs the controllers directly and then directly invokes `update`. If injection changes, update both construction and invocation as needed: resolving a controller through the container handles constructor injection, but method injection also needs container action invocation or explicitly passed collaborators. Its guard requires a **new empty `commentary_playback_verify_*` PostgreSQL database**, with empty DB_URL; it performs migrations and retains evidence. It cannot be run against `friends_verify`, an already-migrated database or development data.

**Acceptance:** `CommentaryPlaybackPreferenceTest` and the legacy preference cases in `VoiceAnnotationHttpTest`, plus malformed-write, both namespaces/other speeches/unrelated JSON, and rollback cases. The guarded PostgreSQL script must continue proving both write orders with independent processes and observed row-lock contention; SQLite alone cannot establish this.

### B6. Share live-review grant predicates without changing visibility tiers

**Evidence:** [Speech::scopeVisibleTo:149](api/app/Models/Speech.php#L149), [SpeechPolicy::readCaptions:53](api/app/Policies/SpeechPolicy.php#L53), [PresignController:81](api/app/Http/Controllers/Api/PresignController.php#L81), [SpeechUploadController:81](api/app/Http/Controllers/Api/SpeechUploadController.php#L81), [SpeechController:104](api/app/Http/Controllers/Api/SpeechController.php#L104), plus review/timeline readers, repeat access-granting status plus nonrevocation.

Use the existing `Review::ACCESS_GRANTING` constant with a small object predicate and query scope/filter. Keep raw SQL/query-builder versus model representations explicit; qualify columns and accept only code-owned identifiers. Link them with a per-path status/revocation matrix rather than loading rows to run PHP predicates.

Share only the grant rule. Keep reviewer/speech IDs, owner/admin branches, parent deletion checks, `allow_preview`, invited metadata tiers and policy/Gate overrides at their existing boundaries. In particular, do not reuse the whole `GrantsReviewWriteAccess` trait as a grant predicate: it also imposes reviewer ownership and categorical administrative denial. A historical non-granting review must still be available where it distinguishes 403 from stranger 404; filtering it out early changes disclosure behavior. `SpeechPolicy::view` intentionally admits invited reviewers, while `readCaptions` does not.

**Acceptance:** all review statuses × revoked/nonrevoked × caller tier, plus live/deleted speech and preview cases. Reuse `SpeechPolicyCaptionsTest`, `ReviewInvitationHttpTest`, `PlaybackAuthorizationTest`, `ProfileTimelineTest`, [VisibleToSnapshotTest](api/tests/Feature/Speech/VisibleToSnapshotTest.php) and existing query-count coverage. The current visibility test requires byte-identical SQL; prefer an extraction that preserves it. If an unavoidable harmless SQL-shape change is proposed, review the exact predicate/grouping/plan difference and strengthen behavior coverage before updating that fixture. Never replace the snapshot with a weaker assertion merely to accommodate the helper. Verify PostgreSQL semantics and bounded query counts. No new broad Gate ability or `isAuthorized` helper.

## 3. Frontend behavior tasks

### F1. Share the annotation-save certainty classifier

**Evidence:** [useAnnotationEditor:230](web/src/hooks/useAnnotationEditor.ts#L230) and [VoiceRecorder:204](web/src/components/annotation/VoiceRecorder.tsx#L204) repeat the same definitive-versus-uncertain failure expression.

Extract a pure annotation-specific predicate. An initial numeric 4xx or `annotation_busy` is definitive; after an uncertain outcome, ordinary 4xx/busy responses retain the original frozen submission. `422 + annotation_overlap` is definitive even after uncertainty. Network/5xx/acknowledgement mismatch otherwise stays uncertain.

Keep the text editor's typed 409 conflict branch before this predicate. Keep each caller's acknowledgement checks, UUID/instance/audio identity, mounted/scope guards, messages and recovery state machine. This task does not merge text editing and recording hooks or retry a different submission.

**Acceptance:** `useAnnotationEditor.test.tsx` and `VoiceRecorder.test.tsx`, with a truth table for initial versus uncertain retries and integration cases preserving the original UUID/body/timing/audio after a lost acknowledgement. Do not reduce all 409s to one outcome or treat a network failure as proof of noncommit.

### F2. Share the existing terminal access-error classification

**Evidence:** [SpeechWatch:111](web/src/routes/SpeechWatch.tsx#L111), its owner/commentary branches, [useCommentaryTrack:101](web/src/hooks/useCommentaryTrack.ts#L101), and [commentaryPlaybackPreference:28](web/src/lib/commentaryPlaybackPreference.ts#L28) repeat numeric statuses 401/403/404/410.

Add a narrowly named predicate beside [getErrorStatus](web/src/lib/errorStatus.ts) and migrate only callers already using this same quartet. Preserve numeric parsing: missing status, string `"401"`, network failures and 5xx remain nonterminal. Do not apply this set to Friends errors or form validation indiscriminately.

Keep denial latches, fresh request epochs, reviewer identity, session proof, playback suppression and restoration conditions at callers. A shared error classifier is not an authorization or session coordinator.

**Acceptance:** existing `SpeechWatch.test.tsx`, `SpeechWatchOwnerTimeline.test.tsx`, `useCommentaryTrack.test.tsx` and `commentaryPlaybackPreference.test.ts`; retain terminal denial followed by a 500 not reviving private tools/text. Add missing classification boundaries only where existing tests lack coverage.

### F3. Share frontend review status membership first

**Evidence:** [useMyReviewForSpeech:7](web/src/hooks/useMyReviewForSpeech.ts#L7), [useCommentaryTrack:17](web/src/hooks/useCommentaryTrack.ts#L17), [SpeechWatch:113](web/src/routes/SpeechWatch.tsx#L113) and [AnnotationComposerPanel:139](web/src/components/annotation/AnnotationComposerPanel.tsx#L139).

Introduce a typed `isAccessGrantingReviewStatus` in the review domain, using accepted/in_progress/published once. Keep revocation checks local initially: most callers use `revoked_at === null`, while Composer uses `!revoked_at`. A combined review predicate requires characterization and an explicit decision for missing/empty/malformed revocation data; do not silently change that behavior through extraction.

Retain owner/reviewer roles, speech matching, fresh cache provenance, pending state and write permission checks. The PHP constant and TypeScript set remain distinct language representations tied by a status contract matrix; no runtime endpoint/code generator is needed merely to share this stable list. Backend enforcement is authoritative.

**Acceptance:** all statuses and revocation cases in composer, track and SpeechWatch tests, plus stale-account/route responses. Coordinate B6's contract matrix without merging the server and client authorization layers.

### F4. Share reviewer-directory filter/query state

**Evidence:** [ReviewerDirectory:25](web/src/routes/ReviewerDirectory.tsx#L25) and [InviteReviewerPanel:52](web/src/components/review/InviteReviewerPanel.tsx#L52) repeat search, 300 ms trim/debounce, credential/page state, synchronous page reset and query arguments.

A small reviewer-domain hook can own those mechanics and return state, handlers and the existing query result. Preserve initial blank browsing, argument shapes, independent instances and timer cleanup. Page resets stay in input handlers, not an effect after a stale-page request.

Keep invitation form/selection/error UI local. `inviteSomeoneElse` must reset only the form and preserve directory filters/page. Do not add a remount key that destroys that state, change auto-search into submit-only behavior, or reuse this hook for Friends discovery.

**Acceptance:** `ReviewerDirectory.test.tsx` plus new focused InviteReviewerPanel coverage (no dedicated panel unit-test file currently exists), including page-three filter changes, debounce/unmount, two invites from one filtered list and separate component instances. Preserve existing accessible labels and denial/error presentation.

### F5. Share recovery enumeration within its existing module

**Evidence:** [annotationRecovery:61](web/src/lib/annotationRecovery.ts#L61) and [annotationRecovery:77](web/src/lib/annotationRecovery.ts#L77) repeat localStorage iteration, parsing, per-entry corruption isolation, canonical-key verification and sorting.

Extract a private scanner inside that module. Public wrappers retain distinct row-scope versus whole-review acceptance and independent scope validation. Preserve versioned keys, account/speech/review isolation, uncertain envelopes, sibling-tab records and descending update order. Leave exact-revision clearing unchanged; do not delete/migrate stored drafts as part of the refactor.

**Acceptance:** extend `annotationRecovery.test.ts` for both wrappers, malformed/null/foreign-scope entries, unavailable storage and a newer sibling revision surviving stale clear. Keep legacy `annotationDraftStorage` and preference storage separate.

## 4. Media and background-work tasks

### M1. Share streamed remote-to-local copy; separately close the caption size gap

**Evidence:** [WhisperTranscriber:58](api/app/Services/Captions/WhisperTranscriber.php#L58) versus [FfmpegTranscoder:714](api/app/Services/Transcoding/FfmpegTranscoder.php#L714).

Extract a narrow input-copy helper owning stream acquisition/open/copy/close, with explicit byte-count semantics: zero/unknown disables size checking; positive expected bytes require an exact match. Preserve streaming memory usage, false/null failure conventions and storage-exception propagation. Close every acquired handle on early return and exception. Local destination allocation/cleanup and caller-specific failure codes remain explicit.

Migrate both existing transcoder uses: source download supplies expected bytes, while poster-rendition download currently omits them and must retain its zero/unknown-size policy. Audit every caller before removing the private copy method; do not accidentally add a length requirement to the poster path.

After a failing caption short-read regression, have captions pass the known positive `sourceAsset.byte_size`. Preserve unknown-size behavior; do not turn old zero-size metadata into automatic failure. Keep attempt heartbeats/CAS, manual-edit/disable protection, Process timeouts, output formats and publication transactions at callers. No full buffered reads or generic Whisper executor.

**Fixture dependency:** `SpeechAssetFactory` supplies a random positive byte_size. Existing nominal caption tests may store `'source-bytes'` or real fixture content without matching that metadata. When enabling caption length checks, set actual string length/file size in those local fixtures in `WhisperTranscriberTest`, `CaptionSettingsTest` and `RealWhisperAdapterSmokeTest`, plus any other affected caption fixture. Do not set the global factory to zero, bypass the new check, or accept early failures that make stale-worker/manual-edit/disable tests vacuous. Retain assertions that prove the intended Process/publication/race path was reached.

**Acceptance:** preserve `FfmpegTranscoderTest` short-copy coverage; extend `WhisperTranscriberTest` for exact/short/overlong/unknown-length input, unreadable streams, output-open failure and exceptions. Verify invalid copies never run FFmpeg/Whisper or publish ready output, and handles/local files are cleaned. Keep known-length and unknown-length poster/source coverage distinct. Adapter fakes prove control flow, not real binary/model execution; the separate guarded real smoke tests remain optional environmental evidence with their existing opt-ins.

### M2. Share owned scratch allocation and cleanup

**Evidence:** [WhisperTranscriber:49](api/app/Services/Captions/WhisperTranscriber.php#L49), [WhisperVoiceNoteTranscriber:13](api/app/Services/Voice/WhisperVoiceNoteTranscriber.php#L13), [FfmpegVoiceNoteProcessor:23](api/app/Services/Voice/FfmpegVoiceNoteProcessor.php#L23), and [FfmpegTranscoder:173](api/app/Services/Transcoding/FfmpegTranscoder.php#L173), including later poster/sprite allocations.

A small per-operation owned-path scope may allocate extensionless placeholders/suffixed outputs and clean the exact local files it allocated in explicit `finally` blocks. Handle failed/partial allocation before passing paths to I/O. Preserve filename prefixes while tests depend on them and keep media commands/database state outside the utility.

It must not accept arbitrary user paths or perform directory scans, globs, recursive deletion or remote-object cleanup. Do not hide disposal solely in destructors in long-lived workers. Coordinate M1's local-destination contract; migrate one adapter at a time.

**Acceptance:** existing Whisper/transcoder scratch success/failure/timeout checks plus allocation-failure/partial-allocation tests using an injectable allocator or equivalent deterministic seam. Verify only created paths are cleaned, unrelated sentinel files survive, and no placeholder/suffixed sibling leaks. No current leak was demonstrated during this audit.

### M3. Conditional high-risk follow-up: delete only explicit claimed object paths

**Evidence:** identical existence/delete/failure loops in [AccountErasureService:323](api/app/Services/Privacy/AccountErasureService.php#L323), [PurgeSpeechMedia:331](api/app/Jobs/PurgeSpeechMedia.php#L331), [PurgeVoiceAsset:59](api/app/Jobs/PurgeVoiceAsset.php#L59), [PurgeDeletedVoiceAnnotation:49](api/app/Jobs/PurgeDeletedVoiceAnnotation.php#L49), [EraseReviewerVoiceNotes:46](api/app/Services/Voice/EraseReviewerVoiceNotes.php#L46).

Consider only a primitive accepting a disk and the caller's explicit, already-claimed object paths. Preserve missing-object success, false-delete failure, caller error context and storage exception propagation. The helper cannot enumerate objects, discover candidates, select a payer, claim/finalize rows, or decide when deletion is authorized.

Keep each claim/restore predicate, asset-before-annotation lock order, transaction wrapper, audit and quota amount/payer local. Takedown excludes voice and refunds ready source bytes to the speaker; voice purges use reviewer temporary/final reservations; account erasure has different accounting; reviewer erasure preserves text/transcript while annotation deletion marks it not_applicable. Do not merge these protocols.

**Acceptance gate:** characterize all callers first with fake storage and disposable local fixture objects only. Existing `VoiceLifecycleTest`, `AccountErasureServiceTest`, `PurgeSpeechMediaTest` and voice erasure HTTP cases must prove failed-delete retention, retries, restoration, normalization/purge ownership and one-time quota release. This planning/refactor work never authorizes running purge jobs against user storage; any later real-data deletion requires its own exact-target authorization.

### M4. Conditional follow-up: normalization-failure settlement

**Evidence:** [NormalizeVoiceNote::failed:70](api/app/Jobs/NormalizeVoiceNote.php#L70) and [FfmpegVoiceNoteProcessor::fail:163](api/app/Services/Voice/FfmpegVoiceNoteProcessor.php#L163) repeat the guarded asset lock, reservation sentinel, failed-state update, fresh reviewer lookup, quota release and candidate cleanup.

Characterize the differences before choosing a helper: the processor clears transcript_failure_code and gates final path clearing on status=failed; the queued backstop does neither. These are existing differences, not established bugs. Preserve them explicitly until a separate regression establishes a desired correction.

Share atomic settlement only if the resulting API stays small. Retain `AnnotationTransactions::run`, fresh reviewer resolution under the lock, expected temporary path, purge-claim denial and `temporary_byte_size !== null` as the once-only release sentinel. Failure codes/transcript policy and cleanup ownership stay explicit; external storage I/O remains outside the retryable closure. If expressing caller differences needs policy flags throughout, leave the implementations separate.

**Acceptance:** `FfmpegVoiceNoteProcessorTest` and `VoiceLifecycleTest` plus duplicate delivery, stale path/claim, reviewer removal, candidate-delete failure, callback-after-commit failure and rollback cases. Coordinate M3 if it lands; do not share quota or claim logic through its deletion primitive.

## 5. Keep separate or defer

- Frontend polling/autosave/session engines: captions, exports, written notes, recordings and playback preferences have different initial/terminal/retry/freshness behavior. Share pure rules, not their complete state machines.
- A generic Whisper/job executor: caption VTT/heartbeats/CAS/publication differs from voice text/exception semantics. M1/M2 are the narrower useful boundaries.
- Verification shell transport helpers are optional inventory only. Several scripts repeat compose/psql/tinker wrappers, but strict versus cleanup-tolerant status handling differs. Keep stack names, compose files, quoting, guards, traps, resets and teardown local. A later proposal must prove exact argv/status behavior with a stub Docker executable before any isolated live check.
- Public display names versus Filament names: `getFilamentName()` may fall back to username/email and must never be reused as a public serializer. The small common name fragment is lower-value work, not required here.
- Prior Friends deferrals remain deferred: full-account erasure lifecycle/serialization, reconciler absent-row/advisory-lock redesign, optional pagination/action/presentation/menu abstractions, artifact disposition and history rewriting.
- No global API-slice merger, schema redesign, dependency upgrade, generated cross-language policy system or broad code-formatting sweep.

## 6. Proposed implementation sequence and ownership

This is the reviewed sequencing proposal. The later authorized explorer assignment and actual completion evidence appear in §9; file ownership was kept exclusive across its three workers.

| Wave | Segments | Shared-file constraints and exit gate |
| --- | --- | --- |
| 1 | B1/B2; B3/B4 backend; B4 frontend + F2/F3 | One owner per file. F2/F3 share SpeechWatch/useCommentaryTrack, so one frontend worker owns both or hands those files off explicitly. Backend schema fragments and Zod shape remain separate implementations. Run focused existing contract tests. |
| 2 | F1/F5; F4 independently; B5 separately | F1 owns useAnnotationEditor/VoiceRecorder and a separate certainty helper; F5 stays inside annotationRecovery. Agree exports with callers instead of making concurrent edits to that module. F4 owns ReviewerDirectory/InviteReviewerPanel and its new hook/tests. B5 includes its directly constructed-controller verification script. |
| 3 | B6; M1; M2 after M1's destination contract is stable | One owner for all review grant consumers; one for media adapter files. M1/M2 both touch WhisperTranscriber and FfmpegTranscoder, so no simultaneous edits. Require driver/failure evidence before integration. |
| 4, optional | M3; M4 | Separate high-risk changes after characterization and explicit file handoff. Scope may be declined if the abstractions obscure ownership/policy. |
| Integration | Independent explorer, then repair owner | Review the combined diff with request/response, RBAC, cache, lifecycle, storage/quota and script context. Repair demonstrated mistakes and rerun affected checks before full acceptance. |

Use small reviewable changes; fix demonstrated behavior in a separate test-first change from later extraction where practical. Keep prior user changes intact. No staging, commit, deployment or real-data cleanup is implied by this plan.

## 7. Future validation and acceptance boundaries

- Backend: focused Pest for touched domains with explicit `DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL=''`; Pint `--test`; full configured PHPStan. At integration, run the full Pest suite with a suitable PHP memory limit (the prior environment needed an explicit increase). Record passes/skips and any environmental failures; do not copy prior test counts as current evidence.
- Frontend: focused Vitest for affected paths, `npm run typecheck` (`tsc -b`), ESLint; then full Vitest and production build. Preserve cache invalidation, session identity, accessible names and literal error messages unless an intentional behavior change explicitly tests them.
- PostgreSQL: B5 requires its own new-empty-database guarded script; B6 needs role/review visibility/query-plan evidence on disposable data. Inspect each script's actual guards and mutation behavior before invocation. Do not repurpose development databases or the stopped Friends verification database as a universal fixture target.
- Browser: use isolated stack/config/accounts appropriate to the affected feature. An ordinary Friends run does not validate essay/captions/voice/reviewer invite behavior; some existing media helpers target the named `speechcoach-e2e` stack and seed/reset fixtures. Inspect those side effects first. Require nonzero executed tests, disclose skips/flakiness, and never run a reset/cleanup helper against user data. No automatic start/stop/reset of the developer stack.
- Media: process fakes and fake storage establish branch/ownership/accounting behavior only. Claim real external-binary/model/object-storage behavior only if its existing guarded smoke workflow actually runs. M2/M3 validation is limited to explicitly owned disposable fixtures.
- Final acceptance: no broadened access or payloads; no changed status/disclosure ordering; no new per-row queries or graph buffering; preserved ownership, retries, idempotency and cleanup boundaries; combined explorer review completed and its actionable findings addressed.

## 8. Plan-review record

The three initial explorer reports were reconciled into B1–B6, F1–F5 and M1–M4. A separate explorer then checked the draft's source equivalences, test names, scripts, privacy/authorization rules, media ownership and work assignments. The main agent checked its actionable findings against the files and revised the document:

| Review finding | Correction incorporated |
| --- | --- |
| Live reviewer payload wording could imply separate first_name/last_name keys | B2 now specifies exact `{id, username, name}` output and the distinct erased-reviewer tombstone. |
| Proposed visibility test name did not exist | B6 names `VisibleToSnapshotTest.php`, preserves its byte-identical SQL expectation, and requires explicit review of any proposed snapshot change. |
| Preference evidence script directly calls update as well as constructing the controller | B5 requires adapting construction and method invocation for the selected injection style. |
| Worker overlap description named the wrong callers | Wave 1 assigns the actual F2/F3 SpeechWatch/useCommentaryTrack overlap; Wave 2 identifies F1's editor/recorder and F5's recovery module separately. |
| Caption success/race/smoke fixtures use random positive metadata sizes | M1 requires exact local fixture sizes and non-vacuous Process/race assertions, preserving the global factory and size-check behavior. |
| Transcoder copy helper has a poster caller as well as source download | M1 explicitly preserves poster's current zero/unknown-size policy. |
| Existing write-access trait is broader than status/nonrevocation | B6 explicitly keeps that trait's reviewer ownership and categorical admin denial outside the shared grant fragment. |

The reviewed plan contained **15 bounded candidates**. At planning time M3/M4 were conditional higher-risk follow-ups and the two defect candidates were unverified hypotheses. The later scope decisions and regression evidence are recorded in §9. Generic lifecycle/job engines and lower-value presentation/transport abstractions remain excluded or deferred.

No implementation, application test execution, service startup or database/storage mutation occurred during the original planning audit. Only this document was added then; the subsequent authorized implementation is recorded separately below.

## 9. Authorized implementation and validation

The implementation explorer revalidated the plan and assigned three workers:

| Owner | Assigned scope | Context boundary |
| --- | --- | --- |
| Backend worker | B1–B6, preference-script dependency updates and HTTP/domain tests | Preserve disclosure order, resource omissions/tombstones, request distinctions, locked merges, Gate rules and byte-identical visibility SQL |
| Frontend worker | B4 Zod and F1–F5, including overlapping SpeechWatch/track files | Share pure rules/query mechanics while retaining each caller's session, revocation, uncertainty and recovery state |
| Media worker | M1/M2 and narrowly scoped M3, media adapters and exact media fixture/test ownership | Preserve attempt guards, unknown-size poster policy, owned scratch files, claim/finalize/quota protocols and caller error messages |
| Main agent | Isolated PostgreSQL/browser/real-media evidence, integration tests, repairs and final plan status | New guarded databases and local fixtures; no development data resets or user-storage purge execution |

The explorer included M3 only as the small explicit-path delete primitive. It deferred M4 because sharing its two failure-settlement paths would require policy switches for existing transcript failure-code and final-cleanup status differences in quota/concurrency-sensitive code. Both M4 implementations retain their existing semantics.

### Completion and integrated review

| Tasks | Disposition |
| --- | --- |
| B1–B3 | Shared the four speech resolvers, loaded-reviewer identity fragment and annotation constraints; caller-specific disclosure/authorization/admission remains local |
| B4 | Shared PHP profile/avatar constraints and the Zod profile-text schema without changing required/optional/null or payload behavior |
| B5 | Shared fresh locked preference writes and fixed the reproduced malformed legacy namespace failure; adapted the concurrency script for injection |
| B6 | Shared object/query review grants, retaining historical-row status classification, Gate/role rules and the exact frozen visibility SQL |
| F1–F3 | Shared save-certainty, numeric terminal-access and review-status rules; retained text/voice state machines and existing revocation/numeric-string distinctions |
| F4/F5 | Shared reviewer query state and private recovery scanning, preserving filter lifetime, independent instances, account/scope isolation and exact-revision clearing |
| M1/M2 | Shared streamed input copying and owned scratch allocation/cleanup; fixed known-size caption validation and corrected only local media fixtures |
| M3 | Shared only the five explicit claimed-object deletion loops; claim/finalize, storage exception messages, restoration and quota rules remain unchanged |
| M4 | Deferred by explorer decision; existing normalization failure policies remain separate |

After every worker released its source, the implementation explorer examined the combined diff and new files. Separate frontend/media explorers cross-checked the integration. They found no blocking product regression and confirmed the selected segments were complete in their shared request, response, authorization, cache, lifecycle, storage and quota context. No product repair was required from that review.

Integration checks did require three fixture corrections, all preserving existing product behavior:

- PostgreSQL sequences do not roll back between tests. `VisibleToSnapshotTest` now uses an in-memory user with fixed ID 1; its SQL fixture and exact comparison are unchanged. The PostgreSQL suite then passed all 60 cases.
- The new browser test initially assumed reviewer search matched combined first/last names. The existing endpoint searches individual fields, so the page-reset test now searches one unique username. The search contract was not changed.
- Commentary playback controls intentionally require a selected published review. The new preference browser fixture now includes a real published review/note rather than expecting controls to enable on an empty roster. The test still proves legacy namespace repair and canonical precedence through actual HTTP writes.

### Fresh validation results

| Check | Result |
| --- | --- |
| Full Pest, explicit SQLite `:memory:`, PHP memory 2G | **1,176 passed, 35 skipped; 6,386 assertions** (1,211 total) |
| Full Vitest | **1,289 passed across 131 files** |
| TypeScript `tsc -b` | Passed, including the new browser spec |
| Production frontend build | Passed; existing large-chunk advisory remains |
| Full Pint | Passed |
| Full configured PHPStan, sequential `--debug` | Passed, zero errors |
| Full ESLint | Zero errors; five existing warnings outside this change |
| PostgreSQL grant/visibility suite | **60 passed, 1,470 assertions**, including the exact visibility snapshot |
| PostgreSQL visibility and EXPLAIN probe | Passed twelve status/revocation cases: owner sees 12, granting viewer sees 3, stranger sees 0; model/raw grant queries both return 3; plans retained for visibility/model/raw queries |
| Preference writer concurrency | Both write orders passed with independent PostgreSQL connections and an observed row-lock wait; both namespaces and unrelated JSON survived |
| Annotation concurrency/purge interlocks | Existing guarded script passed overlaps, restore/delete/revoke interactions and three-connection deadlock/retry/quota cases |
| Real FFmpeg/Whisper adapters | **3 passed, 32 assertions**: diagnostics plus real caption and voice adapter workflows using the existing model, SQLite memory and isolated local storage |
| Final Chromium browser run | **6 passed**, zero skipped/unexpected/flaky |
| Final WebKit browser run | **6 passed**, zero skipped/unexpected/flaky |
| Diff whitespace | Passed |

Each browser ran written annotation capture/add/edit/cancel/publish, separate-tab draft recovery, uncertain voice upload preserving UUID/point, directory paging/filter reset and two invitations, profile text boundaries/save/reload, and malformed legacy preference repair with canonical playback precedence. Fresh final fixtures and output directories preserved the first failed fixture run for inspection. Browser media uses committed local video and a deterministic browser recorder; it does not prove real microphone hardware, SigV4 delivery or a queued media pipeline. The separate real adapter run exercised FFmpeg/Whisper/model code in isolation, not the full queue/storage deployment. Existing Vitest `act(...)`/Base UI warnings remain non-failing. The readonly real-media container emitted a Pest result-cache write advisory after its successful tests; source/vendor/model mounts remained readonly.

### Isolated targets and retained evidence

Evidence is retained at `/private/tmp/speechcoach-dry-platform-3sp7elm_/`, including full-suite/static/build logs, `postgres-grants-final.log`, `review-grants-explain.json`, `preferences-lock.log`, `annotation-concurrency.log`, `real-media-smoke.log`, `smoke-artifacts/`, and final browser JSON/log/trace directories. Environment wrappers and standalone Playwright configurations are retained there as well.

The task created only its own PostgreSQL container, `speechcoach-dry-platform-3sp7elm`, on loopback port 15436. Separate guarded databases were used for preference concurrency, grant tests, annotation concurrency and initial/final browser fixtures. The final browser target is `annotation_range_browser_dry_final_3sp7elm_`; API/preview ports were 8180/5180. No existing database was reused as a universal test target or reset. The real-media container, `speechcoach-dry-platform-smoke-3sp7elm`, had networking disabled, readonly application/model mounts and only new temporary/artifact write locations.

No development services were restarted, no real-user object storage was purged, no dependencies or models were installed/downloaded, and no deployment, staging or commit was performed.

The temporary API and frontend preview processes were stopped after validation, and `speechcoach-dry-platform-3sp7elm` was stopped without removing its container or databases. The real-media smoke container exited after its successful run and was also retained. Test data, artifacts and logs remain available for review; the PostgreSQL fixture can be restarted with `docker start speechcoach-dry-platform-3sp7elm`. Existing development services were left untouched.
