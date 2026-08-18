# STEP-09 verification plan — real-browser captions and a real `whisper.cpp` smoke

**Verifies:** [STEP-09-captions.md](STEP-09-captions.md) · **Contract:** [STEP-09-FROZEN-CONTRACT.md](STEP-09-FROZEN-CONTRACT.md) · **Reviewed against:** `649ad8f` on 2026-08-17

> ## Outcome
>
> The required PR lane drives the built React application in Chromium against the real Laravel API, PostgreSQL, Valkey queue, SeaweedFS objects, video.js player, native `TextTrack`, caption editor, transcript, annotations, and search. It uses deterministic media/VTT fixtures and never downloads or invokes a speech model.
>
> A separate path-triggered/scheduled release lane builds the actual `whisper-worker`, provisions one checksum-pinned model into its read-only runtime volume, and processes a queued caption job against disposable PostgreSQL and SeaweedFS through FFmpeg, `whisper-cli`, the application's VTT parser, storage write, and transcript derivation.

This is a build plan, not an assertion that STEP-09 is already end-to-end complete. The audit found prerequisite defects that would currently make a truthful Playwright or Whisper sign-off impossible.

Planning-pass baseline on the reviewed commit is green: focused caption/upload/ownership Pest tests **54/54** (161 assertions), Vitest **193/193**, Chromium Playwright discovery **30 tests in 8 files**, and current Compose config validation. Those results validate the starting point only; every proposed file/command below remains a required implementation gate.

---

## 1. Testing boundary: four verification layers

| Layer | Runs when | Proves | Must not prove |
|---|---|---|---|
| Existing Pest/Vitest tests | Every PR | Validation and authorization matrices, job routing, state transitions, timeout handling, VTT parsing, component state | A real browser, PostgreSQL search semantics, or a real model |
| `web/tests/captions.spec.ts` | Every PR, Chromium | Real API envelopes/CSRF, real storage, playable media, native cues and seeking, editor persistence, annotation geometry, PostgreSQL search, visible failure/retry states | ASR quality, model download, exact native-caption pixels, or long-running queue timing |
| Model lock check | Every PR | Immutable URL, recorded license, expected filename/model identity, and checksum syntax | Downloaded bytes or executable inference |
| Real Whisper smoke | Relevant caption/worker changes, scheduled/manual, and before release/sign-off | Final worker image starts and consumes a real queued job; model checksum, FFmpeg + real `whisper-cli`, PostgreSQL/SeaweedFS caption/transcript output | Browser behavior, exhaustive transcription accuracy, performance, or exact punctuation/timestamps |

Do **not** write one upload → transcode → Whisper → edit → search Playwright test. It would conflate six independently diagnosable systems, couple every retry to a roughly 142 MiB model download, and turn ASR variation into browser flakiness.

---

## 2. Audit findings that must be fixed first

### P0 — correctness/security blockers

| Finding | Current evidence | Repair and regression |
|---|---|---|
| An invited reviewer can fetch full captions/transcript before accepting | `SpeechPolicy::view()` admits `invited`, while `readCaptions()` delegates to it (`api/app/Policies/SpeechPolicy.php`). The frozen contract is internally contradictory: its code sample delegates to `view()`, but its prose says only active `Review::ACCESS_GRANTING` states. | Treat this as a security-driven frozen-contract amendment before code or tests. Keep invitation visibility for the reduced speech surface if needed, but make the policy itself owner-or-active/non-revoked `Review::ACCESS_GRANTING`. Add owner, accepted/in-progress/published, invited, declined, abandoned, revoked, stranger, anonymous, and direct-policy unrelated-admin tests. HTTP admin read remains an intentional 200 only through `Gate::before`; admin write remains denied. |
| Short edit projections share the CPU-heavy ASR queue and can lose the newest edit | `RederiveTranscript` targets `redis-long/captions`, uses `WithoutOverlapping(...)->releaseAfter(0)`, and the worker has `--tries=1`. A collision can consume the newest job; missing/invalid storage is logged as success. The frontend invalidates Transcript before derivation and never invalidates Search, so both caches can stay stale. | Route only this short job to `redis/default`. Remove its attempt-consuming overlap middleware—the revision guards make these cheap jobs safe concurrently—and add explicit retries/backoff for storage failures. Add a server-produced caption revision (canonical VTT SHA-256, not optimistic locking) to the caption asset/response and matching `caption_revision` to the derived row/response. Dispatch the expected revision; under a row lock write only if it still matches. After PUT, the client condition-polls until revisions match, then refreshes Transcript **and** Search. Test rapid edits with overlapping workers, transient storage failure, and pre-warmed UI caches; the latest canonical VTT must win. |
| “Move annotations to top” does not move them | `SpeechWatch`'s absolute flex wrapper is permanently `justify-end`; `OverlayStack` changes justification only on an auto-height child. | Put the anchor-dependent justification on the full-height absolute positioning layer. Expose `data-testid="overlay-positioner"` and `data-anchor="top|default"`. Retain a component test, then prove upper/lower-half geometry in Playwright. |
| A signed-URL source refresh can remove captions | `addRemoteTextTrack(..., false)` opts into video.js cleanup on `player.src()`, while the React effect does not re-run when only the signed URL changes. | Make the one caption track survive source refresh (recommended: manual cleanup plus the existing explicit replace/remove path), or explicitly reattach after refresh. Add an adapter regression for source refresh and assert exactly one loaded caption track after edits/reloads in Playwright. |
| Unexpected process/storage exceptions can leave captions forever `processing` | `WhisperTranscriber` catches only `InvalidVttException`; `GenerateCaptions` has no failed-job backstop. Laravel uses a job's `$timeout` instead of the worker CLI timeout when it is present, so the operative queue boundary is the 3600s job timeout versus `redis-long`'s 3900s `retry_after`. | Catch/log operational exceptions and guardedly write a retryable `failed` state; add `GenerateCaptions::failed(Throwable)` as a last-resort transition. Test process timeout, missing model, storage read/write failure, and the edit-wins race. Enforce `FFmpeg 300s + Whisper 1800s + storage/DB headroom < effective job timeout 3600s < retry_after 3900s`; align the CLI value for operator clarity, not as another outer timeout. Give moved derivations an effective timeout around 45–50s, below the default connection's 90s `retry_after`. Only a stable `failure_code` and mapped UI copy cross the API; sanitize/truncate internal `failure_detail`, stderr, paths, and exception text, and test that none leak. |
| A hard worker loss still has no caption-safe recovery | Compose workers have no restart policy. `media:reconcile` sweeps every old `processing` asset by immutable `created_at`, calls it `transcode_timed_out`, and can race a retry/edit. A kill/OOM bypasses catches and `failed()`. Although the command is scheduled in `routes/console.php`, no Compose scheduler/cron runs it. | Add worker restart policies **and an actual scheduler service**, health/operations documentation, and per-attempt `queued_at`, `started_at`, and `heartbeat_at` clocks; `updated_at` is not a recovery clock. Reconcile never-started work only after a separate conservative queue-SLA cutoff, and started work only after the effective 3600s job timeout plus scheduler/storage margin. Every transition is a compare-and-set on the current attempt token. Restrict transcode reconciliation to transcode kinds. In `APP_ENV=e2e` only, schedule the same command every minute so a bounded <=90s service-level smoke can prove it runs; production remains daily. Promise handled-failure plus stale-process recovery, not impossible instantaneous recovery from host loss. |

### P1 — contract and harness blockers

| Finding | Current evidence | Repair and regression |
|---|---|---|
| The promised automatic-caption off-switch has no user path or concurrency invariant | The database/resource/dispatch guard exist, but create request/UI and every update route omit `captions_enabled`. Upload completion blindly creates a caption row, and the database does not enforce one captions asset per speech. | Freeze the exact state machine in §4.1, add an owner-only settings route/UI, centralize creation/retry in one locked idempotent service, and add a partial unique index for one `kind=captions` row per speech. Existing ready VTT/transcript remain readable when automation is off. |
| Disabled/no-caption speeches poll forever | `useCaptionsJob` treats only `ready|failed` as terminal, not `unavailable`. | Stop polling on `unavailable`, and skip/restart appropriately when `captions_enabled` changes. Test fake timers at the hook boundary. |
| Current E2E video is deliberately fake | `E2ESeeder` creates asset `9301` with no object, and its HTTP `localhost:8333` URL is mixed content under the HTTPS app. | Add dedicated STEP-09 speeches with a real browser-decodable MP4 and real VTT objects. Do not mutate shared speech `9101`, which CP-05/CP-08 already use. |
| The browser suite is built around a known-flaky Vite dev server | `warmup.setup.ts` and `auth.setup.ts` record 60-second to multi-minute stalls and name the production bundle as the real fix. | Serve `web/dist` through an E2E nginx override. Keep the ordinary HMR development path unchanged. |
| Whisper image/model setup is not runnable | The image copies only `whisper-cli`, while upstream v1.7.2 defaults to shared libraries on Linux; compose has only a placeholder download command aimed at a read-only volume. | Build whisper libraries statically (preferred) or install every runtime library, add an RW initializer with immutable URL + SHA-256 + atomic rename, and keep the worker mount RO. Validate the final image, not just the build stage. |
| The adapter buffers the whole source and leaks scratch files | `WhisperTranscriber` calls `Storage::get()` into memory and appends `.wav` to a path already created by `tempnam()`, leaving the original file behind. Several storage/file writes are unchecked. | Stream `Storage::readStream()` to an opened scratch file, fail on every read/write/copy error, allocate each exact scratch pathname once, and clean every path in `finally`. Add a bounded-memory/large-stream test, stream-failure tests, and a scratch-directory leak assertion. |

No Playwright implementation starts until the P0 items and deterministic media delivery pass their focused tests. Otherwise the browser spec will report product defects as timing failures.

---

## 3. Deterministic E2E stack and fixtures

### 3.1 Test the built artifact

Add `compose.e2e.yaml` and `docker/nginx/e2e.conf`:

1. Serve the already-built SPA at `https://app.speechcoach.test`; do not proxy this hostname to host Vite.
2. Keep `https://api.speechcoach.test` on the real PHP-FPM app and build the SPA with `VITE_API_URL=https://api.speechcoach.test`, preserving the production-like cross-subdomain cookie/CORS path the current specs exercise.
3. Add `https://media.speechcoach.test` as an E2E-only TLS proxy to a version-pinned SeaweedFS image. Use `proxy_pass http://seaweedfs:8333` with no URI suffix, HTTP/1.1, `proxy_set_header Host $http_host`, and unmodified query strings. Forward `Range` and preserve `206`, `Content-Range`, `Accept-Ranges`, `Content-Length`, and `Content-Type`. Set `AWS_ENDPOINT_PUBLIC` to that HTTPS origin in the E2E override.
4. Add the media hostname to CI `/etc/hosts` and the generated certificate SANs.
5. Retain a plain HTTP/static server in the E2E nginx config so the existing container healthcheck remains valid.
6. Extend bucket CORS to `HEAD` and expose the range headers above as well as `ETag`.
7. Prove a presigned GET returns the committed MP4 and a byte-range request returns `206` before writing caption assertions. Failure to preserve SigV4/range delivery blocks implementation/sign-off; Playwright must not fulfill the media itself.

Add one authoritative `scripts/e2e-stack.sh` harness. It owns both compose files, a dedicated project name, an overridden network name (base compose hard-codes `speechcoach-dev`), deterministic environment/cert preparation, migrations/media initialization/seeding, and scoped teardown. It must either parameterize ports/origins or fail clearly when the dev stack already owns 443/5433/8333; it never stops the developer's stack. Its cleanup trap may run `down -v` only for the validated E2E project. Every test-side reset calls the same harness/project from the repository root—bare `docker compose` from `web/` is invalid.

Refactor **all three** current hard-coded base-PostgreSQL mutations—`speech-create.spec.ts`, `essay-editor.spec.ts`, and `onboarding.spec.ts`—to call this harness (preferably a guarded application reset command) before the full-suite gate. Add a repository check forbidding `docker exec instruction-speeches-library-postgres-1` in tests. A separate Compose project is not real isolation while any older spec can mutate the developer database.

The E2E override also defines a stopped-by-default `caption-test-worker` that consumes `redis-long/captions` with a deterministic controllable transcriber—never a model. Its fake driver is accepted only when `APP_ENV=e2e|testing` and startup fails if production selects it. Test controls can hold/release a named attempt through isolated Valkey keys, allowing the worker-isolation and old-attempt race scripts to observe real queued jobs without sleeping or invoking Whisper.

This removes both known sources of false failure: cold Vite module transformation and HTTPS → HTTP mixed content.

### 3.2 Initialize media before seeding

Replace the CORS-only manual prerequisite with an idempotent `media:initialize` command that:

1. creates the configured bucket when absent;
2. applies the existing CORS policy, including exposed `ETag`;
3. succeeds unchanged when run again.

CI order is: services healthy → migrations → `media:initialize` → E2E seed → default queue worker → Playwright. A clean-volume run is the required proof; an old developer volume can conceal this defect.

### 3.3 Add a narrow caption fixture seeder

Create a separately-invoked `E2ECaptionsSeeder` with its own fixed IDs and literal domain timestamps. CI runs the existing lightweight `E2ESeeder` first (users/auth), then this media seeder explicitly. Do not make every existing SQLite test that calls `E2ESeeder` pay for media setup. Re-running only the caption seeder must reset its mutable rows and overwrite its media objects. Liveness clocks are the deliberate exception: the processing fixture receives fresh `caption_queued_at`/heartbeat values on every seed so it is not born stale.

Seed these independent speeches:

| Fixture | State | Purpose |
|---|---|---|
| Caption-display speech | ready H.264/AAC MP4, ready two-cue VTT, derived transcript (`model=e2e-fixture`, `source=whisper`), reviewer A **published**, reviewer B invited, one published overlapping annotation | Native track/seek, authentication seam, independent annotation/caption controls; unlike accepted+published, this state is reachable through production transitions |
| Reviewer-access speech | separate ready captions/transcript, reviewer A accepted on this review, no published annotation required | Positive accepted-reviewer read-only UI without conflating it with reviewer A's separately published commentary lifecycle |
| Caption-edit speech | separate ready MP4/VTT/transcript owned by the same speaker | Editor and async projection mutations cannot corrupt the display fixture |
| Search-edit speech | another ready VTT/transcript with a phrase absent from the initial search cache | Proves edit-driven Search cache convergence without reusing Scenario B's mutable row |
| Caption-processing speech | same ready MP4, caption asset `processing`, no transcript | Playable video plus honest “Captions processing…” state |
| Caption-failed speech | same ready MP4, caption asset `failed` with a stable user-safe failure code; internal detail is never serialized | Visible failure and real retry transition while playback stays usable |
| Search controls | stable owner match, owner non-match, and another user's matching transcript | Baseline PostgreSQL result and ownership scope are not vacuous or coupled to editor behavior |

Fixture rules:

- Store MP4/VTT through `Storage::disk('media')`; local container layers are not shared between `app` and `queue-worker`.
- The media disk currently has `throw=false`: check every write result, then verify stored size/content so a silent S3 failure cannot seed a lying database row. Write explicit `video/mp4` object metadata.
- Commit a tiny, license-clean H.264/AAC-LC, `yuv420p`, fast-start MP4 with spoken audio and a fixture README recording how it was made and who owns it. Reuse it in the real Whisper smoke if its speech is clear enough.
- Seed both a ready `video` asset for playback and a `source` asset for `GenerateCaptions`/Retry. Cue and annotation times must fall strictly inside the probed media duration.
- Use a two-cue VTT with a distinctive edit such as `toast masters` → `Toastmasters` and a second stable phrase for search controls.
- Derive the seeded transcript with the production `Vtt` parser and `TranscriptDeriver`; never hand-maintain body/segments separately from VTT.
- Seed annotation counters consistently with the published annotation row.
- Test `E2ECaptionsSeeder` separately with `Storage::fake('media')`; assert object contents plus idempotent row/object counts without changing existing lightweight seeder tests.
- Add mirrored IDs/text to `web/tests/fixtures.ts` so drift fails loudly.
- Seed once for ordinary runs and give each mutating scenario its own speech. For `--repeat-each`, use an E2E-only reset command via `execFileSync`: first wait until the default queue's ready/delayed/reserved sets are empty, stop its worker with enough grace for the current <=50s job, verify all three sets again, clear the intentionally held isolated captions queue, reseed, then restart the default worker. It must refuse outside the E2E environment. Queue depth alone is not an in-flight proof. Never reset rows/media underneath a live worker, use raw `psql`, hard-code container names, or mutate from an `afterAll` hook.

---

## 4. Focused product fixes and lower-level tests

### 4.1 Freeze the missing and contradictory consistency contracts

Before implementation, append these decisions to `STEP-09-FROZEN-CONTRACT.md` so the browser suite does not accidentally invent product behavior.

**Caption access amendment.** `readCaptions` does not delegate to the broader speech `view()` rule. The policy grants the owner and active, non-revoked reviews in `Review::ACCESS_GRANTING`; an unaccepted invite cannot read VTT/transcript. An unrelated admin is denied by a direct policy call but receives the existing HTTP read override through `Gate::before`. `caption.update` and settings writes remain owner-only and must fall through that override.

**Automatic-caption state machine.** Add owner-only `PATCH /api/speeches/{speech}/caption-settings` with `{ captions_enabled: boolean }`, expose the default-on field during creation, and use one `EnsureCaptionJob` service from upload completion, enable, and retry. The service locks the speech/caption row and is backed by a partial unique index allowing at most one `speech_assets` row where `kind='captions'` per speech:

| Existing state | Setting/action | Required result |
|---|---|---|
| No ready source, no caption asset | Enable | Persist `true`; create no asset/job. A later successful upload calls the same ensure service. |
| No ready source, existing `failed` caption asset | Enable/re-enable | Persist `true`, retain/reuse the single failed row, and create no job. A later successful upload calls the same ensure service and starts a new attempt. |
| Ready source, no asset or `failed` asset | Enable | Create or reuse exactly one row as `processing` and dispatch exactly one after-commit job. |
| `processing` or `ready` | Enable | Idempotent no-op; never duplicate the row/job. |
| No asset or `failed` | Disable | Persist `false`; retain any failure history; dispatch nothing. |
| `processing` | Disable | Atomically set `false` and move that attempt to `failed/captions_disabled`; an in-flight worker's final guarded write checks both status and flag and cannot publish afterward. |
| `ready` | Disable | Persist `false` but keep serving the ready VTT/transcript; manual owner edits remain allowed. |
| Any disabled state | Retry automatic generation | Return HTTP `409` with stable code `captions_disabled`; retry never silently enables automation. |
| `failed/captions_disabled` with ready source | Re-enable | Reuse the row, clear safe failure fields, mark `processing`, and dispatch once. |

Concurrent enable/upload/retry requests must converge on that table. Add database-migration duplicate detection, service-level row locks, the uniqueness constraint as the final defense, and concurrency tests on PostgreSQL.

**Generation-attempt identity and recovery.** Status plus `captions_enabled` cannot distinguish an old worker from a new attempt. Add a nullable UUID `caption_attempt_id` plus `caption_queued_at`, `caption_started_at`, and `caption_heartbeat_at` to the captions row. Every automatic start/retry rotates the token and dispatches `GenerateCaptions(asset_id, attempt_id)`; disable/manual edit invalidates it. The job atomically claims only its current token, then heartbeats at stage boundaries. Whisper success, mapped failure, `failed(Throwable)`, timeout handling, and the stale sweep all update with `WHERE status='processing' AND caption_attempt_id=?`; an old attempt becomes a no-op after disable → re-enable.

Remove `GenerateCaptions`'s current `WithoutOverlapping(...)->releaseAfter(0)`: the dedicated Compose worker remains concurrency one, while the attempt token preserves correctness if an operator later scales it. A non-current job exits before expensive work; an already-running old job may finish consuming CPU but cannot publish/fail the newer attempt. If multi-worker ASR exclusion is later required, add a coordination mechanism whose contention does not consume and discard the queued attempt.

Recovery has two explicit clocks. A row with no `started_at` may fail only after a separately configured, conservative maximum queue wait; a started row may fail only when its last stage heartbeat is at least 4200 seconds old (3600s effective job timeout plus retry/storage/DB margin), independent of how often the scheduler is invoked. E2E overrides thresholds only to make the same transitions observable quickly. The reconciler compare-and-sets the attempt token. Test queued-but-never-consumed, killed-after-start, active-at-the-boundary, and old attempt A followed by disable/re-enable B where A later succeeds, throws, or times out—B always remains authoritative.

**Projection convergence token.** Add a captions-only `content_revision` (SHA-256 of canonical VTT) to `speech_assets` and `caption_revision` to `speech_transcripts`; expose them as read-only `CaptionResource.revision` and `TranscriptResource.caption_revision` fields (`null` when unavailable). They are not a client-supplied precondition or optimistic lock. One shared helper is used by seed data, initial Whisper output, and manual edits so generated captions also persist matching revisions. `CaptionService` computes the revision, checks the storage write, persists it, and dispatches `RederiveTranscript(asset_id, expected_revision)`. The job:

1. has its own tries/backoff budget for transient storage failures and no `WithoutOverlapping` middleware, so revision-safe concurrent jobs cannot consume attempts merely waiting for a lock;
2. first compares the current asset revision with the job's expected revision and exits successfully when superseded—before inspecting newer canonical bytes;
3. only for a current job, treats storage/network absence as retryable and verifies the stored bytes hash to the expected revision; on mismatch it locks/re-reads the asset so a concurrently committing edit exits as superseded, while a still-current mismatch becomes an explicit safe storage-integrity failure rather than success;
4. derives, then locks the asset immediately before writing and rechecks that revision so an edit during parsing wins;
5. stores the matching revision on the transcript while preserving the original model/language and setting `source=edited`.

The PUT UI waits, with a bounded condition-poll, until transcript `caption_revision` equals the returned caption revision; only then does it refresh both Transcript and Search caches. A timeout leaves an honest “updating transcript” state with retry/refetch, not a false “fully saved” claim. This also gives Playwright a public convergence condition without inspecting queue internals.

### 4.2 Lower-level diagnostic tests

Land these before the browser spec so each failure has a small diagnostic test:

1. **Authorization:** full `readCaptions` status matrix at policy and HTTP layers; accepted reviewer positive control; invited/revoked/non-granting denial for both captions and transcript.
2. **Queue/projection:** `RederiveTranscript` routes to `redis/default`; two workers plus rapid consecutive edits and a forced overlap derive the newest revision; transient storage failure retries instead of acknowledging. A focused RTK Query/Vitest test pre-warms both API slices, runs the mutation against controlled async responses, and proves Transcript waits for matching revision before Transcript/Search invalidation; Playwright separately proves a pre-warmed Search query refreshes.
3. **Worker independence measurement:** against a disposable compose stack, enqueue transcode and caption work for the same real source, keep `caption-test-worker` stopped, run only the transcode worker, and assert video reaches `ready` while captions remain queued/`processing`; then start/release the deterministic caption worker and require `ready`. This—not a seeded state or queue-name assertion—is the temporal acceptance proof.
4. **PostgreSQL schema:** query the live catalog after migrations and assert `speech_transcripts.body_tsv` is a stored generated `tsvector` and `speech_transcripts_body_tsv_gin` is a GIN index. Do not assert planner costs on a tiny fixture.
5. **Failure lifecycle:** thrown FFmpeg/Whisper/storage exceptions and job timeout end at `failed`, expose only mapped user-safe code/UI text (never `failure_detail`, raw stderr, local paths, or exception output), and remain retryable; owner edit and attempt-B states cannot be clobbered by attempt A's success/failure/timeout. Separate atomic stale-caption reconciliation and running-scheduler tests cover hard worker loss, which application catches cannot intercept.
6. **Off-switch:** exhaust the state table above, including absent/uploading/ready source, concurrent enable/upload/retry, disable during a running transcriber, database uniqueness, manual edit while disabled, and retention of ready VTT/transcript.
7. **Track lifecycle:** no caption track before VTT; one real default captions track after attach; replacement produces one track; null removes it; a controlled video.js source refresh preserves/reattaches it. An ordinary page reload is not this regression.
8. **Polling:** `unavailable`, `ready`, and `failed` are terminal; `processing` continues polling. Automation disabled does not suppress the initial GET or a retained ready VTT; it only prevents generation/poll restarts when no work exists.
9. **Layout:** component-level anchor metadata and class contract, followed by browser geometry rather than another class-only assertion.
10. **Adapter I/O:** stream the source to disk without whole-object buffering, fail closed on partial reads/writes, clean every exact scratch path on all exits, and prove no temp artifact remains.

The API save response is **not** proof that transcript/search is current. `CaptionService` writes VTT synchronously and queues derivation asynchronously. The real queue integration owns `source=edited`, model preservation, and revision-race invariants. The owner UI currently renders the editable VTT, not the derived transcript, so Vitest owns Transcript-cache orchestration; browser tests use the public revision as a convergence boundary and require corrected native cues/Search UI without pretending local editor text proves derivation.

---

## 5. `web/tests/captions.spec.ts`

Use the established real-stack conventions from `essay-editor.spec.ts`:

- `Accept: application/json` and `Origin: https://app.speechcoach.test` on API requests;
- decoded `X-XSRF-TOKEN` for writes made through `page.request`;
- `expect.poll` / `toPass` and response waits, never fixed sleeps;
- server/API assertions after UI mutations;
- make the entire first `captions.spec.ts` Chromium-only and serialize its mutations. With `fullyParallel`, a read-only Firefox/WebKit test can otherwise observe a Chromium reset. Add a later separate immutable-fixture spec/project for the cross-browser native-track matrix.

Add only the test seams that express stable semantics:

- an accessible name or `data-testid="speech-video"` on the real video;
- `data-testid="overlay-positioner"` and `data-anchor` on its full-height positioner;
- an accessible label for each caption textarea including its timestamp;
- `role="status"`/`role="alert"` for processing, save, and failure feedback where appropriate.

### Scenario A — native captions and commentary are independent

1. Open the caption-display speech as its owner and wait for decoded video metadata.
2. Inspect the real `HTMLVideoElement.textTracks`, using numeric access for cross-engine safety. Require exactly one `kind="captions"` track, its expected language/label, non-null cues, and the seeded cue text. Also require the corresponding real `<track kind="captions" default>` element; this is a STEP-09 product requirement, not an optional video.js detail.
3. Toggle CC and assert both `aria-pressed` and `TextTrack.mode`; do not screenshot or compare native caption pixels.
4. Select the seeded reviewer's commentary, seek into the overlapping cue/annotation window, and require a separate metadata/annotation track plus the visible annotation body.
5. Require the target annotation's `data-visible=true` before measuring (ghost/render-window nodes still have boxes). With captions showing, compare bounding boxes: its center must be in the stage's upper half and `data-anchor=top`.
6. Turn captions off: commentary selection/body stays unchanged and the overlay moves to the lower half.
7. Turn captions on, then select “No commentary”: the annotation disappears while the caption track remains `showing`.

### Scenario B — edit, persist, and replace the native cue

1. Reset the dedicated edit fixture, open the owner's Transcript tab (currently the VTT-backed `CaptionEditor`), and locate the cue by accessible timestamp/text.
2. Change `toast masters` to `Toastmasters`, wait for the exact real PUT, then require saved/server state. Do not race the transient 750 ms `dirty` state when the network response and canonical read are stronger evidence.
3. Poll `GET /captions` until canonical VTT contains the correction, then poll the public transcript endpoint until its `caption_revision` matches. Do **not** treat the editor's local corrected text as evidence of transcript derivation; the RTK cache test in §4.2 owns that frontend seam.
4. Assert the browser's native cue text changes and there is still exactly one caption track. Reload only afterward to prove the corrected editor value/native cue persisted durably.

### Scenario C — transcript click seeks the real video

1. As reviewer A, open the dedicated reviewer-access speech and its real derived `TranscriptPanel`.
2. Click the second timecoded transcript line.
3. Poll the real video's `currentTime` within a small tolerance of that cue's start. This isolates the native media/React callback seam from autosave and search.

### Scenario D — PostgreSQL search, including asynchronous edit visibility

1. Search a stable distinctive fixture phrase through `/search`; require the matching owned speech, reject the owned non-match, and reject the other user's matching speech.
2. Search the future corrected phrase before editing and require the search-edit speech to be absent; keep that exact empty query cached. Open the separate search-edit fixture and perform its small VTT edit through the real owner UI. Using `page.request` here would bypass the Search-cache behavior under test; this step makes no claim that the owner mounted a derived-transcript query.
3. Wait for projection convergence, return to the already-queried phrase, and require the edited speech to appear without a hard reload. This proves the mutation refreshes the pre-warmed Search cache and exercises PostgreSQL `tsvector`; Vitest owns Transcript-cache refresh, while `source`/model/revision-race details stay in the queue integration.

### Scenario E — processing and failure never block playback

1. Open the processing fixture. Require decoded media/a usable player, “Captions processing…”, no ready CC control, and no editable cue textarea.
2. Open the failed fixture. Require the same playable video, a visible safe failure message, and Retry.
3. Click Retry, wait for the real POST, and poll the caption endpoint from `failed` to `processing`; keep the real Whisper worker stopped. Require playback to remain usable.

Scenario E proves the user-visible state. The compose worker-isolation check in Section 4 is the separate temporal proof that video actually transitions to ready while caption work remains unconsumed.

### Scenario F — reviewer surface, authentication seam, and setting

1. As reviewer A (accepted on this separate review), open the dedicated reviewer-access speech and verify no editable caption textarea or editable automatic-caption control is rendered; `captions_enabled` may remain present in the read resource. Scenario C owns its transcript-row/seek proof.
2. Reviewer B is authenticated by `auth.setup.ts` and invited (not accepted) on the caption-display speech. One direct captions/transcript denial plus reviewer A's 200 is retained only to validate the real session/cookie/authentication seam. Pest owns the authorization matrix.
3. As the owner, disable automation on a ready speech, reload to prove persistence and retained VTT/transcript, then re-enable and prove the ready row is not duplicated or reprocessed. Component/API tests own the other state-machine branches.

### Explicit non-goals

- No exact browser-native caption styling/pixel assertion.
- No exact Whisper transcript, punctuation, or cue timing assertion.
- No malformed-VTT or full policy matrix in the browser; Pest already owns those branches.
- No model download, FFmpeg transcode, or Whisper invocation in Playwright.
- No fixed `waitForTimeout`; wait on state, response, cue, or server projection.

---

## 6. Real `whisper.cpp` smoke

### 6.1 Make the runtime image and model reproducible

1. Pin the [v1.7.2 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.7.2) to its full commit `6266a9f9e56a5b925e9892acf650f3eb1245814d` in the Dockerfile. A SHA is not a valid replacement for `git clone --branch`; perform a minimal fetch of the verified commit and detached checkout, then assert `git rev-parse HEAD`. Pin the build and PHP runtime images to the same Alpine minor/digests to avoid copying ABI-sensitive output from Alpine 3.20 into a floating `php:8.4-fpm-alpine`. Add `-DBUILD_SHARED_LIBS=OFF`, keep `WHISPER_BUILD_EXAMPLES=ON` because `whisper-cli` is an example target, disable tests/server, and build `whisper-cli`.
2. Add `docker/whisper/model.lock` containing filename, immutable revision URL, SHA-256, source URL, license name/URL, whisper.cpp commit, and one <=64-character model identifier incorporating both engine and weight revisions (for example short commit + short weight digest). The initializer, `WHISPER_MODEL_NAME`, transcript writer, metadata checker, and both smoke layers consume this single identifier; a weight or engine change cannot silently retain `whisper.cpp-base.en`.
3. Initial candidate: [`ggml-base.en.bin` at immutable Hugging Face revision `80da2d8bfee42b0e836fc3a9890373e5defc00a6`](https://huggingface.co/ggerganov/whisper.cpp/commit/80da2d8bfee42b0e836fc3a9890373e5defc00a6), SHA-256 `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`, whose repository metadata records MIT. Re-verify the downloaded bytes before committing the lock.
4. Add a `whisper-model-init` compose profile/service with an RW `whisper-models:/models` mount. Download to a temporary filename, verify SHA-256, then atomically rename. A checksum mismatch deletes the temporary file and fails non-zero. A matching existing file exits successfully without downloading; prove that with an offline second invocation and unchanged file mtime.
5. Keep `whisper-worker` mounted RO. Never put the model into an image layer, and retain the repository's no-registry rule for FFmpeg-containing worker images.

[Upstream v1.7.2 CMake](https://raw.githubusercontent.com/ggerganov/whisper.cpp/v1.7.2/CMakeLists.txt) sets `BUILD_SHARED_LIBS` on by default on non-MinGW/non-Emscripten platforms, so copying only the CLI is not a valid runtime-image proof. The final image must run `ldd` with no `not found` entries and invoke `whisper-cli --help` successfully.

### 6.2 Focused adapter diagnostic

Add a `whisper-smoke` Docker target based on `whisper-worker` with dev Composer dependencies and `pdo_sqlite` solely for the smoke test, **and define a Compose service that selects that target**. The production worker currently has `--no-dev` dependencies, so `php artisan test` cannot truthfully be proposed against that image without this target/service. Keep the committed media/README under `api/`, which is what the runtime stages copy.

Create an environment-gated `RealWhisperAdapterSmokeTest` that:

1. uses SQLite and `Storage::fake('media')` for isolation;
2. instantiates `WhisperTranscriber` directly so the testing binding cannot substitute `FakeCaptionTranscriber`;
3. runs the committed 3–10 second spoken MP4 through the adapter's real FFmpeg extraction and configured `whisper-cli`;
4. asserts exit success, parseable non-empty WebVTT, at least one cue, and a small normalized keyword subset;
5. asserts the caption asset is `ready`, canonical VTT exists, exactly one transcript row exists, body/segments are non-empty, `source=whisper`, language is correct, revision fields agree, and `model` equals the locked engine+weights identifier;
6. asserts bounded process diagnostics are exported to the mounted artifact directory on failure while secrets, signed URLs, full paths, and unbounded stderr are not.

This is a fast diagnostic for the adapter, not STEP-09's final queued-system proof. Do not compare the full transcript or exact timestamps; those are model/platform-sensitive and do not test the integration seam.

### 6.3 Queued final-worker sign-off

Against disposable PostgreSQL/SeaweedFS volumes and a disposable Valkey container:

1. initialize the real media bucket and checksum-verified model;
2. seed a source asset plus a `processing` captions asset in real storage/DB;
3. dispatch a real `GenerateCaptions` job through Laravel, rather than calling its handler;
4. run the actual final `whisper-worker` image with `queue:work redis-long --queue=captions --once`;
5. assert the job left the queue, caption asset is `ready`, canonical VTT exists in SeaweedFS, exactly one PostgreSQL transcript row exists, body/segments are non-empty, `source=whisper`, caption/transcript revisions agree, and language/model match the lock;
6. inspect the resolved compose service: intended queue, worker/job/retry timeout ordering, CPU/memory settings, and a read-only model mount;
7. invoke `ldd` and `whisper-cli --help` in **`whisper-worker` itself**, not only the dev-derived smoke target. The wrapper runs with `set -eu`, accepts a fully static executable, rejects any `not found`, and cannot let a pipeline/semicolon mask an `ldd` or CLI failure.

This queued check closes the container binding, serialization/routing, worker command, PostgreSQL, and object-storage gaps the adapter smoke deliberately leaves open.

### 6.4 Isolated smoke harness

Add one `scripts/whisper-smoke-stack.sh` wrapper with a dedicated Compose project/network and disposable PostgreSQL/SeaweedFS/Valkey state. Every build, initializer, adapter, runtime, and queued-smoke command goes through it; no bare `docker compose` may accidentally consume the developer stack or model volume. The `whisper-smoke` service explicitly mounts this project's verified model volume **read-only** and a host artifact directory—it does not assume target inheritance also inherits `whisper-worker`'s Compose mounts. A scoped trap tears down only this project while retaining the host artifacts.

### 6.5 Workflow

Add a separate workflow with `workflow_dispatch` plus a schedule. A lightweight lock/license/schema check stays PR-required. The real queued job also runs automatically when the Dockerfile, Whisper/caption adapter or job, compose worker, model lock/downloader, or smoke fixture changes, and it must pass once before STEP-09 release/sign-off. It remains independent of browser retries. A named Docker volume does not survive GitHub runners: cache a host file keyed by SHA-256, re-verify it, then atomically copy it into the model volume. Bind-mount an artifact directory so `docker compose run --rm` cannot discard VTT/diagnostics. Set both job-level and process-level workflow timeouts and upload VTT/process/worker logs on failure.

---

## 7. CI wiring

Update `.github/workflows/ci.yml` so the required browser lane:

1. builds/serves the production bundle through the E2E override;
2. generates certs/hosts for app, API, and media;
3. initializes the media bucket/CORS before seeding;
4. starts the normal queue worker after migrations;
5. leaves the Whisper worker stopped;
6. runs the deterministic worker-isolation measurement with only the transcode worker consuming its queue;
7. runs `verify-caption-concurrency.sh` against PostgreSQL/Valkey with two normal workers plus controlled E2E caption workers, covering forced re-derive overlap, concurrent enable/upload/retry, and attempt A → disable → re-enable B before returning to one default worker and no caption worker;
8. asserts the live PostgreSQL generated column and GIN index;
9. explicitly adds `tests/captions.spec.ts` to the current filename allowlist;
10. configures `screenshot: 'only-on-failure'` and `video: 'retain-on-failure'`, then retains those artifacts with traces, browser report, app/worker logs, and relevant failed jobs.

Separately, add a production Compose scheduler service running Laravel's scheduler with a restart policy. CI starts that service under `APP_ENV=e2e`, where the **same** `media:reconcile` schedule is every minute, seeds a uniquely named scheduler-smoke row outside all browser fixture IDs, and requires its safe failed transition within 90 seconds; direct `media:reconcile` invocation does not satisfy this wiring proof. The verifier then stops the scheduler, removes only its smoke row, reruns `E2ECaptionsSeeder` so the browser processing fixture has fresh liveness clocks, and asserts the scheduler remains stopped before returning. Production keeps the daily cadence, and documentation states the scheduler service is required. The worker-isolation script finishes by draining the held captions job with the deterministic fake transcriber so no queued work leaks into later tests.

Keep the first captions spec entirely serial and Chromium-only. Once stable, copy only immutable read-only native-track/geometry checks into a separate Firefox/WebKit matrix rather than sharing fixture resets across projects or tripling mutable tests.

---

## 8. Validation sequence

### Baseline before implementation

```bash
cd api
./vendor/bin/pest tests/Feature/Captions tests/Feature/Speech/UploadFlowTest.php tests/Feature/Speech/SpeechOwnershipTest.php

cd ../web
npm run test -- --run
npx playwright test --list --project=chromium
```

### Focused implementation gates

Run each block from the repository root. The `--fresh` action is guarded to delete only the dedicated E2E project's state.

```bash
./scripts/e2e-stack.sh prepare
docker compose config --quiet
docker compose -f compose.yaml -f compose.e2e.yaml config --quiet
./scripts/verify-whisper-model-lock.sh --metadata-only

cd api
# This directory includes MediaInitializeCommandTest and E2ECaptionsSeederTest.
./vendor/bin/pest tests/Feature/Captions
./vendor/bin/pint --test
php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G
./vendor/bin/pest

cd ..
./scripts/e2e-stack.sh up --fresh
./scripts/e2e-stack.sh nginx-test
./scripts/e2e-stack.sh verify-signed-media
./scripts/verify-caption-worker-isolation.sh
./scripts/verify-caption-concurrency.sh
./scripts/verify-postgres-caption-schema.sh
./scripts/verify-caption-recovery-scheduler.sh

cd web
npm run lint
npm run test -- --run
npm run build
npx playwright test tests/captions.spec.ts --project=chromium --workers=1
npx playwright test tests/captions.spec.ts --project=chromium --workers=1 --repeat-each=10

cd ..
./scripts/e2e-stack.sh down
```

### Clean-stack browser gate

Run once with fresh disposable E2E Postgres/SeaweedFS volumes and a fresh Valkey container, following the CI order. The browser lane does not initialize or download a model. Then run the full explicit CI list:

```bash
./scripts/e2e-stack.sh down
./scripts/e2e-stack.sh up --fresh

cd web
npx playwright test \
  tests/speech-create.spec.ts \
  tests/app-shell.spec.ts \
  tests/essay-editor.spec.ts \
  tests/captions.spec.ts \
  --project=chromium --workers=1

npx playwright test --project=chromium --workers=1

cd ..
./scripts/e2e-stack.sh down
```

### Real Whisper gate

```bash
./scripts/whisper-smoke-stack.sh prepare
./scripts/whisper-smoke-stack.sh build
./scripts/whisper-smoke-stack.sh model --offline-idempotency
./scripts/whisper-smoke-stack.sh runtime
./scripts/whisper-smoke-stack.sh adapter
./scripts/whisper-smoke-stack.sh queued
./scripts/whisper-smoke-stack.sh down
```

The initializer verifier performs an online first run and network-disabled second run, requiring an unchanged checksum and mtime. The adapter smoke runs once for diagnostics; the final script runs one genuine queued job through the production worker image.

---

## 9. Acceptance mapping and definition of done

| STEP-09 acceptance | Final evidence |
|---|---|
| Video becomes ready independently of captions | Deterministic compose worker-isolation measurement + Playwright processing fixture with decoded video |
| Native captions and annotations toggle independently | Playwright Scenario A, native caption/metadata tracks and control state |
| Annotation moves away from native captions | Playwright Scenario A bounding boxes in upper/lower halves |
| Caption edit persists and re-renders | Scenario B PUT + canonical GET + revision convergence + native cue + reload |
| Failed captions remain visible/retryable without breaking playback | Exception lifecycle Pest tests + Scenario E real retry/status transition |
| Transcript exists, seeks, and search finds the right owned speech | Scenarios C/D plus live PostgreSQL schema/index assertion |
| Edit re-derives transcript as `edited` and preserves model | Focused Pest + real PostgreSQL/default-queue integration; Scenario D proves visible search convergence |
| Automatic captions have a real off-switch | Frozen addendum + settings API/component tests + Scenario F owner UI persistence |
| Model weights and engine are pinned and license-recorded | `model.lock`, engine+weight model ID, checksum initializer, RO runtime mount |
| Actual FFmpeg/Whisper/application path works | One real `GenerateCaptions` job consumed by the final worker against PostgreSQL/SeaweedFS |

STEP-09 verification is complete only when all of the following are true:

- invited, revoked, and all other non-granting reviewers cannot read VTT/transcript;
- an owner can operate the automatic-caption setting without deleting existing captions, concurrent enable/upload/retry cannot create a duplicate row/job, and an obsolete attempt cannot mutate its replacement;
- expected timeouts/exceptions map immediately to retryable failure, and hard worker loss is eventually recovered by an actually running scheduler plus attempt-token compare-and-set using distinct queued/running clocks;
- source transfer is streamed, every storage/file result is checked, and every scratch path is removed on success and failure;
- rapid edit re-derivation is handled by the normal CI worker; revision matching makes the newest canonical VTT win and refreshes pre-warmed Transcript/Search caches;
- worker isolation is measured by running transcode while the captions worker is stopped, then draining the held deterministic caption job;
- Playwright uses real signed HTTPS media from SeaweedFS, browser-decodable MP4 bytes, real stored VTT, real API responses, native cues, and PostgreSQL;
- live PostgreSQL has the generated `body_tsv` column and named GIN index;
- overlay movement is measured geometrically, not inferred from a CSS class;
- a focused video.js adapter/source-refresh regression proves source refresh cannot silently remove the caption track;
- `captions.spec.ts` is explicitly invoked in CI and survives ten repeated Chromium runs;
- the exact engine commit and model artifact are immutable/checksummed/license-attributed, the stored model ID changes with either, the initializer passes an offline idempotency check, and one queued smoke passes through the actual final worker image;
- existing full Pest, Vitest, build, lint, static analysis, and Playwright suites remain green.
