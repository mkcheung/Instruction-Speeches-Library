# Plan: apply DRY to the voice backend (items B1–B5)

**Status:** rev 2, 2026-11-14. **Validated in a scratch copy; not implemented in the repo.**
- **How it was written:** rev 1 was a read-only review of `api/`, plus a `web/` grep for B4. Every `file:line` below was read in the baseline tree.
- **Validation (rev 2):** the plan was applied to a scratch copy of `api/` at `b2b2bee`, one commit per step, with CI's three backend commands after each (§7). Every §7 mutation check was run. §10 lists the findings and their fixes; the text below is corrected.

  | Step | pint | phpstan errors | pest tests / passed / skipped |
  |---|---|---|---|
  | Baseline | pass | 0 | 1451 / 1416 / 35 |
  | §0 | pass | 0 | 1504 / 1469 / 35 |
  | §1 B2a | pass (failed on rev 1's import list) | 0 | 1509 / 1474 / 35 |
  | §2 B2b | pass | 0 | 1511 / 1476 / 35 |
  | §3 B4 | pass | 0 | 1511 / 1476 / 35 |
  | §4 B5 | pass | 0 | 1512 / 1477 / 35 |
  | §5 B1 | pass (failed on rev 1's import list) | 0 | 1519 / 1484 / 35 |
  | §6 B3 | pass | 0 | 1519 / 1484 / 35 |
  | §6.5 (optional) | pass | 0 | 1519 / 1484 / 35 |

  - C-4c was added after the step-by-step run. It passed on the baseline code and on the final tree.
  - The §6.5 row is the final measured run, which includes C-4c. The §0–§6 rows are each step's measured count plus C-4c.

**Scope:** backend only (`api/app`, `api/database/factories`, `api/tests`). No migration, route, payload or `web/` change. §9 has notes for the schema and frontend plans.

**Baseline:** `development` at `b2b2bee`. The only uncommitted file is `PLAN-DRY-VOICE-PLAYBACK.md`, so `api/` is clean.

**Line numbers** refer to that baseline. Each step shifts the lines after it.

**Names fixed for the sibling plans.** PLAN-DRY-SCHEMA-STATUS-CONTRACT.md compares the DB CHECK lists to these enums. Do not rename them.
- `App\Enums\SpeechAssetStatus`, file `api/app/Enums/SpeechAssetStatus.php`, string-backed. Cases: `Uploading = 'uploading'`, `Processing = 'processing'`, `Ready = 'ready'`, `Failed = 'failed'`.
- `App\Enums\TranscriptStatus`, file `api/app/Enums/TranscriptStatus.php`, string-backed. Cases: `NotApplicable = 'not_applicable'`, `Pending = 'pending'`, `Processing = 'processing'`, `Ready = 'ready'`, `Failed = 'failed'`. **It is included in this plan** (§2).
- Each enum has the built-in `cases()` and a static `values(): list<string>` in CHECK order. **Neither is an Eloquent cast** (decision in §1.2).

## Goal

| # | Duplication | One owner after |
|---|---|---|
| B2 | Status words typed as bare strings, with no enum: 37 asset-status lines and 26 transcript-status lines in the voice pipeline, plus 65 asset-status lines elsewhere in `app/` | `SpeechAssetStatus` and `TranscriptStatus` (values only), plus `SpeechAsset::isReady()` |
| B4 | The 200-annotation cap: 4 checks and 1 message | `Review::MAX_ANNOTATIONS` and `Review::hasRoomForAnnotation()` |
| B5 | "Mark the transcript failed if the dispatch throws": 2 copies | `TranscribeVoiceNote::dispatchOrMarkFailed()` |
| B1 | Normalization-failure settlement: **3 copies** (the brief named 2), with 2 drifts | `App\Services\Voice\FailVoiceNormalization::execute()` |
| B3 | Purge-claim stamp, claim-guarded relock and the "bytes held" formula: 3 voice copies (+2 non-voice copies, optional) | `App\Support\AssetPurgeClaim` and `SpeechAsset::chargedBytes()` |

**No user-visible or API change.**
- B1 changes four things. None of them is reachable in production today (§5.3).
- B3 merges two UPDATEs into one in reviewer erasure. The row ends in the same state.

## What the review established

### The brief, checked

- ✓ **No PHP enum exists anywhere in `api/app`.** There is no `app/Enums/` and no `enum` declaration.
- ✓ **Tests run on SQLite `:memory:`** (`api/phpunit.xml:26-27`), with `QUEUE_CONNECTION=sync` (`:30`). Production is Postgres.
- ✓ **CI's backend commands:** `./vendor/bin/pint --test` (`.github/workflows/ci.yml:81`), `php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G` (`:85`), `./vendor/bin/pest` (`:99`).
  - phpstan runs at level 8 over `app`, `config`, `database` and `routes`, **not** `tests` (`api/phpstan.neon`).
  - Pint uses the `laravel` preset (`api/pint.json`) over the whole project, tests included.
- ✓ **`speech_assets.status` CHECK** allows exactly `uploading, processing, ready, failed`, and the default is `uploading`.
  - On SQLite the live definition is `2026_08_18_110001_enable_voice_note_assets.php:48`, because that migration rebuilds the table.
  - On Postgres it is still `2026_08_08_150003_create_speech_assets_table.php:101`. Later migrations re-add only the kind/format CHECKs (`2026_08_08_160001…:109-125`, `2026_08_18_110001…:83-98`).
  - The other copies are at `150003:64`, `160001:79, :179` and `110001:131`.
- ✓ **`annotations.transcript_status` CHECK** allows exactly `not_applicable, pending, processing, ready, failed`, and the default is `not_applicable`. See `2026_08_18_110002_add_voice_audio_to_annotations.php:23, :28` (SQLite) and `:41, :45` (Postgres).
- ✓ **The brief's line ranges for B1, B3, B4 and B5 are right.** Corrections:
  - **B1 has a third copy:** `MediaReconcileCommand.php:138-163`, with its own differences (table below).
  - **The B3 claim stamp and claimed relock also appear in non-voice code:** `PurgeSpeechMedia.php:306-340` and `AccountErasureService.php:318-349` (§6.5).
  - **The processor's failure exit has 7 call sites:** `:33, :40, :49, :55, :58, :78, :140`. Its own comment says six (`FfmpegVoiceNoteProcessor.php:182`).
- **A prior decision this plan must honor.** `PLAN-DRY-PLATFORM.md` already looked at B1 and B3:
  - **M4 (`:170-178`)** deferred B1. Sharing it "would require policy switches for existing transcript failure-code and final-cleanup status differences" (`:241`). This plan decides each drift, so no switch is left.
  - **M3 (`:160-168`)** shared only the object-deletion loop (`StorageObjectRemover`). It said: "Keep each claim/restore predicate, asset-before-annotation lock order, transaction wrapper, audit and quota amount/payer local … Do not merge these protocols" (`:166`). B3 stays inside that line (§6.1).

### Statuses (B2)

- **`SpeechAsset` has no `status` cast** (`SpeechAsset.php:117-133`) and declares `@property string $status` (`:36`).
  - `AnnotationResource.php:46` sends `audio_status` as that raw string, and `SpeechAssetResource.php:25` does the same.
- **These look like speech-asset statuses but are not.** Leave them alone:
  - `data_exports.status` uses the same three words (`2026_08_20_100003_create_data_exports_table.php:45`). The sites are `PrivacyExportController.php:30, :64`, `GenerateDataExport.php:62, :80, :91`, `PurgeExpiredExportsCommand.php:39` and `DataExportFactory.php:24, :32`.
  - `DeterministicCaptionTranscriber::setStatus` (`:95, :143, :164-167`) writes Redis keys.
  - `AdminLoginDestination.php:118-131` matches Horizon URL segments.
- **No raw SQL reads or writes `speech_assets.status` in `app/`.** `ProfileTimelineController.php:62` filters a join with the query builder (`poster.status`).
- **Filament never renders an asset status.** It compares one (`Filament/Resources/SpeechResource.php:343`) and filters one (`:432`), both for video.
- **The query builder accepts backed enums as bindings** in Laravel 13.24: `castBinding` → `enum_value` (`vendor/…/Query/Builder.php:4703-4706`), and `update()` handles `UnitEnum` (`:4309`). This plan still writes `->value` everywhere (Ground rules).

### Normalization failure (B1): three copies, and when each runs

- **The processor's failure exit**, `FfmpegVoiceNoteProcessor::fail` (`:165-209`).
  - It runs inside `NormalizeVoiceNote::handle` (`:46`), at seven known-failure exits, each with its own code:
    - `voice_storage_failed` at `:33, :78, :140`;
    - `voice_invalid_audio` at `:40, :55`;
    - `voice_normalization_failed` at `:49`;
    - `voice_duration_exceeded` at `:58`.
  - It returns `false`, so `handle` stops before dispatching transcription (`:46-51`).
- **The queued backstop**, `NormalizeVoiceNote::failed` (`:70-112`). Its code is always `voice_normalization_failed`.
  - The job has `$tries = 1` and `$failOnTimeout = true` (`:24-26`), so the worker calls `failed()` exactly once when `handle` throws or times out. Causes:
    - an FFmpeg timeout (`FfmpegVoiceNoteProcessorTest.php:157`);
    - a storage exception;
    - the processor's rethrow (`FfmpegVoiceNoteProcessor.php:96`);
    - the transcription-dispatch rethrow (`NormalizeVoiceNote.php:65`). By then the asset is `ready`, so `failed()` does nothing (`:73`).
  - `VoiceNoteService::create`'s catch also calls it synchronously (`VoiceNoteService.php:105-111`), when the post-commit upload or dispatch fails.
- **The reconcile sweep**, the `processing` branch of the stale-voice loop (`MediaReconcileCommand.php:138-163`, inside `:98-173`).
  - It picks voice assets that have a temporary path, had no purge claim when the batch was read, and have an `updated_at` older than `--transcode-hours` (default 2).
  - It is the only path that runs after a hard kill, when no `failed()` runs.
  - It runs daily in production and every minute in e2e (`routes/console.php:20-24`).

| | Processor (`:165-209`) | Backstop (`:70-112`) | Reconcile (`:138-163`) |
|---|---|---|---|
| Check before the transaction | none | status is processing and the temp path matches (`:73`) | the batch query (`:98-100`) |
| Lock predicate | processing, no purge claim, same temp path (`:168`) | same (`:78`) | processing, same temp path. **No purge-claim check** (`:140`) |
| Once-only release sentinel | stop if `temporary_byte_size` is null (`:169`) | same (`:79`) | same (`:141`) |
| Reserved bytes come from | the snapshot at `process()` entry (`:26`) | `failed()`'s own read (`:76`) | the batch snapshot, `?? 0` (`:113`) |
| `failure_code` | the caller's code | `voice_normalization_failed` | `voice_normalization_failed` |
| `failure_detail` | "We had trouble processing this voice note. Please record it again." | same | "Voice normalization did not complete." |
| Transcript update | pending/processing → failed, **and `transcript_failure_code` → null** (`:177-179`) | → failed, code untouched (`:95`) | → failed, code untouched (`:145`) |
| Reviewer resolved | under the lock (`:189`) | same (`:92`) | same (`:148`) |
| Ledger clear after the deletes | **requires `status = failed`** and the same temp path (`:205`) | same temp path only (`:110`) | same temp path only (`:162`) |
| Quota service | injected (`:191`) | `app()` (`:97`) | injected (`:150`) |

**Which behavior is correct for each drift:**

1. **`transcript_failure_code` → null (the processor is right).**
   - `STEP-10-FROZEN-CONTRACT.md:347` freezes "normalize failure asset=failed, transcript=failed". `:350-351` says the backstop "must guardedly reach **the same failure state**" as the primary path, which is the processor.
   - The transcript codes are a closed set of *transcription* failures (`:313-320`). None of them means "the audio never normalized".
   - The public `failure_code` uses the asset's code first (`AnnotationResource.php:48`), so a transcript code would never show here.
   - Every other writer of a terminal or reset transcript state writes the code as well:
     - `TranscribeVoiceNote.php:55` (null) and `:71` (code);
     - `VoiceAnnotationController.php:94` (null);
     - `PurgeDeletedVoiceAnnotation.php:56` (null);
     - `EraseReviewerVoiceNotes.php:57` (null).

     The backstop and the reconcile copy are the only exceptions.
   - **Not reachable today.** While a transcript is pending or processing, its code is already null:
     - it is created without a code (`VoiceNoteService.php:85-92`);
     - retry nulls it (`VoiceAnnotationController.php:94`);
     - the worker's claim only changes the status (`TranscribeVoiceNote.php:41-43`).

     No test in `api/tests` pins either behavior. §5.5 adds one.
2. **The ledger clear keeps its `status = failed` filter (the processor is right).**
   - The filter is a compare-and-set on the state this routine just wrote.
   - The ledger columns (`temporary_path`, `normalization_candidate_path`) name objects that may still exist. The contract requires a durable row naming every stored key (`STEP-10-FROZEN-CONTRACT.md:95-99`).
   - The sweep's own failed-branch clear filters the same way (`MediaReconcileCommand.php:170`).
   - **Not reachable today:** nothing moves a voice asset out of `failed`. The only writers of `processing` or `ready` are:
     - creation (`VoiceNoteService.php:81`);
     - the publish CAS, which requires `processing` (`FfmpegVoiceNoteProcessor.php:84-88`, `FakeVoiceNoteProcessor.php:31-36`);
     - code for other kinds: `SpeechUploadController.php:228, :255` retries only `video` and `captions`, and the captions and transcoding code never touches voice notes.

     No test pins it. §5.5 adds one.
3. **The reconcile copy must re-check the purge claim under its lock**, as the other two do.
   - The contract forbids "overwriting erasure or newer state" (`STEP-10-FROZEN-CONTRACT.md:351`).
   - This is reachable only in the window between the sweep's batch read and its lock (§5.3).

### Purge (B3): what differs on purpose

| | `PurgeVoiceAsset` (`:28-73`) | `PurgeDeletedVoiceAnnotation` (`:29-63`) | `EraseReviewerVoiceNotes` (`:18-75`) |
|---|---|---|---|
| Triggered by | `ReviewService::revokeAndPurge` (`ReviewService.php:388`, after commit, no delay); the orphan sweep (`MediaReconcileCommand.php:197-211`) | annotation delete, after a 10 s delay (`AnnotationService.php:211`); `clearAnnotations` (`ReviewService.php:635-638`); the tombstone sweep (`MediaReconcileCommand.php:182-195`) | `EraseSelfAccount` (`EraseSelfAccount.php:73`); account erasure step 3(a) (`AccountErasureService.php:192`) |
| Annotation | hard-deleted (the review delete cascades) | soft-deleted | live; kept as text |
| Retries | `$tries = 3` (`:21`) | `$tries = 3` (`:22`) | the job has `$tries = 3`, backoff 30/120 s and a 600 s timeout (`EraseSelfAccount.php:21-47`), and re-plucks the remaining notes (`:37-39`) |
| Claim locks, in order | asset (`:41`) | asset, then annotation (`:36-37`) | an unlocked snapshot, then asset, then annotation (`:26-31`) |
| Claim guard | asset exists and is a `voice_note` (`:42`) | both exist, the annotation is trashed, the FK matches (`:38`) | both exist, the FK matches (`:32`) |
| Status change at claim | none (`:46`) | `status = failed`, no code (`:42`) | only if `processing`: failed, `voice_storage_failed`, "Voice note is being erased." (`:36-38`), as a separate UPDATE |
| Bytes to release are read | at finalize, from the relocked row (`:65`) | **at claim** (`:44`) | at finalize (`:53`) |
| Payer | the job argument, else `purge_reviewer_id` (`:53`), looked up at finalize (`:68`) | the review's `reviewer_id`, read at claim (`:44`), looked up at finalize (`:58`) | the `User` passed in (`:62`) |
| Finalize locks | asset by claim (`:61`) | asset by claim, then annotation (`:51-52`) | asset by claim, then annotation (`:48-49`) |
| Annotation update | none | FK null, `not_applicable`, code and attempt null (`:56`) | FK null, `ready` if the body is non-empty else `not_applicable`, code and attempt null (`:54-59`) |
| Delete-failure message | "Voice asset purge failed." (`:59`) | "Voice-note object deletion failed." (`:49`) | "Voice-note erasure failed; reviewer identity was retained." (`:46`) |

**Why the copies differ.** The code never says. All three arrived in `bd09eb3`, so the reasons below are inferred from the call paths:
- **`PurgeDeletedVoiceAnnotation` marks the asset `failed` so that it can read the amount at claim time.**
  - After the mark, every writer that reconciles a reservation stops matching. They filter on `ready` (`FfmpegVoiceNoteProcessor.php:122`, `MediaReconcileCommand.php:119`) or on `processing` (`FfmpegVoiceNoteProcessor.php:168`, `NormalizeVoiceNote.php:78`).
  - So nothing changes `temporary_byte_size` or `byte_size` before finalize. The one exception is the test-only cleanup at `FakeVoiceNoteProcessor.php:49`, which has no status filter.
  - It sets no `failure_code` because a trashed annotation is never serialized.
- **`PurgeVoiceAsset` changes nothing because its caller already did.**
  - `revokeAndPurge` fails processing assets with `voice_storage_failed` (`ReviewService.php:386`), in the same transaction that sets `purge_reviewer_id` (`:383-385`).
  - A `ready` asset stays `ready`, so the processor's temporary-object cleanup can still run before finalize. That is why this job reads the amount at finalize.
- **Erasure fails only `processing` assets because the annotation stays live, and the speaker sees it.**
  - A processing note would otherwise show "processing" for as long as erasure retries.
  - A ready note stays playable and consistent if deletion fails ("reviewer identity was retained"; `VoiceAnnotationHttpTest.php:557`).
  - This is the same transition and code as `revokeAndPurge`.
  - It reads the amount at finalize for the same reason `PurgeVoiceAsset` does.

**What all three share:**
- The claim id is reused if present (`purge_claim_id ?? uuid`), and the candidate paths are captured at claim time.
- `StorageObjectRemover::deleteExisting` deletes the objects. It throws before finalize, so the rows survive for a retry.
- Finalize runs only while `purge_claim_id` still equals this claim.
- The amount formula is `temporary_byte_size ?? byte_size ?? 0`, and the release happens only when the amount is positive.
- The row delete and the release share one transaction, so a retry finds no row and cannot release twice.
- Every transaction goes through `AnnotationTransactions::run`, which replays the whole closure on `40P01`/`40001` (`AnnotationTransactions.php:21-67`).
- No job is `ShouldBeUnique`. Concurrent runners serialize on the asset lock and share one claim id.

**A test gap.** `VoiceLifecycleTest.php:238` ("reuses an existing purge claim rather than minting a second one on retry") would still pass if a fresh id were minted: the claim UPDATE would overwrite the id, and finalize would match the new one. §0.5's P-2 pins reuse directly.

### Cap (B4)

- **The four checks:**
  - `AnnotationService.php:99`, text create;
  - `AnnotationService.php:226`, point restore;
  - `VoiceNoteService.php:47`, voice create;
  - `VoiceAnnotationController.php:134`, voice Undo.

  All four read the `annotations_count` counter cache under the review's row lock. The message is at `AnnotationCapExceededException.php:26`. The rule comes from `MODERNIZATION_PLAN.md:2088` ("reject >200 per set at write time").
- **"There is no hard cap" (`STEP-10-FROZEN-CONTRACT.md:465`) is about the six-voice-note warning (R23),** not this limit. The 200 cap counts voice notes too.
- **No DB CHECK enforces the cap** (`2026_08_09_100001_create_reviews_table.php:74-83`).
- **`web/` has no copy of the cap or its text.**
  - The only mention is a comment at `AnnotationComposerPanel.tsx:202`.
  - The editor shows the server's 422 message (`useAnnotationEditor.ts:56`).
  - No frontend work is needed.
- **Coverage:** point restore at the cap is tested (`AnnotationTimingHttpTest.php:142`). **Text create, voice create and voice Undo at the cap are not.**
  - `AnnotationWriteHttpTest.php:94` looks like the text-create test, but it asserts only the status.
  - Its 200 random factory rows overlap `start_seconds` 5.0. With the cap check removed, the request still gets a 422, from `annotation_overlap`. Validation confirmed it stays green under the `<=` mutation (§7).
  - C-4c (text create), C-4 (voice create) and C-5 (voice Undo) pin the three (§0.2).

### Dispatch-or-fail (B5)

- **`VoiceAnnotationController.php:99-108` and `NormalizeVoiceNote.php:57-66` are the same code.**
  - Each dispatches `TranscribeVoiceNote`.
  - On a throw, each does a compare-and-set (same annotation, same asset, same attempt, still `pending`) to `failed` plus `voice_transcription_failed`, then rethrows.
  - Only the variable sources differ. The controller passes `$fresh->…` uncast to the update but cast to the dispatch (`:100`). The values are the same: `:91` guarantees the asset id, and `:93-94` set the attempt.
- **`PendingDispatch` pushes the job in its destructor**, at the end of the `::dispatch(...)` statement. That is why the throw lands inside the `try`. Both existing tests rely on it (`VoiceLifecycleTest.php:182`, `VoiceAnnotationHttpTest.php:404`).
- **`TranscribeVoiceNote::markFailed` (`:67-72`) is not the same rule:** it also matches `processing`. B5 keeps the pending-only predicate.

## Ground rules

- **The enums carry values only; there is no cast** (decision in §1.2).
  - App code compares and writes `SpeechAssetStatus::X->value` and `TranscriptStatus::X->value`.
  - **Never put a bare case into a model `update()` or `create()` array.** The query builder would still store the right string (`enum_value`), but the in-memory attribute would become an enum, and later `===` checks in the same request would silently fail.
- **Tests keep their string literals** (`'ready'`, `'failed'`, …).
  - They pin the stored and wire values. Switching them to the enum would hide a wrong enum value.
  - The new tests in this plan use strings too.
- **Migrations and seeders keep their literals.**
  - Never edit an applied migration (PLAN-DRY-VOICE-PLAYBACK.md §7 #10).
  - The E2E seeders write raw `DB::table` rows, which the CHECK validates. Leave them.
- **Keep storage I/O outside `AnnotationTransactions::run` closures.** The wrapper replays a closure after a deadlock (`AnnotationTransactions.php:24-54`).
- **Resolve `StorageObjectRemover` from the container on every call** (`app(StorageObjectRemover::class)`), as the code does today. The §0.5 tests swap it with `app()->instance()`.
- **Pint's `laravel` preset fails `--test` on unused or unsorted imports**, in tests as well. Each step lists the imports to add and remove.
- **Two Pest gotchas:**
  - A Closure inside a dataset is *called* by Pest before the test runs. So the datasets here carry entry-point names, and a helper picks the code path by name.
  - Every `function` declared in a test file is global for the whole run, so new helper names must be unique under `tests/`. The names below were grepped and none exist yet.
- **Host memory:** run pest and phpstan with `php -d memory_limit=1G`. The host php.ini allows 128M, and a full pest run otherwise crashes in a way that looks like an `AvatarExifStripping` failure.
- **Order:** §0 → §1 (B2a) → §2 (B2b) → §3 (B4) → §4 (B5) → §5 (B1) → §6 (B3) → optional §6.5. Make one commit per step, and run CI's three commands after each (§7).
  - §0 adds only tests that pass on the baseline, so every later step is checked by tests that were already green before it.
  - B2 goes first, so the B1, B3 and B5 helpers are written with the enums from the start. B2 also converts lines that B1 and B5 later move or delete. That keeps each commit's "no literal left in these files" check simple.
  - B1 adds 7 tests, 5 of which are red on the tree before B1 by design. They go in B1's commit: write them, see them red, then refactor.

## §0 Characterization tests (test-only commit; all pass on the baseline)

All new tests use `Storage::fake('media')` or a swapped remover. None of them touches real storage (PLAN-DRY-PLATFORM.md:168).

### 0.1 Status sites (B2)

**C-1. The playback URL for each status.** Append to `VoiceAnnotationHttpTest.php` and reuse `voiceReview()` (`:21-32`):

```php
it('maps each voice asset status to its playback-url response', function (string $status, int $code, ?string $message) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->for($speech)->voiceNote()->create([
        'status' => $status,
        'failure_code' => $status === 'failed' ? 'voice_invalid_audio' : null,
    ]);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'pending']);

    $response = $this->actingAs($coach)->withHeader('Accept', 'application/json')
        ->getJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}/voice-playback-url")
        ->assertStatus($code);
    if ($message !== null) {
        $response->assertJsonPath('message', $message);
    }
    if ($status === 'failed') {
        $response->assertJsonPath('failure_code', 'voice_invalid_audio');
    }
})->with([
    'processing' => ['processing', 409, 'Voice note is still processing.'],
    'failed' => ['failed', 409, 'Voice note could not be processed.'],
    'uploading' => ['uploading', 404, null],
    'ready' => ['ready', 200, null],
]);
```

**C-2. Retry is refused until the audio is ready** (`VoiceAnnotationHttpTest.php`):
- Name: "refuses a transcript retry while the voice audio is not ready". Dataset: `['processing', 'failed']`.
- Setup: a voice asset with that status, and an annotation whose transcript is `failed`, with a known attempt id `$old`.
- POST `…/voice-transcript/retry` → 409 with `message` "Voice audio is not ready.".
- Afterwards the transcript is still `failed` with attempt `$old`, and `Queue::assertNothingPushed()`.

**C-3. The worker never transcribes audio that is not ready.** Add to `VoiceLifecycleTest.php`, using `makeVoiceLifecycleFixture()` (`:25-35`):

```php
it('never transcribes a pending note whose audio is not ready', function (string $status) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, $speech, $review] = makeVoiceLifecycleFixture();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => $status]);
    $attempt = (string) Str::uuid();
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => '', 'transcript_status' => 'pending', 'transcript_attempt_id' => $attempt]);
    $transcriber = new class implements VoiceNoteTranscriberContract
    {
        public function transcribe(SpeechAsset $asset): string
        {
            throw new RuntimeException('must not be called');
        }
    };

    (new TranscribeVoiceNote($annotation->id, $asset->id, $attempt))->handle($transcriber);

    expect($annotation->fresh()->transcript_status)->toBe('pending')
        ->and($annotation->fresh()->transcript_failure_code)->toBeNull();
})->with(['processing', 'failed']);
```

If the guard at `TranscribeVoiceNote.php:38` broke, the transcriber's throw would be caught and the transcript marked `failed`, so this test catches it.

### 0.2 Cap (B4), in `VoiceAnnotationHttpTest.php`

**C-4. Voice upload at and below the cap.** Two tests, each using `voiceReview()`, `Queue::fake()` and `Storage::fake('media')`:
- **"rejects a voice upload at the annotation cap before reserving quota or storing bytes".**
  - Set `$review->update(['annotations_count' => 200])`, then POST `/api/speeches/{id}/voice-notes` with `Accept: application/json`.
  - Expect 422 with `message` = "This review already has the maximum of 200 annotations.".
  - Afterwards: no annotation on the review, no `voice_note` asset, `$coach->fresh()->storage_bytes_used` is 0, `Storage::disk('media')->allFiles()` is `[]`, and `Queue::assertNothingPushed()`.
- **"accepts a voice upload one below the annotation cap":** `annotations_count = 199`, and the upload gets 202.

**C-4c. Text create at the cap: "rejects a text annotation at the annotation cap".**
- Use `voiceReview()`, then `$review->update(['annotations_count' => 200])`. Create no annotation rows: live rows can fail the request on overlap first, which is how `AnnotationWriteHttpTest.php:94` hides the cap (see the Cap section).
- `postJson` to `/api/speeches/{id}/annotations` with a `client_uuid`, a body and `start_seconds` 5.0.
- Expect 422 with `message` = "This review already has the maximum of 200 annotations.". Afterwards the review has no annotation, trashed rows included.

**C-5. Voice Undo at the cap: "refuses a voice-note Undo at the annotation cap and keeps the note deleted".**
- Mirror `:437`: create a ready asset with a stored object and a `ready` annotation, set `annotations_count = 1`, then DELETE the annotation (204).
- Then set `annotations_count = 200` and POST `…/restore`.
- Expect 422. The annotation is still trashed, `annotations_count` is still 200, and `purge_claim_id` is still null.

### 0.3 Dispatch-or-fail (B5)

**C-6a. The retry endpoint (`VoiceAnnotationHttpTest.php`): "does not fail a newer transcript attempt when a retry dispatch fails".**
- Start like `:404`. Use a mocked dispatcher: `->once()->andReturnUsing(...)`. The closure first sets the annotation's `transcript_attempt_id` to a new `Str::uuid()` (`$newer`), then throws `RuntimeException('redis unavailable')`.
- Expect a server error.
- Afterwards the transcript is still `pending`, the attempt is `$newer`, and `transcript_failure_code` is null.

**C-6b. The job (`VoiceLifecycleTest.php`): "does not fail a newer transcript attempt when the post-normalization dispatch fails".**
- Start like `:182`, with the same mocked-dispatcher closure. Expect the throw.
- Afterwards the asset is `ready`, the transcript is `pending`, and the attempt is `$newer`.

### 0.4 Normalization failure (B1): new file `tests/Feature/Annotation/VoiceNormalizationFailureTest.php`

**Helpers** (global names, unique under `tests/`):

```php
function normalizationFailureFixture(): array
{
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    // 20 bytes reserved by this note, plus 100 held elsewhere: a double release shows up as 80, not a clamped 0.
    $coach = User::factory()->create(['storage_bytes_used' => 120]);
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id, 'status' => 'in_progress']);
    $temporary = 'voice-uploads/'.Str::uuid().'/source';
    $candidate = "speeches/{$speech->ulid}/voice/".Str::uuid().'.m4a';
    Storage::disk('media')->put($temporary, str_repeat('x', 20));
    Storage::disk('media')->put($candidate, 'normalized');
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create([
        'status' => 'processing', 'byte_size' => 20, 'temporary_path' => $temporary, 'temporary_byte_size' => 20,
        'normalization_candidate_path' => $candidate, 'updated_at' => now()->subHours(3),
    ]);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => '', 'transcript_status' => 'pending', 'transcript_attempt_id' => (string) Str::uuid()]);

    return [$coach, $review, $asset, $annotation, $temporary, $candidate];
}

/** Runs one settlement entry point. `$temporary` is the path the caller claims to own. */
function settleNormalizationFailure(string $entry, SpeechAsset $asset, string $temporary): void
{
    if ($entry === 'processor') {
        Process::fake();
        app()->bind(ScratchFiles::class, fn () => new class extends ScratchFiles
        {
            protected function allocate(string $prefix): string|false
            {
                return false; // the scratch-allocation exit: fail(..., 'voice_storage_failed'), FfmpegVoiceNoteProcessor.php:139-140
            }
        });
        expect((new FfmpegVoiceNoteProcessor(app(QuotaService::class)))->process($asset->fresh(), $temporary))->toBeFalse();
    } elseif ($entry === 'backstop') {
        (new NormalizeVoiceNote($asset->id, $temporary))->failed(new RuntimeException('worker lost'));
    } else {
        expect(Artisan::call('media:reconcile', ['--transcode-hours' => 2]))->toBe(0);
    }
}

dataset('normalization failure entries', [
    'processor exit' => ['processor', 'voice_storage_failed', 'We had trouble processing this voice note. Please record it again.'],
    'queued backstop' => ['backstop', 'voice_normalization_failed', 'We had trouble processing this voice note. Please record it again.'],
    'reconcile sweep' => ['reconcile', 'voice_normalization_failed', 'Voice normalization did not complete.'],
]);
```

Every test starts with `$this->seed(RoleSeeder::class); Storage::fake('media');`. Each must pass on the baseline for every row.

| # | Test | Rows | Asserts |
|---|---|---|---|
| N-1 | "settles a processing note once: asset and transcript failed, objects and ledger cleared, reservation released once" | 3 entries | Settle **twice**. Then: status `failed`; `failure_code`/`failure_detail` equal the row's values; `temporary_byte_size` null; `byte_size` 0; `temporary_path` and `normalization_candidate_path` null; transcript `failed`; coach at 100; temp and candidate objects missing |
| N-2 | "leaves an asset a purge has claimed untouched" | 3 entries | First run `SpeechAsset::query()->whereKey(…)->update(['purge_claim_id' => (string) Str::uuid(), 'updated_at' => now()->subHours(3)])` (the explicit `updated_at` keeps the sweep's age filter true). Then: status `processing`, `temporary_byte_size` 20, both ledger paths set, coach at 120, transcript `pending`, both objects present |
| N-3 | "ignores a temporary path it does not own" | `->with(['processor', 'backstop'])` | Settle with `'voice-uploads/someone-else/source'`. Same "untouched" assertions as N-2 |
| N-4 | "fails the transcript only while it is still in flight" | 3 entries × `['processing transcript' => ['processing', 'failed'], 'ready transcript' => ['ready', 'ready']]` (chained `->with()`, 6 tests) | Set the annotation's transcript to the first value, settle, expect the second |
| N-5 | "skips the release when the reviewer is gone but still fails and cleans the asset" | 3 entries | First run `Review::query()->whereKey($review->id)->delete()` (the cascade removes the annotation). Then: status `failed`, ledger cleared, coach still at 120 |
| N-6 | "keeps the ledger when an object cannot be deleted" | 3 entries | After the fixture, `Storage::shouldReceive('disk')->with('media')->andReturn($disk)`, where `$disk` is a `Filesystem` mock whose `exists` returns true and `delete` returns false. Settle once. Then: status `failed`, `temporary_byte_size` null, coach at 100, and both ledger paths **still set** |

N-1 through N-6 add 20 tests. B1's own tests (N-7 to N-9) are in §5.5.

M4's acceptance list (`PLAN-DRY-PLATFORM.md:178`) also names after-commit callback failure and rollback. The post-commit failure path is `VoiceAnnotationHttpTest.php:105`. The wrapper's rollback and replay rules are pinned by `tests/Unit/AnnotationTransactionsTest.php:27, :43, :68, :95`. They need no new test: B1 calls the same wrapper.

### 0.5 Purge (B3): new file `tests/Feature/Annotation/VoicePurgeClaimTest.php`

**Helpers:**
- `voicePurgeFixture(string $caller, string $status = 'ready'): array` creates:
  - a coach with `storage_bytes_used = 120`;
  - a voice asset with that `$status`, `byte_size = 8`, `temporary_byte_size = 20`, and a stored `temporary_path` and `path`;
  - a `ready` annotation with body "Kept transcript.".

  For `'purge deleted note'` it then calls `$annotation->delete()`. It returns `[$coach, $asset, $annotation]`.
- `runVoicePurge(string $caller, SpeechAsset $asset, Annotation $annotation, User $coach): void` picks the code path by name:
  - `'purge asset'` → `(new PurgeVoiceAsset($asset->id, $coach->id))->handle(app(QuotaService::class))`;
  - `'purge deleted note'` → `(new PurgeDeletedVoiceAnnotation($annotation->id))->handle(app(QuotaService::class))`;
  - `'erase reviewer'` → `app(EraseReviewerVoiceNotes::class)->execute($coach)`.
- **The remover seams** are anonymous subclasses of `StorageObjectRemover` (not `final`; it has no constructor), bound with `app()->instance(StorageObjectRemover::class, …)`. Each has a binding helper; the names were grepped and are unique under `tests/`:
  - **recording**, `bindRecordingVoicePurgeRemover(int $assetId, ArrayObject $seen): void`: stores `SpeechAsset::query()->whereKey($id)->value('purge_claim_id')` into `$seen`, then calls `parent::deleteExisting`;
  - **interleaving**, `bindInterleavingVoicePurgeRemover(int $assetId, array $write): void`: runs one query-builder `update($write)` on the asset, then calls `parent::deleteExisting`;
  - **failing**, `bindFailingVoicePurgeRemover(): void`: throws `new RuntimeException($failureMessage)`.

| # | Test | Rows | Asserts |
|---|---|---|---|
| P-2 | "reuses an existing purge claim id" | 3 callers | Pre-set `purge_claim_id = 'pre-existing-claim'`, then run with the recording remover. It saw `['pre-existing-claim']`, and the asset row is gone |
| P-3 | "reads the bytes to release at finalize, except the deleted-note purge, which reads them at claim" | `'purge asset' → 112`, `'erase reviewer' → 112`, `'purge deleted note' → 100` | The interleaving remover sets `temporary_byte_size = null`, standing in for a temporary-object cleanup that lands between claim and finalize. Expect the coach's `storage_bytes_used` to equal the row's number |
| P-4 | "stamps the claim and the caller's status before deleting, and keeps the row when deletion fails" | 3 callers × statuses (table below) | Failing remover; expect `RuntimeException` with the caller's message. Then: `purge_claim_id` not null; status, `failure_code` and `failure_detail` as listed; coach at 120; `Annotation::withTrashed()->find($annotation->id)->audio_asset_id` still equals the asset id |
| P-5 | "a hard purge without a reviewer id refunds the recorded purge reviewer" | 1 | Set `purge_reviewer_id = $coach->id`, then run `(new PurgeVoiceAsset($asset->id, null))->handle(...)`. Coach at 100 |
| P-6 | "releases the bytes once across two runs" | 3 callers | Run twice. Coach at 100; the asset row is gone |
| P-7 | "finalizes only while its claim still owns the row" | 3 callers | The interleaving remover sets `purge_claim_id = 'another-runner'`. Afterwards the asset row exists, the coach is at 120, and the annotation's FK is unchanged |

P-4 rows, as (caller, initial status) → (status, `failure_code`, `failure_detail`, message):
- `purge asset`, `ready` → `ready`, null, null, "Voice asset purge failed."
- `purge asset`, `processing` → `processing`, null, null, same message.
- `purge deleted note`, `ready` → `failed`, null, null, "Voice-note object deletion failed."
- `purge deleted note`, `processing` → `failed`, null, null, same message.
- `erase reviewer`, `ready` → `ready`, null, null, "Voice-note erasure failed; reviewer identity was retained."
- `erase reviewer`, `processing` → `failed`, `voice_storage_failed`, "Voice note is being erased.", same message.

P-3 pins *when* each caller reads the amount. It does not claim that either amount is right for this artificial interleaving: the `PurgeVoiceAsset` row is the latent leak in §8 #1. With it pinned, a fix becomes a deliberate, visible change.

P-2 to P-7 add 19 tests. **§0 totals 53 new tests:** 14 in §0.1–§0.3, 20 in §0.4 and 19 in §0.5.

## §1 B2a: `SpeechAssetStatus` and `SpeechAsset::isReady()`

### 1.1 The enum (new file `api/app/Enums/SpeechAssetStatus.php`)

```php
<?php

namespace App\Enums;

/**
 * Every value the `ck_speech_assets_status` CHECK allows, in CHECK order
 * (2026_08_18_110001_enable_voice_note_assets.php:48). Values only:
 * `SpeechAsset::$status` stays a plain string (no cast), so compare and
 * write `->value`. MODERNIZATION_PLAN §9.4 rule 3: status is the only
 * playback-readiness signal.
 */
enum SpeechAssetStatus: string
{
    case Uploading = 'uploading';
    case Processing = 'processing';
    case Ready = 'ready';
    case Failed = 'failed';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $status): string => $status->value, self::cases());
    }
}
```

If phpstan reports that `array_map` returns `array<int, string>` rather than `list<string>`, use `array_column(self::cases(), 'value')`; do not loosen the declared type.

### 1.2 Decision: values only, no cast

**What a cast (`'status' => SpeechAssetStatus::class` in `SpeechAsset::casts()`) would affect:**

| Area | Effect | Sites |
|---|---|---|
| `===`/`!==` against a string | always false. phpstan level 8 would report most of them, but only after `@property` changes to the enum | 32: `VoiceAnnotationController.php:65, :68, :71, :91`; `TranscribeVoiceNote.php:38`; `NormalizeVoiceNote.php:73`; `FfmpegVoiceNoteProcessor.php:22, :84`; `FakeVoiceNoteProcessor.php:17`; `EraseReviewerVoiceNotes.php:36`; `MediaReconcileCommand.php:114, :138, :164`; `SpeechUploadController.php:228, :268, :285`; `CaptionController.php:124`; `GenerateCaptions.php:89`; `RederiveTranscript.php:96`; `TranscodeSpeechAsset.php:146`; `GeneratePoster.php:96`; `PurgeSpeechMedia.php:350`; `DeterministicCaptionTranscriber.php:109, :152`; `WhisperTranscriber.php:147, :219`; `FfmpegTranscoder.php:690`; `EnsureCaptionJob.php:107`; `WhisperSmokeVerifyCommand.php:52`; `VoiceWhisperSmokeVerifyCommand.php:35`; `Http/Resources/SpeechResource.php:43`; `Filament/Resources/SpeechResource.php:343` |
| `in_array(…, true)` | always false | `EnsureCaptionJob.php:60, :150` |
| `Collection::where('status', 'ready')` on loaded models | loose `==` of an enum against a string is false. **Silent: phpstan cannot see it.** The poster list goes empty | `Http/Resources/SpeechResource.php:35` |
| String interpolation | runtime Error: an enum cannot be converted to a string | `VoiceWhisperSmokeVerifyCommand.php:36`, `WhisperSmokeVerifyCommand.php:53` |
| Query-builder `where`/`whereIn`/`update` | unchanged: strings and enums both bind (`Builder.php:4703-4706, :4309`) | all |
| Model writes with strings | still work through the cast's `from()`. An invalid string becomes a `ValueError` (stricter) | factories, `update()` arrays |
| JSON | unchanged on the wire: `json_encode` of a backed enum gives its value. But `toArray()` would return the enum | `AnnotationResource.php:46`, `SpeechAssetResource.php:25`; `CaptionResource.php:28` declares `status: string` |
| Filament | no column renders it; only `:343` (a comparison) and `:432` (a builder filter) | 2 |
| Raw `DB::table` reads and writes | strings either way; two types in one codebase | E2E seeders, `ProfileTimelineController.php:62` |
| Tests | about 89 `->status)->toBe('…')` asset-status assertions in 16 files would fail, loudly | e.g. `FfmpegTranscoderTest.php` (15), `CaptionSettingsTest.php` (13), `WhisperTranscriberTest.php` (10), `VoiceLifecycleTest.php` (6) |

**Recommendation: values only, with no cast.**
- **A cast is all-or-nothing.** Every one of the ~100 app sites and ~89 assertions has to change in one commit, and the `Collection::where` mode fails silently.
- **Values-only changes no runtime type,** so the voice files can convert now and the rest later.
- **phpstan still guards the converted code.** A forgotten `->value` in a comparison (`string === SpeechAssetStatus`) is reported as always false.
- §8 #6–7 record what would make a cast cheap later.

### 1.3 `SpeechAsset::isReady()`, used where the voice code needs "playable"

Add to `SpeechAsset.php`, after `voiceAssetCandidatePaths` (`:109-112`), and add `use App\Enums\SpeechAssetStatus;` to its imports. The §1.4 table does not list this file.

```php
/**
 * MODERNIZATION_PLAN §9.4 rule 3: `status` is the only readiness signal,
 * never `path` existing. For a voice note, ready is exactly when its audio
 * is playable (VoiceAnnotationController::audioUrl).
 */
public function isReady(): bool
{
    return $this->status === SpeechAssetStatus::Ready->value;
}
```

It is named `isReady`, not `isPlayable`. The same predicate fits the non-voice readers listed in §1.5 (sprite, poster, captions, source), where "playable" would be wrong.

### 1.4 Conversions (voice pipeline only)

Add `use App\Enums\SpeechAssetStatus;` to every file below, in alphabetical order, **except `Jobs/TranscribeVoiceNote.php` and `Console/Commands/VoiceWhisperSmokeVerifyCommand.php`**. Their only conversions go through `isReady()`, so the import would be unused and fail `pint --test` (`no_unused_imports`).

| File | Line(s) | Before → after |
|---|---|---|
| `Http/Controllers/Api/VoiceAnnotationController.php` | :65, :68 | `'processing'`, `'failed'` → `SpeechAssetStatus::Processing->value`, `SpeechAssetStatus::Failed->value` |
| | :71 | `abort_unless($asset->status === 'ready', …)` → `abort_unless($asset->isReady(), …)` |
| | :91 | `$locked->audioAsset?->status === 'ready'` → `$locked->audioAsset?->isReady() === true` |
| `Jobs/TranscribeVoiceNote.php` | :38 | `$annotation->audioAsset?->status !== 'ready'` → `$annotation->audioAsset?->isReady() !== true` |
| `Jobs/NormalizeVoiceNote.php` | :73, :78 → `Processing`; :94 → `Failed` | §5 deletes these lines later |
| `Jobs/PurgeDeletedVoiceAnnotation.php` | :42 | `'status' => 'failed'` → `SpeechAssetStatus::Failed->value` |
| `Services/Voice/VoiceNoteService.php` | :81 | `'processing'` → `Processing->value` |
| `Services/Voice/FfmpegVoiceNoteProcessor.php` | :22, :63, :84, :168 → `Processing`; :88, :122 → `Ready`; :174, :205 → `Failed` | |
| `Services/Voice/FakeVoiceNoteProcessor.php` | :17, :22, :31 → `Processing`; :36 → `Ready` | |
| `Services/Voice/EraseReviewerVoiceNotes.php` | :36 → `Processing`; :37 → `Failed` | |
| `Services/ReviewService.php` | :386 | `where('status', 'processing')` and `'status' => 'failed'` |
| `Console/Commands/MediaReconcileCommand.php` (the voice loop `:98-173` only) | :114, :119 → `Ready`; :138, :140 → `Processing`; :144, :164, :170 → `Failed` | |
| `Console/Commands/VoiceWhisperSmokeSeedCommand.php` | :72 | `'processing'` → `Processing->value` |
| `Console/Commands/VoiceWhisperSmokeVerifyCommand.php` | :35 | `$asset->status !== 'ready'` → `! $asset->isReady()`. Keep the `{$asset->status}` message at `:36` |
| `database/factories/SpeechAssetFactory.php` | :31 → `Uploading`; :48 → `Ready`; :56 → `Failed` | used by every test |

That is 34 app lines plus 3 factory lines. `AnnotationResource.php:46` needs no change: the attribute is still a string.

### 1.5 Inventory left for a follow-up (no change in this plan)

Converting these is the same mechanical change. It belongs to the STEP-03, STEP-04 and STEP-09 owners and their tests, not to a voice plan.

| Area | Sites |
|---|---|
| Upload and playback | `SpeechUploadController.php:123, :172, :179, :228, :255, :268, :285`; `Http/Resources/SpeechResource.php:35, :43`; `Support/AnnotationTiming.php:76`; `ProfileTimelineController.php:62` |
| Admin | `Filament/Resources/SpeechResource.php:343, :432` |
| Transcoding and poster | `TranscodeSpeechAsset.php:132, :134, :146`; `GeneratePoster.php:96`; `FfmpegTranscoder.php:255, :525, :690, :856`; `FakeTranscoder.php:26, :64` |
| Captions | `CaptionController.php:124`; `GenerateCaptions.php:89, :159, :162, :189, :192`; `RederiveTranscript.php:96`; `CaptionService.php:56, :72`; `CaptionAttemptTracker.php:113`; `DeterministicCaptionTranscriber.php:109, :118, :152, :157`; `EnsureCaptionJob.php:60, :64, :107, :109, :150, :180, :220, :223`; `FakeCaptionTranscriber.php:47`; `WhisperTranscriber.php:147, :167, :219, :224`; `WhisperSmokeSeedCommand.php:86`; `WhisperSmokeVerifyCommand.php:52` |
| Purge and reconcile (non-voice) | `PurgeSpeechMedia.php:350`; `MediaReconcileCommand.php:53, :60, :86, :92, :358, :374, :381, :424, :464, :475, :490, :501` |
| Seeders (leave, per Ground rules) | `E2EVoiceAnnotationSeeder.php:308, :336`; `E2ECaptionsSeeder.php:381, :422, :588, :643`; `E2ESeeder.php:452` |
| Tests (leave, per Ground rules) | about 89 status assertions in 16 files, plus factory and `create()` arrays |

### 1.6 Tests (B2a's commit)

New file `tests/Unit/StatusEnumsTest.php`:
- **"lists every speech asset status the schema allows, in CHECK order":** `SpeechAssetStatus::values()` is `['uploading', 'processing', 'ready', 'failed']`.
- **"treats an asset as ready only when its status is ready":** a dataset with keys `uploading`, `processing`, `ready` and `failed`. For each, `(new SpeechAsset(['status' => $status]))->isReady()` is true only for `ready`. These are unit tests, so there is no DB; `status` is fillable (`SpeechAsset.php:70`).

That adds 5 tests. Existing coverage for the converted sites:
- `VoiceAnnotationHttpTest.php:34, :290, :391, :404, :580`;
- `VoiceLifecycleTest.php:48, :60, :72, :83, :116, :164, :182`;
- `FfmpegVoiceNoteProcessorTest.php:64, :88, :139, :157`;
- `MediaReconcileTest.php:91, :116`;
- §0's C-1 to C-3.

## §2 B2b: `TranscriptStatus`

### 2.1 The enum (new file `api/app/Enums/TranscriptStatus.php`)

```php
<?php

namespace App\Enums;

/**
 * Every value the `ck_annotations_transcript_status` CHECK allows, in CHECK
 * order (2026_08_18_110002_add_voice_audio_to_annotations.php:28). Values
 * only: compare and write `->value`.
 */
enum TranscriptStatus: string
{
    case NotApplicable = 'not_applicable';
    case Pending = 'pending';
    case Processing = 'processing';
    case Ready = 'ready';
    case Failed = 'failed';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $status): string => $status->value, self::cases());
    }

    /**
     * Attempts a worker may still finish: the states a failure settles.
     *
     * @return list<string>
     */
    public static function inFlight(): array
    {
        return [self::Pending->value, self::Processing->value];
    }
}
```

### 2.2 Conversions

Add `use App\Enums\TranscriptStatus;` to every file below.

| File | Line(s) |
|---|---|
| `Models/Annotation.php` | :62 `'not_applicable'` → `NotApplicable->value` |
| `Http/Controllers/Api/VoiceAnnotationController.php` | :92 → `Failed`; :94 → `Pending`; :105 → `Pending` and :106 → `Failed` (§4 moves these two) |
| `Jobs/NormalizeVoiceNote.php` | :63 → `Pending`; :64 → `Failed` (§4 moves); :95 `whereIn(…, ['pending', 'processing'])` → `TranscriptStatus::inFlight()` and `'failed'` → `Failed` (§5 deletes) |
| `Jobs/TranscribeVoiceNote.php` | :38, :42 → `Pending`; :43, :52 → `Processing`; :55 → `Ready`; :70 → `inFlight()`; :71 → `Failed` |
| `Jobs/PurgeDeletedVoiceAnnotation.php` | :56 → `NotApplicable` |
| `Services/AnnotationService.php` | :178 → `Ready` |
| `Services/Voice/EraseReviewerVoiceNotes.php` | :56 → `Ready` / `NotApplicable` |
| `Services/Voice/VoiceNoteService.php` | :90 → `Pending` |
| `Services/Voice/FfmpegVoiceNoteProcessor.php` | :177 → `inFlight()`; :178 → `Failed` |
| `Console/Commands/MediaReconcileCommand.php` | :145 → `inFlight()` and `Failed` |
| `Console/Commands/AuditAnnotationTimingCommand.php` | :30 → `NotApplicable` |
| `Console/Commands/VoiceWhisperSmokeSeedCommand.php` | :83 → `Pending` |
| `Console/Commands/VoiceWhisperSmokeVerifyCommand.php` | :92 → `Ready` |
| `database/factories/AnnotationFactory.php` | :29, both literals → `NotApplicable->value` |

That is 25 app lines plus 1 factory line. Leave the seeders (`E2EVoiceAnnotationSeeder.php:137, :158, :179, :200`) and the migration default.

### 2.3 Tests (B2b's commit)

Append to `tests/Unit/StatusEnumsTest.php`:
- **"lists every transcript status the schema allows, in CHECK order":** `['not_applicable', 'pending', 'processing', 'ready', 'failed']`.
- **"counts only pending and processing transcripts as in flight":** `inFlight()` is `['pending', 'processing']`.

That adds 2 tests. Existing coverage: `VoiceLifecycleTest.php:164, :182`; `VoiceAnnotationHttpTest.php:391, :404, :425, :479, :490`; and §0's N-4, C-3 and C-6.

## §3 B4: one named cap

### 3.1 Change

In `Review.php`, after `ACCESS_GRANTING` (`:100`):

```php
/**
 * MODERNIZATION_PLAN.md §10.4: "reject >200 per set at write time".
 * Every annotation counts, voice notes included. Read the
 * `annotations_count` counter cache under the review's row lock, never a
 * live COUNT(*).
 */
public const MAX_ANNOTATIONS = 200;

/** False once the review holds MAX_ANNOTATIONS live annotations. Call it on the locked row. */
public function hasRoomForAnnotation(): bool
{
    return $this->annotations_count < self::MAX_ANNOTATIONS;
}
```

**Call sites.** Each becomes `if (! $x->hasRoomForAnnotation()) { throw new AnnotationCapExceededException; }`, and each check stays exactly where it is (after the idempotent-repeat and trashed checks):
- `AnnotationService.php:99` (`$locked`) and `:226` (`$lockedReview`);
- `VoiceNoteService.php:47` (`$locked`);
- `VoiceAnnotationController.php:134` (`$review`, the locked row).

**The message.** `AnnotationCapExceededException.php:26` becomes `'This review already has the maximum of '.Review::MAX_ANNOTATIONS.' annotations.'`. Add `use App\Models\Review;`. The text stays byte-for-byte the same.

**Docblock.** In `AnnotationService.php:66`, change "The ≤200-per-set cap (§10.4)" to "The per-set cap (`Review::MAX_ANNOTATIONS`, §10.4)".

**Tests keep the literal 200** (`AnnotationWriteHttpTest.php:99-100, :109`, `AnnotationTimingHttpTest.php:145, :149`, C-4, C-4c, C-5). Changing the product number should take a deliberate test edit.

**Frontend:** nothing to do (see the Cap section above).

### 3.2 Tests

No new tests in this commit. Coverage comes from C-4, C-4c and C-5 (§0.2) and `AnnotationTimingHttpTest.php:142`. `AnnotationWriteHttpTest.php:94` does not pin the cap (see the Cap section).

## §4 B5: one dispatch-or-fail

### 4.1 Change

Add to `TranscribeVoiceNote.php`, after the constructor (`:28-33`):

```php
/**
 * Queue this attempt. If the queue rejects it, the attempt can never run,
 * so settle it as a retryable failure instead of leaving it pending forever
 * (compare-and-set: same annotation, asset and attempt, still pending),
 * then rethrow. Unlike markFailed(), a `processing` row is left alone.
 */
public static function dispatchOrMarkFailed(int $annotationId, int $assetId, string $attemptId): void
{
    try {
        self::dispatch($annotationId, $assetId, $attemptId); // PendingDispatch pushes at the end of this statement
    } catch (Throwable $exception) {
        Annotation::query()->whereKey($annotationId)->where('audio_asset_id', $assetId)
            ->where('transcript_attempt_id', $attemptId)->where('transcript_status', TranscriptStatus::Pending->value)
            ->update(['transcript_status' => TranscriptStatus::Failed->value, 'transcript_failure_code' => 'voice_transcription_failed']);
        throw $exception;
    }
}
```

**Call sites:**
- `VoiceAnnotationController.php:99-108` becomes `TranscribeVoiceNote::dispatchOrMarkFailed($fresh->id, (int) $fresh->audio_asset_id, (string) $fresh->transcript_attempt_id);`. These are the values the old catch matched, now cast (see the B5 section above).
- `NormalizeVoiceNote.php:57-66` becomes `TranscribeVoiceNote::dispatchOrMarkFailed((int) $annotationId, $asset->id, $attemptId);`, still inside the `is_string`/`is_numeric` guard at `:56`.

**Imports.** `NormalizeVoiceNote.php` drops `use App\Models\Annotation;`: `:60` was its only use. `Throwable` stays for `failed()`. Nothing changes in `VoiceAnnotationController`: it used the FQN `\Throwable`, and `Annotation` is still used.

### 4.2 Tests

Add to `VoiceLifecycleTest.php`: **"leaves a claimed transcript alone when a later dispatch fails".**
- The annotation's transcript is `processing` with attempt A, and a mocked dispatcher throws.
- `TranscribeVoiceNote::dispatchOrMarkFailed(…, A)` throws, and the transcript stays `processing`.

That adds 1 test. Existing coverage: `VoiceLifecycleTest.php:182`, `VoiceAnnotationHttpTest.php:404`, and C-6a/b.

## §5 B1: one normalization-failure settlement

### 5.1 Where it lives, and why

New class `api/app/Services/Voice/FailVoiceNormalization.php`, with the same `execute()` shape as `EraseReviewerVoiceNotes`.
- **Not in `FfmpegVoiceNoteProcessor`.** The job resolves `VoiceNoteProcessorContract`, which is `FakeVoiceNoteProcessor` under `testing` and the test worker (`AppServiceProvider.php:101-103`). The backstop and the sweep must work whichever processor ran.
- **Not on the contract.** The fake has no failure path.
- **Not on the model.** It releases quota and deletes storage.

### 5.2 The class

```php
<?php

namespace App\Services\Voice;

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;
use App\Models\SpeechAsset;
use App\Services\QuotaService;
use App\Support\AnnotationTransactions;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-10-FROZEN-CONTRACT.md:347: "normalize failure asset=failed,
 * transcript=failed". The one settlement behind every normalization
 * failure: the processor's own exits, NormalizeVoiceNote::failed() (also
 * reached from VoiceNoteService::create), and media:reconcile's
 * hung-normalization sweep. Guarded (contract :351) so it never overwrites
 * a purge claim, another upload's temporary path, or an asset that already
 * left `processing`.
 */
class FailVoiceNormalization
{
    public const DETAIL = 'We had trouble processing this voice note. Please record it again.';

    public function __construct(private readonly QuotaService $quota) {}

    /** True when this call settled the failure; false when the asset had moved on or another call settled it. */
    public function execute(int $assetId, string $temporaryPath, string $code, string $detail = self::DETAIL): bool
    {
        /** @var array{disk: string, candidate_path: string|null}|null $outcome */
        $outcome = AnnotationTransactions::run(function () use ($assetId, $temporaryPath, $code, $detail): ?array {
            $fresh = SpeechAsset::query()->whereKey($assetId)
                ->where('status', SpeechAssetStatus::Processing->value)->whereNull('purge_claim_id')
                ->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
            // temporary_byte_size is the once-only release sentinel: the first settlement nulls it.
            if ($fresh === null || $fresh->temporary_byte_size === null) {
                return null;
            }
            $reserved = (int) $fresh->temporary_byte_size;
            // Resolved under this lock: the annotation or review can be hard-deleted concurrently
            // (ReviewService::clearAnnotations/revokeAndPurge); a stale reviewer would skip the
            // release and leak the reservation for good.
            $reviewer = $fresh->voiceAnnotation()->first()?->review()->first()?->reviewer()->first();
            $candidatePath = $fresh->normalization_candidate_path;
            $fresh->update([
                'status' => SpeechAssetStatus::Failed->value, 'failure_code' => $code, 'failure_detail' => $detail,
                'temporary_byte_size' => null, 'byte_size' => 0,
            ]);
            $fresh->voiceAnnotation()->whereIn('transcript_status', TranscriptStatus::inFlight())->update([
                'transcript_status' => TranscriptStatus::Failed->value, 'transcript_failure_code' => null,
            ]);
            if ($reviewer !== null) {
                $this->quota->releaseDirect($reviewer, $reserved);
            }

            return ['disk' => $fresh->disk, 'candidate_path' => $candidatePath];
        });
        if ($outcome === null) {
            return false;
        }
        // Storage I/O stays outside the retryable transaction.
        $clean = true;
        foreach (SpeechAsset::voiceAssetCandidatePaths($temporaryPath, $outcome['candidate_path']) as $path) {
            $clean = (! Storage::disk($outcome['disk'])->exists($path) || Storage::disk($outcome['disk'])->delete($path)) && $clean;
        }
        if ($clean) {
            SpeechAsset::query()->whereKey($assetId)->where('status', SpeechAssetStatus::Failed->value)
                ->where('temporary_path', $temporaryPath)->update(['temporary_path' => null, 'normalization_candidate_path' => null]);
        }

        return true;
    }
}
```

This follows M4's acceptance rules (`PLAN-DRY-PLATFORM.md:176`):
- it keeps `AnnotationTransactions::run`;
- it resolves the reviewer under the lock;
- it checks the expected temporary path;
- it refuses a purge claim;
- it uses `temporary_byte_size !== null` as the once-only sentinel;
- it keeps storage I/O outside the closure.

The only parameters are data (`$code` and `$detail`), not policy.

### 5.3 Behavior changes, all listed

| Change | Processor | Backstop | Reconcile | Reachable in production? |
|---|---|---|---|---|
| `transcript_failure_code` → null | unchanged | **new** | **new** | No: the code is already null while a transcript is pending or processing (see "Which behavior is correct") |
| The ledger clear requires `status = failed` | unchanged | **new** | **new** | No: nothing moves a voice asset out of `failed` |
| The purge claim is re-checked under the lock | unchanged | unchanged | **new** | Only between the sweep's batch read (`:98-100`) and its lock (`:140`); see below |
| No pre-check before the transaction | n/a | removed (`:72-75`) | n/a | No: the same predicates run under the lock, so the only difference is one extra empty transaction |
| Reserved bytes are read from the locked row | was the entry snapshot (`:26`) | was its own read (`:76`) | was the batch snapshot, `?? 0` (`:113`) | No: the value is identical. `temporary_byte_size` is written non-null once (`VoiceNoteService.php:81`) and after that only nulled (`NormalizeVoiceNote.php:94`, `FfmpegVoiceNoteProcessor.php:135, :175`, `FakeVoiceNoteProcessor.php:57`, `MediaReconcileCommand.php:136, :144`) |
| `disk` is read from the locked row | | | | No: `disk` is set only at creation |

**The reconcile race, in detail.** Which purges can claim a `processing` voice asset without also changing its status?
- **`PurgeDeletedVoiceAnnotation` and reviewer erasure** set `failed` when they claim. That already breaks the sweep's `processing` lock predicate.
- **`PurgeVoiceAsset`'s assets were failed by `revokeAndPurge`** (`ReviewService.php:386`).
- **That leaves account erasure step 3(b)** (`AccountErasureService.php:199-209`), which claims without changing the status.
  - Today, a claim that lands in the window is overridden: the sweep fails the asset, releases the reviewer's reservation and deletes the objects, and erasure then deletes a row that reports 0 bytes.
  - After B1, the sweep skips the asset, and erasure deletes the objects and the row. That path never refunds other reviewers (§8 #2). Fix that in account erasure, not by letting the sweep override a claim.

`failure_detail` is unchanged at all three sites: the sweep passes its own text. `failure_detail` is admin-only. No resource or Filament screen reads it (grep of `app/`).

**Wiring change (no behavior change).**
- The processor's injected `$quota` no longer pays out on the failure path. `FailVoiceNormalization` gets its own `QuotaService` from the container; the processor keeps `$quota` for the success path (`:133`).
- Production and the current tests see no difference. A test that injected a spy `QuotaService` into `FfmpegVoiceNoteProcessor` would no longer see the failure release.
- No caller reads `execute()`'s return value.

### 5.4 Call sites

- **`FfmpegVoiceNoteProcessor.php`.** Replace the body of `fail()` (`:165-209`):

  ```php
  private function fail(SpeechAsset $asset, string $temporaryPath, string $code): bool
  {
      app(FailVoiceNormalization::class)->execute($asset->id, $temporaryPath, $code);

      return false;
  }
  ```
  - Drop the `$reserved` argument at all 7 call sites (`:33, :40, :49, :55, :58, :78, :140`).
  - `$reserved` (`:26`) is still used by the success path (`:121`, `:133`).
  - `app()` is used, as for `ScratchFiles` at `:25`, so that the 5 tests that construct `new FfmpegVoiceNoteProcessor(app(QuotaService::class))` keep compiling: `FfmpegVoiceNoteProcessorTest.php:77, :110, :145, :172` and `RealVoiceAdapterSmokeTest.php:33`.
  - The class is in the same namespace, so there is no new import.
  - Remove `use App\Enums\TranscriptStatus;`: after §2 its only uses were in `fail()` (`:177-178`). The other imports stay (`AnnotationTransactions` is used at `:62, :82, :121`).
- **`NormalizeVoiceNote.php`.** `failed()` (`:70-112`) becomes `app(FailVoiceNormalization::class)->execute($this->assetId, $this->temporaryPath, 'voice_normalization_failed');`.
  - Add `use App\Services\Voice\FailVoiceNormalization;`.
  - Remove `use App\Services\QuotaService;` and `use App\Support\AnnotationTransactions;`: `:97` and `:77` were their only uses.
  - Also remove `use App\Enums\SpeechAssetStatus;` and `use App\Enums\TranscriptStatus;`. After §4 moved `:63-64`, their only uses were in `failed()` (`:73, :78, :94, :95`).
- **`MediaReconcileCommand.php`.**
  - `handle(QuotaService $quota)` (`:50`) becomes `handle(QuotaService $quota, FailVoiceNormalization $failNormalization)`.
  - The body of the `processing` branch (`:139-163`) becomes `$failNormalization->execute($asset->id, $temporaryPath, 'voice_normalization_failed', 'Voice normalization did not complete.');`. The `elseif` header at `:138` stays.
  - `$reserved` (`:113`) is still used by the ready branch, and `$candidatePath` (`:112`) by the failed branch.
  - Add the import. Remove `use App\Enums\TranscriptStatus;`: after §2 its only use was `:145`.
- **`VoiceNoteService.php:105-111`:** unchanged. It reaches the shared code through `failed()`.
- **Comments.** The reviewer-under-lock comments at `NormalizeVoiceNote.php:82-91` and `FfmpegVoiceNoteProcessor.php:180-188` merge into the one in §5.2. `MediaReconcileCommand.php:123-131` points at `FfmpegVoiceNoteProcessor::fail`; point it at `FailVoiceNormalization` instead.

### 5.5 Tests (B1's commit; written and run on §4's tree first)

Add to `VoiceNormalizationFailureTest.php`:

| # | Test | Rows | Before B1 | After |
|---|---|---|---|---|
| N-7 | "clears the transcript failure code when it fails the transcript" | 3 entries | processor green; backstop and reconcile **red** | green |
| N-8 | "leaves the ledger alone if the asset left failed during cleanup" | 3 entries | processor green; backstop and reconcile **red** | green |
| N-9 | "the reconcile sweep skips a note a purge claimed after the sweep selected it" | 1 | **red** | green |

- **N-7:** after the fixture, set `transcript_failure_code = 'voice_transcription_failed'` on the pending annotation (constructible, though unreachable in production). Settle, then expect null.
- **N-8:** facade mock as in N-6, but `delete` uses `andReturnUsing` to run `SpeechAsset::query()->whereKey($asset->id)->update(['status' => 'ready'])` and return true. Expect `temporary_path` to still equal `$temporary`.
- **N-9:** register a one-shot `SpeechAsset::retrieved(...)` listener that stamps `purge_claim_id` the first time the fixture's asset is hydrated, which is the sweep's batch `get()`. The earlier sweeps (uploading assets, video/poster/sprite assets) never load it. Run the sweep. Expect `processing`, the coach at 120, and the transcript `pending`.
- Listeners registered in a test die with that test's application.

That adds 7 tests. Existing coverage:
- `VoiceLifecycleTest.php:60, :72, :83`;
- `FfmpegVoiceNoteProcessorTest.php:64, :139, :157`;
- `VoiceAnnotationHttpTest.php:105`;
- `MediaReconcileTest.php:91`;
- N-1 to N-6.

## §6 B3: one purge-claim token

### 6.1 Design: share the token, keep each protocol

The copies differ on purpose in lock order, guards, status change, the moment the amount is read, the payer, the annotation update and the error message. One `purge(…)` template would need a parameter for every one of those. That is the "policy switches" M4 warned about, and M3 said not to merge these protocols.

So the shared piece is narrower:
- **`AssetPurgeClaim`** owns the mechanics that must not drift:
  - reuse the claim id, or mint one;
  - capture the disk and the candidate paths;
  - delete through `StorageObjectRemover`;
  - relock the asset only while this claim still owns it.
- **`SpeechAsset::chargedBytes()`** owns the amount formula.

Each caller keeps its own transactions, lock order, predicates, status change (passed as `$attributes`), timing, payer and annotation update.

### 6.2 The helpers

New file `api/app/Support/AssetPurgeClaim.php`:

```php
<?php

namespace App\Support;

use App\Models\SpeechAsset;
use App\Services\StorageObjectRemover;
use Illuminate\Support\Str;

/**
 * The claim token every speech-asset purge stamps before it deletes an
 * object (STEP-10-FROZEN-CONTRACT.md:90). Only the token: each caller keeps
 * its own locks and lock order, predicates, status change, transaction
 * wrapper, payer and amount (PLAN-DRY-PLATFORM.md M3).
 */
final readonly class AssetPurgeClaim
{
    /** @param  list<string>  $paths */
    private function __construct(public string $id, public int $assetId, public string $disk, public array $paths) {}

    /**
     * Call inside the caller's transaction, with `$asset` locked. Reuses an
     * existing claim, so a retry finishes the row it already claimed.
     * `$attributes` go into the same UPDATE.
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function stamp(SpeechAsset $asset, array $attributes = []): self
    {
        $id = $asset->purge_claim_id ?? (string) Str::uuid();
        $asset->update([...$attributes, 'purge_claim_id' => $id]);

        return new self($id, $asset->id, $asset->disk, SpeechAsset::voiceAssetCandidatePaths($asset->temporary_path, $asset->normalization_candidate_path, $asset->path));
    }

    /** Outside any transaction. Throws, leaving the claimed row for a retry, if an object survives. */
    public function deleteObjects(string $failureMessage): void
    {
        app(StorageObjectRemover::class)->deleteExisting($this->disk, $this->paths, $failureMessage);
    }

    /** Inside the caller's finalize transaction: the asset, locked, only while this claim still owns it. */
    public function lockAsset(): ?SpeechAsset
    {
        return SpeechAsset::query()->whereKey($this->assetId)->where('purge_claim_id', $this->id)->lockForUpdate()->first();
    }
}
```

Add to `SpeechAsset.php`, next to `isReady()`:

```php
/**
 * Bytes this asset still holds against its uploader's quota: the
 * unreconciled upload reservation while one exists, else the stored size.
 * The caller decides when to read it (claim or finalize) and who is refunded.
 */
public function chargedBytes(): int
{
    return (int) ($this->temporary_byte_size ?? $this->byte_size ?? 0);
}
```

### 6.3 Call sites

**`PurgeVoiceAsset::handle` (`:40-72`).** Keep the comment at `:30-39`.

```php
/** @var array{0: AssetPurgeClaim, 1: int|null}|null $claimed */
$claimed = AnnotationTransactions::run(function (): ?array {
    $asset = SpeechAsset::query()->whereKey($this->assetId)->lockForUpdate()->first();
    if ($asset === null || $asset->kind !== 'voice_note') {
        return null;
    }

    return [AssetPurgeClaim::stamp($asset), $this->reviewerId ?? $asset->purge_reviewer_id];
});
if ($claimed === null) {
    return;
}
[$claim, $reviewerId] = $claimed;
$claim->deleteObjects('Voice asset purge failed.');
AnnotationTransactions::run(function () use ($claim, $reviewerId, $quota): void {
    $fresh = $claim->lockAsset();
    if ($fresh === null) {
        return;
    }
    // Read at finalize: the status is unchanged, so a temporary-object cleanup may have reconciled the reservation since the claim.
    $charged = $fresh->chargedBytes();
    $fresh->delete();
    $reviewer = $reviewerId === null ? null : User::query()->find($reviewerId);
    if ($reviewer !== null && $charged > 0) {
        $quota->releaseDirect($reviewer, $charged);
    }
});
```

Imports: add `App\Support\AssetPurgeClaim`. Remove `App\Services\StorageObjectRemover` and `Illuminate\Support\Str`: `:45` and `:59` were their only uses.

**`PurgeDeletedVoiceAnnotation::handle` (`:35-62`).** The snapshot check at `:31-34` stays.

```php
/** @var array{0: AssetPurgeClaim, 1: int, 2: mixed}|null $claimed */
$claimed = AnnotationTransactions::run(function () use ($snapshot): ?array {
    $asset = SpeechAsset::query()->whereKey($snapshot->audio_asset_id)->lockForUpdate()->first();
    $annotation = Annotation::withTrashed()->whereKey($snapshot->id)->lockForUpdate()->first();
    if ($asset === null || $annotation === null || ! $annotation->trashed() || $annotation->audio_asset_id !== $asset->id) {
        return null;
    }
    // Failed at claim: every writer that reconciles a reservation filters on processing or ready,
    // so the amount read now is still the amount owed at finalize.
    $claim = AssetPurgeClaim::stamp($asset, ['status' => SpeechAssetStatus::Failed->value]);

    return [$claim, $asset->chargedBytes(), $annotation->review()->value('reviewer_id')];
});
if ($claimed === null) {
    return;
}
[$claim, $charged, $reviewerId] = $claimed;
$claim->deleteObjects('Voice-note object deletion failed.');
AnnotationTransactions::run(function () use ($claim, $charged, $reviewerId, $quota): void {
    $asset = $claim->lockAsset();
    $annotation = Annotation::withTrashed()->whereKey($this->annotationId)->lockForUpdate()->first();
    if ($asset === null || $annotation === null || ! $annotation->trashed() || $annotation->audio_asset_id !== $asset->id) {
        return;
    }
    $annotation->update(['audio_asset_id' => null, 'transcript_status' => TranscriptStatus::NotApplicable->value, 'transcript_failure_code' => null, 'transcript_attempt_id' => null]);
    $asset->delete();
    $reviewer = $reviewerId === null ? null : User::query()->find((int) $reviewerId);
    if ($reviewer !== null && $charged > 0) {
        $quota->releaseDirect($reviewer, $charged);
    }
});
```

Imports: as for `PurgeVoiceAsset` (`:41` and `:49` were the only uses of `Str` and `StorageObjectRemover`).

**`EraseReviewerVoiceNotes::execute` (`:25-66`).**
- The claim closure keeps `:26-34` and returns `?AssetPurgeClaim`:

  ```php
  // The note stays live as text: show a processing asset as failed while erasure runs. A ready asset stays ready (and playable) unless erasure finishes.
  $failed = $asset->status === SpeechAssetStatus::Processing->value
      ? ['status' => SpeechAssetStatus::Failed->value, 'failure_code' => 'voice_storage_failed', 'failure_detail' => 'Voice note is being erased.']
      : [];

  return AssetPurgeClaim::stamp($asset, $failed);
  ```
- Then `$claim->deleteObjects('Voice-note erasure failed; reviewer identity was retained.')`.
- The finalize closure starts with `$asset = $claim->lockAsset();`, keeps the annotation lock and guard at `:49-52`, and uses `$charged = $asset->chargedBytes();` (`:53`).
- Imports: as above (`:35` and `:46`).

### 6.4 What this preserves (check each in review)

- **Lock order is unchanged:** asset only; asset then annotation; snapshot, then asset, then annotation. Every lock is still taken by the caller.
- **Predicates are unchanged:** each guard stays in the caller.
- **The claim id is computed before any UPDATE, as before.** Erasure's two UPDATEs (`:36-39`) become one. The row ends with the same values, in the same transaction, and `SpeechAsset` has no observers or `booted()` hook (grep of `app/Models`).
- **The amount is read at the same moment as before:** claim for `PurgeDeletedVoiceAnnotation`, finalize for the other two.
- **The payer is unchanged:** looked up at the same time, from the same source.
- **The delete-failure messages are unchanged.**
- **The transaction wrapper is unchanged** (`AnnotationTransactions::run`). Storage I/O still happens between the two transactions.

### 6.5 Optional (separate commit): the two non-voice copies

- **`PurgeSpeechMedia.php:306-340`** uses `stamp`, `deleteObjects` (message `"Takedown media purge failed for speech asset {$claim->assetId}."`) and `lockAsset`.
  - Return `[$claim, $asset->kind]` from the claim closure, to keep the claim-time `kind` (`:322`).
  - Keep `byte_size ?? 0` (`:345`): its payer rule differs (a ready source only).
- **`Services/Privacy/AccountErasureService.php:318-349`** uses `stamp`, `deleteObjects` (`"Account-erasure media purge failed for asset {$claim->assetId}."`), `lockAsset` and `chargedBytes()` (`:345`).
- Both keep `DB::transaction`: the helper owns no transaction.
- Remove the now-unused `Str` and `StorageObjectRemover` imports (`:316, :332` and `:323, :338` were their only uses).
- **Coverage:** `PurgeSpeechMediaTest.php:106, :159, :232, :251, :279` and `AccountErasureServiceTest.php:45, :105`. No new tests.

Skip this commit if the reviewer prefers to keep the voice scope.

### 6.6 Tests

No new tests in this commit. Coverage comes from P-2 to P-7 (§0.5) and from:
- `VoiceLifecycleTest.php:102, :116, :127, :144, :214, :238`;
- `VoiceAnnotationHttpTest.php:437, :490, :516, :542, :557, :580`.

## §7 Verification

**After every step**, in `api/`, run CI's commands, with the host memory flag on pest:

```sh
./vendor/bin/pint --test
php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G
php -d memory_limit=1G vendor/bin/pest
```

Faster loop while editing: `php -d memory_limit=1G vendor/bin/pest tests/Unit/StatusEnumsTest.php tests/Feature/Annotation tests/Feature/Speech/MediaReconcileTest.php tests/Feature/Review tests/Feature/Privacy tests/Feature/Media`.

**Test counts.** Record the baseline total N on the first run. At `b2b2bee`, N was 1451 (1416 passed, 35 skipped).

| Step | New tests | Total | Validated (rev 2) |
|---|---|---|---|
| Baseline | — | N | 1451 |
| §0 characterization | +53, all green on the baseline | N+53 | 1504 |
| §1 B2a | +5 | N+58 | 1509 |
| §2 B2b | +2 | N+60 | 1511 |
| §3 B4 | 0 | N+60 | 1511 |
| §4 B5 | +1 | N+61 | 1512 |
| §5 B1 | +7. Before refactoring, 5 are red on §4's tree (N-7 and N-8 backstop and reconcile rows, N-9) | N+68 | 1519 |
| §6 B3 | 0 | N+68 | 1519 |
| §6.5 (optional) | 0 | N+68 | 1519 |

**Grep checks** (from `api/`):
- **After §2:** no status literal is left in the voice files.

  ```sh
  grep -nE "'(uploading|processing|ready|failed|pending|not_applicable)'" \
    app/Http/Controllers/Api/VoiceAnnotationController.php app/Jobs/NormalizeVoiceNote.php \
    app/Jobs/TranscribeVoiceNote.php app/Jobs/PurgeDeletedVoiceAnnotation.php app/Jobs/PurgeVoiceAsset.php \
    app/Services/Voice/*.php app/Services/ReviewService.php app/Models/Annotation.php \
    app/Console/Commands/VoiceWhisperSmoke*.php database/factories/SpeechAssetFactory.php
  sed -n 100,175p app/Console/Commands/MediaReconcileCommand.php | grep -nE "'(processing|ready|failed|pending)'" | grep -v '//'
  ```

  Expect no output.
  - Failure codes such as `'voice_transcription_failed'` do not match, because the pattern quotes the whole word. `ReviewService` uses none of these four words for review statuses.
  - `100,175` is the voice loop after §1 and §2 add two imports (`:98-173` at the baseline).
  - The `//` filter drops the comment `// See the 'ready' branch above…` (baseline `:146`), which §5 deletes.
- **After every step:** no bare case flows into a write.

  ```sh
  grep -rnE "(SpeechAssetStatus|TranscriptStatus)::[A-Z][A-Za-z]+" app database | grep -vE "::[A-Z][A-Za-z]+->value" | grep -v "^app/Enums/"
  ```

  Expect no output. The check cannot see a line that holds both a bare case and a `->value`; review such lines by eye.

**Mutation checks.** Apply each mutation, run the named tests, see them red, then revert. Find each site by its code, not its line number: earlier steps shift the lines. In the rev 2 validation, every row below went red as listed.

| Item | Mutation | Must turn red |
|---|---|---|
| B2a | `isReady()` also returns true for `'processing'` | `StatusEnumsTest` "processing" row; C-2 and C-3 "processing" rows |
| B2a | in `audioUrl()`, `if ($asset->status === SpeechAssetStatus::Processing->value)` compares with `Failed` instead | C-1 "processing" and "failed" rows |
| B2b | `TranscriptStatus::inFlight()` returns only `pending` | N-4 "processing transcript" rows; `VoiceLifecycleTest.php:164`; `StatusEnumsTest` "counts only pending and processing transcripts as in flight" |
| B4 | `hasRoomForAnnotation()` uses `<=` | C-4 at-cap, C-4c, C-5, `AnnotationTimingHttpTest.php:142`. `AnnotationWriteHttpTest.php:94` stays green (see the Cap section) |
| B4 | `MAX_ANNOTATIONS = 199` | C-4 "one below the cap", and C-4's message assertion |
| B5 | drop the `pending` predicate from `dispatchOrMarkFailed()`. The same `->where('transcript_status', TranscriptStatus::Pending->value)` also appears in `handle()`'s claim; leave that one | §4.2's test |
| B5 | drop the attempt predicate | C-6a, C-6b |
| B5 | swallow the exception instead of rethrowing | `VoiceLifecycleTest.php:182`, `VoiceAnnotationHttpTest.php:404` |
| B1 | drop `'transcript_failure_code' => null` | N-7, all 3 rows |
| B1 | drop `whereNull('purge_claim_id')` | N-2 processor and backstop rows; N-9 |
| B1 | drop the `status = failed` filter from the ledger clear | N-8, all 3 rows |
| B1 | ignore `$detail` | N-1 reconcile row |
| B1 | ignore `$code` | N-1 processor row; `FfmpegVoiceNoteProcessorTest.php:139` |
| B3 | `stamp()` always mints a new id | P-2, all 3 rows. `VoiceLifecycleTest.php:238` stays green, which is the gap noted above |
| B3 | `PurgeDeletedVoiceAnnotation` stamps without `status = failed` | P-4 "purge deleted note" rows |
| B3 | erasure stamps the failure attributes whatever the status | P-4 "erase reviewer, ready" |
| B3 | `PurgeVoiceAsset` reads `chargedBytes()` in the claim transaction | P-3 "purge asset" row |
| B3 | `lockAsset()` drops the claim predicate | P-7, all 3 rows |

**E2E.** No Playwright change is expected. If you run `web/tests/voice-annotations.spec.ts`, rebuild the app image first: `api/` is baked into it.

## §8 Out of scope (found by the review)

1. **A latent quota leak after a review purge.**
   - `FfmpegVoiceNoteProcessor.php:121-136` and `MediaReconcileCommand.php:118-137` find the payer only through the annotation.
   - After `revokeAndPurge` hard-deletes the annotation, a ready asset's temporary cleanup nulls `temporary_byte_size` without reconciling. `PurgeVoiceAsset.php:65` then releases `byte_size` instead of the reservation.
   - P-3's 112 shows the mechanism. A fix could fall back to `purge_reviewer_id`.
2. **Account erasure step 3(b) never refunds the other reviewers' voice quota.** `AccountErasureService.php:199-209` → `:340-349` deletes their assets and reports the bytes, but calls no `releaseDirect`. Check whether that is intended: M3 says account erasure "has different accounting".
3. **`VoiceLifecycleTest.php:238` does not pin claim reuse.** P-2 replaces it as the real check. Consider rewording its comment.
4. **Erasure can hand out a dead URL** (also PLAN-DRY-VOICE-PLAYBACK.md §6). B3 deliberately keeps a ready asset `ready` while erasure deletes its objects, and P-4 pins that. Changing it is a product decision.
5. **The reviewer-under-lock races stay unpinned.** `MediaReconcileTest.php:85-89` says reverting that fix does not fail its test. Pinning it needs real concurrency.
6. **Non-voice status literals** (§1.5): convert them in a follow-up. Once every `app/` site uses the enum, a cast becomes a mechanical swap guided by phpstan.
7. **`@property value-of<SpeechAssetStatus> $status`** would let phpstan flag a misspelled literal anywhere, without a cast. It changes phpstan's view of every site at once, so validate it separately.
8. **More enums of the same kind:** `kind` (`'voice_note'` appears at about 15 sites), and the closed failure-code sets (`STEP-10-FROZEN-CONTRACT.md:313-320`).
9. **A stale comment:** "six call sites" (`FfmpegVoiceNoteProcessor.php:182`). §5 deletes it.

## §9 Notes for the sibling plans

- **Schema contract plan** (PLAN-DRY-SCHEMA-STATUS-CONTRACT.md):
  - The enum names, files and cases are fixed above; compare with `SpeechAssetStatus::values()` and `TranscriptStatus::values()`.
  - The live `ck_speech_assets_status` differs by driver: on Postgres it is `150003:101`, on SQLite `110001:48`.
  - `ck_annotations_transcript_status` is at `110002:45` (Postgres) and `:28` (SQLite).
  - `data_exports.status` uses the same words with a separate CHECK; no enum here covers it.
  - The enums are values-only, so the contract test needs no model.
- **Frontend plan:**
  - Nothing for B4: `web/` has no copy of the cap.
  - `web/src/features/annotation/types.ts:11` (`VoiceTranscriptStatus`) and `:15` (`audio_status`) are the voice subsets. `not_applicable` and `uploading` never reach the client: `voice` is null without audio (`AnnotationResource.php:44`), and voice assets are created `processing` (`VoiceNoteService.php:81`).
  - A generated union or contract test can use `values()` minus those two.

## §10 Review log

- **rev 1 (2026-11-14):** drafted from a read-only review of `api/` at `b2b2bee`, plus a `web/` grep. Nothing was run.
  - **Checked against the tree:** every fact in the brief, every cited line, and the three B1 copies line by line.
  - **Corrections to the brief:**
    - B1 has a third copy, in the reconcile sweep;
    - two more copies of the claim stamp exist (non-voice);
    - the processor's failure exit has 7 call sites, not 6;
    - PLAN-DRY-PLATFORM.md M3/M4 had already deferred B1 and narrowed B3.
  - **Decisions:**
    - both drifts take the processor's behavior;
    - the enums carry values only, with no cast;
    - `TranscriptStatus` is included;
    - B3 shares the claim token, not the protocol.
  - **Pending:** the adversarial validation (apply in a scratch copy, run CI's commands after each step, run the mutation checks). Record its numbers and findings here as rev 2.
- **rev 2 (2026-11-14):** adversarial validation. The plan was applied to a scratch copy of `api/` at `b2b2bee`, one commit per step, with pint, phpstan and pest after each. The per-step numbers are in the Status table.
  - **What held up:**
    - all §0 characterization tests are green on the baseline;
    - before the B1 refactor, exactly the 5 predicted tests are red (N-7 and N-8 backstop and reconcile rows, N-9), and all are green after;
    - no existing test needed a change;
    - every §1.4 and §2.2 line matched its literal, and the §3–§6 ranges are right;
    - phpstan stayed at 0 (`array_map` passes as `list<string>`, so the `array_column` fallback is not needed);
    - the bare-case grep was empty after every step;
    - 17 of 18 mutations went red as listed, and `VoiceLifecycleTest.php:238` stayed green under "always mint", as §0.5 says;
    - the optional §6.5 applied cleanly.
  - **BLOCKER (fixed, §1.4):** `pint --test` failed on rev 1's import list. `TranscribeVoiceNote.php` and `VoiceWhisperSmokeVerifyCommand.php` use only `isReady()`, so the `SpeechAssetStatus` import was unused. Both are now listed as exceptions.
  - **BLOCKER (fixed, §5.4):** `pint --test` failed on three unused enum imports. The plan now says to remove:
    - `TranscriptStatus` from `FfmpegVoiceNoteProcessor.php` (rev 1 said "the imports stay as they are");
    - `SpeechAssetStatus` and `TranscriptStatus` from `NormalizeVoiceNote.php`;
    - `TranscriptStatus` from `MediaReconcileCommand.php`.
  - **MAJOR (fixed, Cap section, §0.2, §3, §7):** the text-create cap had no test.
    - Under the `<=` mutation, `AnnotationWriteHttpTest.php:94` stayed green: its 200 random rows make the request fail with `annotation_overlap`, still a 422.
    - Added C-4c. It is green on the baseline code and the final tree, and red under `<=` (201).
    - Corrected the coverage claims, and moved the `<=` row from `:94` to C-4c.
  - **MINOR (fixed, §1.3):** `SpeechAsset.php` needs `use App\Enums\SpeechAssetStatus;`, and no step listed it.
  - **MINOR (fixed, §7):** the second grep "after §2" printed one comment line, and its range was the baseline's. It now uses `100,175` and filters `//`. Re-checked empty on the §2 tree.
  - **MINOR (fixed, §6.5):** the path is `Services/Privacy/AccountErasureService.php`. Its line numbers were right.
  - **NITs (fixed):**
    - the mutation table now names sites by code. The B2a `:65` row was `:66` after §1, and the B5 `pending` predicate appears twice in `TranscribeVoiceNote.php`;
    - §5.4 now says the reconcile branch *body* (`:139-163`) is replaced and its `elseif` stays;
    - §5.3 notes the processor's `$quota` no longer pays the failure release, and that no caller reads `execute()`'s result;
    - §0.5 names the three remover-seam helpers;
    - the B2b mutation row adds the `StatusEnumsTest` in-flight test, which also goes red.
