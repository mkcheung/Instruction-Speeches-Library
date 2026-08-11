# Step 04 retrospective — Every video plays

**Executed:** 2026-08-08–2026-08-09 · **Against:** [STEP-04-every-video-plays.md](STEP-04-every-video-plays.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §12 S4 / §5.6 / §9.2 / §9.5
**Method:** solo build in commit [`2da2af2`](../../commit/2da2af2) (dated 2026-08-09, following two CI-hardening commits on 2026-08-08), followed by two unrelated CI-cache commits. This retrospective re-derives its findings from the current repo state and live test runs, not from the earlier session's own account of itself — memory going into this check said Step 04 was "skipped over, still not built," which the commit history and code below contradict.

---

## What was accomplished

**`api/` — the full transcode + poster stack**, replacing STEP-03's remux-only path:
- `App\Services\Transcoding\FfmpegTranscoder` (480 lines): preserves the STEP-03 remux fast path unchanged, adds a full HEVC/H.264 re-encode branch with the zscale/tonemap HDR→SDR chain and `scale='min(1280,iw)':-2` downscale **in the same ffmpeg invocation**, and the §9.5 poster pipeline — one JPEG master at `clamp(10% duration, 2s, 30s)` with `-ss` before `-i`, three widths (320/640/1280) × two formats (webp/jpeg), the 640w webp as the single primary, plus a `fps=…,scale=160:-2,tile=5x2` sprite strip.
- `App\Jobs\TranscodeSpeechAsset` and the new `App\Jobs\GeneratePoster`: both `afterCommit = true`, routed onto a dedicated `redis-long` connection (`config/queue.php`, `retry_after => 3900`, above `TranscodeSpeechAsset::$timeout = 3600` and `failOnTimeout = true`), both keyed with `WithoutOverlapping` on asset id.
- All five idempotency guarantees the step calls for: deterministic output path (no timestamp suffix), the `lockForUpdate()` exit guard in `writeFinalStatus()` re-checked before every write, the same guard reused inside the poster pipeline's transaction, a poster-extraction failure caught and logged without undoing a successful transcode, and delete-then-insert inside one transaction so `uq_assets_primary` is never straddled.
- `App\Http\Controllers\Api\QueueStatusController` — `Redis::connection()->llen('queues:transcode')`, backing the frontend's backpressure number.
- `App\Services\MediaUrlSigner::DEFAULT_TTL_SECONDS = 600` for video, with `SpeechResource::presignPoster()` explicitly overriding to `3600` for posters — matches the step's stated reason (no seek-refresh mechanism behind an `<img>`).
- `config/media.php`'s global `free_space_watermark_bytes` (R10), checked once per entry point before any ffmpeg work starts.
- Migration `2026_08_09..._add_poster_columns_to_speech_assets_table.php`, `SetPosterFrameRequest`, `SpeechUploadController::retry()`, `SpeechAssetResource`/`SpeechResource` poster/sprite blocks.
- 101 Pest tests total (up from Step 03's baseline), including `FfmpegTranscoderTest` (249 lines), `PosterFrameTest`, `QueueStatusTest`, `SpeechAssetResourceTest`.

**`web/` — posters, backpressure, and the frame picker**:
- `components/speech/SpeechPoster.tsx` — `<picture>`/`srcset` with `loading="lazy"`, `decoding="async"`, explicit `width`/`height` read off the asset row.
- `components/speech/StatusBadge.tsx` — polls `/api/queue/transcode-depth` and renders "N videos ahead of yours" / "You're next", confirmed by a real test asserting the exact string against a mocked `depth: 3` and `depth: 0` response.
- `routes/SpeechWatch.tsx` — poster passed into `VideoPlayer`, a `PosterFramePicker` reading the sprite strip, `useSetPosterFrameMutation` wired to the backend's poster-frame endpoint.
- `shared/media/videojs-adapter.ts` — new adapter code, with its own test file.

**Containers**: `ffmpeg-worker` added to `Dockerfile` (built `FROM runtime`, `apk add ffmpeg`, never a fresh base) and `compose.yaml` (`nice -n 19` on the queue-worker process, `cpus: "1.5"`, `mem_limit: "2g"` as the compose-deploy equivalent of `CPUQuota=150%`). The GPL boundary is documented at length in both files and enforced by omission — nothing in `ci.yml`/`deploy.yml` pushes any image to a registry, confirmed by reading both.

**Verified live, not just read**: ran `./vendor/bin/pest` (101/101 passed, 831 assertions), `./vendor/bin/phpstan analyse` (0 errors), `./vendor/bin/pint --test` (clean) against sqlite (matching CI's `phpunit.xml` pin), plus `npx vitest run` (75/75 passed across 13 files), `npx tsc -b` (clean), `npx eslint .` (0 errors, 1 pre-existing warning in an unrelated file, `SpeechCreate.tsx`) on the frontend. All backend containers (`app`, `ffmpeg-worker`, `queue-worker`, `postgres`, `valkey`, `seaweedfs`, `mailpit`, `web`) are up and healthy.

---

## Difficulties encountered

1. **The zscale HDR tonemap chain silently fails without real VUI metadata.** A synthetic 10-bit HEVC fixture with no HDR tags reliably reproduced `zscale`'s "no path between colorspaces" error; the fix wasn't a code change but building a fixture with real `colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc` via `-x265-params` — `-color_primaries` alone didn't stick. Documented directly in `FfmpegTranscoder`'s class doc-comment for whoever next touches this path.
2. **Rotation could not be positively verified.** Multiple attempts to construct a fixture carrying a display-matrix/`tkhd` rotation this ffmpeg build (8.1.2) would visibly re-apply on re-encode failed — `-metadata:s:v:0 rotate=90` produced no side-data block, and `-display_rotation` was rejected as input-only. The class ships relying on ffmpeg's documented default autorotate-on-decode behavior instead of an explicit transform, which is honestly self-documented in the code but is a real, named gap against the demo script's own portrait-video requirement (see below).
3. **A typed-property redeclaration on `Queueable`'s `$connection`/`$queue` is a fatal class-composition error**, not a lint warning — hit once while writing `TranscodeSpeechAsset` and documented so `GeneratePoster` didn't repeat it.

## Mistakes made

- **`-threads 2` was never added to the `ffmpeg` invocation.** `compose.yaml`'s own comment states explicitly: *"`-threads 2` (an ffmpeg CLI flag, not a compose/Docker setting) belongs in the actual `ffmpeg` invocation in `FfmpegTranscoder.php`, not here — not added in this file."* Grepping `FfmpegTranscoder.php` for `threads` confirms it: the flag is absent from every `ffmpeg` call (the transcode, the poster master, the per-width variants, the sprite pass). The step's acceptance list ties this to "three simultaneous uploads do not drive load past the `CPUQuota`" — compose's hard `cpus: "1.5"` cap still bounds the *container*, but without `-threads 2`, a single ffmpeg process is free to spawn as many encoder threads as libx264 will use, which is exactly the per-process throttle the plan called for. Worth fixing before calling this step's resource story complete.
- **No test asserts "no poster path is reachable unsigned" (R20).** The step file marks this with its own ⚠️ specifically because it's "the shortcut the feature actively invites" — but grepping `api/tests` for anything checking poster URLs against an unauthenticated/guest request turns up nothing. Structurally the app likely satisfies it (posters are only ever exposed through `MediaUrlSigner::presign()` inside `SpeechResource`, gated behind whatever the speech's own show-authorization already requires — never a standalone public route), but "likely satisfies it by construction" is not what the plan asked for; it asked for a test that would catch a regression.

## Package/tooling surprises

- **ffmpeg installed via Alpine's `apk` is already `--enable-gpl --enable-libx264 --enable-libwebp --enable-libzimg`** at version 8.1.2 — confirmed by actually running it inside the `ffmpeg-worker` container, not assumed from a changelog. No custom build was needed, which simplified the Dockerfile stage but is worth recording since the plan treats this as something to verify, not assume.
- **ffmpeg is not installed on the host at all** (confirmed while trying to verify this retrospective) — everything ffmpeg-related has to be exercised inside the `ffmpeg-worker` container, same as the original build session's own account says.
- **`vendor/bin/pest` doesn't exist inside the running `app` container** — the production Docker image is built with `composer install --no-dev --no-scripts --no-autoloader` (`Dockerfile`'s `vendor` stage), so dev tooling is deliberately absent from the deployed image. CI instead runs the suite on the GitHub Actions runner directly against a host-level PHP/Composer install with `phpunit.xml`'s pinned `DB_CONNECTION=sqlite`/`:memory:`. This retrospective replicated that path (host PHP 8.5 + Composer, not the container) rather than assuming the container could run tests — a mismatch worth knowing before anyone reaches for `docker compose exec app ./vendor/bin/pest` expecting it to work.

## What was not verified — and cannot be, from here

- **The rotation gap named in "Difficulties" above is untested against a real device fixture**, and the code says so in its own comment. The demo script's step 5 ("shoot a portrait video… the thumbnail is portrait, not sideways") depends on this exact, self-flagged-as-unverified behavior. Closing it needs a real rotated phone video run through the live pipeline by a human, watching the actual output — not another synthetic fixture.
- **No Playwright/e2e spec exists for any part of this step's demo script.** `grep`ing for `.spec.ts` files across the repo turns up only `register-validation`, `onboarding`, and `speech-create` — nothing exercising an HEVC/.MOV upload, the "N videos ahead" backpressure number in a live browser, the Retry button against a genuinely failed asset, or the sprite-strip frame picker. The component-level tests (`SpeechPoster.test.tsx`, `SpeechWatch.test.tsx`, `StatusBadge.test.tsx`) prove the pieces render correctly against mocked data, which is real evidence, but nobody has walked the seven-step demo script end-to-end in a browser against the live stack.
- **"Three simultaneous uploads do not drive load past the CPUQuota" was not measured.** The step's own acceptance line underlines "measured, not assumed" — this retrospective did not spin up three concurrent transcodes and watch `docker stats`, so this remains unmeasured, compounded by the `-threads 2` gap above.
- **"The poster does not flash mid-playback when the presigned URL refreshes"** has no test (component or e2e) and requires watching a real player through an actual URL-refresh cycle to confirm.
- **The full test suite was run against sqlite, not Postgres.** [Step 01's retrospective](STEP-01-RETROSPECTIVE.md) established running against real Postgres before trusting a suite as the standing rule for this project, after catching two sqlite-only false negatives. That check was skipped here deliberately — the only reachable Postgres is the live dev database with real data in it (`docker compose ps` shows it up 2 days), and running the suite against it risked mutating that state. This is a real, not just theoretical, gap: this step touches new unique-index/transaction behavior (`uq_assets_primary`, the delete-then-insert poster transaction) that is exactly the class of bug the Step 01 rule was written to catch. Closing it needs a disposable Postgres instance, not the shared dev one.

---

## Next step

The uncommitted working tree already has the start of the answer: `ReviewController`, `ReviewerDirectoryController`, `NotificationController`, `Review`/`ReviewFactory`, the `reviews`/`notifications` migrations, `app/Notifications/`, `app/Policies/`, `ReviewService`, and `web/src/features/review/` + `web/src/components/review/` are all present but not yet committed. That is exactly [Step 05 — The invitation loop](STEP-05-invitation-loop.md)'s scope (invite a named reviewer, reviewer directory, dashboard, access control) — it appears to already be in progress. Before treating any of it as done, it needs the same ground-truth check this retrospective just gave Step 04: real test runs, not the in-progress session's own account.

**Concretely, before or alongside finishing S05:**
1. Fix the `-threads 2` gap and add the missing "poster path is not reachable unsigned" test — both are small, both are things the plan explicitly called for, and both are cheap to close now versus rediscovering them later.
2. A human needs to walk STEP-04's seven-step demo script in a real browser against the live stack at least once — the iPhone HEVC upload and the portrait-rotation behavior in particular, since the code itself flags rotation as unverified.
3. Run the backend suite against a disposable Postgres instance (not the shared dev database) before calling Step 04's test coverage trustworthy, per the standing rule from [STEP-01-RETROSPECTIVE.md](STEP-01-RETROSPECTIVE.md).
4. Confirm what's already uncommitted in `api/app/Http/Controllers/Api/{Review,Notification,ReviewerDirectory}Controller.php` etc. is intentional in-progress Step 05 work and not something that should be reverted, then commit it deliberately rather than leaving it loose in the tree.

## Next CP checkpoint

Per [LEARNING-TRACK.md](LEARNING-TRACK.md)'s table, **[CP-04 — Service containers, caching, and the codec trap](CP-04-services-and-caching.md)** runs after Step 04. It is explicitly optional — Step 04's own footer and LEARNING-TRACK.md both say Step 05 does not depend on it, so it's safe to go straight to Step 05 (already underway per the uncommitted files above) without it. LEARNING-TRACK.md's own notes flag that CP-04's "codec trap" lesson has already inverted from what the plan originally assumed (Playwright ≥1.57's bundled Chromium now *has* H.264 on macOS arm64/Linux x64, and the gap relocated to arm64 Linux) — worth knowing going in if CP-04 is picked up later, since the exercise as originally scoped would teach the wrong fact.
