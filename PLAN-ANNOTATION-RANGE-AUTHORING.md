# Plan: explicit annotation ranges and no overlapping feedback

**Status:** Reviewed implementation plan; planning only. No implementation is authorized by this document.
**Date:** 2026-10-19
**Scope:** Reviewer annotation authoring, validation, and the related timing contract.
**Review cycle:** Source validation → independent/adversarial review → revision → final validation completed (ledger below).

## 1. Requested outcome and confirmed decisions

Replace the crowded, implicitly saved composer with a deliberate workflow:

1. Choose the beginning of a speech segment.
2. Choose its end.
3. Enter commentary.
4. Click **Add annotation**.

Remove **Kind** and **Topic** from the reviewer controls. The user confirmed:

- Non-overlap is **within each reviewer's own track**, not across reviewers.
- Voice notes remain **point markers**. A voice marker cannot sit inside a
  written segment or share its timestamp with another marker.

The selected end describes speech time. A voice recording's duration describes
time spent listening while the speech is paused; these are different concepts.
The plan does not turn recordings into start/end speech segments.

Recommendations requiring acceptance with this plan: preserve existing overlapping
feedback as flagged legacy data; use explicit Save changes for existing written
notes; make the initial timeline selectable/display-only rather than draggable;
retain the current 120-second written-note maximum and 0.5-second UI minimum,
enforcing that minimum on new/timing-changing API writes too.

## 2. Proposed interface and walkthrough

```text
New annotation

Start  [00:12.500]  [Use current time]
End    [00:18.000]  [Use current time]
Length: 5.500 seconds

Commentary
[Your feedback about this segment                         ]
[                                                        ]

[Add annotation]  [Discard new note]
Only you can see added notes until you publish your feedback.

Added annotations
00:12.500–00:18.000   Your feedback…          [Edit] [Delete]
Voice note at 00:20.000                     [Preview] …

[Publish feedback]
```

On a narrow screen, stack the endpoint rows; use associated Start and End labels,
not compact unlabeled controls. Each capture button has a distinct accessible
name, such as “Use current time for start.” Keep the existing video controls.

### Create a written note

1. Scrub/play the video to the beginning; click the Start capture button. Capture
   that position and pause the video. Do not fill or change End implicitly.
2. Scrub/play to the end; click the End capture button and pause there. The coach
   can edit either time directly. End may be captured first; validation explains
   the missing/invalid other endpoint rather than silently swapping endpoints.
3. Enter commentary. Typing neither stamps a timestamp nor submits a request.
4. Show the selected range on the timeline, a read-only length, and inline
   conflicts. Show saved occupied ranges and voice markers on the same strip.
5. **Add annotation** saves one private server draft. Only an acknowledged save
   clears the form and adds the saved row. Keep playback paused; adding a note
   does not start the video or silently choose the next range.
6. **Publish feedback** remains a separate action governing speaker visibility.
   Adding is not publishing. Editing an already published note continues the
   existing update-in-place behavior; explicitly say that saved changes to it
   are visible to the speaker, rather than promising a second publication gate.

Start/End are initially blank. Trim surrounding whitespace only. Accept unsigned
decimal seconds, `M:SS[.fff]`, or `H:MM:SS[.fff]`; seconds/minutes subordinate to
a colon component must be exactly two digits from 00–59. The leading component
is one or more decimal digits; fractions occur only on seconds and have 1–3
digits. Accept `12.5`, `0:12.500`, `1:02:03.250`; reject signs, exponents, units,
internal whitespace, empty components, `.5`, `1:60`, and extra fractional digits.
Parse strings directly into integer milliseconds, including right-padding the
fraction; reject domain overflow. Render `M:SS.mmm` (or `H:MM:SS.mmm` at an hour)
without losing precision. Existing `formatTimecode()` floors fractions and is
unsuitable for editable endpoint values. Use text inputs with a timecode hint,
not a wall clock `input[type=time]` or a newly introduced slider library.

Add is unavailable until metadata/annotations have loaded, all fields are valid,
the review is writable, and no submission is pending. Explain the reason inline;
do not make a disabled button the only feedback. An existing successful query
may remain usable during a background poll; the server still decides admission.
If initial data cannot load, offer Retry without losing text or endpoints.

### Edit, cancel, and voice recording

- Existing written rows open their own **Start / End / Commentary** editor with
  **Save changes** and **Cancel**. Never load a saved row into the new composer.
- Show saved rows as ranges, including their end time. Cancel discards only the
  local edit after an explicit action, restores the saved preview, and clears
  its recovery draft. A new-note Clear/Discard action must be labeled separately
  and must not clear saved annotations.
- Remove duration nudge buttons and Kind/Topic controls. Duration becomes derived
  information. Use neutral marker styling instead of hidden Kind-driven colors.
- Preserve the voice recorder and microphone lifecycle. Before recording, show
  the anchor and warn about an occupied position. Validate again on upload.
- A stopped, unsaved recording keeps its preview/blob and UUID on rejection.
  Let the coach edit its **Voice note position** or capture a different playhead
  position before retrying **Save voice note**, without re-recording. Do not
  move the anchor as a side effect of retrying or a delayed microphone grant.
- Once saved, voice timing remains immutable in this release. Transcript editing
  and audio playback remain separate. Non-destructive movement of saved voice
  markers would be additional scope, not an unnoticed relaxation of that API.
- A confirmed validation rejection means no row was admitted and the unsaved
  voice anchor may be corrected. A network/5xx/aborted-response outcome is
  **uncertain**: freeze its original UUID/blob/anchor snapshot, refetch the own
  review and reconcile that UUID, or retry that exact snapshot to learn its
  result before allowing a changed anchor. Verify the acknowledged point matches
  the original submitted snapshot. Never clear a preview on the assumption a
  changed retry body moved an already admitted immutable voice note. If admitted,
  identify its actual saved position; any genuinely new note requires an explicit
  new-note action/UUID, not a hidden duplicate upload.
  A UUID absent from one GET does not prove failure while the original request
  may still commit: remain frozen and reconcile the exact original submission
  until success or a definitive rejection establishes its outcome.

## 3. Source findings that determine the implementation

| Current file | Verified behavior / required consequence |
|---|---|
| `web/src/components/annotation/Composer.tsx` | Creates a hook instance per new draft and resets after creation. Preserve separation from row editors. |
| `web/src/hooks/useAnnotationEditor.ts` | First insertion captures playhead; text saves after 750 ms, timing after 300 ms; pagehide also POSTs/PATCHes. Every implicit remote-save path must be removed from explicit authoring, including conflict Keep mine. |
| `web/src/components/annotation/AnnotationEditor.tsx` | Shared new/existing written editor contains duration, Kind and Topic; replace with endpoint form and explicit actions. |
| `web/src/components/annotation/TimelineStrip.tsx` | Independently PATCHes drag timing, permits overlap/out-of-bounds values, and can retain a rejected live override. Remove its mutation/drag path for the initial design. |
| `web/src/components/annotation/AnnotationComposerPanel.tsx` | Merges server rows/live overrides, polls, owns one timing engine, and publishes without checking local pending edits. Coordinate local dirty/submitting/recording state. |
| `web/src/lib/annotationDraftStorage.ts` | Writes UUID-keyed mirrors; `readDraftMirror` has no production recovery caller. Existing mirroring does not establish reload recovery. |
| `web/src/components/annotation/AnnotationList.tsx` | Written Undo re-POSTs; voice Undo restores. Both can fail if their freed slot is reused. |
| `api/app/Services/AnnotationService.php` | Text create locks Review; update locks only Annotation. No overlap check. Parent serialization is needed on timing updates as well as create. |
| `api/app/Services/Voice/VoiceNoteService.php` | Locks User → Review, creates a point anchor with placeholder recording duration 1.0; the worker later replaces that duration. |
| `api/app/Services/Voice/FfmpegVoiceNoteProcessor.php` | Writes recording duration asynchronously. It must not change point occupancy. Fake processor has the same responsibility. |
| `api/app/Http/Controllers/Api/VoiceAnnotationController.php` | Restore uses Review → Asset → Annotation locks and purge-claim checks. Add point conflict checks inside that transaction. |
| `api/app/Services/Voice/EraseReviewerVoiceNotes.php` and `api/app/Jobs/PurgeDeletedVoiceAnnotation.php` | Can clear both audio identity and transcript-status provenance. An audio-null row cannot reliably identify historical written versus voice origin. |
| `web/src/lib/engine.ts` | Active ranges are half-open, but durations under 50 ms are expanded. New written ranges must not be shorter than the agreed 500 ms minimum. |
| `api/database/migrations/2026_08_12_100001_create_annotations_table.php` | Stores numeric start/duration with three decimal places; duration is positive and at most 120 seconds. No overlap constraint exists. |

Source findings describe the current worktree, including the preceding uncommitted
commentary playback implementation. Preserve that work and unrelated plans.

## 4. Timing and overlap contract

### Exact rules

Convert speech timing to integer milliseconds before comparing or persisting
the values represented by NUMERIC(...,3). Typed timecodes are exact integer
parses. Capture a finite nonnegative video position with `round(seconds * 1000)`
(nearest millisecond, positive ties upward); send integer-derived three-decimal
seconds. Subtract integer endpoints to derive duration, never rounded float
differences. For old API numeric input, the server normalizes decimal seconds
to nearest millisecond with positive half-up rounding before checking the
effective range; preserve raw request values until this conversion rather than
casting them prematurely to binary floats in the controller. PHP/TS fixtures
must cover the same decimal boundary cases. Derive the authoritative video bound
from its stored decimal duration in milliseconds and advertise the same bound
to the client. A capture at the video's ended position represents that advertised
end; ordinary out-of-bound captures show an error. Do not introduce floating-point
epsilon gaps or silently clamp typed endpoints. An unrelated poster or voice
recording is not a duration source.

Written range requirements: `0 <= start < end <= speech duration`,
`500 <= end_ms - start_ms <= 120000`. A point requires
`0 <= point_ms < speech_duration_ms`. Unknown/non-finite/non-positive video
duration prevents new timed submissions with a useful retry/error state.
Reject numeric overflow, including voice-start values beyond the start column's
domain; text requests already have an upper-bound check while voice does not.

End remains a UI concept: send existing `start_seconds` and
`duration_seconds = end - start`. Do not add redundant `end_seconds` storage
or reinterpret voice `duration_seconds` as a speech span.

| Existing and candidate geometry | Conflict predicate |
|---|---|
| Ranges `[a,b)` and `[c,d)` | `a < d && c < b` |
| Range `[a,b)` and voice point `p` | `a <= p && p < b` |
| Voice points `p`, `q` | `p === q` after canonical millisecond conversion |

Thus written `10–15` and `15–20` are allowed. A voice at `15` conflicts with
`15–20`, but can follow `10–15` if no other segment starts at that point.
Containment, equal starts, duplicates and crossing ranges are all conflicts.
Do not fake a point as `[p,p+1ms)` or use its recording length as occupancy.

The authoritative set is every **live row of the same review**, draft or
published, including pending/failed voice uploads and preserved point
transcripts. Soft-deleted rows free their slot. The candidate's own row is
excluded when updating. Each reviewer retains an independent track; responses
must never identify peer reviewers or their private notes.

### Preserve point identity after audio erasure

Add server-owned immutable `annotations.timing_type` (`range` or `point`) and
expose it additively in `AnnotationResource` and the TypeScript annotation type.
The endpoint sets it; clients cannot choose/change it. Text creation sets range;
voice creation sets point. Preserve it through normalization, transcription,
erasure, purge, soft delete and restore. This is a small schema change required
by the confirmed all-note rule, even though End itself needs no new column.

Do not infer permanent identity solely from `voice !== null` or transcript status.
An erased empty recording loses both existing signals. Treat **geometry** and
**playable audio** as separate properties throughout the authoring UI.

Backfill known points from a current audio asset or non-`not_applicable`
transcript status. Inventory ambiguous live empty rows and audio-null tombstones
whose origin was already lost; do not claim to reconstruct it perfectly. Require
an explicit reviewed classification policy for those rows before finalizing the
backfill/constraints. Do not silently rewrite them as known written notes.

Erased point transcripts stay readable and seekable, including the existing
Written notes only reading fallback. Show a point timecode and unavailable audio;
do not give them a duration range editor, duration bar, automatic duration overlay,
or native typed cue based on the former recording length. Audio scheduling still
requires an actual audio asset. Apply this narrowly to `timing_type=point`;
ordinary written notes and the four playback modes retain their behavior.
This explicitly amends the earlier playback plan's lack of durable provenance.

## 5. Atomic backend enforcement and errors

Introduce one geometry/normalization validator used by every admission path.
Frontend checks are advisory because polling and multiple tabs can race.

| Operation | Required transaction behavior |
|---|---|
| Written create | Lock Review; recheck current write entitlement; return an existing live UUID match before overlap/cap checks; validate candidate and insert atomically. |
| Written timing change | Lock Review → Annotation; recheck ownership/status; preserve stale-version 409 precedence; combine submitted fields with locked row; validate effective range excluding self; increment version and save. |
| Body-only edit | Preserve optimistic locking and metadata. Do not revalidate unchanged legacy timing or make old comments impossible to edit. |
| Voice create | Preserve User → Review → Asset/Annotation order. Check point conflict before quota reservation/object writes/asset creation, including processing and failed slots. Keep recording-duration handling intact. |
| Voice restore | Preserve Review → Asset → Annotation order and ownership/purge checks, then validate point admission before restore/counter changes. |
| Erased-point restore | New `POST /api/speeches/{speech}/annotations/{annotation}/restore-point` operation restores the same audio-null point tombstone under Review → Annotation locks, checks ownership/active entitlement and point occupancy, and restores counters. No asset, audio resurrection, quota charge or client-supplied geometry. Reject asset-backed rows on this route. |
| Written Undo | Re-POST remains normal creation and checks current occupancy. If gap was reused, preserve recovery content and explain the conflicting time. |
| Delete | Refetch current row under Review lock before deleting/counting; do not rely on a stale controller model or decrement a published counter twice. |
| Clear/publish/revoke/purge | Audit existing Review-first transactions, authorization and counter behavior. New validation must not create an inverted lock path or publish side effects on rejection. |

Review-lock serialization must cover **all** live geometry changes, not just
two creates. Recheck active/non-revoked entitlement after obtaining the lock.
Both controller and service generic-PATCH guards must prohibit point timing
changes using **timing_type**, including audio-null erased points; checking only
audio_asset_id leaves a bypass. Preserve the authorization appropriate to the
operation: actual audio/transcript/asset-backed restore keeps existing coach and
verified-email restrictions, while readable erased-point body editing/deletion
keeps its existing own-active-review authorization. The new text-only point
restore uses that same own-active-review entitlement (new policy/Gate mapping),
with 404 ownership predicates before any peer-sensitive type/error response;
it must not weaken the existing verified/coach audio restore route.
Register the new ownership-only ability in `AppServiceProvider` and add it to
the blanket-admin-bypass fall-through list; an admin must not restore a peer's
commentary merely through the generic admin shortcut. Test this explicitly.

Choose Undo by timing_type **and** current audio availability: range re-create,
asset-backed point restore, or audio-null point restore. Do not re-POST an erased
point through range creation or silently fall back from failed audio restore to
transcript-only recovery. Explain that unavailable audio is not restored. Cover
idempotent/concurrent restores and increment counters only on an actual transition.
For the new audio-null restore operation, an already-live authorized point
returns its current row without incrementing again. A real tombstone must pass
admission before restoring. Retain original publication on same-row point Undo
(a previously published point becomes visible again); written re-create Undo
keeps its current private-draft semantics. Do not create a new publish notification
as a side effect of restoration.

Do not add Review locks to normalizer/erasure asset→annotation paths merely to
guard recording metadata: immutable timing_type/start means they cannot change
occupancy. Audit their actual writes and preserve that property.
Include implicit User locks acquired by quota UPDATEs in the complete lock
graph. A concrete existing cycle is confirmed in source: new voice create holds
User and waits Review; restore holds Review and waits Asset; deleted-voice purge
holds that Asset/Annotation and quota release waits User. Restore's purge-claim
check occurs after its Asset wait, so it does not prevent the cycle.

The bounded first-release mitigation is **three attempts at the outermost DB
transaction for known rolled-back deadlock/serialization failures**, retaining
the same logical UUID/CAS. This promises recovery, not deadlock absence. Apply
it to geometry admission/restore and participating voice quota-accounting DB
phases. Installed Laravel supports transaction attempts but does not locally
retry nested concurrency failures; the retry boundary must be the outermost
transaction. Test on actual independent PG connections, not a parent transaction.

Audit/refactor attempt-local state before enabling retries:

- Re-fetch Eloquent rows each attempt. PHP field mutations survive SQL rollback.
- `VoiceNoteService` currently captures `&$storedPath`. Return committed
  created-asset identity/ownership from the successful transaction instead;
  never clean up or fail an asset found by a retained deterministic path from
  a rolled-back attempt. A sibling same-UUID request may own that valid asset.
- Erasure currently increments `&$counts` inside a transaction. Return a per-item
  delta and accumulate only after commit, so a commit-time retry cannot double it.
- Keep quota deltas and asset/CAS ledger changes atomic. Do not retry FFmpeg,
  storage writes/deletes or queue dispatch as part of a whole-method retry.
- Retry only recognized rolled-back concurrency errors (40P01/40001). A lost
  commit/network acknowledgement is uncertain, not proof of rollback; reconcile
  UUID/ledger state instead of replaying a quota delta.

Relevant supporting accounting paths: FfmpegVoiceNoteProcessor success/failure,
FakeVoiceNoteProcessor, NormalizeVoiceNote::failed, PurgeDeletedVoiceAnnotation,
PurgeVoiceAsset, EraseReviewerVoiceNotes and MediaReconcileCommand. Preserve
their claims and external-I/O boundaries. Exhausted known concurrency failures
return a retryable **503 `annotation_busy`** for HTTP writes, preserving the
form/UUID; job/command failures follow their bounded retry/reporting contract.
An ordered-lock redesign is a possible later hardening task, not a claim this
minimal retry protocol eliminates the existing lock cycle.

Return **422** with stable `code: annotation_overlap`, actionable field errors
and authorized conflicting IDs/timecodes. A body-only version conflict remains
the existing **409** `{conflictSource: "self", current: ...}`; do not send an
overlap through the editor's “Keep mine” version-overwrite path. Other 422s are
validation errors, not “offline.” Keep 401/403/404/410 handling and draft text.

On rejection: no partial annotation, quota charge, asset/object, counter increment,
publication or notification. Network retries retain the submission UUID. An
idempotent retry of an already admitted row returns it even though it occupies
the requested slot; it must not conflict with itself or apply a changed retry body.

No immediate PostgreSQL exclusion constraint is proposed: heterogeneous geometry
and existing conflicting rows need a deliberate migration. The guarantee is all
supported application write paths serialized on Review, not protection against
arbitrary direct SQL. Audit admin/import/seed commands as possible bypasses;
production import paths must use the same service, while deliberately legacy
fixtures must be explicitly isolated from normal authoring fixtures.

## 6. Explicit submission, recovery and publishing

Refactor the existing editor state machine rather than attach a button to its
autosave hook. Use shared endpoint parsing/validation for new and row forms;
keep each row's state isolated. Expose explicit submit/cancel operations and
remove remote debounce, automatic pagehide POST/PATCH, and post-conflict auto-save.
“Keep mine” prepares a retry with the current version and requires Save changes.

During Add/Save, freeze that form's submitted fields and guard duplicate clicks.
Match acknowledgement to user/speech/review/row, UUID and submitted snapshot
before clearing local state. Late responses cannot clear a new context's draft.
Keep one UUID through uncertain retries; changed content after an uncertain create
must first reconcile the original UUID result rather than silently drop changes
when an idempotent response returns the earlier body. No offline auto-submit.

Save local recovery drafts synchronously, with versioned records scoped to
account + speech + review + row/new-note + draft UUID + editor-instance identity.
Keep a discoverable context index, rebuildable by validated key-prefix discovery
if concurrent tabs race its update. Include revision/snapshot identity; a save
may clear only its own matching record, never another tab's draft/newer revision.
Offer an explicit choice when several recoverable drafts exist; do not implement
one shared context slot that tabs overwrite. Persist the create UUID inside its
envelope so retry identity survives reload. Validate restored
data and recheck authorization/occupancy/lock_version before submission. Offer
Restore/Discard; never auto-submit a recovered draft. Do not read another account's
draft. Do not remove old mirrors as an unsolicited cleanup.

Keep unsaved changes protected across tab switches, route changes, browser close,
401/revocation and storage failures. Where local storage is unavailable, keep the
form in memory and clearly warn before navigation; do not promise reload recovery.
A recording blob remains only as durable as the recorder's actual implementation;
do not claim text-draft storage recovers microphone recordings after reload.

Publish is disabled while a written form/transcript editor is dirty, an upload or
save/restore is pending, or a recording/unsaved voice preview exists. Explain
“Add, save, or discard your pending feedback before publishing.” Do not silently
save an unsubmitted form or publish only part of what the coach can see. A failed
save cannot leave Publish enabled with unsubmitted text. Reuse the existing
publication/counter/notification service once pending work is resolved.

Use the same pending-work coordination **before** Clear saved notes or Abandon
mutates the server. A navigation blocker after Abandon is too late. Disable
terminal actions while saves/uploads or recording are pending; resolve uncertain
requests before proceeding. For local unsaved text/transcript/voice preview,
require Save/Add or explicit Discard before the action. Clear then removes saved
rows and associated saved-row previews/recovery state; it does not silently
discard the new form or recreate cleared notes from stale callbacks. Abandon
navigates only after an acknowledged transition. No implicit save during either.

Dirty row/transcript editors cannot simply close/unmount or hide their text.
Require Save/Cancel (explicit discard) or Keep editing, retaining recovery on
protected route transitions. Pending-state registration must track editor/context
identity and unregister only after acknowledged save, explicit discard or
protected recovery; avoid both orphaned hidden dirty state and a Publish guard
that disappears when an unsaved child is hidden.

## 7. Existing data and compatibility consequences

Existing overlap is intentional in `SeedAnnotationsCommand`, E2E voice fixtures
and the preceding playback acceptance fixture. Do not trim, move, merge, delete,
or republish any such feedback automatically.

Recommended transition: preserve/read flagged legacy conflicts; reject every new
range/point and every actual timing change that conflicts with a live neighbor.
Allow body-only edits and ordinary publication of unchanged grandfathered rows,
with a reviewer warning. Timing edits must leave the edited candidate conflict-free.
Saved voice anchors remain immutable, so some historical point conflicts cannot
be repaired in this release without an explicit later marker-move feature or the
reviewer's own deliberate deletion. Do not strand them behind an unfulfillable
publication gate. This is **no new overlaps**, not a claim old data is already clean.

If retroactively eliminating every existing overlap is required, scope a separate
reviewed remediation step before declaring that stronger invariant achieved.
Legacy playback tests for overlapping overlays must remain; new authoring
fixtures should use valid disjoint ranges and point positions.

Retain Kind/Topic columns, API fields, defaults and historical values. New written
requests omit them → observation/null defaults; edits omit them rather than
resetting them. Removing storage is unnecessary and would affect old clients,
moderation and fixtures. Old clients may still send metadata; server timing rules
apply to them too. Old autosave clients can now receive overlap/bounds errors;
their UI compatibility is limited and a refresh is required for the improved UX.
New minimum/bounds checks intentionally tighten the old permissive write API;
unchanged legacy timing remains readable/editable as described above.

## 8. Files and ordered implementation phases

| Phase | Work / likely files | Completion condition |
|---|---|---|
| 1. Freeze rules | Amend STEP-07/STEP-10 and `PLAN-COMMENTARY-PLAYBACK.md`; specify parser, minimum, boundaries, error shape, legacy policy and immutable geometry. | Product choices and legacy exception are executable test cases. |
| 2. Geometry provenance | New migration; `Models/Annotation.php`, `Http/Resources/AnnotationResource.php`, factories; voice creation/erasure/purge audit; inventory/backfill. | New and erased points have durable identity; ambiguity is explicitly resolved. |
| 3. Backend guard | Shared timing validator/error; `AnnotationService`, `VoiceNoteService`, create/update/voice requests, both controllers, relevant ReviewService paths; `routes/api.php`, policy/Gate registration for text-only point restore. | Every supported create/retime/restore path serializes/checks correctly; no partial side effects. |
| 3a. Concurrency recovery | The quota-accounting paths listed in section 5, transaction attempt-local results and typed busy handling. | Deterministic deadlock/commit-failure tests prove bounded recovery without double quota or cleanup of another request's upload. |
| 4. Explicit forms | `useAnnotationEditor`, `Composer`, `AnnotationEditor`, `AnnotationRow`, endpoint utility, `annotationDraftStorage`, API payload/error types. | No HTTP writes before Add/Save; clear failures/recovery/conflicts; Kind/Topic removed from UI. |
| 5. Orchestration | `AnnotationComposerPanel`, `TimelineStrip`, `AnnotationList`, `VoiceRecorder`, `VoiceAnnotationRow`, `useKeyboardShortcuts`. | Single range-edit path, accurate preview, safe voice retry/Undo, coordinated Publish guard. |
| 6. Read/playback compatibility | `lib/commentaryPlayback`, `useCommentaryTrack`, native cue/overlay projections as needed; list/timeline point presentation. | Erased point text readable without a fabricated duration span; actual audio scheduling unchanged. |
| 7. Verify/deploy | Tests below, reviewed migration, API/UI coordinated rollout, acceptance ledger. | New rules proven at relevant levels; original data and previous playback work preserved. |

Keyboard: keep existing navigation and typing/native-control guards. Map C/Alt+C
to explicit Start capture in the new composer and document that it no longer
auto-adds anything; End has its visible capture button in the first iteration.
Do not introduce a shortcut that submits while the coach is typing. Do not claim
frame-accurate capture: the current step helper uses a nominal 1/30 second.

The initial timeline keeps occupied range bars, point markers, selected range and
seek clicks. Remove direct drag/resize mutation and related stale overrides.
A later dual-handle selection/drag editor is optional; it must use the same
validation, explicit save and rejection rollback, not a new mutation shortcut.

## 9. Validation and acceptance

### Automated checks to implement and run

- Timecode utilities: valid formats, fraction preservation, malformed/negative/
  non-finite/overflow values, video bounds, 500 ms/120 s limits, and matching
  millisecond conversion in PHP/TS. Verify the engine does not extend new ranges.
- Geometry table: adjacency; nesting; exact duplicates; point at range start,
  interior and exclusive end; same/different point; draft/published/deleted sets;
  self-exclusion; independent reviewers; processing/failed/erased points.
- Feature/API tests: create/update/voice-create/restore/Undo with real endpoints,
  idempotent retry, stale version precedence, effective partial PATCH, unchanged
  legacy body edit, forbidden/revoked review, bad metadata/role spoofing and
  422s with no counter/quota/storage/publication side effects.
- Migration/lifecycle: known point backfill; ambiguous history handling; erased
  empty/nonempty point identity; delayed normalizer/transcriber completion;
  deletion/restore/purge race and unchanged recording watchdog duration.
- **Isolated PostgreSQL with two connections:** overlapping range/range create,
  range/point create in both lock acquisition orders, retime/retime, retime/create,
  restore/create, delete/restore and revoke/write. Prove admission outcome,
  current permissions and intact counters; include the User/Review/Asset quota
  lock graph and a deterministic three-connection reproduction/recovery test.
  Cover victim selection, retry exhaustion, commit-time serialization failure,
  fresh models each attempt, sibling UUID ownership and exactly-once accounting.
  SQLite cannot prove row serialization or deadlock recovery.
- Frontend hook/form: zero POST/PATCH on typing/capture/debounce/unload; exactly
  one submit; rejected/unknown-outcome retries; retained UUID/text/times;
  acknowledgement/context guards; explicit edit/Cancel/conflict; recoverable
  scoped multi-tab drafts and unavailable storage; no old fields reset on edit.
- Panel/timeline/voice: no independent drag PATCH; unsaved range preview cleared
  correctly; no erased-point duration overlay; occupancy updates from polling;
  safe recorded preview on conflict; Undo gap reuse; publish guards including
  transcript edits, uploads, recording and pending failures; Clear/Abandon and
  dirty-close guards; uncertain voice save followed by attempted anchor change;
  erased-point same-row restore without role escalation or quota changes.
- Regression: voice normalization/transcription/playback, prior four modes,
  legacy overlap playback, captions/fullscreen, privacy/peer isolation, review
  counters, deletion, keyboard and accessibility. Update current autosave/nudge/
  drag assertions intentionally; do not weaken unrelated checks.

Primary existing tests: `useAnnotationEditor.test.tsx`,
`AnnotationComposerPanel.test.tsx`, `AnnotationList.test.tsx`,
`TimelineStrip.test.tsx`, `VoiceRecorder.test.tsx`, `VoiceAnnotationRow.test.tsx`,
`lib/engine.test.ts`, annotation write/voice HTTP/lifecycle/schema tests under
`api/tests/Feature/Annotation`, and Review counter tests. Update browser
`keyboard-shortcuts.spec.ts`, authoring/voice scenarios, accessibility selectors
and any references to automatic timestamps/autosave. Keep separate legacy
fixtures where overlap is the behavior intentionally under test.

Run focused tests first, then frontend suite/typecheck/lint/build and changed PHP
Pint/PHPStan/feature suites. Use explicit test storage/SQLite or isolated PG;
never refresh/reseed the user's development database. The full E2E harness shares
development ports; run its mutating cases on isolated CI/host, not by changing
its database target to the working app.

### Browser acceptance script

1. On a dedicated test speech, capture Start/End, type a paragraph, wait several
   seconds: no annotation exists until Add. Add produces one private draft.
2. Create adjacent ranges, reject partially/nested/identical overlapping ranges,
   and show exactly which of this reviewer's notes conflicts. Other reviewers'
   overlapping feedback remains independent and invisible to this coach.
3. Reject a voice marker at a segment's start/interior and another marker; allow
   its exclusive end when free. Reject upload without losing its stopped preview;
   change the unsaved anchor and save without re-recording.
4. Edit one range; Save updates that row only. Cancel restores server content.
   Rejected timing retains input and removes invalid optimistic preview state.
5. Delete, fill the freed interval, then Undo: useful conflict instead of overlap
   or data loss. Refresh a second coach session and race two submissions.
6. Verify pending written/transcript/voice work blocks Publish; successful Add
   remains private until publication; saved published-row edits are visible as
   documented. Kind/Topic are absent and old metadata remains intact.
7. Reload a text draft, Restore/Discard, switch accounts/rows/speeches and check
   isolation. Simulate validation/network/auth failure; no unintended auto-submit.
8. Verify erased-point text remains readable/seekable, no invented duration bar
   or timed overlay, and current playable voice/captions/four modes still work.
9. Keyboard-only and narrow/mobile viewport checks: all controls labeled,
   endpoints editable, errors announced, focus returns sensibly after Add/Cancel.

## 10. Rollout, consequences and effort

This is a medium-sized authoring change: the visual form is straightforward;
explicit-save recovery, all-path atomic exclusion and durable voice-point
identity account for most work. Estimate **4–7 focused engineering days** for
implementation/review/tests plus migration/acceptance time, subject to the legacy
inventory. Allow **another 1–2 days** for the supporting quota retry/ownership
work if it is not already fixed independently. This is a planning estimate,
not a token or completion guarantee.

Use a coordinated maintenance window for the provenance migration: preserve
unsaved recordings first; back up the target database; quiesce annotation writers
(including old tabs/API instances) and background erasure/purge work that can
remove origin evidence. Add/backfill/review classification, deploy updated
writers and UI, then resume. Do not add `NOT NULL DEFAULT range` while old voice
writers can still create mislabeled points. A rolling release needs a separately
designed nullable/dual-read transition; do not improvise it during deployment.

No migration or maintenance occurs during this planning task. Destructive cleanup,
automatic retiming and removing Kind/Topic storage are outside scope. A rollback
must retain timing provenance and recorded content; rolling back to a writer
that bypasses exclusion requires keeping annotation writes disabled until a
compatible writer is restored. A UI rollback alone cannot preserve the promised
explicit-save UX in old bundles.

Practical consequences: explicit extra clicks replace surprise autosaves; local
text needs real recovery; arbitrarily overlapping new feedback is no longer
allowed; a voice marker requires a written segment to end at or before it, or
start strictly after it; point-at-start behavior follows the confirmed rule; some Undo actions
can now fail; saved voice positions remain immutable; old overlaps remain a
visible exception; some existing API clients receive new validation errors.

## 11. Planning evidence and review ledger

- Read-only frontend/backend audits inspected real composer, editor, timeline,
  voice, mutation, erasure, migration and test paths. No source files or database
  records were changed by the audit agents.
- Baseline focused tests executed before the plan: **4 files / 24 tests passed**
  (`useAnnotationEditor`, `AnnotationComposerPanel`, `AnnotationList`,
  `TimelineStrip`). They establish current behavior only, not the proposed design.
- Initial source review caught independent drag PATCHes, pagehide autosaves,
  false reload-recovery assumptions, point/recording-duration confusion,
  erased-origin loss, lock ordering and the engine's 50 ms expansion.
- Independent frontend review and adversarial backend/design review challenged
  the written plan. Revisions explicitly addressed erased-point retime and Undo
  bypasses, authorization/admin fall-through, exact time parsing, uncertain voice
  upload acknowledgement, concurrent recovery drafts, dirty-close/terminal-action
  guards and the confirmed quota lock cycle. The separate backend audit checked
  the bounded-retry strategy against the installed Laravel implementation and
  identified attempt-local cleanup/count hazards; those are included above.
- A final review of the revised document found **no remaining blocking design
  contradiction**. The frontend reviewer confirmed all six UX findings addressed;
  its final absent-UUID precision has also been incorporated. This is not a
  guarantee that future code will contain no errors.
- Final source/path/requirement validation passed: all **15 explicit existing
  source paths** and **6 named frontend test paths** resolve, Markdown fences
  balance, no trailing whitespace, and the confirmed scope/boundaries/error/
  restore/retry contracts are present. No browser or database mutation was used.
- Remaining implementation gates are explicit: inspect actual legacy origin
  ambiguity before migration; prove two-/three-connection PostgreSQL behavior;
  implement and execute the new tests/browser script. Current baseline tests do
  not establish those future properties.
- This plan does not certify future code or all browser/device behavior. No
  implementation, schema change, deployment, fixture mutation or commit is part
  of this planning task.
