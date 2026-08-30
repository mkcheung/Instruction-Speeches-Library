# Step 10 retrospective — Voice annotation

**Executed:** 2026-08-18/28 · **Against:** [STEP-10-voice-annotation.md](STEP-10-voice-annotation.md),
[STEP-10-FROZEN-CONTRACT.md](STEP-10-FROZEN-CONTRACT.md),
[STEP-10-VERIFICATION-PLAN.md](STEP-10-VERIFICATION-PLAN.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md)
§8.7 (voice annotation), §12 S10, R21–R23, §11.2 (erasure)
**Method:** a 2026-08-18 three-subagent readiness review (backend/frontend/infrastructure) written into
`STEP-10-FROZEN-CONTRACT.md` and `STEP-10-VERIFICATION-PLAN.md`, then a build (commit `bd09eb3`,
2026-08-24 — 107 files, 7,397 insertions), then a code-review pass that died mid-way on a session
limit before reaching `app/Services`/`app/Jobs`/`app/Models` (per the 2026-08-28 project-state entry),
completed 2026-08-28 via four parallel read-only finder agents plus a manual verify-then-fix pass,
producing four more commits (`054e16a`, `fc2ee33`, `7efd9a5`, `0ea7f9d`) plus one e2e-expectation fix
(`a377cc7`). This retrospective re-derives current state directly rather than trusting any prior
session's self-report.

---

## What was accomplished

**`api/` — the voice annotation backend**, built against the frozen contract's five resolved
contradictions (interjection-not-ducking, separate voice-mode radiogroup, independent audio/transcript
readiness, a dedicated playback-URL endpoint, S10-owned voice-erasure slice):

- Six migrations (`2026_08_18_110001`–`110006`): `voice_note`/`m4a` appended to `speech_assets`'
  kind/format CHECK (voice assets always `is_primary=false`); `audio_asset_id`/`transcript_status`/
  `transcript_failure_code`/`transcript_attempt_id` on `annotations`; `users.preferences` JSONB;
  `voice_erasure_started_at` on `reviews`; `erasure_started_at` on `users`; `purge_reviewer_id` on
  `speech_assets`. Confirmed applied cleanly against a fresh PostgreSQL 17 instance this session (see
  "Fresh, re-run verification," below) — every one reached `DONE`, none `Pending`.
- `App\Services\Voice\VoiceNoteService` (direct multipart create, deriving the caller's review
  server-side, idempotent `client_uuid` repeat), `EraseReviewerVoiceNotes` (the S10-owned erasure
  domain operation), `FfmpegVoiceNoteProcessor`/`FakeVoiceNoteProcessor` (the
  `VoiceNoteProcessorContract` seam, mirroring `TranscoderContract`), `WhisperVoiceNoteTranscriber`/
  `FakeVoiceNoteTranscriber` (`VoiceNoteTranscriberContract`).
- `App\Jobs\NormalizeVoiceNote` (`redis-long/transcode`, two-pass `loudnorm` with `dual_mono=true` to
  AAC-LC mono 64 kbps, `$timeout=300`/`$tries=1`), `TranscribeVoiceNote` (`redis-long/captions`,
  `$timeout=1700`/`$tries=1`, attempt-token compare-and-set so retry/erasure/newer-state always wins),
  `PurgeVoiceAsset`, `PurgeDeletedVoiceAnnotation`, `EraseSelfAccount` (the minimal queued erase-self
  path the contract requires so the acceptance test exercises real orchestration, not just a helper).
- `App\Http\Controllers\Api\VoiceAnnotationController` (create/audioUrl/retryTranscript/restore),
  `VoicePreferenceController` (`PATCH /api/me/preferences/voice-commentary/{speech}`), extending
  `AnnotationController`/`AnnotationResource` with the `voice: {...}` block, a new `voice.create`
  Gate ability plus transcript update/retry/preference abilities all added to `Gate::before`'s
  `$mustFallThrough` list (the exact trap class STEP-08/09 flagged — confirmed present in
  `AppServiceProvider.php` this session, not just claimed).
- Five new route entries under `api/speeches/{speech}/...` and `api/me/preferences/...`, confirmed live
  by direct `route:list` against a freshly rebuilt container this session (not stale).
- Test files: `VoiceAnnotationHttpTest.php` (24 cases), `VoiceLifecycleTest.php` (13),
  `FfmpegVoiceNoteProcessorTest.php` (3, process-faked), `VoiceSchemaTest.php` (3),
  `E2EVoiceAnnotationSeederTest.php` (2), `RealVoiceAdapterSmokeTest.php` (1, gated behind
  `RUNS_WHISPER_SMOKE=1` — correctly skipped outside that container, see below).

**`web/` — recording, playback, and the interjection controller**:

- `VoiceRecorder.tsx` (the construct-and-catch MIME preference loop: `webm/opus` →
  `mp4/mp4a.40.2` → `ogg/opus` → `webm` → `mp4` → one native no-`mimeType` attempt — six
  construction/start attempts, matching §6 of the frozen contract exactly), `VoiceWaveformPreview.tsx`
  (`wavesurfer.js` fed a local `blob:` URL only), `VoiceAnnotationRow.tsx`, `VoiceNoteMarkers.tsx` (the
  point-glyph marker, no resize handles).
- `useVoiceInterjections.ts` (the `crossedNotes`-driven playback state machine: idle → hinting →
  loading → playing → idle, with the R22 duration+3s safety timeout as a separate mechanism from any
  drift watchdog — none exists, matching the contract's explicit non-goal), `useVoiceCommentaryPreference.ts`,
  `voiceRoles.ts`.
- The `Play commentary | Text only | None` radiogroup as a separate control from the reviewer
  radiogroup, per the contract's frozen decision #2.
- Component/hook test files exist 1:1 alongside each: `VoiceRecorder.test.tsx`,
  `VoiceWaveformPreview.test.tsx`, `VoiceAnnotationRow.test.tsx`, `VoiceNoteMarkers.test.tsx`,
  `useVoiceInterjections.test.tsx`, `useVoiceCommentaryPreference.test.tsx`, `voiceRoles.test.ts`.

**E2E infrastructure**: `web/tests/voice-annotations.spec.ts` (Scenarios A–F, 471 lines) and
`voice-annotations.cross-browser.spec.ts` (the forced-first-MIME-failure fallback test run explicitly
against Firefox/WebKit/mobile-WebKit, not just Chromium), `voice-test-helpers.ts` (the deterministic
recorder/audio shims), `api/database/seeders/E2EVoiceAnnotationSeeder.php` (354 lines — real MP4/M4A
fixture rows, a dedicated erasure-test review/annotation), and CI wiring in `.github/workflows/ci.yml`
(seed step, `verify-postgres-voice-schema.sh`, the voice spec added to both the Chromium required lane
and the Firefox/WebKit/mobile-WebKit fallback lane). Read directly, not taken on faith: the spec's
Scenario F erasure check queries PostgreSQL directly for `reviewer_id`/`audio_asset_id`/asset-row-count/
transcript body and separately re-fetches the erased audio URL over HTTP expecting a real `404` — this
is a genuine end-to-end assertion, not a mocked placebo.

**Five bug-fix commits landed after the initial build**, each re-read directly this session rather than
taken from the commit message alone:

1. `054e16a` (2026-08-25) — an RBAC ownership-check **ordering** leak in `AnnotationController` (a
   voice-specific check ran after a general one that could short-circuit past it) and `voice` field
   nulling in the annotation conflict (409) response, which had been leaking a draft voice row's asset
   state to a caller who should only see the conflict's safe fields.
2. `fc2ee33` (2026-08-25) — stale quota-release races under lock in `QuotaService` (a second commit
   touching `MediaReconcileCommand`/`SpeechAsset`/`FfmpegVoiceNoteProcessor`/erasure), recovery of
   expired voice preview URLs, and deduplication of voice-asset-cleanup/quota-clamp code that had
   drifted into two copies.
3. `7efd9a5` (2026-08-27) — an admin-as-speaker draft leak (essay side, `EssayController`), voice
   endpoint **peer-id leaks** (`VoiceAnnotationController` returning enough identifying detail for one
   reviewer to infer another's presence), caption in-flight data loss (`useCaptionEditor.ts`), and a
   Whisper model-identity fix (`AnnotationPolicy`, `Annotation` model). Also added the
   `caption-test-worker`/`whisper-worker` service definitions to `compose.e2e.yaml`/`compose.yaml`.
4. `0ea7f9d` (2026-08-28) — the broadest of the five: this is the completion of the **Services/Jobs/
   Models/migrations audit that STEP-10's own code-review agent died mid-way through** (per the
   2026-08-28 project-state entry), so most of its 24-file diff is general (transcoder memory
   exhaustion, temp-file leaks in `FfmpegTranscoder`, `WithoutOverlapping`'s job-class-scoped lock key,
   `Vtt::parse` NOTE/STYLE/REGION rejection, `TranscriptDeriver`'s `array_filter` word-count bug) rather
   than voice-specific — but it does touch `FfmpegVoiceNoteProcessor.php` (13 lines) and
   `VoiceLifecycleTest.php` (44 lines), so it belongs in this step's own history even though its
   primary scope is the earlier captions/transcoding step.
5. `a377cc7` (2026-08-28) — a stale e2e expectation in `voice-annotations.spec.ts` for peer
   voice-playback-url denial, fixing the spec itself rather than product code.

**Fresh, re-run verification this session (2026-08-29), not carried over from any prior report:**

- Backend (native `composer install` + `vendor/bin/pest`, sqlite in-memory per `phpunit.xml`):
  **384/386 passed, 2040 assertions, 2 skips** (`RealVoiceAdapterSmokeTest` and the equivalent captions
  smoke test, both correctly gated behind their `RUNS_WHISPER_SMOKE=1`/real-worker guard). `phpstan
  analyse` (level 5, `--memory-limit=1G`) → **0 errors**. `pint --test` → **passed**.
- Frontend (`npm ci` + `vitest run`): **50 test files, 269/269 tests passed**. `tsc -b --noEmit` →
  clean. `eslint .` → **0 errors**, 1 pre-existing unrelated warning in `SpeechCreate.tsx` (the same
  React-Compiler-incompatible-`watch()` warning STEP-08's retrospective already flagged as pre-existing
  — confirmed still the only one).
- Real Docker builds, run from scratch this session: `docker compose build app` succeeded; the
  disposable E2E stack (`scripts/e2e-stack.sh up`) built `whisper-worker` by compiling `whisper.cpp`
  from source inside the `whisper-build` stage and came up clean — Postgres migrations 2 through
  `2026_08_18_110006` (all six voice migrations plus every STEP-09 captions migration) applied with
  real `DONE` status against live PostgreSQL 17, not sqlite. `E2ECaptionsSeeder` and
  `E2EVoiceAnnotationSeeder` both ran via `db:seed --force` with no errors. `nginx -t` inside the E2E
  stack passed.

---

## Difficulties encountered

1. **The code-review agent for this step died mid-pass on a session limit**, per the 2026-08-28
   project-state entry — it had only reached partway through `app/Services`/`app/Jobs` before running
   out. The remaining scope (`app/Models`, `database/migrations`, the rest of `app/Jobs`) was picked up
   by a *separate* four-agent audit two days later, whose fixes landed in `0ea7f9d`. Worth naming
   plainly: this means STEP-10's own dedicated review coverage is thinner than S05/S07/S08/S09's
   (which each completed in one pass), even though the gap was eventually closed by a broader pass that
   happened to touch the same files.
2. **This session's own attempt to run the real-browser Playwright specs (Scenarios A–F) hit an
   environment gap**: `scripts/e2e-stack.sh`'s own `verify-signed-media` check failed with curl exit 6
   (`COULDNT_RESOLVE_HOST`) because `/etc/hosts` had `app.speechcoach.test`/`api.speechcoach.test` from
   prior sessions' work but never `media.speechcoach.test` — needed because STEP-10's audio playback is
   a real signed URL a real `<audio>` element fetches, unlike the JSON-only endpoints prior steps
   exercised. Adding it requires `sudo`, which cannot be supplied non-interactively from this session;
   the user was asked and chose to skip real-browser verification for this pass rather than add the
   entry. This is a new instance of the same infrastructure-gap category `dev-stack-staleness-and-vite-stall`
   already tracks, not a product bug.
3. **A genuinely two-project-spanning fix commit (`0ea7f9d`)** made attributing "what actually
   belongs to STEP-10" harder than in prior steps, where each fix commit's diff stat cleanly matched
   its step's own files. Resolved by reading each file changed and checking whether it's under
   `Voice/`/voice-named, rather than trusting the commit message's ordering of concerns.

## Mistakes made

- No mistake was made *during this retrospective's own verification* that needed correcting — but the
  standing lesson from `0ea7f9d`'s findings is worth carrying forward explicitly for this step:
  **`FfmpegVoiceNoteProcessor` needed a real fix for the same buffered-whole-file-into-memory /
  no-`try`-`finally`-scratch-cleanup pattern that `FfmpegTranscoder` had**, meaning STEP-04's transcoder
  and STEP-10's voice processor drifted independently on a correctness property that should have been
  shared from the start (both wrap `Process::timeout()->run()`, and both throw). Treat this codebase's
  "the same defensive pattern must be re-verified per-caller of a shared idiom, not assumed to
  propagate" as a recurring class, now confirmed a third time (`WhisperTranscriber` in STEP-09,
  `FfmpegTranscoder` and `FfmpegVoiceNoteProcessor` here).
- The RBAC ordering leak (`054e16a`) is this step's own instance of the `Gate::before`/ownership-check
  trap class STEP-08 and STEP-09 both already flagged — worth noting it recurred a third time
  specifically in *ordering* (not a missing check, a misordered one), a subtler variant than the prior
  two "forgot to add it to `$mustFallThrough`" instances.

## Package/tooling surprises

- **No new surprise specific to `wavesurfer.js`** (the only new frontend dependency per the contract's
  §10 dependency rule) — confirmed no `RecordRTC`, `extendable-media-recorder`, or second playback
  library was added, matching the frozen contract's explicit constraint.
- **`whisper.cpp` compiling from source takes real wall-clock time** (multiple minutes for the
  `whisper-build` stage alone) every time the E2E stack is brought up without a warm Docker layer
  cache — not a surprise relative to STEP-09's own findings (`whisper.cpp` was already the chosen
  container strategy there), but worth re-confirming as a real cost this session paid directly, not
  assumed.

## What was not verified — and cannot be, from here

Same structural gap every prior step's retrospective has flagged, now compounded by one new
session-specific blocker:

- **None of Scenarios A–F in `voice-annotations.spec.ts` were actually executed this session.** The
  disposable E2E stack came up cleanly, both seeders ran, migrations applied against real PostgreSQL,
  and `nginx -t` passed — but the browser run itself (`npx playwright test tests/voice-annotations.spec.ts
  --project=chromium`) was never invoked, because it requires `media.speechcoach.test` in `/etc/hosts`
  and the user explicitly chose to skip adding it this pass rather than supply a `sudo` password. This
  is a materially larger gap than STEP-08/09 left open (those steps' gaps were "no GUI browser is
  available from this session" for interactions that had no automated equivalent at all; here, a
  written, real, non-trivial spec exists and simply was not run).
- **No real FFmpeg normalization or real Whisper transcription smoke ran.** `RealVoiceAdapterSmokeTest`
  is correctly gated behind `RUNS_WHISPER_SMOKE=1` and was correctly skipped in the standard run; the
  dedicated `scripts/whisper-smoke-stack.sh voice-queued` command the verification plan names as the
  authoritative check for real loudnorm/AAC-LC output and real transcription was not invoked this
  session.
- **`scripts/verify-postgres-voice-schema.sh` was never reached** — it comes after `verify-signed-media`
  in both the CI ordering and this session's attempt, and the session stopped at the hosts-entry
  blocker before getting to it.
- **No real Firefox, real Safari, or physical iPhone Safari evidence exists** — the verification plan's
  own §5 and §8 final ledger require this explicitly and name Playwright WebKit as insufficient for the
  Safari/iPhone rows specifically; nothing in this project's history claims that evidence has ever been
  collected for STEP-10.
- **STEP-10-voice-annotation.md's and STEP-10-VERIFICATION-PLAN.md's checkbox lists remain entirely
  unchecked** (`- [ ]` throughout, confirmed by direct grep) — consistent with this project's own
  established convention (STEP-08/09's files are the same way; the retrospective, not the step file, is
  where verification gets recorded), not evidence of anything wrong.

---

## Next step

Per [STEPS.md](STEPS.md)'s own dependency diagram, Step 10 has **no outgoing arrow** — nothing in the
plan depends on it (`STEP-10-voice-annotation.md`'s own header says "**Unblocks:** nothing," and its own
prose calls it "the most self-contained step in the plan," addable or droppable without consequence).
**[Step 11 — Privacy and erasure](STEP-11-privacy-erasure.md)** was already the genuinely next-unblocked
step as of STEP-08's retrospective (`S7 --> S11`, and Step 07 has been built and passing since
2026-08-14) — that has not changed, and Step 10's own completion status does not gate it.

Before treating Step 10 as *fully* finished (not blocking Step 11's start, per the same "a step can be
safe to start without every gap closed" principle prior retrospectives have used):
1. Add `media.speechcoach.test` to `/etc/hosts` (`printf '127.0.0.1  media.speechcoach.test\n' | sudo
   tee -a /etc/hosts`) and actually run `npx playwright test tests/voice-annotations.spec.ts
   --project=chromium` plus the cross-browser fallback spec — this is the single largest concrete gap
   this session found, and unlike prior steps' "no GUI browser available" gap, the fix here is one
   command away, not a hardware/human requirement.
2. Run `scripts/whisper-smoke-stack.sh voice-queued` for real normalization/transcription evidence.
3. Run `scripts/verify-postgres-voice-schema.sh`.
4. Collect the real Firefox/Safari/physical-iPhone-Safari evidence STEP-10-VERIFICATION-PLAN.md §5
   requires — this one genuinely does need a human with real devices, the same category every prior
   step has left open.

## Next CP checkpoint

Per [LEARNING-TRACK.md](LEARNING-TRACK.md), **[CP-10 — faking a microphone](CP-10-faking-devices.md)**
(Playwright, ~3h) is next, immediately after Step 10 and explicitly optional —
STEP-10-voice-annotation.md's own footer already names it as "Optional next," and Step 11 does not
depend on it. No `CP-10-BUILD-PLAN.md` or equivalent status doc exists yet (confirmed by direct `ls`),
so nothing about it is started. It is placed here because Step 10 just produced
`voice-test-helpers.ts`'s deterministic `MediaRecorder`/microphone shim, which is exactly the real code
CP-10 would teach against — and running it would also close this retrospective's largest open gap
(gap #1 above), since CP-10's own subject matter is precisely how to drive that spec in CI.
