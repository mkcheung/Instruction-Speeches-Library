# STEP-10 verification plan — Voice annotation

**Verifies:** [STEP-10-voice-annotation.md](STEP-10-voice-annotation.md) · **Contract:**
[STEP-10-FROZEN-CONTRACT.md](STEP-10-FROZEN-CONTRACT.md) · **Prepared:** 2026-08-18

> ## Outcome
>
> Required PR checks prove the schema, authorization, direct upload, worker routing, recorder
> fallback, crossing logic, playback recovery, preferences, publication, and erasure behavior with
> deterministic fixtures. A real-stack browser lane proves the application/API/PostgreSQL/
> SeaweedFS/queue seams without invoking Whisper. Focused real FFmpeg and queued Whisper smokes
> prove the two production worker images. Final sign-off additionally requires recorded runs in
> real Firefox, real Safari, and physical iPhone Safari; Playwright WebKit is not relabeled as
> Safari device proof.

This is a verification plan, not evidence that STEP-10 is already complete. At plan creation no
voice product code or dependency exists, current CI installs/runs Chromium only, and no account
erasure implementation exists.

## 1. Evidence layers

| Layer | Proves | Cannot prove |
|---|---|---|
| Pest/SQLite + process fakes | request validation, policy matrix, state transitions, commands, queue names, CAS, erasure semantics | PostgreSQL CHECK/FK/index behavior, real FFmpeg/Whisper, browser media APIs |
| Vitest + Testing Library | MIME fallback, recording UI, pure crossing/state machine, R22 recovery, R23 modes/warnings, cleanup | real microphone/container support or autoplay policy |
| Disposable E2E stack + Playwright | real API/CSRF/Postgres/SeaweedFS/signed audio, publication/visibility, deterministic browser wiring | ASR quality or actual Safari/iPhone hardware behavior |
| Real worker smokes | final FFmpeg/Whisper images, normalization/probe, queue/storage/DB seams | browser behavior |
| Manual device matrix | actual Firefox/Safari/iPhone recording, permissions, autoplay, controls | exhaustive state/authorization branches |

No single end-to-end test substitutes for the narrower layers. Every claimed behavior below names
the layer that owns it.

## 2. Backend acceptance matrix

### 2.1 Migration and database invariants

Pest migration tests on SQLite and a live-PostgreSQL verifier must assert:

1. `annotations.audio_asset_id` is nullable and deletes to null when its asset row is deleted;
2. all transcript status/attempt/failure columns and allowed values exist;
3. `voice_note/m4a` passes the kind/format CHECK and invalid pairs fail;
4. two `is_primary=false` voice assets for one speech insert successfully;
5. a second `is_primary=true` voice asset cannot be produced through application code, and the
   existing partial primary index remains intact for real primary asset kinds;
6. voice annotation duration accepts 90 seconds and rejects application writes above 90 while the
   database's general 120-second CHECK remains;
7. `users.preferences` is JSON/JSONB, defaults to `{}`, and preserves unrelated keys on merge.

Catalog names and SQL definitions, not a successful migration alone, are the PostgreSQL evidence.

### 2.2 Direct upload and policy

Feature tests call the real multipart route and require:

- Coach with own accepted/in-progress/published non-revoked review: `202` and one annotation/asset;
- repeated `client_uuid`: `200`, same rows, no second object/job;
- Member holding an otherwise valid review: direct API `403`;
- admin/super-admin, owner without reviewer grant, peer reviewer, revoked, invited-only, declined,
  abandoned, stranger, anonymous/unverified: denied with the existing non-leaking conventions;
- no `review_id`, duration, byte count, path, format, or primary client field can affect storage;
- actual byte size is server measured; empty and >16 MiB fields reject synchronously, while
  malformed/non-audio and >90-second probed media reach the specified queued failed state;
  reach bounded validation/failure states;
- `uploads_in_flight` and multipart bookkeeping are unchanged before/after success and failure;
- storage/DB/dispatch failure leaves neither an orphan live row nor unbounded temporary object.

The Member test must use the dedicated voice endpoint. An absent Record button is not authorization
evidence.

### 2.3 Normalization

Process-fake tests require two distinct FFmpeg invocations. Pass one must request loudnorm JSON with
`dual_mono=true`; pass two must consume the measured values and specify mono AAC-LC at 64 kbps.
Tests cover malformed measurement JSON, probe failure, pass-one/pass-two timeout, failed upload,
duration >90, stale/deleted annotation, exact temp cleanup, stable failure codes, and no stderr/path
leak.

A focused real-worker smoke feeds a committed short, redistributable microphone-like fixture to the
final `ffmpeg-worker` image and uses real FFprobe to assert:

- M4A container, AAC codec, one channel;
- duration within fixture tolerance and <=90 seconds;
- bitrate close to 64 kbps (container overhead tolerant);
- two-pass loudnorm command includes `dual_mono=true` and produces finite measured output;
- only the final object remains.

Command-string assertions alone do not prove a decodable output.

### 2.4 Transcription and concurrency

Queue tests assert normalization uses `redis-long/transcode`; only successful normalization
dispatches transcription on `redis-long/captions`; no new connection/container is introduced.
They also assert the frozen job/worker/retry ordering (`300 < 3700 < 3900` for normalization's
effective boundary and `1700 < 1800 < 3900` for transcription), plus guarded `failed()` backstops.

Fake-transcriber integration tests prove pending -> processing -> ready fills `Annotation.body`,
clears failure, increments lock version, and leaves audio ready. Failure leaves audio playable and
is retryable. Attempt A cannot overwrite retry B, an erasure, a deleted row, or a changed audio FK.
Manual transcript editing is refused before ready and persists after ready.

A queued real-Whisper smoke uses the existing checksum-pinned model/final `whisper-worker`, real
PostgreSQL and SeaweedFS:

1. seed a normalized ready voice asset and pending annotation;
2. dispatch `TranscribeVoiceNote` through Laravel;
3. run the final worker with `queue:work redis-long --queue=captions --once`;
4. require the job leaves the queue, body is non-empty, status ready, model process succeeds, audio
   object remains unchanged, and no speech-level caption/VTT/transcript row is created.

Use a keyword subset, never exact punctuation/timestamps.

### 2.5 Resource, visibility, URL, and publish

Feature tests require:

- text row -> `voice:null`; live voice row -> public safe state only; erased row -> ordinary text;
- speaker endpoint excludes draft voice rows and includes published pending/ready rows;
- author sees own permitted draft; peer cannot enumerate; admin behavior follows moderation policy;
- playback URL rejects wrong speech/annotation/asset, draft-to-speaker, processing, failed, erased,
  and non-voice assets; ready visible voice returns a ten-minute signed URL;
- signed URL supports `Origin` plus Range in the disposable SeaweedFS stack;
- no path, failure detail, stderr, secret, or exception reaches JSON;
- set-level publish includes a pending voice row and returns it to the speaker as playable when audio
  is ready plus `Transcribing…` state;
- deleting/clearing/purging follows the soft-delete Undo and eventual object-cleanup contract.

### 2.6 Preference and erasure

Preference tests prove default play/unexperienced, first-completion automatic text/experienced,
explicit mode persistence, per-speech isolation, unrelated-key preservation, and authorization.

The erasure integration must execute the queued erase-self path, not call only a helper. Against
`Storage::fake` and the real DB it requires:

- every coach-authored voice object and asset is gone;
- `audio_asset_id` is null;
- annotation body, timing, publication, and review survive;
- reviewer identity is null and no snapshotted name remains;
- another coach's audio is untouched;
- missing objects are idempotent; storage deletion failure retries and does not anonymize early;
- API/UI afterward exposes ordinary Former reviewer text with no broken player/failure state.

## 3. Frontend unit/component matrix

### 3.1 Recorder selection and lifecycle

Test the pure recorder factory with controlled globals:

1. preferred type supported, constructor and start succeed;
2. preferred type reports supported but constructor throws; second succeeds;
3. constructor succeeds but `start()` throws; candidate is disposed and second succeeds;
4. unsupported entries are skipped;
5. missing `getUserMedia` or `MediaRecorder` hides Record before any gesture and shows unsupported
   copy;
6. with both APIs present, the permitted stream gesture runs the guarded construct-and-start loop;
   every candidate failing releases the stream, produces a first-class unavailable result, and
   removes Record;
7. `NotAllowedError` -> explanatory permission-denied state;
8. `NotFoundError` -> no-microphone state;
9. all tracks stop, chunks/listeners reset, blob URLs revoke, and WaveSurfer destroys on rerecord,
   save, cancel, and unmount;
10. timestamp is the value at start, not stop; 90-second timer stops once and is cleaned up.

The forced first-preference failure is mandatory and must pass under each targeted browser build; a
test that merely changes `isTypeSupported()` to false does not exercise the reported-true/throws
failure. No test may claim a candidate is usable before the permission-bearing stream gesture;
pre-gesture evidence is only the presence or absence of the two required APIs.

### 3.2 `crossedNotes`

Exhaustively cover forward crossing, exact lower/upper boundaries, paused/equal time, backward
movement, jump exactly at and above epsilon, backward re-arm, note at `0.000` on first tick, two
notes in one 250ms tick, equal timestamps with stable id tie-break, and empty/invalid input. Require
an ordered array; a single returned note is a failing implementation.

### 3.3 Playback controller

With fake video/audio and fake timers, assert:

- natural crossing pauses once, queues every crossed note, and final ended resumes;
- `audio.play()` rejection resumes (R22);
- audio error and URL failure resume;
- duration+3 seconds without ended resumes; earlier timer does not fire;
- the safety timer is not a drift/synchronization loop;
- Skip and Escape stop audio, clear the crossing queue, and resume immediately;
- manual pause intent suppresses resume on ended/reject/error/timeout;
- backward seek rearms; forward seek does not fire skipped notes;
- reviewer/mode/route changes cancel URLs, audio, queue, and timers;
- text and none modes never call the playback URL or `audio.play()`;
- first completed/skipped interruption persists automatic text preference once.

### 3.4 Presentation and R23

Testing Library assertions cover:

- Coach + paused video sees Record beside composer; playing video hides it; Member never sees it;
- waveform/Re-record/Save, recording time, permission guidance, processing/failure/retry, and
  editable ready transcript;
- voice timeline marker is a speaker-labelled point with no duration handles;
- about-three-second hint is a status, not an assertive live-region interruption;
- playing transcript is visible and Skip is accessible;
- pending transcript says `Transcribing…`;
- voice radiogroup is separate from reviewer radiogroup and has three options;
- play/text/none semantics suppress only what the contract specifies;
- seven notes trigger count + total-duration warning; six do not; no hard cap;
- erased voice renders as ordinary Former reviewer text.

## 4. Real-stack Playwright

Add `web/tests/voice-annotations.spec.ts`, a dedicated immutable voice seeder, and committed short
audio fixtures. Follow existing CSRF/Origin/response-wait conventions; no fixed sleeps.

### Scenario A — role and direct API boundary

As Coach, paused ready speech shows Record. As Member with an accepted review, text composer remains
but Record is absent. Use the Member browser session to make the real multipart POST and require
403. Pest still owns the exhaustive matrix.

### Scenario B — deterministic recording fallback and upload

Install a deterministic test-only MediaRecorder/microphone shim before application code. Make the
first preference claim support and throw on start; require the second preference records the
committed bytes. Stop shows a real blob-fed waveform, Re-record replaces it without network, Save
makes one POST, and API polling reaches ready/pending-transcript. Inspect that two created voice
notes are non-primary and coexist in PostgreSQL.

This proves application fallback wiring, not actual Firefox/Safari microphone support.

### Scenario C — publish and speaker interjection

Publish a ready-audio/pending-transcript note at a short fixture timestamp. As speaker, select its
review and Play commentary. Require the approaching marker/hint, natural crossing, video paused,
audio playing, transcript/`Transcribing…` visible, ended, then video advancing again. Server and UI
must both show the row published.

### Scenario D — Skip, manual pause, R22

Use separate deterministic fixtures for:

- Skip during audio: audio stops and video advances immediately;
- Escape: same result;
- manual pause intent: note ends and video remains paused;
- forced `audio.play()` rejection: video resumes;
- no ended event: bounded duration+3 timer resumes.

Trace each subcase; do not infer resume from a button label—poll `currentTime` advancing or stable.

### Scenario E — modes, warning, and preference

With seven voice notes, Coach sees exact count and summed-duration warning. Speaker proves Play
interrupts, Text only shows transcript without pausing, None suppresses voice rows without hiding a
normal text annotation, and existing No commentary suppresses the whole track. Reload and a second
session prove per-speech preference persistence/default transition.

### Scenario F — erasure

Run the real queued erase-self path for the coach fixture. Poll completion; require storage URL no
longer resolves and DB asset is gone. As speaker, the same published annotation transcript remains
under Former reviewer with no audio control, broken-player message, or failure alert.

## 5. Browser and device matrix

CI must install Chromium, Firefox, and WebKit and explicitly run the immutable, deterministic
voice spec portions in all three. Mutable stack scenarios remain serial/Chromium; cross-browser
fallback/presentation cases use isolated fixture ids or read-only setup.

Before STEP-10 sign-off, record date/browser/OS/device and result for:

| Target | Required manual evidence |
|---|---|
| Current desktop Firefox | real microphone record/stop/waveform/rerecord/upload/playback |
| Current desktop Safari | same, including preference fallback actually selected |
| Physical iPhone Safari | full 12-second note at 2:30 demo: permission, record, waveform, publish, approaching marker, automatic pause/audio/resume, Skip, manual pause stays paused, transcript, sound-off usability |

Playwright WebKit, an emulated iPhone viewport, or a mocked MediaRecorder is useful regression
coverage but cannot satisfy the physical iPhone row. A screenshot alone does not prove audio,
timing, permission, or resume; retain a short screen recording plus a checklist/log.

## 6. CI and artifacts

Required PR wiring:

1. add `wavesurfer.js` lockfile integrity/build checks;
2. run focused + full Pest, Pint, Larastan, TypeScript, ESLint, and Vitest;
3. verify PostgreSQL voice schema/catalog and two-non-primary insertion;
4. extend signed-media verifier to a voice object with Origin and Range;
5. add `voice-annotations.spec.ts` to the explicit CI filename allowlist;
6. install/run targeted Firefox and WebKit projects rather than relying on configured-but-unused
   projects;
7. upload report, trace, screenshots, video, app log, ffmpeg/caption worker logs, failed jobs, and
   bounded media diagnostics on failure;
8. add path-triggered/scheduled real normalization and queued-Whisper smokes, independent of browser
   retries and using disposable stack state.

Do not put real model inference in the required Playwright lane.

## 7. Validation commands

Exact filenames may grow during implementation, but completion must expose one command per layer:

```bash
cd api
./vendor/bin/pest tests/Feature/Annotation/VoiceAnnotationHttpTest.php tests/Feature/Annotation/VoiceLifecycleTest.php tests/Feature/Annotation/VoiceSchemaTest.php tests/Feature/Annotation/FfmpegVoiceNoteProcessorTest.php
./vendor/bin/pint --test
php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G
./vendor/bin/pest

cd ../web
npm run test -- --run
npm run lint
npm run build
npx playwright test tests/voice-annotations.spec.ts --project=chromium
npx playwright test tests/voice-annotations.cross-browser.spec.ts --project=firefox --project=webkit --project=mobile-webkit

cd ..
docker compose config --quiet
docker compose -f compose.yaml -f compose.e2e.yaml config --quiet
./scripts/e2e-stack.sh verify-signed-media
./scripts/verify-postgres-voice-schema.sh
./scripts/whisper-smoke-stack.sh voice-queued
```

`scripts/whisper-smoke-stack.sh voice-queued` is the implemented disposable-stack command for the
real queued FFmpeg-normalization and Whisper path. `scripts/verify-postgres-voice-schema.sh` is the
implemented live-catalog check. Its current scope verifies CHECK/FK/index definitions; §2.1's
invalid-pair runtime inserts and PostgreSQL down/up parity remain incomplete until they are added
to this or an equivalent checked-in verifier.

The scripts must fail non-zero on missing prerequisites or absent evidence. Grep-only inspection of
source commands, a seeded `ready` row, a mocked URL, Playwright discovery, or a green build is not
completion evidence.

## 8. Final completion ledger

STEP-10 is complete only when every row has authoritative evidence:

- [ ] Coach 12-second direct recording/upload/publish/replay works at 2:30.
- [ ] Member direct multipart request is 403.
- [ ] Two non-primary voice assets coexist on real PostgreSQL.
- [ ] Real normalization output is AAC-LC mono M4A near 64 kbps with two-pass dual-mono loudnorm.
- [ ] Voice transcription consumes the captions queue and preserves audio on transcript failure.
- [ ] Forced first MIME preference failure reaches a working fallback.
- [ ] `crossedNotes` zero and multi-note boundaries are exhaustively tested.
- [ ] Play rejection and duration+3 safety timeout resume; manual pause suppresses resume.
- [ ] Marker/hint, Skip/Escape, transcript, permission denial, waveform, and rerecord are verified.
- [ ] R23 warning and independent persisted Play/Text/None mode work.
- [ ] Draft/publication and signed-audio authorization do not leak.
- [ ] Queued coach erasure deletes audio and preserves transcript/Former reviewer rendering.
- [ ] Full automated quality gates pass.
- [ ] Real Firefox, real Safari, and physical iPhone Safari evidence is recorded.

Any unchecked row leaves STEP-10 incomplete; later intent, mocks outside the owning layer, or lack
of observed failure is not proof.
