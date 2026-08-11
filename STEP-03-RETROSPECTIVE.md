# Step 03 retrospective — Upload and watch

**Executed:** 2026-08-08 · **Against:** [STEP-03-upload-and-watch.md](STEP-03-upload-and-watch.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §12 S3 / §9 media pipeline / §6.11 speech versioning
**Method:** solo build, primary commit [`58ce8ac`](../../commit/58ce8ac) "implement speech upload, S3 multipart, transcode queue, and playback" (2026-08-08), followed same day by [`4036c34`](../../commit/4036c34) fixing a real StrictMode bug in Uppy/video.js lifecycle, CI hardening commits (`01f41fe`, `08b1410`, `0ed915e`, `de4cbd4`, `b564899`), and [`5afb10a`](../../commit/5afb10a) fixing an FK-ordering bug in the e2e test's own cleanup. Verified here against the live running stack and current code, not the original session's account — note that Step 04 has since landed on top of this step's transcoder, which changes what one of this step's own acceptance items now means (see below).

---

## What was accomplished

**`api/` — the full upload/quota/versioning/playback stack**:
- `speeches` and `speech_assets` tables (raw driver-branched SQL migrations, not Blueprint — both engines need identical CHECK constraints, and SQLite can only acquire a CHECK at `CREATE TABLE` time). `ck_speeches_supersedes_older` (`supersedes_id < id`, the entire cycle defense for §6.11), `uq_speeches_successor` (partial unique index — one successor per attempt), `ck_speech_assets_kind`/`ck_speech_assets_format`/`ck_speech_assets_kind_format`, and `uq_assets_primary` (partial unique on `(speech_id, kind) WHERE is_primary`).
- `App\Services\QuotaService` — `reserve()` as a single conditional `UPDATE` (never check-then-act; `affectedRows === 0` is the only over-quota signal) and all four release paths named in the plan: `releaseOnComplete` (reconciles by the real `byte_size` against the untrusted `client_declared_bytes`), `releaseOnAbort`, `releaseOnReconcile`, `releaseOnSpeechDeleted`.
- `App\Services\MultipartUploadService` — the four presigned-S3 endpoints (create/sign-part/complete/abort) against SeaweedFS, with the same internal-vs-public-endpoint `S3Client` split `MediaUrlSigner` uses.
- `App\Console\Commands\MediaReconcileCommand` (`media:reconcile`) — sweeps `uploading` rows past 2h (releasing the quota counter, not just marking the row) and `processing` rows past 2h (surfacing a hung transcode as a visible Failed+Retry). Scheduled in `routes/console.php`.
- `TranscoderContract` bound to `FakeTranscoder` in testing (`AppServiceProvider`, keyed off environment) and, at the time this step shipped, a remux-only `FfmpegTranscoder` in dev — `-c copy -movflags +faststart` for h264+aac+≤1080p, `status='failed'` otherwise.
- `App\Jobs\TranscodeSpeechAsset` with `afterCommit = true` from the first dispatch.
- 9 new Pest test files (`UploadFlowTest`, `SupersedeTest`, `PlaybackAuthorizationTest`, `QuotaServiceTest`, `MediaReconcileTest`, `SpeechOwnershipTest`, `TranscodeSpeechAssetTest`, `FfmpegTranscoderTest`, plus factories).

**`web/` — upload dashboard, player, status/versioning UI**:
- `components/speech/UploadDashboard.tsx` — Uppy + `@uppy/aws-s3` wired to the four multipart endpoints through `store.dispatch(speechApi.endpoints….initiate(...)).unwrap()`, not hooks (Uppy's plugin callbacks run outside any component). The Uppy instance is created *and* destroyed inside the same `useEffect` — the doc comment explains this is deliberate, not a style choice: a `useState`-lazy-init + separate destroy-on-cleanup split would tear down the one live Uppy instance on React 18 StrictMode's dev-only mount→cleanup→remount pass, which is exactly the bug `4036c34` fixed after first shipping the other way.
- `shared/media/videojs-adapter.ts` — the §9.3 TTL-refresh handler: on `MEDIA_ERR_NETWORK`/`MEDIA_ERR_SRC_NOT_SUPPORTED` (and only those two codes — `ABORTED`/`DECODE` are real failures a fresh URL can't fix), fetches a new presigned URL, reassigns `src`, and restores both playback position and play state. A real unit test (`videojs-adapter.test.ts`) sets `currentTimeValue = 42`, triggers the error, and asserts position is restored to `42` after `loadedmetadata` — this is the literal acceptance item ("seeking past the 10-minute TTL refreshes the URL and restores playback position"), independently confirmed passing in this session (75/75 Vitest tests green, including this file).
- `components/speech/StatusBadge.tsx` — renders every asset status including `failed` with a working Retry button, and a `"v2 of {title}"` badge when `speech.supersedes` is present.
- `components/speech/NoPosterPlaceholder.tsx` — the typographic hue-from-ULID placeholder at 16:9.
- `routes/SpeechCreate.tsx` — the create form including the "this replaces an earlier attempt" picker and `change_note` field.

**Containers**: `valkey` and `queue-worker` added to `compose.yaml` — `queue-worker` built from the same `Dockerfile` as `app`, differing only in its `command`, exactly the "same image, different command" illustration the step names.

**Verified live in this session, not just read:**
- `./vendor/bin/pest` → **101/101 passed**, 831 assertions (matches the count already confirmed in the Step 04 retrospective — no regressions since).
- `npx vitest run` → **75/75 passed** across 13 files, including the exact position-restore assertion above.
- `./vendor/bin/phpstan analyse` → 0 errors; `./vendor/bin/pint --test` → clean.
- The DB-level cycle-rejection test (`SupersedeTest`) genuinely attempts `UPDATE speeches SET supersedes_id = ?` to create a cycle and asserts a `QueryException` — proving the `< id` CHECK itself rejects it, not a service-layer guard a seeder could bypass, exactly as §6.11 requires.
- The 1-byte-declared/40MB-real quota test (`UploadFlowTest`) asserts the exact reconciliation delta — the literal ⚠️ acceptance item.
- `npx playwright test tests/speech-create.spec.ts --project=chromium` → **1/1 passed**, live against `https://app.speechcoach.test`: real registration, real Mailpit click-through, real speech-create form submission, landing on the real upload step.

---

## Difficulties encountered

1. **A real StrictMode lifecycle bug, caught by using the app, not by review.** `4036c34`'s commit message states it directly: "repair uppy and video.js instances breaking under strictmode remount." The `UploadDashboard.tsx` doc comment explains the mechanism precisely — a `useState`-created singleton survives React 18 dev-only StrictMode's double-invoke, but a paired `useEffect` cleanup (`uppy.destroy()`) fires on the *first, throwaway* unmount too, tearing down the one live instance the still-mounted `<Dashboard>` was wired to. First shipped the "natural" way, rendered as an empty unresponsive box, fixed by creating fresh inside the effect itself.
2. **Foreign-key ordering broke the e2e test's own cleanup, not the app.** `5afb10a` fixes `speech-create.spec.ts`'s `afterEach`: `speeches.user_id` is `ON DELETE RESTRICT` by deliberate product decision (§6.3 — a speech should outlive its speaker's account deletion, not vanish silently), so a test that deletes straight from `users` after creating a speech now fails on the FK it never used to touch. Fixed by deleting the dependent `speeches` row first.

## Mistakes made

None found in this pass that weren't already caught and fixed within the same day (see Difficulties above) — both real bugs hit during the build were found by actually running the app/tests, fixed same-session, and left with a paper trail (commit message, doc comment) explaining why, which is itself worth carrying forward as the standing practice.

## Package/tooling surprises

- **Only the multipart upload path was implemented — `shouldUseMultipart` is unconditionally `true`, regardless of file size**, contradicting the step's own Frontend bullet ("Uppy Dashboard with the multipart threshold at ~20 MB"). `UploadDashboard.tsx`'s own comment names this explicitly: the backend has no single-PUT presign endpoint, so the ~20MB threshold from the reference design was deliberately given up in favor of one upload code path end to end. Not a bug — self-documented and reasoned — but a real, standing deviation from the step file's literal text, worth knowing before assuming a small-file fast path exists anywhere in this app.
- **Resumability is Uppy's own retry/backoff on individual parts, not a page-reload-survives-tab-close mechanism.** The same comment block is explicit that a page reload mid-upload is *not* resumed (that would need `@uppy/store-default`'s IndexedDB persistence, never added) — the acceptance item satisfied is losing and regaining the *network* mid-upload, not the *tab*. Worth knowing precisely which failure mode this step actually covers.

## What was not verified — and cannot be, from here

- **The demo script's wifi-kill-and-resume step (item 2) and the cross-browser Chrome+Safari scrub (item 3) both need a human with a real network connection and, for Safari, a real Safari** — neither is reachable from this environment. The mechanism (Uppy's built-in per-part retry) is real code, but nobody has watched a real upload survive a real network drop.
- **The `speech-create.spec.ts` e2e file says, in its own header comment, that it does not exercise most of the demo script** — the wifi/resume case, the cross-Member presigned-URL fetch, and the iPhone-.MOV-fails case all explicitly need either a real video fixture (none is committed — the Step 00 spike's sample file was local and ungitted) or a second authenticated browser context, and the comment states outright "Follow STEP-03's own demo script by hand against the live stack for full coverage." This retrospective ran the one thing that *is* covered (1/1 passed, live) but did not attempt to hand-build the missing coverage — that would be new test-writing, out of this retrospective's scope.
- **Acceptance item 7 ("Upload an unmodified iPhone .MOV. It fails — visibly...") is no longer true of the current codebase, and that is expected, not a regression.** Step 04 has since landed (see [STEP-04-RETROSPECTIVE.md](STEP-04-RETROSPECTIVE.md)) and replaced the remux-only `FfmpegTranscoder` with a full HEVC/HDR pipeline — an unmodified iPhone file now transcodes successfully rather than failing. The step file itself calls this out ("That is deliberate; step 04 makes it work."), so grading Step 03 in isolation against *today's* code for this one item would be grading it against a target that was only ever meant to hold until the very next step. The Failed+Retry *mechanism* itself (the `StatusBadge` UI, the `failure_code`/`failure_detail` columns, the reconcile sweep) is still fully in place and still real — only the specific "HEVC always fails" trigger condition has since been superseded.
- **The full backend suite was run against sqlite** (matching `phpunit.xml`'s pin and CI's own approach), not the live dev Postgres — consistent with the same tradeoff made in the Step 02 and Step 04 retrospectives, for the same reason: the only reachable Postgres is the shared dev database with real data in it, and mutating it wasn't in scope here. This step's own migrations (the `< id` CHECK, both partial unique indexes) are exactly the class of constraint the [Step 01 retrospective](STEP-01-RETROSPECTIVE.md)'s standing rule was written to protect against sqlite false negatives on — the cycle-rejection and one-successor tests did run and pass here, but only against sqlite's CHECK/index implementation, not Postgres's.

---

## Next step

Per [STEPS.md](STEPS.md), Step 03 unblocks Steps 04, 05, and 06. Per the two prior retrospectives in this session, **Step 04 is already built and committed**, and **Step 05 is already in progress, uncommitted** in the working tree. Nothing above blocks either — the open items are demo-script coverage gaps (network-kill, cross-browser, cross-Member manual walkthrough) that don't gate what's already been built on top. The practical next action is the same one named in the Step 02 and Step 04 retrospectives: a human walking the full demo scripts by hand, since that's the one thing no amount of curl/Pest/Playwright substitutes for across all three steps now.

## Next CP checkpoint

Per [LEARNING-TRACK.md](LEARNING-TRACK.md)'s table, **[CP-03 — Debugging a failure you cannot see](CP-03-debugging-failures.md)** is next, and is explicitly optional (Step 04 does not depend on it — already confirmed moot here since Step 04 has already shipped). It's placed here because Step 03 is what it tests against, and the StrictMode/Uppy bug and the FK-ordering test bug fixed in `4036c34`/`5afb10a` above are both genuine "a failure you cannot see directly" specimens from this exact step, real material for that checkpoint if picked up.
