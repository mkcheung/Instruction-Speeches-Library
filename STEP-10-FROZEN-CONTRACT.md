# STEP-10 frozen contract — Voice annotation

Written after a 2026-08-18 multi-agent backend/frontend/infrastructure review of
[STEP-10-voice-annotation.md](STEP-10-voice-annotation.md),
[MODERNIZATION_PLAN.md §8.7](MODERNIZATION_PLAN.md), R21–R23, and §11.2. This document
resolves every implementation choice that would otherwise make the API, workers, and browser
state machine diverge. Product code must follow this contract; changing it requires updating this
document and its verification plan first.

## 1. Scope and resolved contradictions

Voice annotation is an **interjection**. The speech video pauses, one voice note plays, and the
video resumes. It is never mixed with or ducked under the speech.

Five decisions are frozen:

1. STEP-10 excludes a continuous audio/video **drift-synchronization watchdog**. R22 still requires
   a bounded **failure-safety timer**: after `audio.play()` resolves, a note that has not emitted
   `ended` within its stored duration plus three seconds is abandoned and the video is safely
   resumed. These are different mechanisms.
2. `Play commentary | Text only | None` is a separate, adjacent `radiogroup` named **Voice
   commentary**. It is not folded into the existing reviewer-track radiogroup. The first chooses a
   reviewer; the second chooses how that reviewer's voice rows behave.
3. Audio readiness and transcript readiness are independent states. A published, playable note may
   still say `Transcribing…`; neither `speech_assets.status` nor an empty `body` is overloaded to
   represent both states.
4. Voice audio has its own row-authorized URL endpoint. The existing video playback endpoint must
   remain video-only; merely allowing `kind=voice_note` there would bypass publication and review
   isolation.
5. Although general account erasure is S11, S10 owns the complete **voice-erasure slice**: a domain
   operation invoked by the future account-erasure job deletes every voice object/asset authored by
   the erased reviewer while preserving transcript annotations. S10 cannot be signed off until that
   operation is exercised through a minimal queued account-erasure path.

Explicit non-goals: ducking, `MediaElementAudioSourceNode`, `AudioContext`, decode cache,
scrub-into-a-note playback, playback-rate pitch correction, audio/video drift correction, and
presigned multipart upload.

## 2. Schema

### 2.1 `speech_assets`

Additive migration, with matching PostgreSQL and SQLite CHECK definitions:

- append `voice_note` to `kind`;
- append `m4a` to `format`;
- permit exactly `kind=voice_note AND format=m4a` in the kind/format CHECK;
- retain the existing status values (`uploading|processing|ready|failed`);
- every voice-note asset is created with `is_primary=false`; no request field may set it.

Add the internal lifecycle ledger columns:

```text
temporary_path               nullable string; committed upload-object key
temporary_byte_size          nullable bigint; bytes still reserved for that upload
purge_claim_id               nullable UUID; prevents restore/new work after purge wins
purge_reviewer_id            nullable bigint; quota owner retained across review hard-delete
normalization_candidate_path nullable string; final candidate key persisted before upload
```

These fields never appear in API resources. A stored source or normalized candidate must always
have a durable row naming its exact key before the object write begins, so a killed worker can be
reconciled without bucket-wide guessing. Successful normalization clears the candidate ledger;
successful temporary cleanup clears both temporary fields. Hard purge, delayed annotation purge,
reviewer erasure, and reconciliation delete all non-null object keys before deleting the asset.

The existing partial unique index remains unchanged. Two non-primary voice assets on one speech
must coexist.

### 2.2 `annotations`

Add:

```text
audio_asset_id          nullable FK speech_assets(id) ON DELETE SET NULL
transcript_status       not null: not_applicable|pending|processing|ready|failed
transcript_failure_code nullable varchar(64)
transcript_attempt_id   nullable UUID/varchar(36)
```

Text annotations use `transcript_status=not_applicable`. A live voice annotation has a non-null
`audio_asset_id` and `transcript_status` in `pending|processing|ready|failed`. After reviewer
erasure, `audio_asset_id` is null, `body` and `transcript_status=ready` remain, and the row behaves
as ordinary text from a former reviewer.

For voice rows:

- `start_seconds` is the playhead sampled when recording starts;
- `duration_seconds` is measured from the normalized output, capped at 90 seconds, and cannot be
  changed through the annotation PATCH endpoint;
- `body` is the transcript. It begins as an empty string, renders as `Transcribing…` while pending
  or processing, and becomes editable only at `transcript_status=ready`.

The existing database timing CHECK (`duration_seconds <= 120`) remains. Application validation
enforces the stricter voice-note maximum of 90 seconds.

### 2.3 `users.preferences`

Add a JSON/JSONB `preferences` column defaulting to `{}`. Voice state is stored under:

```json
{
  "voice_commentary": {
    "<speech-id>": { "mode": "play|text|none", "experienced": true }
  }
}
```

An absent entry means `mode=play` and `experienced=false`. After the first voice interruption on a
speech completes or is skipped, the client persists `{mode:"text", experienced:true}` unless the
user has already made an explicit selection. User-selected modes persist per speech. Preference
writes merge this namespace and never replace unrelated preferences.

### 2.4 Erasure claims

Add nullable `users.erasure_started_at` and `reviews.voice_erasure_started_at` timestamps. The
queued erase path locks and sets these claims before enumerating audio. New voice creation and new
review invitations must reject once the applicable claim is present. Claims are durable across
worker retry; reviewer identity is nulled only after every claimed voice object has been removed
and its transcript row preserved.

## 3. HTTP contract

All routes are inside the existing authenticated, verified-user API group and use the current CSRF
convention.

### 3.1 Create — direct multipart POST

```http
POST /api/speeches/{speech}/voice-notes
Content-Type: multipart/form-data

audio=<binary>
client_uuid=<uuid>
start_seconds=<decimal>
kind=praise|correction|observation      # optional, default observation
topic=<string|null>                    # optional
```

The server derives the caller's review from `(speech, authenticated user)`. It accepts no
`review_id`, `audio_asset_id`, duration, byte count, path, format, or `is_primary` field.

Success:

- `202 {"annotation": AnnotationResource}` for a new upload queued for normalization;
- `200 {"annotation": AnnotationResource}` for an idempotent repeat `client_uuid`, without storing
  or queuing the repeated bytes.

The API receives the bytes itself, measures their real size, writes a randomized temporary object,
creates one processing non-primary final asset plus annotation transactionally, and dispatches
normalization after commit. It does not create or mutate multipart-upload bookkeeping and does not
change `uploads_in_flight`.

Validation returns `422`; unavailable/invalid audio, an input that normalizes beyond 90 seconds,
or worker failure becomes a safe failed state. Request/body limits must accommodate the 90-second
ceiling but remain bounded. Client MIME and duration are hints only; FFprobe/FFmpeg are authority.

The frozen request limit is **16 MiB** for `audio`, with nginx and PHP configured to accept at least
that field plus multipart overhead (20 MiB request ceiling). A field rejected synchronously for
size/shape returns 422. Corrupt media and real duration are known only after queued probing, so
those transition the returned resource to `failed`; they are not misrepresented as synchronous
validation.

### 3.2 Read annotations

The existing annotation response remains enveloped and sorted. `AnnotationResource` is extended:

```json
{
  "id": "123",
  "start_seconds": 150.0,
  "duration_seconds": 12.0,
  "kind": "observation",
  "topic": null,
  "body": "Your pause here was excellent.",
  "lock_version": 1,
  "client_uuid": "...",
  "voice": {
    "asset_id": 456,
    "audio_status": "processing|ready|failed",
    "transcript_status": "pending|processing|ready|failed",
    "failure_code": null
  }
}
```

`voice` is `null` for text annotations and for an erased former voice note. No storage path,
internal failure detail, signed URL, stderr, or exception text appears here. A speaker sees only
published rows through the existing `Annotation::visibleTo` scope. A published pending transcript
is returned with an empty `body` and `transcript_status=pending|processing`; the UI renders
`Transcribing…` without withholding ready audio.

### 3.3 Voice playback URL

```http
GET /api/speeches/{speech}/annotations/{annotation}/voice-playback-url
200 {"audio":{"url":"https://...","expires_at":"..."}}
```

The controller confirms all of the following before signing:

- annotation belongs to a review on the route speech;
- caller passes `readAnnotations` for that review;
- the row is visible to that caller (authors/admins may read their permitted drafts; speakers only
  published rows);
- its referenced asset belongs to the same speech, is `kind=voice_note`, and is `status=ready`.

Wrong speech/annotation/asset, erased audio, and invisible draft all return non-enumerating `404`.
Unauthorized review access returns the same policy behavior as annotation reads. A processing note
returns `409 {"message":"Voice note is still processing."}`; a failed note returns a safe mapped
`409`. URLs use `MediaUrlSigner` with the existing ten-minute TTL and Range-compatible signature.

### 3.4 Transcript edit and retry

The existing annotation PATCH edits a ready voice transcript through `{body, lock_version}`. For a
voice row it rejects `duration_seconds`; timing retime may remain supported only if product UI
offers it, but recorded duration is immutable. Transcript editing before `ready` returns `409`.

```http
POST /api/speeches/{speech}/annotations/{annotation}/voice-transcript/retry
202 {"annotation": AnnotationResource}
```

Only the coach author holding the active review may retry a failed transcript. Retry mints a new
`transcript_attempt_id`, sets pending, and dispatches after commit. A late job updates the row only
when both attempt id and audio asset id still match, so retries, erasure, and newer state win.

### 3.5 Preference

```http
PATCH /api/me/preferences/voice-commentary/{speech}
{"mode":"play|text|none","experienced":true}

200 {"voice_commentary":{"speech_id":123,"mode":"text","experienced":true}}
```

The user must be able to view the speech. This endpoint mutates only that speech's voice preference.

### 3.6 Delete and Undo restore

Voice deletion uses the existing annotation delete route and a voice-specific authorization check:

```http
DELETE /api/speeches/{speech}/annotations/{annotation}
204
```

It soft-deletes the annotation and schedules object/asset cleanup only after the Undo window. A
voice-note Undo restores that same tombstoned row and asset through the server endpoint:

```http
POST /api/speeches/{speech}/annotations/{annotation}/restore
200 {"annotation": AnnotationResource}
```

Restore is permitted only to the verified active Coach author before purge has claimed the asset.
Wrong speech, another reviewer's row, or an already purged/claimed asset uses the existing
non-enumerating failure conventions. This route is distinct from text annotation Undo, which may
still re-POST its original payload and `client_uuid`.

## 4. Authorization

Add a dedicated `voice.create` ability. It returns true only when:

- the user has the `coach` role;
- they are the reviewer on this speech's active, non-revoked,
  `Review::ACCESS_GRANTING` review;
- they are not an admin/super-admin acting through an override.

Add `voice.create`, voice transcript update/retry abilities, and preference ownership where needed
to the scoped `Gate::before` fall-through list. `annotation.create` is not sufficient because
Members are intentionally allowed to write text annotations. Hiding Record is presentation only;
a direct Member POST must return 403.

## 5. Storage and worker state machine

No container is introduced.

Public failure codes are closed sets:

```text
audio:      voice_invalid_audio | voice_duration_exceeded |
            voice_normalization_failed | voice_storage_failed
transcript: voice_transcription_failed | voice_transcription_timed_out |
            voice_transcription_storage_failed
```

Anything more detailed remains log/audit data. Unknown internal failures map to the corresponding
generic normalization/transcription code rather than crossing the API.

### 5.1 Normalization

`NormalizeVoiceNote` runs on `redis-long/transcode` in the existing `ffmpeg-worker`. It:

1. downloads/streams the randomized temporary input to an exact scratch path;
2. probes it and rejects missing audio/corrupt input;
3. runs loudnorm pass one and parses its measurement JSON;
4. runs pass two with measured values, `dual_mono=true`, AAC-LC, one channel, 64 kbps, `.m4a`;
5. probes normalized duration, rejects `>90.000`, and uploads the final object;
6. atomically marks the voice asset ready with real bytes/duration, updates the annotation duration,
   deletes the temporary object, and dispatches `TranscribeVoiceNote` after commit.

Every exit cleans exact scratch paths. Failure deletes partial final/temp objects, sets a stable
user-safe failure code, and never exposes process output. The job has timeout/retry ordering below
the existing `redis-long` retry-after boundary.

Frozen transitions and execution limits:

```text
POST committed       asset=processing, transcript=pending
normalize claimed    asset=processing, transcript=pending
normalize success    asset=ready,      transcript=pending; dispatch transcription
normalize failure    asset=failed,     transcript=failed
```

`NormalizeVoiceNote`: `$timeout=300`, `$tries=1`, `redis-long/transcode`. Its `failed()` backstop
must guardedly reach the same failure state without overwriting erasure or newer state.

### 5.2 Transcription

`TranscribeVoiceNote` runs on `redis-long/captions` in the existing `whisper-worker`. It reuses a
low-level Whisper runner, not the speech-caption `GenerateCaptions` projection (which owns VTT and
`speech_transcripts`). It sets `transcript_status=processing` by compare-and-set on its attempt,
transcribes the normalized M4A, and writes plain transcript text to `Annotation.body`,
`transcript_status=ready`, clears failure code, and increments `lock_version` only if attempt and
asset still match. Failure produces `transcript_status=failed` and a stable code while leaving
audio playable.

The coach may edit only after ready, so ASR and a manual edit cannot race. Publishing is never
blocked on normalization or transcription; the existing set-level publish includes the row.

```text
transcription claimed  asset=ready, transcript=processing
transcription success  asset=ready, transcript=ready, body=<plain text>
transcription failure  asset=ready, transcript=failed, body unchanged
retry requested        asset=ready, transcript=pending, new attempt id
```

`TranscribeVoiceNote`: `$timeout=1700`, `$tries=1`, `redis-long/captions`; the existing worker's
1800-second process limit and `redis-long`'s 3900-second retry-after remain outside it. Its
`failed()` hook uses the attempt-token compare-and-set.

## 6. Recording contract

`createRecorder(stream)` iterates a frozen MIME preference list. `isTypeSupported()` may skip a
candidate but never proves it usable. For each candidate it constructs a `MediaRecorder` and calls
`start()` inside the same guarded attempt; constructor or start failure disposes that candidate and
continues. It reports unavailable only after every candidate fails.

Usability cannot be proven before the permission-bearing user gesture because construction requires
the resulting `MediaStream`. Pre-gesture capability detection is therefore deliberately limited to
the existence of `navigator.mediaDevices.getUserMedia` and `MediaRecorder`: if either API is absent,
Record is hidden and the unsupported copy is shown. If both APIs exist, Record may request the
stream; only then does the construct-and-start loop above determine whether any candidate is truly
usable. If all candidates fail, the stream is released, the unsupported copy is shown, and Record is
removed. `isTypeSupported()` alone never makes Record "proven usable."

The explicit MIME preference list, in order, is:

```text
audio/webm;codecs=opus
audio/mp4;codecs=mp4a.40.2
audio/ogg;codecs=opus
audio/webm
audio/mp4
```

After those five explicit MIME attempts, the client makes one final native/default
`new MediaRecorder(stream)` attempt with no `mimeType` option. This is a sixth recorder
construction/start attempt, not a sixth MIME string. It is subject to the same rule: construction
and `start()` must both succeed, and failure proceeds to the unsupported state. The browser's
resulting `recorder.mimeType` (or `application/octet-stream` when it supplies none) remains only a
request hint; the server still probes the bytes.

The produced `Blob.type` is sent with the request as a hint, but the backend still probes bytes.

The UI:

- renders Record beside the text composer only for a Coach with an active review, a paused ready
  video, and both required recording APIs present; after the permitted stream gesture, all
  construct/start candidates failing removes Record and enters the unsupported state;
- samples `video.currentTime` when recording starts;
- auto-stops at 90 seconds;
- distinguishes permission denied (with browser-settings guidance), no input device, and no usable
  recorder/container;
- keeps recording local until Save, permits free Re-record, and stops every MediaStream track;
- gives `wavesurfer.js` only a local `blob:` URL, revokes it on rerecord/unmount, and destroys the
  WaveSurfer instance. Remote playback uses a plain `<audio>` element.

## 7. Playback state machine

`crossedNotes(notes, prevTime, nowTime, started)` is the pure function in §8.7 with
`SEEK_EPSILON=1.0`. It returns every forward-crossed note sorted by `(start_seconds,id)`, handles a
note at exactly zero on the first tick, returns none for backward/paused movement or jumps, and
thereby rearms after seeking backward.

The controller has states:

```text
idle -> hinting -> loading -> playing -> idle
                         \-> recovering -> idle
```

On a natural crossing in `play` mode it pauses video, queues all crossed notes, obtains the first
fresh signed URL, and awaits `audio.play()`. `ended` advances the queue; the final note resumes the
video. `play()` rejection, audio error, URL failure, or the R22 duration+3-second safety timeout
clears the queue and resumes. No branch may leave the video stranded.

Skip button or Escape stops audio, clears the whole crossing queue, and resumes immediately.
Manual pause intent during a note sets `resumeSuppressed`; ending/error/timeout then leaves the
video paused. The player adapter must expose manual pause intent even though the video element is
already programmatically paused. Switching to `text` or `none`, changing reviewer, leaving the
route, or unmounting cancels audio/timers/URLs safely.

Modes:

- `play`: text rows render normally; voice transcript appears while audio plays and interrupts;
- `text`: voice transcript participates as timed text, but audio never interrupts;
- `none`: voice rows are suppressed; ordinary text rows remain;
- existing reviewer option `No commentary`: suppresses the entire reviewer track, independently.

A speaker-glyph point marker (no duration resize handles) and unobtrusive `commentary ahead` hint
appear about three seconds before a playable voice note. While audio plays, the transcript is
visible in the overlay and linear list; pending text reads `Transcribing…`. Skip is visible and
keyboard accessible.

## 8. R23 product guardrail

When a review has more than six live voice notes, authoring shows a warning with count and summed
recorded duration. There is no hard cap. The warning, voice-mode radiogroup, and per-speech
preference are required S10 behavior, not later polish.

## 9. Voice erasure slice

`EraseReviewerVoiceNotes` is an idempotent domain operation used by the queued account-erasure
path. Before reviewer identity is nulled it selects annotations through reviews authored by that
user, locks them, deletes each referenced storage object, deletes the `SpeechAsset` row (letting
`ON DELETE SET NULL` clear the FK), retains annotation body/timing/publication, forces transcript
status ready when transcript text exists, and records bounded audit counts. Missing objects are
treated idempotently; storage errors prevent identity erasure and make the job retryable.

The speaker response afterward contains an ordinary text annotation with `voice:null` and reviewer
`null`; UI says Former reviewer and does not render a broken player or failure banner. General S11
profile/connections/export/retention work remains out of scope, but a minimal queued erase-self
route/job must call this operation so the acceptance test proves real orchestration rather than an
unused helper.

Voice objects also need lifecycle ownership: review hard purge and eventual soft-delete retention
cleanup delete them; the six-second annotation Undo window keeps them until the tombstone is
actually purged. A bulk annotation clear must not create permanent orphan objects.

## 10. Dependency rule

The only new frontend runtime dependency is `wavesurfer.js`. Do not add RecordRTC,
`extendable-media-recorder`, Web Audio wrappers, or a second playback library.
