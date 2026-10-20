# Implementation plan: four commentary playback modes

**Status:** Implementation and local deployment complete; automated and desktop Chrome checks recorded below. Full isolated browser-suite and physical iPhone acceptance remain unverified. Adversarial plan review complete. See section 13 for evidence and validation limits.
**Date:** 2026-10-19
**Location:** Repository root, following the existing `PLAN-*.md` convention.

## 1. Request and scope

Replace the confusing combination of reviewer selection, `No commentary`, and
three voice-only buttons with a reviewer selector and one control governing all
timed reviewer feedback. The user explicitly confirmed that option 1 includes
typed notes, recorded audio, and the recording's transcript while it plays.

The four-mode design below is the recommended implementation of that request.
The user has now authorized execution of this plan through the active thread
goal. Preserve the full scope and record evidence of implementation below.

The playback controls apply to the speaker/owner's watch screen. Coach recording,
editing, publishing, access policies, media processing, and the speech's own
captions retain their existing responsibilities. The Essay tab remains separate.

## 2. Verified current implementation

These are source observations, not claims of browser verification of this plan:

| Current component | Behavior relevant to this change |
|---|---|
| `web/src/components/review/TrackSelector.tsx` | Reviewer chips include `No commentary`; another radiogroup offers `Play commentary`, `Text only`, and `None`. The readable commentary list and voice playback controls also live here. |
| `web/src/hooks/useCommentaryTrack.ts` | `play` shows written feedback plus voice audio/transcripts; `text` shows written feedback plus transcribed voice notes silently; `none` removes voice rows but retains written notes. One returned annotation collection currently serves several different consumers. |
| `web/src/routes/SpeechWatch.tsx` | Uses that collection for overlays, voice markers, keyboard navigation, and the Notes UI. The selected reviewer also drives the Essay tab. |
| `web/src/hooks/useVoiceInterjections.ts` | Pauses the speech for voice notes crossed during normal playback, fetches a signed URL, plays audio, and normally resumes the speech. Only literal mode `play` enables this behavior today. |
| `web/src/hooks/useVoiceCommentaryPreference.ts` | Persists per-user/per-speech voice preferences locally and remotely. An initial automatic audio experience saves `text` for the next visit unless the viewer explicitly chose a mode. |
| `api/app/Http/Controllers/Api/VoicePreferenceController.php` | Accepts exactly `play`, `text`, and `none`, stored in `users.preferences.voice_commentary[speechId]`. Updates merge preferences under a user-row lock. |
| `web/src/hooks/useIosFullscreenSubtitles.ts` | Provides a separate native `Commentary` subtitle track for timed written feedback. It is not the speech's generated captions track. |
| `web/src/components/annotation/OverlayStack.tsx` | Renders at most three simultaneous overlays, with fade/ghost behavior. Overlays are hidden from screen readers; the readable list supplies accessible text. |
| `web/src/components/speech/VideoPlayer.tsx` and `web/src/shared/media/videojs-adapter.ts` | video.js owns the fullscreen player root. Owner overlays/markers are currently sibling elements outside it, and commentary controls are below the player. HTML fullscreen parity requires integration work, not just a test. |

The old frozen playback contract explicitly specifies the existing voice-only
semantics: `STEP-10-FROZEN-CONTRACT.md`, sections 2.3 and 7. Implementation must
record that the new owner-facing experience supersedes those portions while
keeping the legacy preference API compatible.

## 3. Product contract

### 3.1 Controls and labels

- The reviewer row contains reviewer names only. Remove its visible
  `No commentary` choice.
- Label the second row **Commentary playback**, replacing **Voice commentary**.
- Offer exactly **Text + audio**, **Written notes only**, **Audio only**, **Off**.
- Keep the internal empty-reviewer state for no available reviewers, initial
  loading, and revocation. It is not another user-facing Off choice.
- Turning Off does not deselect the reviewer, reset the playhead, or disable
  the selected reviewer's Essay or Report action.
- Keep the existing most-recently-published reviewer default. Do not invent a
  newly persisted reviewer selection in this change.
- Scope that default-selection latch and fetched/displayed rows to the current
  account and speech. Reset them when either changes. Revoking the selected
  review clears that selection and old feedback without rewriting the viewer's
  saved playback mode or silently selecting another reviewer.
- With no eligible reviewer, show an honest empty state and disable playback
  controls. Never imply that selecting a mode grants access to feedback.

### 3.2 Exact mode matrix

| Canonical value / label | Written overlays | Recorded audio | Voice-transcript overlay | Voice markers | Previous/next note shortcuts |
|---|---|---|---|---|---|
| `all` / Text + audio | Yes | Yes | Current voice note only | Yes | All authorized notes |
| `written` / Written notes only | Yes | No | No | No | Written notes only |
| `voice` / Audio only | No | Yes | No | Yes | Voice notes only |
| `off` / Off | No | No | No | No | No commentary targets |

The matrix describes inline playback and HTML fullscreen. Section 8 defines
the native iPhone fullscreen exception; do not claim native transcript parity.

The speech's video, original sound, generated captions, and speech Transcript
tab are independent of these modes. `Off` means no automatic timed reviewer
feedback, not muting the original speech or hiding its subtitles.

For this plan, a written row means the current API returns `voice === null`.
An audio-erased former reviewer's preserved transcript becomes such a row under
the existing erasure contract and will appear in Written notes only. Distinguishing
historically recorded text from originally typed text would require additional
provenance and is outside this change.

### 3.3 Define when the active voice transcript appears

In Text + audio, show the current recording's text after audio playback starts;
retain it while that recording is deliberately paused. Clear it on completion,
skip, failure, cancellation, reviewer change, or leaving an audio-enabled mode.
Loading shows a generic loading status, rather than displaying the transcript
before audio starts. This deliberately clarifies current loading behavior.

Playable audio is not blocked by an unfinished or failed transcription. Use
`Transcribing…` or `Transcript unavailable.` in the transcript slot as appropriate.
Audio only displays playback status, Pause/Resume, and Skip, without displaying
commentary body text.

Reserve one of the existing three overlay slots for the active voice transcript
in Text + audio: at most two written overlays plus that transcript. Otherwise
keep the three-written-note cap. A simultaneous written note must not crowd out
the transcript the user explicitly requested. Keep coach authoring's cap unchanged.

### 3.4 Readable feedback and accessibility

Do not confuse on-video overlays with the readable Notes list:

| Mode | Default readable Notes content |
|---|---|
| Text + audio | Chronological written notes and voice transcripts, with current-row highlighting. |
| Written notes only | Written rows only; no voice transcripts or voice audio. |
| Audio only | Timecoded voice-note navigation and processing status, without commentary body text. |
| Off | `Commentary is off.`; no default commentary rows. |

Add a collapsed **Read all feedback** disclosure outside the video, available
for the selected authorized review. Opening it intentionally reveals the full,
chronological, timecoded text list without enabling audio, changing modes, or
changing speech captions. This preserves a way to read voice feedback silently
without introducing a fifth playback mode.

The disclosure starts closed and closes on mode, reviewer, speech, or account
change. Thus selecting Written, Audio only, or Off never leaves voice text open
from the previous mode. Avoid duplicate identical lists and duplicate accessible
names when Text + audio already displays the full list.

Keep overlays `aria-hidden`, keyboard focus stable, and screen-reader text in
the deliberate readable surface. Use native radio semantics or a tested radio
group primitive with arrow-key navigation, visible focus, and one tab stop.
Preserve `Choose commentary track` for the reviewer group's accessible name and
the distinct Essay picker name unless all dependent tests are deliberately updated.

### 3.5 Empty states, counts, and unread

- Use `No written notes from this reviewer.` and `No audio commentary from this
  reviewer.` when a mode filters out the available feedback. Do not say the
  reviewer has left nothing when other kinds of feedback exist.
- Keep reviewer badges based on total published notes, labeled as a total;
  do not replace them with draft-inclusive counts or pretend they equal the
  currently filtered list length.
- Separate a failed annotations request from a genuine empty result. No stale
  previous-reviewer feedback may appear under a newly selected name.
- Loading data with Off selected never automatically marks feedback seen.
- Written marks a review seen only when eligible written feedback is presented;
  Audio only when audio actually starts; Text + audio when readable feedback
  is presented or audio starts. A deliberate Read all feedback action can mark
  it seen in any mode, including Off.
- Retain the existing coarse review-level publication timestamp. Reading one
  eligible portion can mark that review's current publication seen; tracking
  unseen written and audio notes separately is additional scope.
- Do not mark on hydration, failed fetch, empty filtering, a loading hint,
  hidden/inactive Notes content, or crossfade suppression. Re-check the active
  review/publication before committing the seen marker.
- Pass actual Notes-tab/disclosure visibility from the tab owner. A retained
  `keepMounted` panel is not evidence that the viewer can see its rows. The
  deliberate reading surface in fullscreen follows the same visibility rule.

## 4. Separate source data from playback projections

Keep one canonical set of authorized, speaker-visible annotations for the selected
review. Derive explicit collections/IDs for each consumer, rather than filtering
that source away globally:

| Consumer | Planned input |
|---|---|
| Timed written engine | Written rows in `all`/`written`; empty otherwise. |
| Audio scheduler | Ready voice rows when preferences are ready and mode is `all`/`voice`; disabled otherwise. |
| OverlayStack | Timed written rows/IDs plus the active voice row/ID only in `all`, respecting the reserved slot. Empty in `voice`/`off`. |
| VoiceNoteMarkers | Voice rows in `all`/`voice`, retaining current processing/failed marker treatment. Empty otherwise. |
| Native Commentary subtitles | Timed written rows in `all`/`written`; empty in `voice`/`off`. |
| Default readable list | The mode-specific rows defined in section 3.4. |
| Read all feedback | Full authorized selected-review rows, only when intentionally expanded. |
| Keyboard previous/next | The mode-specific set from the matrix, independent of the disclosure. |

Keep overlay-active and readable-list-active IDs separate: hiding a transcript
overlay in Audio only must not discard its audio or its timecoded navigation.
Remove excluded overlay sources immediately on the next render so deferred fade
ghosts cannot leave text behind after Audio only or Off is selected. Retain the
existing reviewer crossfade, but never show an outgoing row under a new name.

Do not pass the duration of a voice recording into the speech's timed-text engine.
The speech pauses during that recording; active voice text follows the actual
audio session rather than the speech's frozen clock.

## 5. Audio lifecycle and switching rules

Replace the scheduler's literal `mode === 'play'` dependency with an explicit
audio-enabled capability. Both `all` and `voice` enable the same scheduler.

1. **All ↔ Voice:** keep current audio, position, loading request, queued notes,
   and manual paused state. Only the text presentation changes.
2. **All/Voice → Written/Off:** immediately cancel active or loading audio,
   clear hints and queued work, and invalidate its asynchronous generation.
3. **Resume ownership:** resume the speech only if this active interruption
   paused a previously playing speech and no manual pause suppressed resumption.
   Clear that ownership on finish; an idle mode change must never start a video.
4. **Stale work:** late signed-URL resolution/rejection, audio play resolution/
   rejection, audio events, safety timers, and cancellation from an older
   generation must not affect a newer mode, reviewer, account, or speech.
5. **New context:** reviewer change/revocation, speech/account change, access
   denial, and unmount cancel old work. Do not resume a detached or different
   speech's video during cleanup.
6. **Re-enabling audio:** begin with future normal timestamp crossings. Do not
   replay every note that was passed in Written/Off. Backward seeking still
   rearms subsequent normal crossings, including the existing zero-time behavior.
7. Keep Skip/Escape and playback-error recovery. Never leave the speech stranded
   because a recording URL, play request, or audio element failed.
8. **Changing source rows:** reconcile queued/current note IDs and voice asset
   IDs against each successful authorized annotations response. Drop removed,
   unpublished, erased, replaced, or no-longer-ready queued audio. If the current
   note/asset becomes invalid, cancel its generation and remaining crossing queue
   and apply resume ownership. A transient polling failure is not proof of
   deletion; an access-denied response still suppresses all feedback.
9. **Live text:** resolve an active voice transcript from the current canonical
   row, rather than a captured queue snapshot. Pending-to-ready text or a body
   correction updates its display without restarting the same valid recording.
10. **Pause budget:** freeze the remaining duration-plus-margin safety budget
    while commentary is manually paused, and resume that remaining budget when
    audio resumes. A long deliberate pause must not exhaust a wall-clock deadline.
    All ↔ Voice preserves this budget and the existing manual-resume suppression.
11. **Bound loading:** give signed-URL loading plus audio start a shared
    15-second timeout. On timeout, invalidate that generation, clear its queue,
    show a safe playback failure, and apply resume ownership; no automatic retry
    loop. The recording-duration timer starts only after playback begins.
12. **Seeking:** scrubbing, a timecode click, or previous/next-note navigation
    cancels the old current/loading/paused voice and its queue without calling
    `video.play()` as a side effect. Preserve the video's native seek/play state,
    rebase the crossing window, and ignore stale work. Navigation is **Seek to**,
    not **Play recording**; retain the no-scrub-into-note contract. Seeking
    exactly to a marker does not itself play it: start normal playback from
    before that marker. The zero-time exception is explicit: reset to `0` and
    press Play; a note at `0` is included on the first normal forward tick,
    without requiring playback before zero. Test forward/backward/exact/zero
    seeks and source-refresh seeks. Direct click-to-play voice notes would be
    additional scope.

Source-row removal is observed through the existing annotation refresh/polling
cadence. Do not promise instantaneous remote revocation or retraction of bytes
already delivered to the browser.

Two current implementation risks need regression coverage while changing this
code: resume ownership survives `finish()` today, and the URL/play success paths
check generation while the catch path can still recover a stale request. Fix
these within the playback lifecycle work, rather than adding unrelated features.

## 6. Preference API and compatibility

### 6.1 Use a separate canonical namespace

Adding `all/written/voice/off` directly to the old response would break stale
browser bundles that only understand `play/text/none`. Prefer an additive API:

- `GET /api/me/preferences/commentary-playback/{speech}`
- `PATCH /api/me/preferences/commentary-playback/{speech}`
- PATCH body: `{ "mode": "all|written|voice|off" }` (one actual enum value).
- Response envelope: `commentary_playback`, containing `speech_id`, canonical
  `mode`, and `source` (`saved`, `legacy`, `default`, or `invalid`). For `legacy`,
  include the validated `legacy_mode` to explain the `text` transition.
- Store explicit choices in `users.preferences.commentary_playback[speechId]`.
- Retain the old endpoint, validation, response, `voice_commentary` JSON key,
  and `voice-commentary:*` localStorage unchanged for old bundles.

Use the current authentication and verification middleware and `view` policy.
Only the authenticated user's preference is read/written. Both old and new
writers must lock and re-read the same user row before merging their separate
namespaces, preserving unrelated JSON entries. No schema migration, transcript
rewrite, audio conversion, or bulk preference rewrite is required.

### 6.2 Read precedence and legacy mapping

New GET is side-effect free. Prefer an existing valid canonical entry, otherwise
derive from a valid server-side legacy entry, otherwise use `all` for a genuinely
new preference. A present but malformed/unsupported entry returns safe `off`
with `source: invalid`; do not accidentally enable audio or revive legacy data.

| Legacy value | Canonical result | Consequence |
|---|---|---|
| `play` | `all` | Combined experience remains available. |
| `none` | `written` | Existing written-only behavior remains. |
| `text` | `written` | Preserves silence, but voice transcripts move behind Read all feedback. No exact four-mode equivalent exists. |

Explain the last change with brief helper text when deriving from legacy `text`.
Do not silently map it to an audio-playing mode. Do not delete the legacy value.
An explicit new PATCH creates the canonical choice; subsequent old-tab changes
remain legacy and do not override it.

`experienced` remains a legacy field, not part of the new contract. Remove the
new UI's automatic first-play → next-visit Text behavior. Successful explicit
choices remain stable across later visits.

### 6.3 Client identity, loading, ordering, and failure

- Use a versioned, per-user/per-speech cache key, for example
  `commentary-playback:v1:{userId}:{speechId}`. Treat it as confirmed cache,
  not a replacement for successful remote hydration.
- Key new RTK Query arguments/tags by both user and speech, even though the URL
  only contains speech. Prevent prior-account cached preferences from matching.
- Initial hydration keeps timed feedback/audio suppressed until a successful
  current-user/current-speech GET. The original video remains usable. Show
  Loading, or a clear failure with Retry; do not briefly default to audio before
  a saved Off/Written response arrives.
- Run the new preference/data subscriptions only for the enabled owner watch
  context with a valid speech and known authenticated user. Calling the parent
  hook unconditionally must not activate these queries for the coach composer.
- Successful initial remote hydration is authoritative, including a server
  default. Legacy local-only writes are not silently promoted over server state.
  Preserve old local keys, but document that unacknowledged legacy local-only
  choices are not guaranteed to migrate.
- Allow immediate in-session explicit selection after hydration. A later GET
  initiated before that choice, or while its save/unsaved failure is unresolved,
  cannot override it or reset its save status. After the latest PATCH succeeds
  with no queued intent, commit that acknowledgement into the same identity's
  confirmed coordinator/query state before clearing the temporary override;
  stale `query.data` must never become the displayed fallback between save and
  refetch. Permanently reject GET responses stamped with an older intent
  generation, even after the save finishes. A newly initiated clean focus/refetch
  GET can then become authoritative. Do not retain `explicitMode` forever and
  defeat cross-tab convergence.
- Use one in-flight preference PATCH per user/speech within a tab, coalescing
  queued changes to the latest desired choice. The coordinator survives route
  remounts so a second hook cannot race an earlier request for the same key.
  A database row lock alone does not enforce click order.
- When an earlier PATCH settles, send the newest unsent intent, including after
  a transient failure of the superseded choice. Only failure of the final desired
  choice produces its unsaved/Retry state. Auth/access failure cancels queued work.
- Capture identity and choice generation in callbacks. Older responses cannot
  mutate another account/speech or clear a newer pending/error state. Cache only
  acknowledged settings; update displayed selection only for the latest intent.
- A transient save failure keeps the chosen mode for the current session and
  shows `Could not save setting.` with Retry. It does not overwrite confirmed
  cache or claim cross-device persistence. Retry saves the latest desired mode.
- Cancel unsent work and discard the active override/coordinator on auth change;
  prevent an old request's completion from repopulating new-account caches.
- `401` follows authentication handling. `403/404/410` stops audio and suppresses
  cached feedback; a transient initial preference failure stays suppressed.
  Existing feedback-access failures remain real errors, not empty data.
- Across tabs, last committed server write wins. Refetch on focus when no local
  save is pending. Global ordering of human clicks across tabs is not promised.

## 7. Files and ordered implementation work

| Phase | Main files / work | Completion condition |
|---|---|---|
| 1. Contract and pure rules | `web/src/features/annotation/types.ts`; new mode/legacy normalization helpers; update relevant STEP-10 contract documentation | The matrices above become executable rules, with legacy/new types kept separate. |
| 2. Additive preferences | New API controller/tests; `api/routes/api.php`; `web/src/features/annotation/annotationApi.ts`; new preference hook/coordinator; authentication cache cleanup as needed | Both API generations remain usable; identity, hydration, serialization, and failure tests pass. |
| 3. Playback projections | `web/src/hooks/useCommentaryTrack.ts`, `useVoiceInterjections.ts`, `useIosFullscreenSubtitles.ts`, `SpeechWatch.tsx` | Source data, overlays, readable feedback, audio, native cues, markers, and keyboard inputs follow the matrix. |
| 4. Controls and reading | `TrackSelector.tsx`, `Transcript.tsx`, `VoiceNoteMarkers.tsx`, `OverlayStack.tsx`, `components/essay/EssayReviewerPicker.tsx` as necessary | Reviewer-only row, four modes, disclosure, transcript priority, counts, and correct empty states work without changing coach authoring. |
| 5. Fullscreen integration | `VideoPlayer.tsx`, `videojs-adapter.ts`, owner player layout/portal host and playback controls | The player fullscreen root contains owner overlays, markers, accessible controls, and deliberate reading access without remounting media. |
| 6. Integration and validation | Existing voice/captions/browser tests plus new targeted tests and manual script below | Every mode/transition and saved preference behavior is verified at the appropriate level. |
| 7. Deploy and document | API and frontend build/deploy; README/runbook or contract sections actually affected | New UI uses new API; existing clients remain compatible; real-browser checks pass. |

Implement phases sequentially at their dependencies. Independent test/review
tasks may run in parallel. Re-read the current worktree before implementing and
preserve unrelated user changes. Before editing modules served by live Vite/HMR
or deploying the new frontend, preserve any unsaved voice recording by saving or
downloading it. A hot reload/remount can discard an in-memory recording even
without an explicit browser refresh.

## 8. Fullscreen implementation and accessibility limits

### 8.1 Inline and HTML fullscreen must share the same playback state

The current owner overlays and voice markers sit outside the video.js element
that requests HTML fullscreen. Implement an owned portal host inside the public
player root (`player.el()`), and render the owner's presentation surfaces into
that host. Do not depend on video.js private fields or request fullscreen on an
unrelated page element. Confirm the installed library's actual behavior before
choosing the final integration point.

The fullscreen root must contain written/voice-transcript overlays, voice
markers, generic playback status, Pause/Resume/Skip, a compact mode selector,
and deliberate Read all feedback access. Keep speech caption controls available
through the player. A user must be able to turn commentary off or stop a stalled
voice without first leaving fullscreen.

Use one presentation/control owner: do not mount duplicate media engines,
duplicate interactive radiogroups, or two copies of the active reading list.
Below-player controls may be hidden/inert while the fullscreen controls are
active, or the same controls may be portaled. Bind both layouts to the same
reviewer/mode/voice session. Mode and active media state survive entering/exiting
fullscreen; do not recreate the video or Audio element.

Teardown owned portal content before video.js disposes/replaces its target;
verify StrictMode, source refresh, unmount, and route changes. Position feedback
against the displayed video frame in portrait and landscape; remove inline
height-budget constraints appropriately in fullscreen. Keep controls reachable
and avoid blocking the player's normal controls. Menu/disclosure portals must
also stay inside the fullscreen root.

Preserve native fullscreen exit and focus behavior. Escape must not trap the
viewer in fullscreen while attempting to implement Skip; provide the explicit
Skip button inside the root and test the shortcut/exit interaction in browsers.
This integration is for owner playback; do not relocate the coach composer or
change authoring's playback lifecycle.

### 8.2 Native iPhone fullscreen is a documented exception

The existing iPhone native player cannot render the HTML overlay or its HTML
commentary controls. This plan retains its typed-note Commentary subtitle
fallback, clears those cues in Audio only/Off, and leaves speech captions alone.
It does not promise the active voice transcript inside native iPhone fullscreen.
Users can use inline playback and Read all feedback for that text.

This is an explicit proposed scope exception to the desktop/inline matrix,
not proof of device parity. Real iPhone validation is required before claiming
external commentary audio, pause/resume, or simultaneous subtitle behavior works
there. If exact native voice-transcript parity is required, stop and scope that
additional work rather than silently declaring it covered by desktop tests.

The manual text disclosure is required for this plan's four-mode design: without
it, replacing old `text` removes the convenient way to read recorded feedback
silently. Keep the deliberate readable list accessible to screen readers and
usable without timed overlays or audio playback.

## 9. Verification and acceptance criteria

### 9.1 Targeted automated coverage

- Backend preference tests: default/legacy GET with no writes; all mappings;
  invalid entries; canonical precedence; a legacy PATCH after a canonical save;
  all four valid modes; invalid payloads; auth, verification, and view access;
  another user's isolation; preserving legacy/unrelated JSON and concurrent
  namespace updates. Keep legacy preference tests passing unchanged.
- Preference hook/coordinator tests: delayed GET; server precedence; no initial
  audio flash; failed hydration; acknowledged cache; transient save failure and
  Retry; serialized/coalesced rapid changes; remount while saving; speech/account
  changes; stale responses; no mode snapback after a PATCH acknowledgement while
  stale GET data remains/resolves; unavailable storage; clean refetch on focus.
- Mode projection tests: overlays, readable rows, audio enablement, markers,
  keyboard sets, native cues, no-reviewer/filtered empty states, total counts,
  pending/failed audio/transcripts, and preserved erased-audio text.
- Playback tests: every relevant transition while loading/playing/paused; All ↔
  Voice continuity; Written/Off cancellation; manual pause preservation; stale
  URL and play success/failure; old audio events and timers; idle mode changes;
  re-enable after missed notes; reviewer revocation; route/account cleanup;
  deleted/unpublished rows, asset erasure/replacement, live transcript updates,
  long paused safety budgets, loading timeout, and all seek paths.
- UI/integration tests: three overlapping written notes plus an active voice
  transcript; immediate exclusion of overlay ghosts; disclosure resets and never
  enables audio; Off retains Essay/Report selection; hidden Notes content does
  not clear unread; deliberate reading and actual audio can clear it.
- Browser tests: matrix during real video playback; saved mode after a fresh
  context; legacy values; cross-tab compatibility boundaries; independent speech
  captions; real fullscreen entry/exit and reachable mode/voice/read controls;
  portrait/landscape layout; keyboard/focus behavior; frontend/browser console checks. Synthetic
  recorder seams alone do not prove real microphone capture or model inference.

Existing starting points: `TrackSelector.test.tsx`,
`useVoiceInterjections.test.tsx`, `useVoiceCommentaryPreference.test.tsx`,
`SpeechWatch.test.tsx`, `EssayReviewerPicker.test.tsx`,
`api/tests/Feature/Annotation/VoiceAnnotationHttpTest.php`,
`web/tests/voice-annotations.spec.ts`, `web/tests/voice-annotations.cross-browser.spec.ts`,
and `web/tests/captions.spec.ts`. Add focused projection/coordinator tests rather
than relying entirely on large watch-page mocks.

Before deployment, run backend contract tests in explicitly isolated SQLite/test
storage, frontend tests, TypeScript, lint/Pint for changed files, and production
builds. Separately verify concurrent legacy/canonical namespace writes using two
connections to an isolated PostgreSQL test database/container. SQLite cannot
prove PostgreSQL `SELECT FOR UPDATE` serialization. Assert both preference
entries and unrelated JSON survive; identify the isolated target before creating
test data. If that check cannot run, record concurrency as unverified rather
than claiming SQLite established it. Never run DB-refresh or concurrent-write
tests against the user's development database.

### 9.2 Manual acceptance walkthrough

Use a dedicated test speech with multiple written notes, playable voice notes,
overlap, and ready speech captions. Use isolated speaker/coach test sessions.
Do not reseed or mutate the user's existing working speeches as a test shortcut.

1. Select Cora and Text + audio. Confirm written overlays, pause for voice,
   visible current transcript, and normal resumption. Confirm the transcript
   still receives an overlay slot during overlapping written notes.
2. Switch to Audio only mid-recording: audio continues, commentary text vanishes,
   and voice markers/controls remain. Switching back restores the current text.
3. Switch to Written notes only during playback/loading: voice stops, its text
   disappears, queued voices do not start, and only written notes remain.
4. Select Off: no timed feedback, markers, or automatic voice sound. The original
   speech sound and its independently enabled captions continue. Cora remains
   selected, and her Essay/Report is still available.
5. Deliberately open Read all feedback: text is readable without starting audio.
   Switch modes/reviewer/speech and verify it closes without stale content.
6. Pause manually, switch modes, and verify the speech does not start itself.
   Seek backward and play normally to confirm subsequent voice crossings rearm.
7. Rapidly choose several modes, reload, and open another signed-in browser
   context: the final successfully saved choice wins. Simulate a failed save
   and verify the visible unsaved state and latest-choice Retry.
8. Load a saved Off choice with a delayed preference response. Verify no flash
   of commentary or audio before it resolves. Repeat with access failure.
9. Confirm Off does not clear unread just by loading data, and filtered empty
   copy accurately describes what is missing. Confirm keyboard navigation
   follows the selected mode and does not start hidden voice playback.
10. Verify inline/HTML fullscreen in supported browsers, then run the explicit
    iPhone native-fullscreen checks and record the known text limitation.
11. While loading/playing a voice, remove or erase its test note from the isolated
    coach session. Verify cancellation on the next authorized update; queued
    removed notes never start. Update transcript text and verify the active
    valid recording continues while its displayed text refreshes.
12. Leave a voice paused longer than its original safety deadline, then resume.
    It must continue. Simulate a stalled URL/audio start and verify bounded
    recovery, reachable Skip, and no late playback after timeout.
13. Seek forward/backward while voice audio is loading, playing, and paused.
    Old audio/queue stops without starting the speech. Verify exact-marker and
    zero-time behavior matches the documented Seek-only navigation.

### 9.3 Validation boundaries

The prior investigation ran four existing frontend test files: 43 tests passed.
Those tests validate the current implementation, not the proposed design; they
also emit test-environment video.js/Base UI warnings. No new-mode implementation,
new API, migration behavior, browser flow, or physical-device result is claimed
by that baseline. Revalidate against the checkout used for implementation.

## 10. Deployment, rollback, and consequences

- Deploy the additive API before or alongside the new frontend. If the new
  endpoint is unavailable, the new UI suppresses feedback with Retry rather than
  guessing a legacy mode. Old clients continue using the old API/JSON namespace.
- Rebuild the API and frontend serving the watch page. Playback preference
  changes do not require media reprocessing or worker-image rebuilds.
- For this Compose deployment, wait for API health after app recreation, validate
  and reload nginx if needed to refresh its static `app:9000` upstream, and check
  `/up` through the browser-facing HTTPS host. Preserve any unsaved coach
  recording before frontend edits/deployment; keeping a tab open alone is not
  protection against a frontend hot reload.
- Rolling the frontend back restores the old UI and its separately retained old
  preferences; new canonical choices are not losslessly representable there.
  In particular, new Off/Audio-only choices are not promised to apply to an old
  bundle. Communicate this boundary; keep new data for roll-forward.
- Written-only no longer automatically shows voice transcripts. Read all feedback
  is the intentional replacement, and legacy `text` gets explanatory copy.
- Off retains the reviewer, simplifying re-enable behavior and preserving Essay.
  Removing the old chip is a visible behavior change, so update walkthroughs and
  browser selectors accordingly.
- All feedback remains stored and processed; a presentation preference is not a
  retention, deletion, sharing, or access change.

## 11. Estimate and scope boundaries

The earlier discussion estimated one to two focused days for the core controls
and filtering. Allow approximately **two to four focused development days** for
this reviewed scope, including the additive API, ordering/cancellation coverage,
explicit fullscreen integration, isolated PostgreSQL verification, and desktop
browser checks. This is a planning estimate, not an execution promise. Physical
iPhone testing depends on device access; new native-fullscreen transcript parity
would be additional scope.

Exclude new transcription providers/models, recording/upload changes, precise
per-note unread tracking, historical voice-origin metadata, and a redesign of
the coach authoring surface. Address only lifecycle faults encountered in the
mode-switching paths described above.

## 12. Adversarial review record

An independent adversarial agent challenged the draft against the current
source. The first pass found six substantive gaps, all addressed in this revision:

| Finding | Resolution |
|---|---|
| HTML fullscreen excludes sibling overlays/markers and below-player controls. | Added an explicit fullscreen integration phase and owned portal/control contract in section 8.1. |
| Queued/current voice snapshots outlive deleted/erased/replaced source rows, and transcript text can stay stale. | Added canonical note/asset reconciliation and live text lookup in section 5. |
| A long commentary pause exhausts the existing wall-clock safety deadline. | Defined frozen remaining playback budget and long-pause acceptance tests. |
| Seek behavior during an active voice and exact-marker navigation were unspecified. | Defined cancellation without forced autoplay and an explicit Seek-only contract. |
| Permanent local override would conflict with authoritative clean focus refetches. | Added bounded intent generations, acknowledgement rules, and clean-refetch precedence. |
| SQLite cannot prove PostgreSQL row-lock concurrency semantics. | Added a separate isolated PostgreSQL two-connection check and an honest unverified fallback. |

Additional clarification: Notes-tab visibility must be passed explicitly despite
`keepMounted`, and loading/start recovery now has a bounded timeout. The estimate
has been increased to reflect the discovered fullscreen/compatibility scope.
The final reread also required committing a preference acknowledgement before
dropping the local override, rejecting old GET generations after a save, and
stating the zero-time playback exception. These clarifications are included in
sections 5, 6.3, and their regression criteria.

Final adversarial disposition: **no remaining design blockers found** after the
initial challenge, revised-plan review, and final clarification check. The
reviewer confirmed all six findings and the two final precision fixes were
addressed. This establishes the reviewed plan's internal consistency, not
implementation correctness or authorization to begin coding.

Residual limitations are explicit: native iPhone voice-transcript parity,
cross-tab human-click ordering, instant remote audio retraction, unacknowledged
legacy local-only settings, and per-type unread/provenance tracking are not
promised by this plan.
Do not describe an adversarial review as proof that no implementation error
is possible; implementation and browser/device validation remain necessary.

## 13. Implementation progress and evidence

### 2026-10-19 — implementation started

- Baseline worktree: only this previously untracked plan; no application changes.
- Browser preflight: the open speech watch page has no unsaved voice preview or
  Save voice note button, so frontend hot reload will not discard a recording.
- Phase 1/2 underway: canonical mode rules, separate preference endpoint,
  compatibility tests, and the ordered client preference coordinator.
- Remaining: playback lifecycle/projections, controls/disclosure, fullscreen,
  integration tests, isolated PostgreSQL check, deployment and acceptance audit.
- No completion or browser/device parity is claimed by this initial entry.

### 2026-10-19 — preferences and playback lifecycle checkpoint

- Scope remains all seven phases. Phases 1/2 are the dependency order, not a
  limit on the authorized work.
- Added executable four-mode projections/types and amended the STEP-10 contract.
- Added the separate canonical preference resolver/controller/routes with
  legacy compatibility and row-locked fresh merges. Existing endpoints remain.
- Added an identity/speech coordinator, owner-gated hook, scoped query keys,
  confirmed-only cache, serialized/coalesced PATCHes, stale GET/ack guards,
  retryable session choices, focus refresh, and authentication cleanup.
- Refactored audio into a controller behind the hook's audio-enabled capability.
  It owns cancellation generations, pause ownership, source reconciliation,
  live transcript rows, shared 15-second startup timeout, frozen pause budget,
  seek cancellation, and Escape/Skip. Context cleanup does not start old video.
- The visible watch UI still uses the legacy selection/projection pending the
  phase 3/4 integration. The new preference hook is not yet wired into that UI.
  No deployment has occurred.
- Targeted frontend run: **52 passed** across mode rules, coordinator, preference
  hook transport, and audio lifecycle tests. This includes delayed URL failures,
  rapid selections, remount serialization, manual pause, seek-to-zero, and asset
  replacement. Full frontend regression run: **81 files / 495 tests passed**.
  Existing jsdom video.js media/CSS and Base UI button warnings remain; these
  tests do not prove real media or fullscreen behavior.
- Backend SQLite isolation: **58 tests / 259 assertions passed** for canonical
  preferences plus the existing voice-note HTTP suite. The explicit environment
  used `APP_ENV=testing DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL=` and
  array cache/session with synchronous queue. No development database was reset.
- Frontend typecheck passed after the fixture correction; targeted ESLint passed.
  Pint passed after correcting import ordering in `routes/api.php`. Targeted
  PHPStan passed with `--debug` (serial analysis); the ordinary parallel command
  exited 1 without a diagnostic, so its result is not counted as a pass.
- Pending: production-store auth tests, PostgreSQL two-connection evidence,
  owner projection/reading/controls integration, fullscreen, browser checks,
  final checks and deployment. Native iPhone validation remains unperformed.

### 2026-10-19 — watch integration and fullscreen checkpoint

- Wired owner watch playback to the new preferences. Removed the legacy mode
  control and first-experience save from the owner flow; the old API/hook remain
  for compatibility. Reviewer defaults are scoped to user/speech, revocation
  suppresses rows, and counts use total published notes.
- Separate projections now drive overlays, native written cues, readable rows,
  markers, navigation, and voice scheduling. All reserves a transcript slot;
  Audio only/Off remove excluded overlay sources immediately. Pending and failed
  transcripts retain their safe display states.
- Added native radio controls and deliberate Read all feedback with keyed
  disclosure resets. The actual Notes tab visibility gates unread marking;
  actual audio start and deliberate reading can mark the selected publication.
- Added a React-owned portal host inside public `player.el()`. Owner overlays,
  markers, fullscreen mode/reading controls and always-reachable active voice
  controls share the existing watch lifecycle. The host is detached before
  video.js disposal. Inline sizing does not constrain the fullscreen frame.
- Verified installed video.js requests fullscreen on its player element
  (`dist/video.es.js`, `requestFullscreenHelper_`). Added source-refresh disposal
  guard. Native iPhone cues clear when disabled and on teardown; device parity
  still requires real-device evidence.
- Frontend checkpoint: **84 files / 511 tests passed**, production build passed,
  changed-file ESLint passed. Four additional authentication middleware tests
  passed for account change, logout, auth reset and session expiry while the
  watch route is unmounted. Final combined rerun remains pending.
- Route tests now mock the media component at its UI boundary. Separate player
  tests cover portal/StrictMode/source replacement; this avoids jsdom's
  unsupported-media timer error rather than treating it as real media evidence.
- PostgreSQL proof passed in both write orders using the actual controllers and
  two separate PDO connections: canonical then legacy, and legacy then canonical.
  The second connection was observed waiting on `Lock` before the first commit;
  both namespaces, another speech and unrelated JSON survived.
- Isolated target was newly created as
  `commentary_playback_verify_20261019_1509` on the local PostgreSQL service.
  No development database migration/reset was run. Test DB/evidence retained;
  script: `scripts/verify-commentary-preference-lock.php` (syntax/Pint passed).
  Evidence directory:
  `/var/folders/94/480l7jvs29b4jvkkwvvyv9800000gn/T/commentary_playback_verify_20261019_1509_4039355e`.
- Browser preflight before deployment: speech 8 is open as Cora Coach, with the
  recorder idle and no unsaved voice preview/Save voice note button. Existing
  published notes and recording remain intact. API/frontend deploy and real
  browser acceptance are the next steps; no completion is claimed yet.

### 2026-10-19 — local deployment verified

- `docker compose build app web` passed (API and production SPA images).
- Recreated only `app` and `web` using `up -d --no-deps app web`; workers,
  databases, object storage and existing feedback were preserved. No migration
  was needed for the additive JSON preference API.
- Running API exposes authenticated/verified GET and PATCH canonical preference
  routes. `app` and `web` are healthy; `nginx -t` passed; HTTPS
  `https://api.speechcoach.test/up` returned **200**.
- Rechecked the coach page immediately before deployment: zero unsaved voice
  previews and zero Save voice note buttons.
- Real browser acceptance remains pending. Only the existing Chrome profile is
  connected; the separate in-app browser is unavailable. Any test-account login
  switch must be restored to the existing Cora Coach session afterward.
- No goal completion is claimed: browser mode/media/fullscreen checks, final
  validation, remaining race coverage and requirement-by-requirement audit are
  still required.

### 2026-10-19 — real Chrome acceptance and resumed fullscreen checks

- Speech 8: verified four owner modes, total counts, Written notes only hiding
  voice text, Audio only presenting timecodes/status, Off hiding the default
  list, deliberate Read all feedback and disclosure reset. No annotations or
  original recording were edited. Restored its effective Text + audio choice.
- Real voice playback interrupted the speech. Pausing, switching All → Voice →
  All retained Resume state; the transcript returned only in All. A pause longer
  than the watchdog budget still resumed correctly. Disabling audio after this
  manual pause did not automatically start the speech.
- Created independent acceptance speech **9**, review **4**, voice annotation
  **13**, using `scripts/prepare-commentary-acceptance.php`. It copies video/audio
  to new object keys and adds clearly synthetic captions/feedback. Source speech
  8 timestamps, review count and asset count were checked unchanged. Fixture
  remains available; no cleanup/deletion was performed.
- Speech 9 confirms three visible overlay slots: the current voice transcript
  plus the two newest overlapping written notes. Captions remain a separate
  control. The fixture's caption text is synthetic, not an ASR quality claim.
- After interruption, resumed in a persistent claimed user tab. Chrome's actual
  Fullscreen / Exit Fullscreen controls and a viewport screenshot confirmed
  fullscreen entry. Active voice Pause/Resume/Skip and the expandable mode/list
  controls are inside it, with only one mode control/list rendered. All ↔ Audio
  only retained paused audio and removed/restored transcript overlays.
- Visual QA caught white inherited video.js text and its button reset overriding
  Tailwind. Scoped the presentation host's foreground and rolled back vendor
  button styles inside that host. DOM style checks now show dark overlay text,
  flex readable rows and the intended 8px gap; final visual recheck underway.
- Updated existing voice/caption browser specs to the four-mode contract and
  removed first-experience preference downgrade expectations. These real-stack
  specs are not yet claimed as executed: the isolated E2E harness uses the same
  ports as the running development stack, and must never reseed that stack.
- Additional targeted tests passed: audio/adapter **43**, preference hook **5**,
  canonical API plus voice HTTP **60 tests / 267 assertions**. Final combined
  frontend/typecheck/lint/build, source audit, session restoration and remaining
  acceptance checks are pending. Physical iPhone testing remains unavailable.

### 2026-10-19 — final implementation validation and acceptance audit

All seven implementation phases have landed in the worktree. The following
ledger distinguishes implemented behavior, executed validation, and remaining
environment/device acceptance; it does not claim every browser/device passed.

| Area | Final evidence |
|---|---|
| Four modes and independent projections | Pure rules, owner hook, controls and watch tests; real Chrome matrix on speeches 8/9. Written excludes voice bodies; Audio only exposes status/timecodes; Off suppresses automatic feedback and retains reviewer/Report/Essay access. |
| Reading, overlays, unread | Controls/hook tests cover deliberate disclosure, resets, hidden Notes, filtered empty states and voice-start marking. Real overlapping fixture reserves the third slot for the active voice transcript. |
| Preference API and old clients | Canonical/legacy precedence, malformed data, authorization and namespace preservation passed alongside unchanged voice HTTP tests. GET does not migrate. Two-connection PostgreSQL proof passed in both write orders. |
| Preference ordering and identity | Coordinator, production-store middleware and transport tests cover hydration, delayed reads, failed saves/Retry, coalescing, remount, focus, unavailable storage and logout/account isolation. |
| Audio lifecycle | Tests cover continuity, pause ownership, duration budget, bounded startup, cancellation, stale promises/events/timers, source replacement and seek cases. Chrome confirmed real interruptions, long pause, backward seek/rearm, mode continuity and manual-pause preservation. |
| Live source reconciliation | On dedicated annotation 13 only, a polled body update appeared while the same voice remained paused. Temporarily withdrawing publication cleared its audio controls and readable/overlay text. Original body/publication restored from a saved backup; existing user notes untouched. |
| Fullscreen and layout | Real Chrome entry/exit, reachable active voice controls, one mode/list owner, mode transitions and native keyboard radio navigation passed. Portrait fixture 9 and existing dedicated landscape fixture 9401 were inspected. Landscape frame measured 1363.55 × 766.98 centered at x=347.23 in a 2058 × 767 viewport; feedback x=359.23 remained inside the frame. |
| Speech captions | Fullscreen screenshot showed `Acceptance speech caption.` continuing with commentary Off. Updated real Chromium caption-independence Scenario A passed after native-radio test interaction was corrected. |
| Deployment and preservation | Final web image `cff8835f020b87104f59e7ba204b3f4132c04260c49d8a840b2bd493df31aa65` built/deployed using `up -d --no-deps web`. API and web healthy; `nginx -t` passed; HTTPS app returned 200. Workers/data retained; no schema migration/reseed. |

Final executed checks:

- `web`: **85 files / 520 Vitest tests passed**. `npm run typecheck` passed.
  `npm run lint` exited 0 with **0 errors / 5 existing warnings**; the final
  changed browser-spec/helper ESLint check also passed.
- `api`: canonical preference + existing voice HTTP suites passed again with
  **60 tests / 267 assertions**, explicitly isolated in-memory SQLite/test
  cache/session. Serial PHPStan (`--debug`) passed with 0 errors. Pint passed
  changed API files and the two verification/fixture scripts.
- `npm run build` passed; existing large-bundle warning remains. Browser-only
  selector changes after this build do not change the application bundle.
- Updated browser specs discover/typecheck successfully, including a new
  fullscreen/pause-continuity scenario. Discovery is not execution evidence.
- Real Chromium caption Scenario A passed (**1 test / 4.3s**) with existing
  authenticated test states and `--no-deps`; no fixture reset was invoked.
  Earlier run failed because a native radio's label intercepted an input click;
  tests now use its actual Space-key interaction. Auth/warmup had passed then.
- Automatic approval review initially rejected the rerun over a perceived setup
  reseed. Source inspection established no seed/shell calls in auth/warmup and
  no reset/shell call in Scenario A. The narrower no-setup rerun was approved and
  passed. No rejected action was executed.
- `git diff --check` passed. An unrelated `PLAN-LANDING-PAGE.md` appeared during
  this resumed work and was left untouched.

Remaining acceptance limits:

- The **full mutating voice/caption E2E suite has not been executed** for this
  change. Its dedicated stack publishes the same 443/5433/8333 ports as the
  running development stack. Do not run its reset/seed scenarios against the
  development database or stop that stack as an unrequested shortcut. Run it
  on an isolated host/CI using the existing E2E harness. New fullscreen Scenario
  H is compiled/discovered and manually exercised, not yet an executed CI pass.
- Physical iPhone/native fullscreen remains untested. The explicit section 8.2
  typed-note fallback/voice-transcript limitation still applies; desktop or
  emulated tests do not establish device audio/subtitle parity.
- Temporary Vite-proxy navigation stalls produced 502s during verification.
  Host Vite and the Docker-to-Vite route subsequently returned 200, as did the
  deployed HTTPS app. No proxy configuration or global security setting changed.
- Existing Base UI button warnings and extension listener errors were observed;
  they are not new commentary exceptions and were not silently counted as clean
  console evidence. Synthetic fixture captions do not prove Whisper accuracy or
  real microphone capture.

Acceptance fixture 9 and isolated PostgreSQL evidence remain available for
review. Final account/session restoration is recorded in the next entry.

### 2026-10-19 — session restored

- Restored `coach@e2e.test` / Cora Coach through the normal login UI.
- Original speech **8** is open again under Cora Coach. Verified the recorder
  and text composer are idle, no unsaved voice preview is present, and all four
  existing published notes (including its recording and transcript) remain.
- Refreshed the existing dashboard tab. No original user tab was closed.
- No commit was created. Application changes, tests and this evidence ledger
  remain reviewable in the worktree; unrelated landing-page planning is intact.
