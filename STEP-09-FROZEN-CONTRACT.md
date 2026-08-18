# STEP-09 frozen contract — Captions

Written after a 2026-08-17 four-subagent readiness review (backend/frontend/infra/cross-cutting)
of [STEP-09-captions.md](STEP-09-captions.md), spot-checked directly against the repo. Mirrors the
STEP-07/STEP-08 method: resolve every point STEP-09.md's own prose leaves undecided into one
concrete decision here, so two parallel build agents can work from the same shape rather than
guessing independently (the guess-divergence class of bug that hit S05/S07/S08 exactly once each).

## 1. Policy — new `SpeechPolicy` methods, not `AnnotationPolicy::readAnnotations`

`AnnotationPolicy::readAnnotations` is Review-scoped and wrong here: captions/transcripts belong
to the `Speech` and can exist with zero reviews. Add to `api/app/Policies/SpeechPolicy.php`:

```php
public function readCaptions(User $user, Speech $speech): bool
{
    return $this->view($user, $speech); // same visibility as the speech itself
}

public function updateCaptions(User $user, Speech $speech): bool
{
    return $speech->user_id === $user->id; // owner ("the speaker") only — same shape as invite()
}
```

`readCaptions` reuses `view()` (owner OR active non-revoked reviewer per `Review::ACCESS_GRANTING`)
because a reviewer coaching a speech needs to read captions/transcript same as they can watch the
video. `updateCaptions` is ownership-only, matching STEP-09.md's "speaker-editable" language and
MODERNIZATION_PLAN.md:1760's "The speaker can edit the VTT" verbatim — no reviewer or admin path.

## 2. `Gate::before` — add to `$mustFallThrough`

`api/app/Providers/AppServiceProvider.php`'s `$mustFallThrough` list (confirmed current, no
`caption.*` entry exists yet) must gain:

```php
'caption.update',   // ownership-only, same bug class as essay.update/publish (STEP-08)
```

`caption.readCaptions`... (read ability) does **not** need to be listed if it stays a "reviewer OR
owner" grant — same reasoning as `essay` reads, which are not in the fallthrough list either
because widening admin read access isn't the same failure mode as widening admin write access.
Only the write ability needs the guard.

## 3. §20 Q12's off-switch — new column, not a separate settings table

Add `captions_enabled BOOLEAN NOT NULL DEFAULT true` to `speeches` (a small additive migration, not
a new `speech_settings` table — this project has no settings/preferences table anywhere yet and one
boolean doesn't justify starting one). `SpeechUploadController` (or wherever captions job dispatch
lives) checks this before enqueuing the whisper job; toggling it later does not retroactively delete
an already-generated transcript, only gates future runs. Exposed on `SpeechResource` as
`captions_enabled`, writable only by the owner (reuse `updateCaptions` or a lighter
`speech.update` ability if one already covers other speech-metadata edits — confirm against
`SpeechController::update` if it exists before adding a new ability name).

## 4. Response envelope and routes — mirrors the essay/annotation convention exactly

```
GET  /api/speeches/{speech}/captions          -> { captions: { vtt: string, status, ... } }
PUT  /api/speeches/{speech}/captions           -> { captions: {...} }   (server-side VTT validation; 422 on invalid VTT)
GET  /api/speeches/{speech}/transcript         -> { transcript: { body, segments, word_count, words_per_minute, language, model, source } }
GET  /api/speeches/search?q=...                -> { results: SpeechResource[] }   (tsvector match, GIN index)
```

Every success body is enveloped (`{ captions: ... }` / `{ transcript: ... }` / `{ results: ... }`),
matching `EssayController`/`AnnotationController`'s existing convention. `captionApi.ts` and
`transcriptApi.ts` (two slices, following the existing one-slice-per-domain convention — captions
are an editable resource, transcript is a read/search-only projection, same split logic that kept
`reviewApi`/`annotationApi`/`essayApi` separate) must each add explicit `transformResponse` to
unwrap these envelopes — do not consume the bare shape, and do not let a mocked-response unit test
stand in for confirming this against the real controller (the exact gap that caused STEP-08's
`essay_lock_version: undefined` bug).

No optimistic-locking / `lock_version` / 409 conflict handling on captions — STEP-09.md never asks
for it, and single-speaker VTT editing (unlike multi-party annotations/essays) has no concurrent-
writer scenario to guard against. Do not add one uninvited.

## 5. Frontend route placement — a tab, not a new top-level route

Transcript view is a third tab in `SpeechWatch`'s existing `Tabs`/`TabsList` (built in STEP-08,
currently `Notes | Essay`) — becomes `Notes | Essay | Transcript`. The caption editor is reached
from the transcript tab (same screen, edit-in-place per line, "same shape as the transcript list"
per STEP-09.md's own wording — literally reuse `Transcript.tsx`'s list/click-to-seek structure,
adding inline-editable text per row). Search is a new top-level route, `/search`, added to
`App.tsx`'s existing `AppLayout`-wrapped authenticated route group (no existing route to nest it
under — it queries across all of a user's own speeches, not one speech).

## 6. Whisper container — prefer `whisper.cpp`, new Dockerfile stage family

`faster-whisper` (Python + CTranslate2, likely no prebuilt musl/Alpine wheels) does not fit this
project's existing all-stages-share-one-PHP-base Dockerfile the way `ffmpeg-worker`'s `apk add
ffmpeg` did. **Use `whisper.cpp`** instead — a self-contained C++ binary with no Python/glibc-wheel
problem, buildable from source with a standard Alpine `build-base`/`cmake` toolchain in its own
stage, closer in shape to the ffmpeg precedent. New Dockerfile stage `whisper-worker`, `FROM
runtime`, adds a build stage that compiles `whisper.cpp`'s CLI (`whisper-cli`/`main`) and copies
only the resulting binary into the final layer (multi-stage, so the build toolchain doesn't bloat
the runtime image). Model weights are **not** baked into any image — a named volume
(`whisper-models:/models`, matching the `postgres-data`/`seaweedfs-data` named-volume convention,
mounted read-only into `whisper-worker`) populated by a one-time download step (a small shell
script or an init container, downloading a specific GGUF file pinned by its published digest).
License terms (whisper model weights' own license, separate from whisper.cpp's MIT code license,
per STEP-09.md's own §4 warning) go in an inline comment block on the `whisper-worker` service in
`compose.yaml`, mirroring the existing GPL-boundary comment convention on `ffmpeg-worker` (no
repo-root LICENSE/NOTICE file precedent exists — don't start one for this alone).

Queue: reuse the existing `redis-long` connection (`config/queue.php`), new `--queue=captions` flag
on a new `whisper-worker` compose service — no new Redis connection/env var needed, exactly
mirroring how `ffmpeg-worker` only differs from `queue-worker` by connection+queue-name+timeout on
the CLI, not by a new connection definition. `cpus`/`mem_limit` on `whisper-worker` should be set
independently from `ffmpeg-worker`'s (`1.5`/`2g`) once real hardware numbers are known — inherit the
same *pattern*, not the same *values*.

`CaptionTranscriberContract` (mirrors `TranscoderContract`) with `FakeCaptionTranscriber` (testing)
and `WhisperTranscriber` (real, shells out via `Process::timeout()->run([...])` exactly like
`FfmpegTranscoder`) bound conditionally in `AppServiceProvider::register()`.

## 7. tsvector/GIN testing strategy — Postgres-only feature test, sqlite gets a plain column

CI/`phpunit.xml` is pinned to sqlite, which has no `tsvector`/GIN. Mirror the existing
driver-branched raw-SQL migration convention (`speech_assets`'s CHECK-constraint migration is the
precedent): the Postgres branch creates a generated `tsvector` column + GIN index; the sqlite branch
creates a plain `TEXT` column with no index and search falls back to a `LIKE` (adequate for a test
fixture with a handful of rows, not a testing-strategy gap in practice — CI never needs to prove GIN
index *performance*, only that a matching row is returned). Do **not** skip full-text-search tests
on sqlite; assert against the `LIKE` fallback there and add one Postgres-specific integration test
(if this project has a Postgres CI lane — confirm; if not, this is manually verified against the dev
stack, same as other Postgres-only behaviors already are).

## 8. Enums and asset lifecycle

`speech_transcripts.source` is a Postgres `CHECK (source IN ('whisper', 'edited'))`, mirroring the
`speech_assets.kind`/`format` CHECK-constraint convention exactly (not a free-text column). The
`captions` `speech_assets` row uses the *existing* `status` enum (`uploading|processing|ready|
failed`) unmodified — a captions job failing sets that row's `status='failed'` independently of the
video asset's own status, per STEP-04's already-established per-asset independence (this needs no
new column, just dispatching `GenerateCaptions` the same way `GeneratePoster` is dispatched
alongside `TranscodeSpeechAsset` today).

## 9. Docker Desktop memory

No action needed — already documented at `MODERNIZATION_PLAN.md:2796` ("~12 GB once whisper arrives
at S9"), STEP-09.md's own line is consistent with it, and there is no second doc to update.

---

**Verification note**: every code claim referenced above (`speech_assets` CHECK constraints,
`captionsAnchor.ts`'s dormant hook, the current `$mustFallThrough` list, `SpeechPolicy`'s existing
shape, the route-naming convention, `essayApi.ts`'s envelope pattern) was read directly from the
repo on 2026-08-17, not taken on a subagent's word alone.
