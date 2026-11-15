# Plan: play the voice note you clicked, and a ▶ on every audio commentary row

**Status:** rev 3, 2026-11-13. **Implemented (uncommitted).** Rev 3 revises D8 after implementation: the video's Play now cancels a note.
- **Adversarial review:** IMPLEMENTABLE WITH FIXES. Two major and seven minor findings, all folded in.
- **Validation:** the plan was applied to a scratch copy of `web/`. With the rev 2 engine rule, `tsc -b`, eslint and vitest pass (1559/1559), and mutation checks fail the intended tests.
**Supersedes:** the "Seek-only" rule for voice notes in `PLAN-COMMENTARY-PLAYBACK.md` item 12 (:233-243, :516-517), for notes the user navigates to.

## Goal

Two problems on the speaker's watch page. The first is shared with the coach's authoring view.

1. **Click, then Play, plays nothing.**
   - Clicking a voice note in the Commentary track list, or its Voice point on the timeline, puts the slider exactly on the note.
   - Pressing the video's Play then skips the note. The engine only plays notes that playback *crosses*, and a note exactly at the starting playhead never counts (`web/src/lib/crossedNotes.ts:28-30`; `web/src/lib/voiceInterjectionController.ts:170`).
   - The same skip happens when you click a note while the video is already playing.
   - This was specified (`PLAN-COMMENTARY-PLAYBACK.md:233-243`) and is pinned by `useVoiceInterjections.test.tsx:543`.
2. **No way to just listen to one note.** The list has no per-note play button.

No backend change is needed (§ "Backend" below).

## Decisions (user, 2026-11-13)

1. **Fix A, "remember the clicked note".**
   - Navigating to a voice note arms it.
   - The next forward playback from that marker plays it.
   - The slider still lands exactly on the marker.
   - Unchanged: plain scrubbing, and the coach's just-recorded note, which must not replay on Play.
2. **A ▶ button on every audio commentary row**, at the right end of the row, to the right of the text. Each ▶ plays its own row's note without moving the slider.
3. **If the video is playing when ▶ is pressed, it pauses and stays paused** after the note.
4. **Only audio commentary gets ▶.** Written notes never get one, and nothing gets one in Written notes only mode.

### Decisions taken by this plan (change them before implementation if you disagree)

| # | Decision | Why |
|---|---|---|
| D1 | Play at an armed note starts it **immediately**, inside the `play` event. If the video was already playing when the user navigated, or Play lands mid-seek, the first tick after the seek starts it. | Ticks come every ~250 ms. The tick approach would always play ~¼ s of speech past the marker and resume ¼ s late. Pausing inside `play` already exists (controller :163-166) and is tested (`useVoiceInterjections.test.tsx:150`). |
| D2 | "Navigating to a voice note" means a click on: a Commentary track row (main list, Read all feedback, and the fullscreen copy) or an owner-timeline Voice point; the `[`/`]` previous/next-note keys; and, **as a separate commit**, the coach's "Go to time", the coach's timeline voice markers and the coach's `[`/`]`. Dragging the slider, the scrubber and video.js's progress bar are plain scrubbing and don't arm. | The keys are the keyboard twin of a click. Coaches preview what speakers hear (`PLAN-COACH-VOICE-PREVIEW.md`, Goal). Without the coach commit, a coach would hear silence where the speaker hears the note. Drop that commit if you want the speaker only. |
| D3 | An armed note shows the existing "🔊 Commentary ahead" hint while the playhead sits on it. | It is true, and it's the only sign the click did something. |
| D4 | Several notes at the same time: the clicked row plays first, then same-time rows listed after it. Rows listed before it are skipped. | "As if playback started just before the clicked row." It matches the list's order, (start, id) (`Transcript.tsx:41`, `crossedNotes.ts:31`). |
| D5 | ▶ appears on voice rows whose audio is ready, in any Commentary track list, **while audio is on** (Text + audio, Audio only). That includes Audio only's "Read all feedback" and the fullscreen panel. It never appears in Written notes only or Off, on written notes, or on processing, failed or erased audio. | One rule: ▶ shows exactly when the engine can play the note. In Audio only, the main list hides the text, so "Read all feedback" is where the text is (decision 2). |
| D6 | The row's button follows its own note: ▶ Play, a spinner while loading, ⏸ Pause while playing, ▶ Resume while paused. It also reflects a note that started by crossing. The global Pause/Resume/Skip stay. | One control per row. |
| D7 | ▶ pressed while another note is loading or playing (by crossing or ▶) stops that note without resuming the video, then plays the new one. The video stays paused. | Decision 3: the user took manual control. |
| D8 | **Revised 2026-11-13, after implementation.** The video's own Play (its button, a click on the video, Space) during any note cancels the note and its queue, and drops an armed note. That covers a note that is loading, playing or paused, from ▶ or a crossing. The video plays on from the playhead. Rev 2 kept the old rule instead (the video stays paused until the note ends or is skipped). A *paused* note never ends, though, so the video couldn't play again until Skip or a seek. | User decision, 2026-11-13. Frozen contract amendment "the video's Play cancels a note". Tests: `useVoiceInterjections.test.tsx` (the rewritten :150) and the cancel block in `useVoiceInterjections.navigate.test.tsx`. |
| D9 | A ▶ note shows no caption over the video; its row stays highlighted. | The frame on screen isn't the note's moment. |
| D10 | A failed ▶ note says "Could not play this voice commentary." without "Play the video to continue." | The engine never paused the video for it, and the video stays paused. |
| D11 | Reserve the voice status box's height above the list while audio is on (`sm:min-h-16`). | Pressing ▶ mounts the box (`CommentaryPlaybackControls.tsx:60`), which pushes the rows down under the pointer. A quick second click could then land on another row's seek button and cancel the note. The composer already reserves space (`AnnotationComposerPanel.tsx:506`). **Cost:** a visible change. At ≥640 px, about 64 px of blank space sits above the list whenever audio is on and nothing is hinted or playing. Drop D11 if you'd rather keep the shift. |
| D12 | Only `seeking` cancels a note, not `seeked`. | A latent race, fixed below (§1.6). Fix A would trigger it on every click during playback. |

## What the research established

Three read-only review agents covered the engine, the UI and the backend. The engine agent also prototyped its design in a scratch copy of `web/`: 124 of 125 tests passed. The one failure was its probe of today's race, which the prototype fixes. Citations are theirs, spot-checked.

**Engine**
- **The crossing window:** it is (previous, now] and excludes its lower bound (`crossedNotes.ts:28-30`).
  - After a seek, `previousTime` is the landing point (controller :182), and Play raises it 1 ms more (:170).
  - A note stamped exactly 0.000 already plays: at t=0, `started=false`, so the lower bound is −∞ (:172; `crossedNotes.ts:28`).
- **The latent race:** `onSeeking` handles both `seeking` and `seeked` (:225-226) and cancels any active note (:180).
  - The HTML seek algorithm queues the seek's own `timeupdate` before `seeked`.
  - So if the video is playing and that tick crosses a note just after the target, the note starts, `seeked` cancels it, and the video is left paused with no audio.
  - Reproduced in a jsdom probe following the spec's event order; not yet seen in a real browser.
- **`commentary.seek` is shared:** it (`useCommentaryTrack.ts:155`) also drives the owner scrubber (`SpeechWatch.tsx:550`), the timeline markers (:475-477) and `[`/`]` (:599-601). So Fix A needs its own entry point; `seek` itself stays unchanged.
- **RTK reuses in-flight requests:** a request for a cache key that is still pending gets the in-flight promise back (RTK 2.12). So ▶ must never restart its own active note right after aborting it.
- **Harness:**
  - `playableVideo()` starts *playing*.
  - jsdom's `seeking` is always false, and setting `currentTime` fires no events, so tests dispatch `seeking`/`timeupdate`/`seeked` themselves.
  - `tick()` always fires `play`.
  - A jump over 1 s counts as a seek.

**UI**
- **Row structure:** each list row is one `<button>` (`Transcript.tsx:134-147`). `notebook.css:334-337` (44px targets) selects `> li > button` in both `ol[aria-label='Commentary transcript']` and `ol[aria-label='All feedback']`; `app-shell.spec.ts:1221` (`expectTargetSizes`) checks only the main list. ▶ in "All feedback" therefore gets its 44 px from its own `min-h-11 min-w-11`. So ▶ must be a **direct child of the `<li>`**, after the seek button. Scenario H (`voice-annotations.spec.ts:564`) takes the list's first button.
- **"Read all feedback" renders whenever the mode isn't Text + audio**, Off included (`CommentaryPlaybackControls.tsx:66`).
- **Owner timeline markers pass only seconds** (`OwnerVideoTools.tsx:76`). `TimelineStrip` already calls an identity-aware `onMarkerActivate` right after its single seek (`TimelineStrip.tsx:162-166`; contract :9-11). The `kind` is `'voice'` for Voice points (:50).
- **`[`/`]` pass only seconds** (`useKeyboardShortcuts.ts:166, :173`), although the note (`{id, start_seconds}`, :91-94) is in hand.
- **Coach paths:**
  - "Go to time" passes seconds (`VoiceAnnotationRow.tsx:102` → `AnnotationList.tsx:423`).
  - `handleMarkerActivate` gets the full activation (`AnnotationComposerPanel.tsx:416-426`), but it is declared above the `useVoiceInterjections` call (:448).
- **Typecheck trap:** `TrackSelector.test.tsx:25` builds a `VoicePlayback` literal without a cast. Adding members fails `tsc -b` (TS2739) while vitest stays green.
- **Exact-name locators exist** for "Pause commentary", "Resume commentary" and "Skip commentary", and for the status texts. `TrackSelector.test.tsx:128` expects exactly one `status`.
- **The list clips outset focus rings:** the `<ol>` has `overflow-y: auto`, which forces `overflow-x` too.
- **Safari doesn't focus a button on click.**

**Backend (no change needed)**
- **Access:** the list and the audio-URL endpoint apply the same gate and visibility scope (`AnnotationController.php:54-56`; `VoiceAnnotationController.php:59-62`), so the speaker can fetch every voice note the list shows.
  - Processing or failed audio returns 409 (:65-70). Gate ▶ on `audio_status === 'ready'`.
  - A per-note 403/404 must not reach the track-level `isTerminalAccessError` (`useCommentaryTrack.ts:105`). The engine's `fail()` already keeps it local.
- **No throttle on the route.** Each call is a few queries plus a local HMAC.
- **Keep refetching on every play.** The URL lives 600 s (`MediaUrlSigner.php:24`), and the engine already refetches each time (`useVoiceInterjections.ts:24`, `preferCacheValue=false`).
- **The unread "new commentary" dot** clears when `voicePlayback.state === 'playing'` (`useCommentaryTrack.ts:142`). Playing ▶ through the engine keeps that.
- **E2E fixture:**
  - Speech 9601 is owned by 9004 (e2e-member) and has a 6 s video.
  - Published review 9611 is by Cora Coach.
  - Voice notes 9801–9807 sit at 0.75, 1.40, 2.05, 2.70, 3.35, 4.00 and 4.65 s; text note 9808 sits at 0.10 s.
  - The deterministic Audio fake (`web/tests/voice-test-helpers.ts:99-155`) implements only what the engine uses.

## Step 0: documentation first (the frozen contract requires it)

1. **Amend `STEP-10-FROZEN-CONTRACT.md`** with "Amendment 2026-11-13: navigate to a voice note; play one from the list", after the 2026-11-03 amendment (:492). It states:
   - **Arming:** navigating to a voice note (the D2 paths) arms it. The next forward playback from its marker starts it: at once when Play is pressed there, or on the first tick after the seek if the video is playing. Plain scrubbing is unchanged, including the exact-marker rule for scrubs.
   - **The hint** shows at an armed note.
   - **Row ▶** plays one note on demand without seeking. The video pauses and **stays paused** when the note ends, fails, times out or is skipped. That is a scoped exception to "the final note resumes the video" (:439-440) and "Skip … resumes immediately" (:443). Captions over the video are suppressed for it.
   - **Seeking:** only `seeking` cancels a note. A note started by a seek's own `timeupdate` survives its `seeked`.
   - **The non-goal stands:** "scrub-into-a-note playback" (:69-70) remains a non-goal. An armed note always plays from its start, never from mid-recording.
2. **Add one-line "Superseded for navigated voice notes by PLAN-VOICE-NOTE-CLICK-AND-ROW-PLAY.md" notes.** Don't rewrite history. Put them at:
   - `PLAN-COMMENTARY-PLAYBACK.md` item 12 (:233-243). Item 12 also says "Direct click-to-play voice notes would be additional scope" (:242-243); note that the row ▶ is that scope.
   - `PLAN-COMMENTARY-PLAYBACK.md` :516-517.
   - The `PLAN-COMMENTARY-PLAYBACK.md` review table, where it says "explicit Seek-only contract" (:578).
   - `PLAN-COACH-VOICE-PREVIEW.md:44`, where it says "Go to time + Play does not replay". Under §3 that is no longer true for voice notes.
3. **`STEP-10-VERIFICATION-PLAN.md`:** add Scenarios N and O (§4.3). The spec already has A–M; the file lists A–F and I. Note the gap, as Scenario I did (:261-265).

## §1 Engine (`web/src/lib/voiceInterjectionController.ts`, `web/src/hooks/useVoiceInterjections.ts`)

### 1.1 New state and constant
- **`cue: (VoiceIdentity & { seconds: number }) | null`** is the armed note.
- **`source: 'crossing' | 'list'`** is set when a run starts.
  - The snapshot publishes it as `source`: `null` when idle, `'list'` for ▶, and `'crossing'` for crossings and armed starts.
- **`resumeFloor: number | null`** is the latest start among the notes an armed run played. It is held until the next Play, whoever presses it (the engine's resume or the user), or until the next `seeking`. That Play must not replay those notes.
- **`CUE_TOLERANCE_SECONDS = 0.05`** goes in `crossedNotes.ts`, next to the existing constants. It decides whether the playhead still "sits on" the armed note.
  - It is looser than the 1 ms play tolerance, so a browser that reports the landing position a little off still works.
  - `resumeFloor` makes the looseness unable to cause a replay.

### 1.2 `armNote(note)` (public)
1. If anything is active, queued or loading, call `finish(false)`. A navigation cancels a note, just as the seek it comes with would.
2. Set `cue = enabled && connected && canonical(note) ? { id, assetId, seconds: note.start_seconds } : null`.
3. If armed, publish `{ state: 'hinting', hint: <the canonical note>, error: null }` (D3). Publish the canonical note, not the caller's object.

It doesn't seek. Callers seek in the same task, before or after it. `seeking` is dispatched in a later task (HTML seek algorithm), so the call order doesn't matter. A caller whose seek is guarded must apply the same guard to `armNote`.

### 1.3 `playNote(note)` (public)
1. Return unless audio is enabled, the controller is connected and `canonical(note)` exists.
2. Return if that note is already active (identity and asset). The row offers Pause/Resume instead, and RTK would hand back the request that was just aborted.
3. If anything is active, queued or loading, call `finish(false)`: no resume, and `ownsPause` is dropped (D7).
4. If `cue` is this note, clear it. Another note's cue stays, because the playhead hasn't moved.
5. Call `begin([note], false, 'list')`.

### 1.4 `begin(notes, ownsPause, source)` (private)
Shared by the crossing branch (:203-208), armed starts and ▶. It:
- sets `queue` and `ownsPause`;
- sets `resumeSuppressed = !ownsPause`;
- sets `source`;
- calls `video.pause()`, then `playNext()`.

A crossing always has a playing video, so its `ownsPause` stays true, as it is today.

### 1.5 `startCue()` (private, returns whether it started)
It runs only when a cue exists, audio is enabled, nothing is active, and the video is playing and not seeking.
1. Take the cue and clear it. Return false if the note is no longer canonical, or if the playhead is outside `[seconds − CUE_TOLERANCE_SECONDS, seconds + VOICE_NOTE_SEEK_EPSILON_SECONDS]`.
2. Build the group, sorted with `crossedNotes`' comparator (start, then `id.localeCompare`, `crossedNotes.ts:31`):
   - the armed note;
   - ready notes at the same start that sort after it (D4);
   - ready notes after its start, up to the playhead.
3. Set `playFloor = null; previousTime = now; started = true; resumeFloor = <latest start in the group>`.
4. Call `begin(group, true, 'crossing')` and return true.

### 1.6 Event handlers and existing methods
- **`onPlay`:**
  - Keep the existing active-note branch. During a note, the floor stays for a later Play.
  - Then `if (startCue()) return`.
  - Then apply any floor to this Play, whoever pressed it:
    ```ts
    const floor = this.resumeFloor
    this.resumeFloor = null
    const floorBase = floor !== null ? Math.max(now, floor) : now
    // A pending cue (Play pressed mid-seek) needs no floor: the cue is explicit.
    this.playFloor = (floorBase > 0 || floor !== null) && !this.cue ? floorBase + PLAYHEAD_TOLERANCE_SECONDS : null
    this.previousTime = this.playFloor ?? now
    // After an armed 0.000 note, Play at 0 must not re-arm the zero-time rule.
    this.started = now > 0 || floor !== null
    ```
  - Not a resume-only flag: after a Pause/Resume commentary or coach author intent, the engine doesn't resume. The user's next Play must not replay the note either. (Revised D8: a Play gesture during the note cancels it, and the floor applies to that same Play.)
- **`onSeeking(event)`:**
  - Only on `event.type === 'seeking'`, which means a new seek:
    - run the existing cancel (:180);
    - drop the cue if `|currentTime − cue.seconds| > CUE_TOLERANCE_SECONDS`. While seeking, `currentTime` reports the latest target, so any other seek drops the cue;
    - clear `resumeFloor`.
  - On both events: the existing rebase (`playFloor = null`, `previousTime`, `started = true`). It is harmless while a note is active.
  - `seeked` must not touch the cue, the floor or the note. When the video is playing, the seek's own `timeupdate` can start the armed note and set `resumeFloor` before that same seek's `seeked` arrives. This is D12.
- **`onTime`:**
  - After the `!enabled || active` guard, `if (startCue()) return`.
  - Compute the hint as `cueHint(now) ?? <existing find>` (:212). `cueHint(now)` returns the armed note while `|now − seconds| ≤ CUE_TOLERANCE_SECONDS`.
- **`finish()`:**
  - Publish `hint: cueHint(currentTime)` (state `'hinting'` when there is one) and `source: null`. That brings back an armed note's hint after ▶ of another note.
  - Don't add a resume flag: `resumeFloor` covers the resume (rev 1's `resuming` flag was redundant and racy).
- **`fail`:** for `source === 'list'`, the error is "Could not play this voice commentary." (D10). Crossings keep today's text.
- **`update()`:** clear the cue when audio is turned off or the note is no longer canonical (removed, replaced asset, not ready).
- **`suppressResume()`:** this is the coach's author intent (capture, delete, Clear all), and it also clears the cue. A note recorded at the armed spot must not start with it.
- **`connect()` cleanup:** clear the cue.

Unchanged: `crossedNotes.ts`'s function, `skip`, `pauseCommentary`, `resumeCommentary` and Escape. `skip` → `finish(true)` resumes only if the engine owns the pause, which a ▶ note never does.

### 1.7 Hook
Add `armNote`, `playNote` and `canPlayNotes: audioEnabled && controller !== null` to the return (:38-47). The two actions are no-ops without a controller. `source` comes through the snapshot spread; mask it to `null` when audio is off, like `hint` and `error`.
- **Why a controller check:** the list renders before the player is ready (`SpeechWatch.tsx:439, 443`), and the hook's actions are no-ops until then.

## §2 Speaker UI

### 2.1 `web/src/components/annotation/Transcript.tsx`
- **Props:** add an optional `voicePlayback?: VoicePlayback`.
- **Row click:** `onSeek(a.start_seconds)` as today, then, for a voice note, `voicePlayback?.armNote(a)`. Keeping `onSeek(seconds)` keeps `Transcript.test.tsx:94` green.
- **Row DOM:**
  ```tsx
  <li key={a.id} ref={…} aria-current={isCurrent ? 'true' : undefined}
    className={cn('flex items-stretch gap-1 rounded-md', isCurrent && 'bg-muted')}>
    <button type="button" onClick={…}
      className={cn('flex min-h-11 min-w-0 flex-1 items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', isCurrent && 'font-medium')}>
      {/* unchanged: aria-hidden timecode, sr-only "Annotation at …", body (break-words) */}
    </button>
    {playable && <RowPlayButton note={a} name={names.get(a.id)!} playback={voicePlayback!} />}
  </li>
  ```
  - The highlight (`bg-muted`) moves from the button to the `<li>`, and `aria-current` stays on the `<li>`.
  - The seek button's content is unchanged. Playwright matches `/Annotation at 0 seconds Ordinary text…/` at `voice-annotations.spec.ts:62, 412, 420, 440, 541`.
- **`playable`** is `voicePlayback?.canPlayNotes && a.voice?.audio_status === 'ready'` (D5).
- **`RowPlayButton`** (local):
  - It's a native `<button>`, like the seek button and `VoicePlaybackControls.tsx:12-14`. Inside the player, `index.css:274-276` restores Tailwind classes on native buttons only.
  - Classes: `inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent`, with the inset focus ring above.
  - It is icon-only: lucide `Play`, `Pause` or `LoaderCircle` with `aria-hidden` and `size-4`, plus `fill-current`, or `motion-safe:animate-spin` while loading.
  - Its name comes from `aria-label` only. Add no text node, no sr-only text and no `role=status`.
  - **State:** `playback.current?.id === note.id ? playback.state : 'idle'`.
    - `idle`: "Play voice commentary at {name}" → `playNote(note)`.
    - `loading`: "Loading voice commentary at {name}", with `aria-disabled="true"` and the click ignored. Don't use `disabled`, which drops focus.
    - `playing`: "Pause voice commentary at {name}" → `pauseCommentary`.
    - `paused`: "Resume voice commentary at {name}" → `resumeCommentary`.
    - None of these may equal the exact names "Pause commentary" or "Resume commentary".
  - The same element is kept across states, so focus survives.
  - On click, call `event.currentTarget.focus({ preventScroll: true })` first. Safari doesn't focus on click, and the `:focus-within` auto-scroll guard (:81) needs it.
- **`name`:** `formatSpokenTimecode(a.start_seconds)`. Duplicates within the list get TimelineStrip's suffix, ", 1 of 2 with this name". Move its `dedupe` (`TimelineStrip.tsx:183-192`) into a shared `web/src/lib/` helper and use it in both places.

### 2.2 `web/src/components/review/CommentaryPlaybackControls.tsx`
- **Both lists:** pass `voicePlayback` to both `<Transcript>`s (:63, :80). D5 holds because `canPlayNotes` is false whenever audio is off.
- **Reserved space (D11):** wrap `<VoicePlaybackControls>` (:60) in `<div className={cn(voicePlayback.canPlayNotes && 'sm:min-h-16')}>`. The fullscreen copy passes `showVoiceControls={false}` and is unaffected.

### 2.3 `web/src/hooks/useCommentaryTrack.ts`
- **Overlay (D9):** `overlayVoice = projection.showVoiceTranscript && voicePlayback.source !== 'list' ? activeVoice : null` (:120).
- **Row highlight:** keep `readableActiveIds` (:124-125), so the playing row stays highlighted. The owner timeline marks it current too, which is acceptable: it is the note playing.

### 2.4 Owner timeline Voice points
- **`OwnerVideoTools.tsx`:** add an optional `onVoiceNoteActivate?: (note: Annotation) => void`. Pass `onMarkerActivate={(m) => { if (canSeek && m.kind === 'voice') onVoiceNoteActivate?.(m.annotation) }}` to `TimelineStrip` (:75-77). TimelineStrip still does the one seek.
- **`SpeechWatch.tsx`:**
  - Extract `seekOwnerTimeline`'s guard (:475-478) into a predicate.
  - Pass `onVoiceNoteActivate={(note) => { if (<predicate>) commentary.voicePlayback.armNote(note) }}` to the `OwnerVideoTools` element (:811-822).

### 2.5 `[`/`]` keys
- **`useKeyboardShortcuts.ts`:** make it generic over `T extends KeyboardShortcutAnnotation`, and add `onNavigate?: (note: T) => void`. Keep it in a ref like `onSeekRef` (:144-150), and call it right after the seek at :166 and :173.
- **`SpeechWatch.tsx` (:598-605):** set `onNavigate: isOwner ? (note) => { if (note.voice) commentary.voicePlayback.armNote(note) } : undefined`. `navigationAnnotations` are full `Annotation`s.

## §3 Coach opt-in (separate commit; drop it to keep the speaker only)

- **`AnnotationComposerPanel.tsx`:**
  - Move the `useVoiceInterjections` call (:448-454) above `handleMarkerActivate` (:416).
  - In `handleMarkerActivate`, for a non-temporary `kind === 'voice'` activation, call `voicePlayback.armNote(activation.annotation)`. Its comment ("never seek again here") stays true.
  - Depend on `voicePlayback.armNote`, which is stable per controller, not on `voicePlayback`, which is a new object every render.
  - The composer's own `useKeyboardShortcuts` call (:435-440) gets the same `onNavigate` as the owner's (§2.5), for saved voice rows.
- **`AnnotationList` / `VoiceAnnotationRow`:**
  - Add an optional `onVoiceNoteActivate?(note)`, called right after `onSeek` in "Go to time" (`VoiceAnnotationRow.tsx:102`).
  - The panel passes `voicePlayback.armNote`.
- **Author intent** clears the cue (§1.6, `suppressResume`). Recording at the armed spot then can't start the new note together with the armed one.
- **No ▶ for coaches.** Their rows keep "Preview audio" (`VoiceAnnotationRow.tsx:105-106`).
- **The armed note plays only while auto-play is on**, because `armNote` follows `audioEnabled` (`autoplayOn`, :452).

## §4 Tests

### 4.1 Engine (`web/src/hooks/useVoiceInterjections.test.tsx`)
**Renamed:** rename :543 to say it is a plain scrub ("does not fire at an exact scrubbed marker without an arm…"). Its behaviour is unchanged.

**New, Fix A:**
1. Paused, arm and seek to 1.0, then Play:
   - the note's URL is requested before any `timeupdate`;
   - the video is paused by the engine;
   - after `ended`, the video resumes once;
   - a following tick at 1.2 doesn't replay it.
2. Playing, arm and seek: the seek's own `timeupdate` (with `seeking` false) starts the note, and the following `seeked` doesn't cancel it.
3. **Regression test for D12, without any arm:**
   - Playing, scrub to 1.8 with a note at 1.9. The seek's own `timeupdate` at 1.95 starts it, and `seeked` doesn't cancel it.
   - Then the video resumes after `ended`.
4. Play pressed mid-seek, with `seeking` overridden to true: nothing starts until the first tick after the seek. Dispatch `seeked` *after* that tick, and assert the note survives it. The mutation check shows D12 also guards this D1 path.
5. Arm, then scrub to 3.0: the cue is dropped, and Play from 3.0 behaves as today.
6. An armed note at 0.000: it plays once, the engine resumes at 0, and there is no second play (`resumeFloor`).
7. An armed note while the playhead reads 0.03 s early (inside `CUE_TOLERANCE_SECONDS`): it plays, and the resume doesn't replay it (`resumeFloor`).
8. Arm during a loading note: the request is aborted (assert through `{ unwrap, abort }`), the video doesn't resume, and the new cue holds.
9. Same-time notes (D4): arming the second of three same-time rows plays it and the third, not the first.
10. Not arming:
    - a note that isn't ready, or audio that is off, only seeks;
    - it never arms later, even when the note becomes ready.
11. Turning audio off, removing the note or replacing its asset each clear the cue.
12. The hint shows the armed note while paused on it, and it comes back after ▶ of another note ends.
13. `suppressResume()` clears the cue.
14. Unchanged and still passing: the playhead-tolerance block (:565-628), including "does not replay a just-saved note".
15. Playing, with the landing reported early (2.02 for 2.05):
    - the seek's own tick starts the note, and `seeked` keeps `resumeFloor`;
    - after `ended` the engine resumes, and the next tick doesn't replay the note.
    
    This fails on rev 1's "clear on both events" rule.
16. Paused, armed, early landing, Play:
    - the note plays, and Pause commentary then Resume lets it end with the video paused;
    - the user's next Play doesn't replay it.
    
    This fails on rev 1's resume-only floor.
17. The same as 16 for an armed note at 0.000: the user's Play at 0 doesn't replay it through the zero-time rule.

**New, ▶:**
1. While playing: the video pauses, the note plays, and after `ended` the video stays paused with `currentTime` unchanged.
2. During a crossing's loading note: the request is aborted, the video doesn't resume, and the new note plays.
3. During a crossing's playing note: it stops without resuming, and the new note plays.
4. Skip and Escape during a ▶ note leave the video paused.
5. A video Play gesture during a ▶ note cancels it, and the video plays on (revised D8).
6. ▶ on the note already active is a no-op: no second request.
7. ▶ on the armed note clears the cue. ▶ on another note keeps the cue, and the hint comes back afterwards.
8. No-ops: audio off, a note that isn't ready, a disconnected controller.
9. `source` is `'list'` from loading through playing, and `null` after.
10. The 15 s watchdog for a ▶ note shows "Could not play this voice commentary." and leaves the video paused.
11. Pause and Resume work for a ▶ note.

### 4.2 Components and hooks
- **`Transcript.test.tsx`:**
  - ▶ only on ready voice rows when `canPlayNotes` is true, and not on written, processing, failed or erased rows, or when audio is off.
  - The four names and states.
  - Loading uses `aria-disabled` and its click does nothing.
  - Pause and Resume call the hook's actions.
  - ▶ never calls `onSeek`.
  - A voice row click calls `onSeek(seconds)` then `armNote(note)`; a written row doesn't arm.
  - Both buttons are direct `<li>` children, seek first.
  - Same-second names get the suffix.
- **`TrackSelector.test.tsx`:**
  - Update the `VoicePlayback` literal at :25 with the new members (`source`, `armNote`, `playNote`, and `canPlayNotes: projection.playAudio`). This is required for `tsc -b`.
    - A fixed `canPlayNotes` would make the mode tests below test only the fixture.
    - Pair them with a `useVoiceInterjections` test that `canPlayNotes` is false when audio is off or there is no video.
  - Add: no ▶ in Written notes only or Off (including Read all feedback); ▶ in Audio only's main list and in Read all feedback; still exactly one `status`.
- **`useCommentaryTrack.test.tsx`:**
  - No overlay voice for `source: 'list'`, but the row is still in `activeIds`.
  - Still marked seen while a ▶ note plays.
- **`OwnerVideoTools.test.tsx`:**
  - A voice marker calls `onVoiceNoteActivate` once, after the single `onSeek`.
  - A text marker doesn't.
  - Nothing happens when `!canSeek`.
  - :101 and :229 stay green.
- **`useKeyboardShortcuts` tests:** `onNavigate` gets the target note after `onSeek`.
- **Coach (§3):**
  - the composer's marker and "Go to time" arm through the panel's engine;
  - capture clears the cue;
  - with auto-play off, nothing arms.

### 4.3 E2E (`web/tests/voice-annotations.spec.ts`, Chromium)
Use speech 9601 and review 9611 as e2e-member, with `trackVoiceUrlRequests` (spec :100-107).
Import `setDeterministicAudioMode` and `finishDeterministicAudio` from `web/tests/voice-test-helpers.ts`; the spec doesn't import the first today.
- **Scenario N: clicking a voice row arms it.**
  - Paused at 0, click the row for 9803 (2.05 s). `currentTime` becomes 2.05.
  - Don't assert the hint here: 9804 (2.70) is within 3 s, so "🔊 Commentary ahead" shows even without an arm. Unit test 12 covers D3.
  - Play: the first voice-URL request is 9803, and "Playing voice commentary" shows.
  - In natural mode the video resumes. The next request is 9804, and 9803 is requested only once.
  - **The D12 path:** in hold mode, play from 4.7 at `playbackRate` 0.25 (the video is 6 s, so this widens the window), then click 9805's row.
    - "Playing voice commentary" must stay visible and the video stay paused.
    - A URL request alone proves nothing, because it goes out before a `seeked` cancellation.
- **Scenario O: a row's ▶ plays that note and leaves the video paused.**
  - In hold mode, play from 4.7 at rate 0.25, then press ▶ on 9803. The video pauses, 9803 is requested, and the row's button reads "Pause voice commentary at 2 seconds, 1 of 2 with this name". 9803 (2.05) and 9804 (2.70) share "2 seconds".
  - `finishDeterministicAudio` ends the note. The video stays paused with `currentTime` unchanged, and no other request is made.
  - Switching to Written notes only removes every ▶.
- **D11 guard, a speaker analogue of Scenario M:** at 1440 and 640 px, pressing ▶ doesn't move the pressed row's top.

The 44px check at `app-shell.spec.ts:1221` now covers ▶ too, and passes because ▶ is `min-h-11 min-w-11`. The owner axe scans in `accessibility.spec.ts` (:125-133, :811-842, :852-880) scan ▶; `button-name` and `nested-interactive` are the rules at stake.

### 4.4 Unchanged on purpose
- `crossedNotes.ts` and its 9 tests.
- The coach playhead-tolerance block.
- The coach's Preview audio.

## §5 Edge cases (each has a test above or a stated reason)
1. **Clicking the row of the note that is playing:** it cancels and re-arms at the note's start, so Play replays it from the top. That is a navigation, as intended.
2. **Clicking a row while a ▶ note plays:** it is cancelled, and the clicked note is armed and sought.
3. **A note past the video's end:** the seek is clamped, the `seeking` position doesn't match, and the cue drops silently.
4. **Switching between the two audio modes** keeps the cue and the playing note (`update()` with audio still enabled). Switching to Written notes only or Off, or a reviewer crossfade, clears the cue.
5. **The player isn't ready:** there is no controller, so ▶ is hidden and arming is a no-op. The seek itself is a no-op as today.
6. **Polling** (every 3 s) re-creates note objects. The cue survives because `canonical()` matches on id and asset.
7. **A source refresh that re-seeks to the same time** keeps the cue, within tolerance.
8. **Fullscreen:** ▶ is in the "Commentary controls" panel, and the floating box (`SpeechWatch.tsx:752`) shows its state.
9. **Narrow widths:** the text column is about 150 px at 320 px wide, 210 px at 375 px and 235 px in the 360 px fullscreen box. `min-w-0` and `break-words` keep long transcripts wrapping, and ▶ keeps its 44 px.

## §6 Implementation order
1. Step 0 docs.
2. §1 engine with the §4.1 tests: one commit, including the D12 fix and its regression test.
3. §2 speaker UI with the §4.2 tests.
4. §3 coach opt-in with its tests, as a separate commit.
5. §4.3 e2e.
6. §7 verification.

## §7 Verification
- **CI's exact commands in `web/`:** `npx tsc -b && npx eslint . && npx vitest run`. `tsc --noEmit` is a silent no-op here.
- **Playwright:** `voice-annotations.spec.ts` (all scenarios), `app-shell.spec.ts` and `accessibility.spec.ts`. Running e2e locally needs the dev stack stopped (`scripts/e2e-stack.sh`).
- **Name-drift check:** before committing, grep `web/tests` for every exact name and status text listed in "UI" above. None may change.
- **Real browser:** Chrome and Safari, at 1280, 768 and 375 px, as e2e-member on speech 9601:
  1. Paused: click 9803's row, then Play. It plays at once, and the video resumes at about 2.05 s with no replay.
  2. Playing: click 9805's row. It plays at once.
  3. ▶ while playing: the video pauses, the note plays, and the video stays paused with the slider unchanged.
  4. The row states: Play, Loading, Pause, Resume.
  5. No ▶ in Written notes only or Off.
  6. ▶ in the fullscreen panel.
  7. At 1280 and 768, pressing ▶ doesn't move the pressed row.

  Safari is the check for `CUE_TOLERANCE_SECONDS`: log `currentTime` at `seeking`, `seeked` and `play` for one click.

## §8 Out of scope (found along the way)
1. **`[BLANK_AUDIO]` in transcripts** (the user's screenshot).
   - **Cause:** whisper.cpp's marker for silence is saved verbatim. `WhisperVoiceNoteTranscriber.php:29-38` only `trim()`s, and `TranscribeVoiceNote.php:55` writes `annotations.body`. Nothing in the repo strips such tags.
   - **Dev DB:** one row has it, annotation 8 on speech 8, which also has "(swooshing)".
   - **Fix:** normalize at ingestion by dropping lines that are only a `[...]` or `(...)` tag, then run an idempotent backfill that bumps `lock_version`. Decide what an all-silent note becomes, since an empty body is treated as `voice_transcription_failed` today.
   - **Why not strip on display:** it would miss the data export (`GenerateDataExport.php:215`) and the admin panel (`SpeechResource.php:352`). Captions (`Captions/WhisperTranscriber.php:83-90`) share the risk.
   - Recommended as its own small plan.
2. **No throttle on `voice-playback-url`.** It isn't needed now. If added, mirror `friends-read` (120/min per user) and treat 429 as transient.
3. **The backend is looser than the UI on revoked reviews:** the speaker branch ignores `revoked_at` (`AnnotationPolicy.php:56-58`). The UI hides revoked reviews. Pre-existing.
4. **Audio quirks:** voice notes are encoded at 96 kHz (no `-ar`), and uploaded without a Content-Type (`FfmpegVoiceNoteProcessor.php:47, :77`). Harmless today.

## §9 Review log
- **rev 1 (2026-11-13):** written from three read-only reviews.
  - Engine: proposed the API, traced events, found the D12 race and validated a prototype, 124/125 tests.
  - UI: listed every navigation path including `[`/`]`, designed the row, and found the layout shift, the typecheck trap and the locator constraints.
  - Backend: no change needed; confirmed the access paths, the TTL and Range/CORS on dev; traced `[BLANK_AUDIO]`; listed the fixture ids.
  - The plan differs from the prototype as follows:
    - `armNote` without a seek instead of `seekToNote`, so callers keep their single seek;
    - `CUE_TOLERANCE_SECONDS` with `resumeFloor`;
    - author intent clears the cue;
    - the error copy for ▶;
    - the reserved space.
- **Adversarial review (rev 1 → rev 2):** the reviewer applied the whole plan to a scratch copy of `web/`, with caches redirected and the repo untouched.
  - **Results:**
    - Baseline: `tsc -b` 0, eslint 0 errors, vitest 1527/1527.
    - Rev 1 as written: 1556/1559. The reviewer's three probes failed.
    - With the rev 2 engine rule: 1559/1559.
    - `tsc -b` failed with TS2739 until `TrackSelector.test.tsx:25` was updated, as predicted.
  - **Mutation checks:**
    - Reverting D12 fails 4 tests.
    - Never setting `resumeFloor` fails 5.
    - Removing the immediate start fails 7.
    - Clearing the floor on `seeked` fails probe P1, now test 15.
  - **MAJOR-1:** `seeked` erased the floor its own seek had just set (§1.6).
  - **MAJOR-2:** the floor protected only the engine's resume. The fix applies it to the next Play by anyone and deletes `resuming`.
  - **Minor fixes:**
    - Scenario N asserted things that pass without the fix.
    - Scenario O's name ignored the dedupe suffix and needed the audio helpers.
    - The TrackSelector fixture made the mode tests vacuous.
    - Coach `[`/`]` was missing from §3.
    - Step 0 missed four docs that state the old rule.
    - D11's blank space was unguarded and unstated.
    - Test 4 needed `seeked` dispatched after its tick.
  - **Nits:** publish the canonical note; name one comparator; use stable hook deps.
  - **Citations:** 40+ spot-checked; two imprecise ones were corrected. Backend citations come from the backend review and weren't re-checked by the adversarial pass.
- **Not covered by the validation:**
  - e2e Scenarios N and O typecheck and lint but couldn't run while the dev stack was up;
  - the §3 coach unit tests were only partly written;
  - real Chrome and Safari behaviour is still unchecked (§7).
