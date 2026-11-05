# Plan: coach voice preview (auto-play the coach's own voice notes)

**Status:** **rev 4, final, ready for implementation**, 2026-11-03. Validation 1 checked about 65 claims: 9 corrections and 11 misses folded in. The adversarial review found 0 blockers and 12 findings, all folded in. Validation 2: IMPLEMENTABLE, 0 blockers; 21 rev-3 items verified; 2 major, 3 minor and 5 nit fixes folded in. Not implemented. **Supersedes** the "no reviewer voice playback" fences in `PLAN-REVIEWER-VIDEO-OVERLAY.md` (:19, :98, :118) and `PLAN-COMMENTARY-PLAYBACK.md` (:25-27, :308-310, :399-400, :555-558) for the reviewer's **own** notes only.

## Goal

When a coach plays the video in their own authoring view, their **own** voice notes interject exactly as they do for the speaker. The video pauses at the marker, the note plays, and the video resumes.

Today this happens only in the speaker's view. Verified 2026-11-03 in Chrome on speech 8:
- **As the coach:** the video played straight through the 10.5 s marker, and no audio was created.
- **As the speaker:** the video paused at 10.58 s and the note played.

## Decisions (user, 2026-11-03)

1. **On by default**, with a way to turn it off.
2. **Drafts included:** the coach's unpublished voice notes play too.
3. **Same controls** as the speaker: the "🔊 Commentary ahead" hint, Pause/Resume commentary, Skip commentary, and the error line.

### Decisions taken by this plan (change them before implementation if you disagree)

| # | Decision | Why |
|---|---|---|
| D1 | Only the coach's **own** rows ever play. The composer's list is already scoped to the author's review, so no other reviewer's notes can appear. | Product rule: reviewers never see or hear each other. The audio URL already returns 404 for a peer's note. |
| D2 | Playback is gated by **data, not role**: any ready voice row of the coach's own review plays. Recording stays coach-only (`canRecordVoice`). | A coach demoted to member still owns their notes. This matches the audio-URL endpoint, which has no role check. |
| D3 | Auto-play runs only while the **Notes** tab is active (where its controls are visible). Leaving Notes mid-note stops the note and leaves the video paused. | This is **deliberately stricter than the speaker**, whose engine has no tab gate. It matches the coach's existing overlay-preview gate, keeps the controls visible whenever audio can play, and avoids surprise video playback. |
| D4 | Auto-play is **suspended only while a recorder session is pending**: requesting the mic, recording, an unsaved preview blob, saving, or an uncertain upload. While suspended no notes start, and a playing note stops without resuming the video. **Selecting the Voice note tool does not suspend it.** Instead, **while a note is interjecting, Record is replaced by a short hint** (`recordBlocked`; exact copy in §3), and the recorder's own "Use current time" counts as author intent (D5). | *Changed in rev 3* (review finding 3). Suspending on the tool would make "on by default" effectively off for exactly the coaches who record voice notes, because voice notes can only be made from that tool and those coaches stay on it. There's no race left: a crossing needs a playing video, and Record needs a paused one with no interjection. The rev 2 alternative (suspend on the tool, with an actionable hint) was rejected for that reason. |
| D5 | **Author intent counts as manual pause intent.** The trigger actions are:<ul><li>any capture: C, Alt+C, every "Use current time" button in the new-note Composer, in each saved row's editor and in the recorder;</li><li>deleting the playing note;</li><li>Clear all.</li></ul>After a **capture**, the current note and its queue keep playing. **Deleting a note during an interjection** (any delete counts) or **Clear all** ends the note and drops its queue, which is the existing path. **In every case the video does not auto-resume afterwards**: Skip and toggle-off end the note and leave the video paused. | STEP-10's contract already says manual pause intent suppresses the resume (`STEP-10-FROZEN-CONTRACT.md:443-446`), and the controller already does this after Space or Play (:160) or Pause commentary (:233), via :104. An authoring action is one more source of that intent, so this is not a new exception. Without it, deleting the playing note would resume the video behind the Undo toast (`update` → `finish(true)`). |
| D6 | Turning the toggle **off** mid-note stops the note and **resumes** the video, exactly as the speaker's mode change does today (pinned by `useVoiceInterjections.test.tsx:418-430`). | Parity with the speaker; it reuses tested behavior. |
| D7 | The toggle is a per-user, **device-local** setting (localStorage), default ON. | Synchronous, no endpoint, no collision with the speaker's per-speech server preference. Cross-device sync would need a new `users.preferences` namespace and is out of scope. |
| D8 | **Fullscreen parity**: in fullscreen the coach gets the same floating controls box as the speaker. | Without it, in fullscreen a coach has no Skip or Pause, and Escape exits fullscreen. |
| D9 | **Out of scope:** showing the playing note's transcript in the coach's video overlay. It is cheap (about 3 lines), but it changes the coach overlay cap that `PLAN-COMMENTARY-PLAYBACK.md:109` keeps. | Not requested; listed as a follow-up. |

## What the research established (all verified in code; agents' citations kept)

| Fact | Evidence | Consequence |
|---|---|---|
| The engine (`VoiceInterjectionController`, `useVoiceInterjections`, `crossedNotes`) has **no owner, role or publication logic**. `canonical()` matches only id, `asset_id` and `audio_status === 'ready'`. | `lib/voiceInterjectionController.ts:55-58`; `hooks/useVoiceInterjections.ts`; `lib/crossedNotes.ts` | Reuse it unchanged except for two tiny additions (§1). |
| All owner coupling lives in the caller (`useCommentaryTrack`: `projectCommentary` and its gates). | `hooks/useCommentaryTrack.ts:44,103-113` | **Do not copy** `useCommentaryTrack`, `projectCommentary`, `CommentaryPlaybackControls`, `markRead` or `useIosFullscreenSubtitles`. |
| The composer already has the coach's rows, drafts and published together, polled every 3 s. `voiceRows` is memoized, and RTK structural sharing keeps its identity across unchanged polls. | `AnnotationComposerPanel.tsx:123-126,139,209`; `api/app/Models/Annotation.php:108-112` | No new endpoint or polling. Pass `voiceRows` straight in. |
| Rows carry no published/draft flag. The audio URL serves the author's own draft: 200, pinned by `voice-annotations.spec.ts:159-164`. | `features/annotation/types.ts:26-33`; `VoiceAnnotationController.php:58-62` | "Include drafts" means "play all own rows". No backend change. |
| Setting `audioEnabled=false` runs `finish(true)`, which **resumes** the video. Changing `videoEl` or `resetKey` tears the controller down with `finish(false)`: stop, no resume. A returning video gets a fresh controller seeded at the current time, so passed notes don't replay. | controller :40-41,60-72,104,216-224; tests :334-355 (`resetKey`), :418-430 (`audioEnabled`). **No test yet covers `videoEl` going to null; §4 adds one.** | Suspension (D3/D4) goes through **`videoEl: null`**; the toggle (D6) goes through `audioEnabled`. No new "stop without resume" API is needed. |
| The controller has no `pause` listener. A capture's `videoEl.pause()` on an already engine-paused video is a no-op, so the engine still resumes at note end. | controller :104,111; `hooks/useAnnotationEditor.ts:137-145` | D5 needs one tiny engine method, `suppressResume()` (§1.2). |
| Record only renders while the video is paused, and an engine-paused video counts as paused. | `VoiceRecorder.tsx:27-37,140,239` | D4 no longer suspends on the Voice tool, so Record must be **replaced by a hint while interjecting** (a new `recordBlocked` prop, rendered like the existing VR:242 hint). |
| A just-saved voice note's start is `Math.round(t*1000)/1000`, so it can sit up to 0.5 ms **after** the paused playhead. `crossedNotes`' lower bound is strict, so the next Play would replay it at once. | `lib/annotationTiming.ts:51`; `crossedNotes.ts:26-28` | A tiny tolerance when playback starts from a pause (§1.1). The owner's pinned "Go to time + Play does not replay" (`useVoiceInterjections.test.tsx:581-590`) already wants this. |
| Two audio sources are uncoordinated today: a row's `<audio>` (expanded "Preview audio") and the engine's detached `new Audio()`. | `VoiceAnnotationRow.tsx:67-72,113`; controller :140 | Pass `AnnotationList active={authoringActive && !interjecting}`; rows already pause and unmount when `active` goes false (`VoiceAnnotationRow.test.tsx:201-216`). |
| `VoicePlaybackControls` is reusable as-is: an error `role="alert"`, a hint `role="status"`, and a box with a status, Pause/Resume and Skip. It lives under `components/review/`, while imports run review → annotation. | `CommentaryPlaybackControls.tsx:83-96`; `OwnerVideoTools.tsx:2` | Move it to `components/annotation/` (owner imports updated) so the composer can use it without a reverse import. |
| The owner's fullscreen box is inline in `SpeechWatch.tsx:737-745`, and its Escape→skip and `stopPropagation` handler is already written twice (:739-742, :748-751). The reviewer presentation is just the preview frame (:756-761). | `SpeechWatch.tsx` | Extract one `FullscreenVoiceControls` component (DRY), used by the owner and by the coach (D8). |
| `useAutoPausePreference` is a per-user localStorage boolean with **no production caller** (only a stale mock at `AnnotationComposerPanel.test.tsx:36`), default false. | `hooks/useAutoPausePreference.ts` | Generalize it into the toggle's store with default true (D7) instead of writing a new hook. |
| Docs fence this feature: STEP-10's frozen contract must be amended (with its verification plan) **before** code. | `STEP-10-FROZEN-CONTRACT.md:5-8` | Step 0 below. |

## Step 0: documentation first (required by the frozen contract)

1. **Amend `STEP-10-FROZEN-CONTRACT.md`** with an "Amendment 2026-11-03: author voice preview" section stating:
   - the author's own voice notes, drafts included, interject in the authoring view with the same state machine;
   - the suspension rules D3/D4, and that Record is blocked during an interjection;
   - the author-intent rule D5, stated as an instance of the contract's existing manual-pause intent (§7, :443-446), not a new exception: after a capture, queued notes still play with the video paused; a delete or Clear all ends the note and its queue, with the video paused;
   - an edit to the contract's "Skip resumes immediately" (:443): "…unless manual-pause or author intent was recorded". That matches what the controller already does (:104, :227).
   - the toggle (D6/D7), default on;
   - that peers' notes never play (D1).
2. **Add scenario "I — author preview interjection" to `STEP-10-VERIFICATION-PLAN.md`**, mirroring Scenario C. The verification plan currently lists A–F (:213-255), while `voice-annotations.spec.ts` already has G and H; use "I" in both and note the gap.
3. **Add a one-line "Superseded for the reviewer's own voice notes by PLAN-COACH-VOICE-PREVIEW.md"** at each fence in `PLAN-REVIEWER-VIDEO-OVERLAY.md` and `PLAN-COMMENTARY-PLAYBACK.md`. Don't rewrite history.

## §1 Engine: two tiny, additive changes (owner behavior unchanged)

1. **Playhead tolerance on play.** In `VoiceInterjectionController.onPlay` (no active note), set `previousTime = video.currentTime > 0 ? video.currentTime + PLAYHEAD_TOLERANCE_SECONDS : video.currentTime` (`0.001`, named next to `VOICE_NOTE_SEEK_EPSILON_SECONDS` in `crossedNotes.ts`). This applies only to play-from-pause; normal ticks are untouched.
   - A note at or within 1 ms after the paused playhead does not fire on the next Play.
   - **Only when `currentTime > 0`** (validation fix). At 0 the raised value would trip `crossedNotes`' `nowTime <= prevTime` guard on a first tick in (0, 0.001]. `onTime` would then set `started = true`, and a 0.000 note would be lost.
   - Why it is needed: the recorder saves `Math.round(t*1000)/1000` (`annotationTiming.ts:51`, used by `VoiceRecorder.tsx:58,89,179`). A start rounded **up** sits ahead of the playhead and would replay on Play; one rounded down sits behind and never replays. The existing "Go to time + Play" test (:581-590) passes either way, so it does not pin the sub-ms case.
   - Tests:
     - a just-saved note at playhead + 0.0004 does not replay on Play;
     - a note 0.002 s ahead still fires;
     - the existing 23 + 2 hook tests and the 9 `crossedNotes` cases pass unchanged.
2. **`suppressResume()`**: an arrow-property method, a no-op unless `this.active || this.queue.length`. It sets `resumeSuppressed = true`, reusing the existing "manual pause cancels auto-resume" field.
   - Validated: the flag is reset only inside `finish` (:106) and at a new crossing (:195), which can't happen while a note is active. So every ending path skips the resume: queue end, `onended`, watchdog/`fail`, `skip` and toggle-off.
   - The hook returns it alongside `skip`/`pauseCommentary`/`resumeCommentary`, and its no-op fallback must cover it too.
   - **Type ripple (`tsc -b`):** the hook's return type gains a member, so every typed literal of `ReturnType<typeof useVoiceInterjections>` must add `suppressResume: vi.fn()`. One is known, `TrackSelector.test.tsx:25`; grep for others. Vitest would pass while `tsc -b`, which CI and the e2e image build run, would fail.
   - Tests:
     - after `suppressResume()` during loading or playing, the note ends and the video stays paused;
     - **notes queued from the same crossing still play after it**, and the video stays paused at the end;
     - with no active note it changes nothing.

No other engine changes. In particular there is no new state, no fork, and no "stop without resume" API: suspension uses the existing teardown path.

## §2 Shared UI and preference (DRY extractions)

1. **Move `VoicePlaybackControls`** from `components/review/CommentaryPlaybackControls.tsx` to a new `components/annotation/VoicePlaybackControls.tsx`, unchanged. Its users are `SpeechWatch.tsx:18` (import) and `CommentaryPlaybackControls.tsx:59` (internal use, which now imports it). No test mocks either.
2. **Add `FullscreenVoiceControls({ playback })`** in the same file. It is the extracted owner box from `SpeechWatch.tsx:737-745`:
   - the same classes;
   - `onClick`/`onKeyDown` with `stopPropagation` and Escape→`playback.skip()`;
   - it renders only when `current || hint || error`.

   The owner's box is replaced by it, and the identical Escape handler on the owner's "Commentary controls" `<details>` (:748-751) uses the same shared key handler, so there is one copy.
   - **That handler lives in a `.ts` module, e.g. `lib/voiceControlsKeys.ts`**, never exported from the `.tsx` file. `react-refresh/only-export-components` is an ESLint **error** in this repo (review verified with a lint probe), so `npx eslint .` in CI would fail. The `.tsx` file exports components only.
3. **Generalize `useAutoPausePreference`** into `useLocalBooleanPreference({ key, userId, defaultValue })`, a rename of the file plus a `defaultValue` parameter:
   - it reads `'true'`/`'false'` and falls back to `defaultValue`, keeping the existing try/catch and the "adjust during render" re-key logic;
   - **with no `userId`** it returns `defaultValue` and skips the write (today's hook returns false and skips it, :6, :47);
   - the dead auto-pause export is removed (the stale mock in `AnnotationComposerPanel.test.tsx:36` is removed by Agent C, who owns that file);
   - **the stored key is `${key}:${userId}`**: the hook adds the colon, and callers pass the prefix without one. So `key: 'annotation-composer:voice-autoplay'` stores `annotation-composer:voice-autoplay:9003`. A unit test pins the literal `annotation-composer:voice-autoplay:3`, so the e2e init scripts can't silently miss.

## §3 Composer wiring (the only real behavior change)

All in `AnnotationComposerPanelInner` (`AnnotationComposerPanel.tsx`), which is already keyed `${userId}:${speechId}:${review.id}` (:85):

```ts
const [autoplayOn, setAutoplayOn] = useLocalBooleanPreference({ key: 'annotation-composer:voice-autoplay', userId, defaultValue: true })
const recorderPending = voiceReports.some((report) => report.pending)
// One expression, reused by the voice gate and the existing preview portal (DRY).
// The portal at ACP :447 becomes `previewTarget && previewAllowed && createPortal(…)`; keep `previewTarget`.
const previewAllowed = previewEnabled && !previewAccessDenied && !previewAccessBlocked
const voicePreviewSuspended = !previewAllowed || recorderPending   // D3, D4
const voicePlayback = useVoiceInterjections({
  speechId,
  videoEl: voicePreviewSuspended ? null : videoEl,             // teardown = stop, no resume
  notes: voiceRows,                                            // memoized (:209)
  audioEnabled: autoplayOn,                                    // D6: off = stop + resume
  resetKey: reviewId,
})
const interjecting = voicePlayback.current !== null
```

- **Gate source:** `previewEnabled`, which is the prop `reviewerTab === 'notes' && !!previewIdentity` at `SpeechWatch.tsx:984`, with `previewIdentity` defined at :486-489.
  - It means: Notes tab active; current speech, source and tech ready; a signed-in non-owner; and an access-granting, non-revoked review. It does not depend on preview-target registration, the captions anchor or fullscreen. That mirrors how the owner engine only gets `ownerVideo`.
  - **Validated:** it is false on every other tab and true whenever the coach can play. `authoringActive` has no source or access proof, and `reviewerScrubReady` would flap on every `/api/me` refetch.
  - One known case fails closed: a non-terminal speech refetch error clears `currentSpeech` while the player stays playable, so auto-play stops silently until the refetch succeeds. Accepted.
- **Two-audio coordination:** `<AnnotationList active={authoringActive && !interjecting} …>`. Nothing else changes in the rows.
- **Record during a note (D4):** pass `recordBlocked={interjecting}` to `VoiceRecorder` (ACP :507-521), a new optional prop that defaults to false.
  - While it is true, **render this text in place of Record**, the way VR:242 renders its "Pause the video to record…" hint: **"To record here, choose “Use current time”, then record once the voice note ends or you skip it."**
  - Why this copy: when the note ends or is skipped, the engine resumes the video it paused (controller :104, :111, :194, :227). Record then unmounts, because VR:239 needs `paused`, and VR:242's hint shows instead. Record is only usable straight after the note if the coach first stated intent with "Use current time" (D5).
  - Text alone stays at 44 px at 375 px; a disabled button plus text grew to 72 px (measured).
  - The recorder's own capture is described in the next bullet.
- **D5 author-intent plumbing.** The callback is named **`onAuthorIntent`** (rev 3: it is broader than a capture), and every call site passes `voicePlayback.suppressResume`. Capture plumbing follows; three `useAnnotationEditor` instances exist (validated). The instances are the Composer's new-note editor (`Composer.tsx:16-21`), each saved text row's `RowEditor` (`AnnotationRow.tsx:117-121`), and the voice row's `TranscriptEditor` (videoEl null, no time fields, so unaffected). Steps:
  1. Add `onAuthorIntent?: () => void` to `UseAnnotationEditorOptions` (`useAnnotationEditor.ts:17-34`) and call it inside `capture()` immediately before `latest.videoEl.pause()` (:143).
  2. Pass `<Composer onAuthorIntent={voicePlayback.suppressResume}>` (ACP :491-504). It flows automatically, because `ComposerProps` derives from the options type (`Composer.tsx:6,16-17`). This covers C/Alt+C (`handleCapture` → `composerSetToPlayhead`) and the Composer's "Use current time" buttons (`AnnotationEditor.tsx:48`).
  3. Add `onAuthorIntent` to `AnnotationListProps` (`AnnotationList.tsx:85-114`), destructure it (:131) and pass it to `<AnnotationRow>` (:426-428). AnnotationRow already spreads editor options into `RowEditor` (:41,65,110,118), so the saved rows' "Use current time" buttons are covered. **Also call it in the list's delete handler**, as `latest.current.onAuthorIntent?.()` (the existing latest-ref, AnnotationList:144-145), after the guard (:313) and before `deleteAnnotation` (:320). That stops deleting a note during an interjection from resuming the video. A voice row's Delete goes through the same handler (VoiceAnnotationRow:124-125 via AnnotationList:417-419).
     - Don't put the destructured prop in `handleDelete`'s fixed `useCallback` deps (:311, :345). It would keep the first controller's `suppressResume`, which becomes a no-op after a suspension flip rebuilds the controller, and `exhaustive-deps` only warns.
  4. Pass `<AnnotationList onAuthorIntent={voicePlayback.suppressResume}>` (ACP :536-557).
  5. Call it in the panel's **`handleClear`** (Clear all) once the guard passes (no pending work, data loaded, writable), so a refused Clear does not record intent. `handleAuthorIntent` is declared later in the component body; that is safe because `handleClear` runs from an event, never during render.
  6. Add `onAuthorIntent` to **`VoiceRecorder`** and call it in its "Use current time" (`VoiceRecorder.tsx:177-182`) before its `pause()`.
  - There is **no** "Set to playhead" button; only stale comments at ACP :227,231 mention one.
- **Controls placement: a reserved slot, so nothing shifts at 640 px and wider** (rev 4, measured). The block sits between the TimelineStrip (:467) and "Add commentary" (:469) and renders **only when `voiceRows.length > 0`**. It is a `flex flex-col gap-2` block:
  - the checkbox row;
  - one slot with `sm:min-h-16`, holding **either** the D4 `<p>` **or** `<VoicePlaybackControls>`.

  They never coexist: suspension hands the hook `videoEl: null`, so it returns an idle snapshot (`useVoiceInterjections.ts:27`). The tallest contents measure 62 px at `sm` and up (44 + 2×8 + 2), so every state is 64 px there. Below `sm` (640 px) the slot is allowed to grow, because reserving the phone maximum (142 px for the paused box at 375 px) would leave a large blank area at rest. Contents:
  - a labelled checkbox **"Auto-play my voice notes"** (not `role="status"`; the composer test pins the status count at rest, `AnnotationComposerPanel.test.tsx:61-62,73`);
  - when suspended by D4 **and the toggle is on**, a plain `<p>`: "Voice notes won't auto-play while a recording is in progress or unsaved.";
  - `<VoicePlaybackControls playback={voicePlayback} />`, rendered **unless the floating copy is shown**, i.e. hidden only when `htmlFullscreen && voiceControlsTarget`. If `htmlFullscreen` but the target is null, the inline controls stay, so a coach never loses Skip and Pause.
  - **Acceptance criterion:** the Composer's `boundingBox().y` is identical in the idle, hint, loading, playing and paused states at **1440 px and 640 px**.
    - At 375 px the block may grow (measured: 64 idle, 92 hint, 118 playing, 170 paused, 140 D4 text) but must not overflow horizontally (`expectNoPageOverflow`).
    - Alternative if phones must not shift either: `min-h-36 sm:min-h-16`, which leaves 144 px blank at rest on phones.
  - **Accepted:** the block first appears when the first voice note is saved (it renders only when `voiceRows.length > 0`), a one-time push of about 116 px for the Composer below it. Reserving it from the start would leave blank space for coaches who never record.
  - Alternative considered and rejected: always-floating controls over the video. That would shift nothing, but it covers the video's bottom-left and scrolls away with the player.
- **D8 fullscreen:** add **optional** props `htmlFullscreen?: boolean` (default `false`, from `SpeechWatch.tsx:267`) and **`voiceControlsTarget?: HTMLElement | null`** (default `null`). They must be optional, because three test files build `AnnotationComposerPanel` props literals and `tsc -b` type-checks `src/`: `AnnotationComposerPanel.test.tsx:58-159`, `AnnotationComposerPreview.test.tsx:64` and `AnnotationWorkspace.test.tsx:94`. When `htmlFullscreen`, portal `<FullscreenVoiceControls playback={voicePlayback} />` into that target, and hide the inline copy (one mounted at a time, like the owner) only while that target exists; with no target, the inline copy stays.
  - In `SpeechWatch`'s reviewer presentation (:756-761), add a sibling target `<div data-testid="reviewer-voice-controls-target" ref={…}/>` outside the overlay frame. Today the branch is a single element, so wrap both in a fragment.
  - Validated: `presentation` is portaled into a host inside `player.el()`, which is the fullscreen element (`VideoPlayer.tsx:112,116,153`), so the target is visible in fullscreen.
  - The host is `pointer-events: none` (`index.css:261-266`); the box keeps the owner's `pointer-events-auto` class.
  - **DRY:** generalize the existing identity-safe `registerPreviewTarget` registration (:490-500) into one small hook (`usePresentationTarget(identity)`) and use it for both targets, so the registration logic is not copied. Keep it module-private in `SpeechWatch.tsx`, or in a `.ts` file if it is exported (react-refresh rule). The hook must keep:
    - per-hook state;
    - a ref callback memoized on identity;
    - the Symbol-token-plus-node check in its cleanup;
    - target derivation that matches the identity.

## §4 Tests

**Backend (test-only; no product change).** Add Pest cases for `GET …/voice-playback-url`:
- the author's own **draft** gets 200;
- the author's own published note gets 200;
- a revoked author gets 404.

Today only Playwright proves the 200s, and the peer 404 already has Pest coverage (`VoiceAnnotationHttpTest.php:245-288`).

**Unit (vitest).**
- **Shared helpers:** extract `FakeAudio`, `playableVideo`, `deferred` and `tick` from `useVoiceInterjections.test.tsx:12-78` into `src/test/voiceAudio.ts`. Use it there and in all the new tests (DRY). `SpeechWatchOwnerTimeline.test.tsx` (:748, :802, :1070) keeps its own stubs for now: it is an owner-regression file, and moving it is a separate cleanup.
- **Engine:** the §1 tests, plus a **`videoEl` → null teardown test** (note playing → `videoEl: null` → audio stopped, request aborted, video not resumed; video back → fresh controller, no replay).
- **`FullscreenVoiceControls`:** renders only with current, hint or error; Escape inside it skips; clicks and keys don't propagate.
- **Type ripple:** add `suppressResume: vi.fn()` to every typed `ReturnType<typeof useVoiceInterjections>` literal (`TrackSelector.test.tsx:25`, plus a grep).
- **`useLocalBooleanPreference`:**
  - default true when nothing is stored;
  - stored `'false'` honored;
  - per-user keys;
  - storage that throws.
- **Test files own assertions as follows**, because `AnnotationComposerPanel.test.tsx` mocks Composer and AnnotationList (:39-40) and so can only check forwarded props:
  - **`AnnotationComposerPanel.test.tsx` (forwarded props and gating; Agent C also removes its stale `useAutoPausePreference` mock at :36).** First add `useLazyGetVoiceAudioUrlQuery` to its `annotationApi` mock as a **hoisted, stable** trigger, since otherwise all 7 tests fail once the panel calls the hook (:23-26). A per-render `vi.fn()` would rebuild the controller on every render (hook :25 deps). Add `localStorage.clear()` to its `beforeEach`. Then cover:
    - the hook receives the video when `previewAllowed`, and **null** when a recorder session is pending or `previewAllowed` is false;
    - it receives the video **when the Voice tool is selected with no session**;
    - `audioEnabled` follows the toggle;
    - Composer, AnnotationList and VoiceRecorder receive `onAuthorIntent` set to `suppressResume`;
    - AnnotationList `active` is false while interjecting;
    - VoiceRecorder `recordBlocked` is true while interjecting;
    - controls and toggle render only with voice rows;
    - there is no new `role="status"` at rest.
  - **`AnnotationWorkspace.test.tsx` (real behavior).** Its URL-loader mock resolves `{}` (:16,:29), which would throw into `fail()`, so a crossing needs a real URL mock and the shared `voiceAudio.ts` fakes. Cover:
    - one real crossing;
    - capture mid-note, after which the video stays paused at note end;
    - delete the playing note, after which the video stays paused.

    Its existing "audio URL loader not called" and play/pause spy assertions must stay true at rest.
  - **`VoiceRecorder.test.tsx`:** while `recordBlocked`, Record is not rendered and the §3 hint text is; "Use current time" calls `onAuthorIntent`.
  - **Any test that persists the toggle** needs `beforeEach(() => localStorage.clear())`, because `src/test/setup.ts` never clears it and a stored `'false'` would leak into later tests.
- **Owner regression:** `TrackSelector.test.tsx:113-131` and `SpeechWatchOwnerTimeline.test.tsx` pass with the moved component and the extracted fullscreen box.

**End-to-end (Playwright; extend `web/tests/voice-annotations.spec.ts`, already in CI on chromium).** Reuse `installDeterministicVoiceAudio`, `setDeterministicAudioMode`, `finishDeterministicAudio`, `startNaturalCrossing` (role-agnostic) and `resetVoiceFixtures`. **Split `startNaturalCrossing` into a seek step and a play step:** it waits for the "Commentary ahead" hint (spec :74), which never appears while auto-play is suspended or off, so scenarios 3 and 4 can't use it whole. Parameterize the spec-local `annotations()`, which hard-codes review 9611 (:36-43). New scenarios:
1. **Coach A** (`reviewerA`, speech 9601, review 9611): a natural crossing fetches `/annotations/9801/voice-playback-url`; the video pauses; the controls show "Playing voice commentary"; Skip resumes. (No transcript shows in the coach view, D9; "Transcribing…" appears only in the folded voice row.)
2. **Coach B's draft** (`reviewerB`, speech 9601, review 9614, draft note 9822 at 1.0 s): `/9822/…` returns 200 and plays; **no** request for 9801-9807 (collect paths with `page.on('request')`).
3. **Recorder session pending** (started with `installDeterministicRecorder`): the clock passes 1.0 s with **zero** `voice-playback-url` requests.
   **Voice tool selected with no session:** the interjection plays and the §3 hint replaces Record. After the note the video resumes and Record stays hidden. After "Use current time" then Skip, the video stays paused and Record is enabled.
4. **Toggle off:** the clock passes 1.0 s with zero `voice-playback-url` requests; after a reload it is still off.

**E2E tests ON-by-default touches** (fix both in the same change):
- **Real regression:** `web/tests/app-shell.spec.ts:2139-2219`. The reviewer scrub variant plays from .1 and crosses `tools-voice-processing` at .22 s, whose audio is ready (:690) but whose URL is not mapped (:683,:774-775). The request lands in `unexpected` (:363), and the engine's pause breaks the time-advance asserts (:2181-2183).
- **Not a deterministic failure, but fix for determinism:** `web/tests/keyboard-shortcuts.spec.ts:89-103`. It presses Space as coach A on 9601, whose first note is at 0.75 s; it normally finishes before then, and if not it passes for the wrong reason.
- **How to turn auto-play off:** `page.addInitScript` writing `annotation-composer:voice-autoplay:{userId}` = `'false'`, wrapped in try/catch for about:blank. `me.user.id` is a string (`UserResource.php:21`); the keys are `…:9003` for reviewerA (E2ESeeder `COACH_ID`, hardcoded or read from `/api/me`) and `…:2` for the app-shell reviewer (:669). This is the analogue of the owner variant's `playbackMode: 'written'` (:2057); don't change the tests' intent.
- **Phone width:** the new composer block must pass app-shell's 375 px overflow check (`expectNoPageOverflow`, :1433), so use `flex-wrap`.

**Real-browser check (Chrome, live stack).** Repeat the 2026-11-03 coach-versus-speaker comparison on speech 8:
- the coach's view now pauses at 10.5 s and plays the note;
- the speaker's view is unchanged.

Also check:
- the fullscreen controls;
- on the Voice tool during a note, the hint replaces Record, and Record returns as §4 scenario 3 describes;
- suspension while a recording is in progress or unsaved;
- the toggle;
- that the controls row causes no layout shift. The e2e fixture audio is uncompressed PCM (an `ipcm` sample entry, no `mp4a`, confirmed). A research probe saw Firefox reject it, though that browser behavior can't be verified from the repo. So manual Firefox checks need a real recording.

## §5 Efficiency and DRY guarantees

- No new endpoint, polling or query. The audio URL is fetched only at a crossing, exactly as for the speaker.
- One engine instance per page. The owner engine gets `videoEl: null` for non-owners (`useCommentaryTrack.ts:44,109`).
- `voiceRows` is passed memoized. The controller rebuilds only when the suspension gate flips (cheap: listeners plus state).
- Nothing copied:
  - the engine, `crossedNotes`, `VoicePlaybackControls` and the preference hook are reused;
  - the fullscreen box, its Escape handler and the target registration are extracted once and shared.
- Not touched: `useCommentaryTrack`, `projectCommentary`, `CommentaryPlaybackControls` (except its import), the owner's per-speech playback preference, and the legacy `useVoiceCommentaryPreference` (dead code, separate cleanup).

## §6 Edge cases the implementation must handle (each needs a test or a stated reason)

1. **A note still processing:** it is skipped. Once it is ready (via the 3 s poll), it plays on the next crossing (`canonical()`).
2. **A note deleted, re-recorded or no longer ready mid-play:** the engine stops it (tests :474-503).
3. **The coach switches tab mid-note:** the note stops and the video stays paused (D3). A recorder session can't start mid-note, because Record is replaced by the hint and every other pending source needs an earlier recording (VR:94). **Opening the Voice tool mid-note** changes nothing.
4. **Author intent mid-note:** after a capture in any editor or in the recorder, the note and its queue continue. A delete during the note, or Clear all, ends the note and drops its queue. In every case the video stays paused afterwards (D5).
5. **The toggle is turned off mid-note:** the note stops and the video resumes (D6), unless author intent preceded it (D5).
6. **A row's preview audio is playing when a crossing fires:** the row audio pauses and unmounts (`active` false). Pressing a row's Preview during an interjection shows no player until the note ends.
7. **Fullscreen:** the floating box works and Escape inside it skips (D8).
8. **Access lost or the review revoked:** the engine is suspended, and the composer's existing denied state applies.
9. **A voice note saved at the paused playhead** does not replay on the next Play (§1.1).
10. **A reviewer without the coach role who owns voice notes** (the `app-shell` reviewerOverlay fixture, `:670,:805-812`): their notes play (D2).
11. **More than six voice notes** (R23, e.g. coach A has 7 in a 6 s video): every one interjects; the toggle is the escape hatch.
12. **Escape anywhere** (the controller's window listener) skips the note, even inside a composer field or the Clear dialog, unless that widget stops propagation (the scrubber does). Same as the speaker. After a capture it won't resume (D5).
13. **iOS native video-only fullscreen** has no HTML controls; Play is re-paused while a note is active. Same as the speaker; accepted.
14. **An expanded row's audio** remounts from the start and loses focus when an interjection starts. Its "Preview audio" button may flicker "Loading…", because the engine refetches the same RTK cache key with `preferCacheValue=false`. Cosmetic; accepted.
15. **First voice note saved:** the controls block appears for the first time, a one-time ~116 px layout push (§3). Accepted.
16. **The toggle is not synced across browser tabs** (localStorage read at mount). Accepted (D7).

## §7 Implementation roster (for the multi-agent build)

The build is small and coupled, so write in sequence and check in parallel:

1. **Orchestrator:** Step 0 docs.
2. **Agent A (engine and shared UI):** writes `lib/voiceInterjectionController.ts`, `hooks/useVoiceInterjections.ts`, `lib/crossedNotes.ts` (the constant), `components/annotation/VoicePlaybackControls.tsx`, the owner import updates, the extracted fullscreen box in `SpeechWatch.tsx`'s owner branch, the preference hook, `src/test/voiceAudio.ts`, and the §1/§2 unit tests. In parallel, **Agent B** writes the backend Pest tests (disjoint files).
3. **Agent C (composer wiring):** writes the following, with their unit tests. It starts **after** A, because it consumes A's API.
   - `AnnotationComposerPanel.tsx` (gate, `previewAllowed`, reserved row, `handleClear` intent);
   - `useAnnotationEditor.ts` (`onAuthorIntent`; `Composer.tsx` needs no change, because its props derive from the options);
   - `AnnotationList.tsx` (the `onAuthorIntent` prop, plus the delete-handler call);
   - `VoiceRecorder.tsx` (`recordBlocked`, `onAuthorIntent`);
   - the reviewer presentation target plus `usePresentationTarget` in `SpeechWatch.tsx`;
   - the unit tests in `AnnotationComposerPanel.test.tsx` (including the stale-mock removal), `AnnotationWorkspace.test.tsx`, `VoiceRecorder.test.tsx` and SpeechWatch.

   Agent A owns the `TrackSelector.test.tsx` type-ripple fix and `lib/voiceControlsKeys.ts`.
4. **In parallel after C:** **Agent D** (Playwright scenarios plus the two regression fixes; needs Docker) and **Agent E** (adversarial reviewer, read-only).
5. **Validate** with CI's exact commands (`npx tsc -b`, `npx eslint .`, `npx vitest run`, Pest/pint/phpstan, Playwright chromium), mutation-check the new tests, run the real-browser check, then improve and validate again.

`SpeechWatch.tsx` is touched by both A (owner box) and C (reviewer target). Sequencing A then C avoids a write conflict; C must re-read the file first.
