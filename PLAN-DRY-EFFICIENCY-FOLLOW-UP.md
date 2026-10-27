# Further DRY and efficiency plan

Status: **independently reviewed and corrected; planning only.** Prepared 2026-10-26 against clean `development` at `230708c`. Three explorer agents reviewed backend HTTP/domain/query code, frontend code, and jobs/media/tooling; the main agent reconciled their reports against source and inspected route loading. A separate explorer, supported by focused frontend/media subreviews, checked this plan against the code; its corrections are recorded in §9. This document proposes later work. No implementation, application tests, build, service startup, database mutation or storage operation is authorized by this audit.

The completed [Friends/connections plan](PLAN-DRY-FRIENDS-AND-CONNECTIONS.md) and [platform plan](PLAN-DRY-PLATFORM.md) are the baseline. Their implementations are present. Their deliberate deferrals remain deferred unless this document identifies new evidence. Do not reopen those projects or introduce general-purpose engines merely to remove similar-looking code.

## 1. Findings and priorities

The useful remaining work is a mixture of narrow rule reuse and removing repeated work. Source inspection establishes the duplicated code and algorithm/query shapes below; it does not establish observed user latency, measured memory savings or a passing regression test.

| ID | Candidate | Type and evidence strength | Priority / risk |
| --- | --- | --- | --- |
| A1 | Predecessor speech metadata may bypass viewer visibility | High-confidence source-derived privacy candidate; not runtime reproduced | First, test-first / medium |
| E1 | Batch timeline arc queries across retained page roots | Two extra queries per chained item are explicit in source/tests; optimization, not a bug | High efficiency value / medium |
| E2 | Avoid retaining imperative multipart mutation results | Installed RTK source confirms tracked results are retained until removed/reset; memory impact unmeasured | High / low implementation, medium test effort |
| E3 | Stream voice adapter inputs through the existing copier | Whole-object input strings are explicit in both adapters | High / medium |
| D1 | Reuse the existing S3 client factory in multipart uploads | Exact config-construction duplication | Small DRY task / low–medium |
| D2 | Reuse erased-reviewer projection in account exports | Exact projection duplication; eager loading already present | Small DRY task / low |
| D3 | Share speech metadata constraints/conversion | Common rules and conversions with intentional create/PATCH differences | Optional / low |
| D4 | Share literal-contains LIKE escaping | Two identical expressions; reviewer search is deliberately excluded | Optional / low |
| E4 | Split heavy routes from the initial import graph | Router eagerly imports media/upload/editor routes; actual chunk/latency savings unmeasured | Measure-first efficiency / medium |
| E5 | Memoize authoring ordering; conditionally share current-row selection | Composer re-sorts unchanged data on fallback playhead changes; selection ties differ from Transcript | Recommended memoization; extraction conditional / low–medium |
| E6 | Index ready voice identities inside the existing controller | Repeated linear searches and per-event filter allocation | Optional, bounded data size / medium |
| A2 | Characterize Clamd partial-I/O/non-progress handling | Unchecked writes and unbounded progress loops in source; no reproduced incident | Conditional test-first / medium–high |

A1 and A2 are separate behavior/reliability investigations, not behavior-preserving DRY extractions. Require failing regression evidence before labeling either a confirmed fixed defect. Do not claim the platform is currently validated from historical test results; this audit runs no application checks.

## 2. Privacy characterization before shared response loading

### A1. Protect predecessor metadata with the existing visibility rule

**Evidence:** granting reviewers reach [SpeechController:125](api/app/Http/Controllers/Api/SpeechController.php#L125); its [eager-load list:291](api/app/Http/Controllers/Api/SpeechController.php#L291) loads `supersedes` without viewer filtering. The [relationship:95](api/app/Models/Speech.php#L95) is unrestricted, and [SpeechResource:102](api/app/Http/Resources/SpeechResource.php#L102) emits the predecessor's `{id, ulid, title}`. The resource's own [contract comment:13](api/app/Http/Resources/SpeechResource.php#L13) forbids chain-based grants. In contrast, [SpeechArcService:49](api/app/Services/SpeechArcService.php#L49) rechecks every ancestor with `visibleTo` and redacts inaccessible metadata.

**Proposal:** first add an HTTP regression: a reviewer granted v2, without access to v1, must not receive v1's private title or ULID in v2's badge. Characterize the existing optional `supersedes` field and choose omission for an inaccessible loaded predecessor, consistent with the resource's existing absent/null relation behavior. Constrain predecessor eager loading at the HTTP/query boundary using `Speech::visibleTo($viewer)`. Keep the global relationship independent of authentication and avoid authorization queries inside resource serialization.

After a demonstrated repair, a separate extraction may share the exact response relation list with [SpeechSearch:42](api/app/Services/Search/SpeechSearch.php#L42). Search is owner-only; retain that scope. Audit every `SpeechResource` caller before choosing this boundary. Do not repurpose full arc redaction as a badge payload, add fields, broaden grants or modify the byte-identical visibility SQL.

**Acceptance:** extend [SupersedeTest](api/tests/Feature/Speech/SupersedeTest.php) and [ReviewInvitationHttpTest](api/tests/Feature/Review/ReviewInvitationHttpTest.php). Cover v2 granting statuses, and v1 absent/invited/declined/revoked versus granting access; owner-visible predecessors, deleted predecessors, invited-v2 reduced payload, stranger 404 and former-reviewer 403. Retain [SpeechOwnershipTest](api/tests/Feature/Speech/SpeechOwnershipTest.php), [FlagshipScreensQueryCountTest](api/tests/Feature/FlagshipScreensQueryCountTest.php), and [StatusBadge.test.tsx](web/src/components/speech/StatusBadge.test.tsx). Check that filtering adds no per-row query and badge absence remains supported. Regression repair and relation-list extraction should be separately reviewable.

## 3. Remove repeated work

### E1. Batch timeline arc traversal and visibility

**Evidence:** [ProfileTimelineController:109](api/app/Http/Controllers/Api/ProfileTimelineController.php#L109) calls `chainFor` inside the item map at line 134. [SpeechArcService:32](api/app/Services/SpeechArcService.php#L32) runs one recursive CTE and one visibility query per call. With 20 chained retained rows, that is up to 40 arc queries. [FlagshipScreensQueryCountTest:193](api/tests/Feature/FlagshipScreensQueryCountTest.php#L193) explicitly accepts the present per-chain cost; this proposal changes that documented budget intentionally.

**Proposal:** add a root-aware batch API for only the distinct chained speech IDs in the retained page, after removing the extra pagination sentinel. Carry root ID and depth through the CTE, then use one existing `visibleTo` query for the union of discovered speech IDs. Group/redact results back per root. Keep the single-root API if another caller needs it, delegating without duplicating traversal/redaction rules.

Preserve depth-one roots, depth limit 10, per-root depth ordering, shared ancestors appearing in each applicable root, null arcs for unchained items and each redacted entry's current fields/types. Roots must not share a visited set that truncates another root. No cross-request/viewer caching, connection-based grants, global graph loading, or altered frozen visibility predicate. Bind IDs; never interpolate request input into CTE SQL. Preserve both tabs, cursor ordering and current deleted-row/redaction semantics.

**Acceptance:** extend [ProfileTimelineTest](api/tests/Feature/Connection/ProfileTimelineTest.php) and the flagship query-count test for zero/one/many roots, overlapping chains, depth cap, ungranted/revoked/deleted ancestors, both tabs and later pages. Compare payloads to characterized single-root results. Prove zero arc queries for zero roots and one CTE plus one visibility query for nonempty existing roots independent of page root count; update the old budget and its explanatory comments together. Later inspect PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` on isolated fixtures; record query reduction separately from measured latency or database work.

### E2. Stop retaining unused multipart mutation cache entries

**Evidence:** [UploadDashboard:159](web/src/components/speech/UploadDashboard.tsx#L159) initiates `createUpload`, `signPart`, `completeUpload` and `abortUpload` imperatively, unwraps them, and never resets their tracked mutation results. Installed RTK defaults `track = true` in `web/node_modules/@reduxjs/toolkit/src/query/core/buildInitiate.ts:549`; `buildSlice.ts:434–467` retains tracked results until explicit removal/API reset. Each signed part adds a result. No upload UI consumes these mutation-result cache rows.

**Proposal:** pass `{ track: false }` to these four imperative mutation initiations. Retain `unwrap()` and endpoint definitions. No helper or API-slice merger is needed for this small option. The installed `queryLifecycle.ts:443–451` handles lifecycles without a tracking prerequisite. `invalidationByTags.ts:35–103` counts pending thunk actions independently of mutation-result tracking, including delayed invalidation. Tests must demonstrate both behaviors with the actual store; do not infer them from another RTK version.

**Acceptance:** retain [UploadDashboard.test.tsx](web/src/components/speech/UploadDashboard.test.tsx), whose mocked store/endpoints alone cannot prove cache behavior. Add a real-store API integration test for repeated and concurrent signed parts, rejected signing/completion/abort, create/complete/abort results and no leftover mutation-cache rows. Preserve the distinct current rules: quota `/api/me` refresh runs only after successful create/complete/abort, while complete/abort invalidate Speech tags on both fulfilled and rejected requests. Assert both rules, concurrent delayed invalidation, and unchanged errors/toasts/retries/`onAssetReady`. Use mocked HTTP and no actual S3 writes. Measure memory separately before claiming a numeric saving. Also check the installed runtime's transient in-flight bookkeeping settles; the goal is removing completed result retention, not promising zero transient objects.

### E3. Stream the remaining voice input downloads

**Evidence:** [FfmpegVoiceNoteProcessor:29](api/app/Services/Voice/FfmpegVoiceNoteProcessor.php#L29) and [WhisperVoiceNoteTranscriber:17](api/app/Services/Voice/WhisperVoiceNoteTranscriber.php#L17) call `Storage::get()` and `file_put_contents()` for input. [MediaInputCopier](api/app/Services/MediaInputCopier.php) already streams into an owned destination and closes handles. Voice upload admission permits 16,384 KiB; reuse avoids an adapter-owned full-input string. This does not establish end-to-end unbuffered S3 transport or measured peak-memory savings; the filesystem adapter/SDK may buffer independently.

**Proposal:** reuse the existing copier for these input downloads into their existing `ScratchFiles` paths. Use `expectedBytes = 0` initially: voice currently does not enforce matching metadata size. Do not introduce positive-length integrity checks as an incidental refactor. Preserve empty/unknown-size admission and existing storage-failure mapping, process commands/timeouts, propagated exceptions, finally cleanup, attempt ownership and publication/quota boundaries. A stream-copy false result maps to the adapter's existing storage failure; establish how newly observable partial-write failures should be classified before merging. Keep filesystem/SDK configuration outside this task: the current media disk omits `stream_reads`, Laravel defaults it to false (`api/vendor/laravel/framework/src/Illuminate/Filesystem/FilesystemManager.php:258`), and Flysystem enables HTTP streaming only when configured (`api/vendor/league/flysystem-aws-s3-v3/AwsS3V3Adapter.php:464`).

Leave normalized output buffering and `strlen($normalized)` accounting unchanged. Do not touch deferred M4 failure settlement or replace output publication with a streaming transaction in this task.

**Acceptance:** retain [MediaInputCopierTest](api/tests/Unit/MediaInputCopierTest.php), [FfmpegVoiceNoteProcessorTest](api/tests/Feature/Annotation/FfmpegVoiceNoteProcessorTest.php), [VoiceLifecycleTest](api/tests/Feature/Annotation/VoiceLifecycleTest.php). Add dedicated transcriber coverage (proposed new test, not present today) and adapter cases proving `readStream` is used without `get`, unreadable source/local-open failure, zero/unknown lengths, exceptions, no Process call after failure, cleanup and the distinct `voice_storage_failed` / `voice_transcription_storage_failed` codes. Existing fake/lifecycle tests establish control flow and quota semantics; guarded [RealVoiceAdapterSmokeTest](api/tests/Feature/Annotation/RealVoiceAdapterSmokeTest.php) is separate optional real-binary/model evidence. If quantifying memory, use comparable isolated-process measurements.

### E4. Split heavy route code from initial navigation

**Evidence:** [App.tsx:4](web/src/App.tsx#L4) statically imports all pages, including SpeechCreate and SpeechWatch. The latter imports [EssayEditorPanel:3](web/src/components/essay/EssayEditorPanel.tsx#L3) (Tiptap), [VideoPlayer:4](web/src/components/speech/VideoPlayer.tsx#L4) / [videojs-adapter:1](web/src/shared/media/videojs-adapter.ts#L1), and voice recording's [WaveSurfer preview:2](web/src/components/annotation/VoiceWaveformPreview.tsx#L2). [UploadDashboard:2](web/src/components/speech/UploadDashboard.tsx#L2) imports Uppy. There is another eager Uppy path: [BecomeACoach:4](web/src/routes/BecomeACoach.tsx#L4) imports CoachApplicationForm, which imports [CoachDocumentUpload:2](web/src/components/coach/CoachDocumentUpload.tsx#L2). This establishes eager reachability; the audit has not built or measured a new bundle.

**Proposal:** after recording a production-build/network baseline, add route-level dynamic imports for the heavy pages, including BecomeACoach if claiming Uppy Core/Dashboard deferral. Splitting only SpeechCreate/SpeechWatch leaves that Uppy path eager. Audit all remaining entry paths and shared chunks before claiming a dependency is deferred. Keep the existing data router, guard grouping, public profile nesting, verification-link behavior and error boundaries. Prefer a content-level loading fallback that keeps the authenticated shell visible. Keep `useBlocker` under its data router and avoid remounting active editor/recorder state during settled navigation. A chunk rejection needs an accessible recovery path; don't introduce automatic reload loops. Keep both development-only Spikes guards. Do not merge API slices or dynamically remove registered Redux reducers/middleware.

**Acceptance:** new route integration coverage (no current App/router test is assumed) plus existing [AuthShell tests](web/src/components/auth/AuthShell.test.tsx), [UnauthenticatedRedirect tests](web/src/components/auth/UnauthenticatedRedirect.test.tsx), editor/blocker and public-profile tests. Browser checks must include direct deep links, login redirects, nested profile children, back/forward, unsaved navigation, chunk-load failure, and authenticated shell persistence. Compare production output and browser requests before/after: show heavy route chunks are deferred on an unrelated entry and load when required. Set any size/latency target from that baseline; don't promise a number or raise the chunk-warning threshold instead of measuring. Report CSS loading effects and shared chunks honestly.

### E5. Memoize authoring order without changing selection ties

**Evidence:** [AnnotationComposerPanel:246](web/src/components/annotation/AnnotationComposerPanel.tsx#L246) sorts `merged` in its fallback selection whenever playhead dependencies change. [Transcript:40](web/src/components/annotation/Transcript.tsx#L40) already memoizes ordering, then repeats a similar latest-active/nearest-preceding selection. Their active scans differ: Composer scans input order; Transcript scans sorted order. Equal-start active ties can therefore select different IDs today.

**Proposal:** first memoize Composer's fallback ordering against `merged`, keeping its active scan's original input order. Then consider a private/pure current-row selector only if it can preserve each caller's current tie behavior clearly. Do not silently turn both inputs into the same sorted scan. Keep no-future fallback, optimistic rows, voice points, latest-active preference, `aria-current` and Transcript's manual-scroll/focus suppression.

**Acceptance:** extend [Transcript.test.tsx](web/src/components/annotation/Transcript.test.tsx), [AnnotationComposerPreview.test.tsx](web/src/components/annotation/AnnotationComposerPreview.test.tsx) and [AnnotationComposerPanel.test.tsx](web/src/components/annotation/AnnotationComposerPanel.test.tsx). Cover equal-start ties, unsorted input, overlapping active rows, future-only rows and optimistic/saved combinations. Use meaningful sort-operation instrumentation or profiling to show playhead-only changes do not re-sort unchanged rows. Ordering reuse is ready for implementation; selector consolidation remains conditional on behavior characterization.

### E6. Optional ready-row index within the voice controller

**Evidence:** [VoiceInterjectionController:55](web/src/lib/voiceInterjectionController.ts#L55) scans notes for each canonical `(id, asset_id)` check; line 73 repeats that for the queue. [onTime:184](web/src/lib/voiceInterjectionController.ts#L184) allocates a ready array every event and line 199 selects a hint.

**Proposal:** rebuild a ready array and exact identity lookup at `update()`, retaining input order. Use them for canonical checks/queue validation and playhead filtering. Keep hint selection as the first input-order match, not the closest timestamp. Preserve duplicate/identity handling established by characterization; avoid an index that silently changes first-match semantics. The existing hint cleanup at lines 79–80 checks only ID plus ready status, while canonical active/queued lookup checks ID plus asset ID plus ready status. Keep those checks distinct; don't use the composite index to tighten hint replacement behavior. No new playback engine, sorting, session coordinator or changed full-object comparison.

**Acceptance:** existing [useVoiceInterjections.test.tsx](web/src/hooks/useVoiceInterjections.test.tsx) plus unsorted hints, duplicate identities if accepted, simultaneous removal/replacement/readiness changes, queued notes, enable transitions and late URL cancellation. Preserve seeks, zero-start behavior, generations and video pause ownership. This removes repeated scans/allocation, but review size is bounded around 200 and no latency incident establishes urgency. Defer if added state obscures invalidation correctness.

## 4. Small reuse tasks

### D1. Reuse the multipart S3 client factory

**Evidence:** [MultipartUploadService:28](api/app/Services/MultipartUploadService.php#L28) repeats the config construction in [MediaS3ClientFactory:23](api/app/Services/MediaS3ClientFactory.php#L23).

**Proposal:** inject the existing factory and call `make('media')` and `make('media_public')` separately. Keep create/complete/head/abort on the internal client and signing on the public client, using the current media bucket, arguments, part order, path-style behavior and TTL. Never rewrite the signed host afterward or collapse the endpoints. No measurable speed benefit is claimed.

**Acceptance:** retain [UploadFlowTest](api/tests/Feature/Speech/UploadFlowTest.php), [SpeechOwnershipTest](api/tests/Feature/Speech/SpeechOwnershipTest.php), [UploadRateLimitTest](api/tests/Feature/Speech/UploadRateLimitTest.php) and [MediaInitializeCommandTest](api/tests/Feature/Captions/MediaInitializeCommandTest.php). They do not replace a proposed focused multipart-service test: use distinct per-disk clients, assert operation routing/arguments, `ContentLength`, exceptions and signed host/part/upload ID/expiry. The existing factory's single override can hide an endpoint split if a test returns the same client twice; use a per-disk fake or equivalent. Mock SDK transport; no live object mutation is needed.

### D2. Reuse erased-reviewer fields in account exports

**Evidence:** [GenerateDataExport:136](api/app/Jobs/GenerateDataExport.php#L136) repeats [ReviewerIdentityFields:11](api/app/Http/Resources/ReviewerIdentityFields.php#L11); reviewer eager loading already exists at export lines 100–102.

**Proposal:** reuse the existing formatter for the already-loaded nullable reviewer. If a neutral layer is preferable for job/resource sharing, move that formatter once and update its current consumers; do not add another implementation or broader public-user serializer. Keep exactly `{id, username, name}` or `{display_name: 'Former reviewer'}`.

**Acceptance:** extend [DataExportHttpTest](api/tests/Feature/Privacy/DataExportHttpTest.php) with live/null/anonymized reviewer cases and exact output/no private fields. Retain [ReviewerIdentityResourcesTest](api/tests/Unit/ReviewerIdentityResourcesTest.php) and [AccountErasureServiceTest](api/tests/Feature/Privacy/AccountErasureServiceTest.php), lazy-load protection and bounded queries. Do not merge export builders: account export remains published-only; reviewer export keeps drafts and `withTrashed` speech context. Annotation batching already exists, so do not claim an N+1 fix here.

### D3. Optional speech metadata fragments

**Evidence:** [CreateSpeechRequest:37](api/app/Http/Requests/Speech/CreateSpeechRequest.php#L37) / [UpdateSpeechRequest:43](api/app/Http/Requests/Speech/UpdateSpeechRequest.php#L43), and [SpeechController:57](api/app/Http/Controllers/Api/SpeechController.php#L57) / [179](api/app/Http/Controllers/Api/SpeechController.php#L179) repeat constraint tails and common validated-field conversion.

**Proposal:** small speech-specific constraint fragments and a converter for already-validated common fields. Keep create's required title/conditional change note, PATCH's `sometimes`, omitted versus explicit null, create-only linking/captions and same-owner/successor enforcement local. Do not turn unsupported PATCH keys into accepted fields or 422 errors: current [SpeechEditDeleteHttpTest:33](api/tests/Feature/Speech/SpeechEditDeleteHttpTest.php#L33) behavior is 200 with those keys ignored despite its test name. Keep authorization/disclosure order and caption defaults unchanged.

**Acceptance:** that HTTP suite, SupersedeTest and [CaptionSettingsTest](api/tests/Feature/Captions/CaptionSettingsTest.php), plus missing create/PATCH boundary, omitted/null/date and unsupported-key cases. Do not replace `validated()` with raw request input. Share the controller owner with A1 to prevent concurrent edits. Skip this extraction if its API is more complex than the few common fields.

### D4. Optional literal-contains search pattern

**Evidence:** [SpeechSearch:19](api/app/Services/Search/SpeechSearch.php#L19) and [FriendDirectoryService:157](api/app/Services/FriendDirectoryService.php#L157) share ordered `!/%/_` escaping and percent wrapping.

**Proposal:** one pure pattern helper for these exact callers. Keep explicit `ESCAPE '!'`, LOWER folding, columns/grouping, bindings, scopes, trimming and search-bound cursor semantics local. [User reviewer search](api/app/Models/User.php#L123) uses different backslash/bare-LIKE semantics and is excluded; changing it requires a separate contract decision.

**Acceptance:** [TranscriptControllerTest](api/tests/Feature/Captions/TranscriptControllerTest.php), [FriendDirectoryTest](api/tests/Feature/Connection/FriendDirectoryTest.php) and a helper matrix for `%`, `_`, `!`, backslash, punctuation, blank and Unicode input. SQLite does not prove PostgreSQL Unicode/collation parity. The existing [PostgreSQL friends verifier](scripts/verify-postgres-friends.php) inserts fixtures; inspect its current guards before later isolated execution. This is drift prevention, not a search-speed improvement.

## 5. Conditional transport investigation

### A2. Bound and check Clamd stream progress

**Evidence:** [ClamdScanner:46](api/app/Services/Scanning/ClamdScanner.php#L46), line 59 and line 66 repeat unchecked writes. File read failures/non-progress continue at lines 54–58; response reads loop until EOF at lines 68–71 without read-failure/timeout/progress checks. Line 74 accepts an `OK` substring without `FOUND`. The normal test binding selects a fake scanner, so [ScanApplicationDocumentTest](api/tests/Feature/CoachApplication/ScanApplicationDocumentTest.php) does not establish real transport behavior.

**Proposal gate:** create deterministic transport tests for partial/zero/false writes, source-read failure, peer stalls, timeout/no progress, truncated/malformed responses, valid clean/infected replies and both handles closing. Verify the intended protocol framing/verdict grammar before changing parsing. Only after reproducing a failure, add a small private checked write-all operation and bounded/fail-closed read handling. Keep transport errors as exceptions for the existing job failure path, not clean verdicts or fabricated infections.

Use controlled streams or isolated local socket fixtures with a test deadline, not a real ClamAV deployment for regression tests. Avoid retry loops without an overall bound. Do not change scan-document lifecycle, stored object deletion, application decisions or global scanner bindings. Real daemon evidence, if later desired, is additional and must name its isolated target. This security boundary warrants a dedicated owner/review rather than being bundled with media cleanup refactors.

## 6. Segmentation and sequence after implementation authorization

| Wave / owner | Tasks | Exclusive files and exit gate |
| --- | --- | --- |
| 0, backend response owner | A1 regression, repair, then optional eager-load extraction | SpeechController, SpeechSearch if extracting, SpeechResource only if necessary, predecessor tests. Preserve existing disclosure and query counts before merging |
| 1, frontend upload owner | E2 | UploadDashboard and its mock/real-store tests. Cache/lifecycle/invalidation evidence before acceptance |
| 1, media adapter owner | E3 | Both voice adapters and their tests. Existing copier/scratch changes only if separately justified; retain failure/quota evidence |
| 1, backend arc owner | E1 | SpeechArcService, ProfileTimelineController, ProfileTimelineTest and flagship query-count test. Wait for Wave 0 ownership release of shared tests; audit privacy result in context |
| 2, small backend reuse owner | D1/D2, optional D3/D4 | D3 requires SpeechController handoff; D4 requires SpeechSearch handoff. Moving identity helper includes explicit ownership of both existing resource consumers |
| 2, frontend authoring owner | E5, optional E6 after review | Composer/Transcript and optional selector, then controller/hooks. Avoid concurrent edits to authoring tests and preserve each selection/pause rule |
| 2, route owner | E4 only after baseline | App/router/loading boundaries and integration tests. Coordinate authoring/route fixtures; retain data-router and guard structure |
| Conditional, transport owner | A2 only after failing characterization | ClamdScanner and proposed dedicated transport tests, with separate security review |
| Integration, independent explorer | Entire selected diff | Recheck cross-worker request/response, visibility, cache, lifecycle, retry/cleanup and bundle context; repair findings before full acceptance |

These are ownership groups, not a requirement to run all workers simultaneously. A1/D3 share SpeechController; A1/D4 may share SpeechSearch; A1/E1 share flagship query tests. Give each file one active owner. Select optional tasks based on measured benefit and abstraction clarity rather than checking every item off.

## 7. Future validation and safety boundaries

After authorization, add meaningful behavioral characterization/regressions before risky changes; avoid tests that merely restate implementation. Run focused domain checks first, then full integration checks after combined review. Do not import previous pass counts as this revision's evidence.

- Backend: explicit `DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL='' php -d memory_limit=2G vendor/bin/pest --compact` from `api`, scoped first to touched tests. Run Pint `--test` and configured PHPStan. Use new isolated PostgreSQL fixtures for E1 query plans/visibility and D4's driver-sensitive behavior; inspect verifier guards before running scripts. No development database reset or reuse of prior fixture databases without checking their contract.
- Frontend: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` from `web`, focused first as appropriate. E2 needs a real configured RTK store with mocked HTTP; E5 needs real selection behavior, not snapshots of helper names. For E4 retain production build/network evidence and check CSS/chunks rather than merely silencing warnings.
- Browser: use isolated config/accounts/fixtures and execute nonzero cases for the affected upload, authoring, route or predecessor behavior. Inspect setup/reset/seed side effects before invocation. Preserve the developer stack. Record passed/skipped/flaky counts and distinguish deterministic recorder/local media from real hardware, SigV4 or full queued storage pipelines.
- Media: fake Process/storage tests prove branch/ownership semantics, not actual binaries/models/S3. Use existing guarded real smoke tests only in an isolated environment with available tools/model and explicit opt-ins; no model downloads/dependency upgrades are part of this plan.
- Safety: no real-user purge/scan/delete runs, cleanup sweeps, device changes, staging/commit, deployment, broad formatting or history rewriting. New tests may create only explicitly isolated disposable fixture data. Retain evidence and stop only task-created services when finished.

Final acceptance requires no broadened access or payload, unchanged omission/null and 403/404/410 distinctions except separately proven A1 correction, preserved request/PATCH/cache/identity semantics, no added per-row serialization queries, and fresh evidence for each claimed efficiency gain. Independent combined review must inspect all selected tasks together before declaring completion.

## 8. Exclusions and deferred work

- Prior platform M4 normalization settlement, generic Whisper/job executors, erasure lifecycle serialization, reconciler lock redesign and Friends presentation/menu/action abstractions remain deferred.
- No global API-slice merger, schema redesign, new global authorization helper, generated cross-language policy system, dependency upgrades or automatic migration.
- Search pagination/full-text/truncation changes alter the current result contract and require separate design; don't add limits to the unbounded search API under a helper extraction.
- Export streaming is a larger output/order/consistency change; annotations are already batched. Sweep chunking in purge/reconcile commands changes snapshot/count/concurrency behavior while deleting rows and needs separate design.
- Composer's quadratic legacy-overlap scan is memoized and bounded; profile before proposing a sweep algorithm that must preserve half-open ranges, point collisions and fail-closed invalid timing.
- Transcript/crossedNotes use localeCompare while annotationOrder uses bytewise comparison. This is implementation inconsistency, not a confirmed production ordering bug. Decimal persisted IDs and optimistic temporary IDs need characterization before changing tie ordering; don't silently include it in E5/E6.
- Short cross-slice invalidation callbacks, dashboard query builders, display names and timing formatters have meaningful local differences. Their abstraction benefit is currently too small to justify broader coupling.

## 9. Independent plan-review record

A separate explorer checked all twelve candidates against current source and the completed plans. Focused frontend and media/jobs subreviews checked the risky efficiency boundaries independently. Reports returned to the main agent, which verified the relevant source and corrected the document:

| Review finding | Correction incorporated |
| --- | --- |
| Multipart factory test was linked under the wrong feature directory | D1 now links `Feature/Captions/MediaInitializeCommandTest.php`; all relative document links were checked |
| Voice copying could imply end-to-end unbuffered S3 or measured memory savings | E3 limits its claim to removing adapter-owned input strings, records the installed Laravel/Flysystem behavior, and excludes disk configuration changes |
| Generic untracked-mutation assumptions could miss version-specific delayed invalidation | E2 records the installed action-driven pending counter and requires real-store concurrent lifecycle/invalidation coverage |
| Success-only quota refresh differs from complete/abort Speech invalidation on failed requests | E2 explicitly preserves and tests both distinct rules |
| Speech-only route splitting leaves Uppy reachable through the coach application | E4 includes BecomeACoach/CoachDocumentUpload and requires all-entry/shared-chunk evidence before claiming deferral |
| A composite voice identity index could tighten the existing hint cleanup rule | E6 retains hint ID-plus-ready matching separately from active/queue ID-plus-asset-plus-ready matching |

The final independent report found no blocking plan error. It confirmed A1's source path and proposed visibility boundary, E1's per-root batching/redaction constraints, E5's differing active-tie behavior, D2–D4's bounded equivalences, A2's test-first gate, file handoffs and prior deferrals. No implementation was performed by any explorer or the main agent. A1/A2 still require runtime characterization during a later authorized implementation; benchmark-dependent benefits remain unmeasured.

Only this planning document may change during the audit. Source inspection is not platform execution or validation; implementation and its acceptance checks remain unexecuted.
