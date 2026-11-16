# Plan: four DRY follow-ups in the frontend (F1–F4)

**Status:** rev 2, 2026-11-14. **Implemented in commit d64ce62 (F1-F4; F1's contract test is `api/tests/Unit/FrontendStatusContractTest.php`).** Validated on a scratch copy first.
- An adversarial pass applied rev 1 to a scratch copy and ran CI's commands after each step, then the §5 mutation checks. One finding broke `tsc -b`; rev 2 fixes it and the rest (§7).
- Results per step, with rev 2's corrections applied:
  - **F4:** tsc OK, eslint 0 errors / 5 warnings, vitest 145 / 1602. `OwnerVideoTools.test.tsx` goes 23→26 and `SpeechWatchOwnerTimeline.test.tsx` 64→65.
  - **F3:** tsc OK, eslint 0 / 5, vitest 145 / 1602. All 145 per-file counts are unchanged.
  - **F2:** tsc OK (rev 1 failed with TS2304 ×3), eslint 0 / 5, vitest 145 / 1602. `--list` shows 113 tests in 7 files, 19 of them in the voice spec.
  - **F1:** tsc OK, eslint 0 / 5, vitest 145 / 1602. `pint --test` passes and phpstan reports 0 errors. The new test passes 3 tests (9 assertions). The full Pest run gives 1454 tests: 1419 passed, 35 skipped (+3).
- **Not verified:** real Playwright runs, the Docker builds and the whisper-smoke run (§7).

**Follows:**
- PLAN-DRY-VOICE-PLAYBACK.md rev 2 (its items 1–4). That plan is not in the repo yet; this one assumes it has landed. F1–F4 are its §7 items #6–#9.
- For F1 only, PLAN-DRY-BACKEND-VOICE.md, which is being written in parallel and was not in the repo when this plan was written.
- **Sibling plan:** PLAN-DRY-SCHEMA-STATUS-CONTRACT.md (also written in parallel) checks each DB CHECK list against its enum, in `tests/Feature/Schema/CheckListContractTest.php`. F1 checks each enum against its TS list. Together they cover all three layers. Both plans treat `TranscriptStatus` as optional and follow the same fallback.

**Scope:** the frontend (`web/`) plus one new Pest test (F1). No PHP production code and no schema change.

**Line numbers**
- **`web/src`:** the numbers come from the scratch copy that validated PLAN-DRY-VOICE-PLAYBACK.md rev 2. That copy is `/private/tmp/claude-501/-Users-marscheung-SideProjects-Instruction-Speeches-Library/bc302c93-0a11-4e42-8344-135eb66858d5/scratchpad/dry/web` (git HEAD `81a9da7`, clean).
  - So they refer to **the tree after PLAN-DRY-VOICE-PLAYBACK.md**. It has `src/test/voiceFixtures.ts` (`voiceNote`), `stubVoiceAudio`/`restoreVoiceAudio` in `src/test/voiceAudio.ts`, and `isPlayableVoiceNote` in `features/annotation/types.ts`.
  - The scratchpad may be cleared. If it has been, apply that plan first and these numbers hold.
- **`web/tests`, `api/`, `Dockerfile`, `compose.yaml`, `.github/` and `scripts/`:** the numbers come from the repo. That plan doesn't touch them; a `diff -rq` of `web/tests` against the scratch copy shows no differences.
- Each step shifts the lines after it in the same file.

## Goal

| # | Duplication | One owner after |
|---|---|---|
| F1 | The asset and transcript status lists live in three layers: DB CHECKs, PHP literals, and 5 TS spellings (`annotation/types.ts:11, :15`, `speech/types.ts:18`, `caption/types.ts:24`, `tests/voice-annotations.spec.ts:28-29`) | The PHP enums (backend plan). Two TS files hold `as const` lists, the unions derive from those lists, and one Pest contract test checks the lists |
| F2 | The e2e voice spec repeats its video-element reads: `.paused` ×9, the `readyState` poll ×2, the play-count read ×2, an inlined `prepareSpeakerInterjection` ×1, an inlined `playVideo` ×1, and `as unknown as` ×18. The track-radio press appears ×6 across 3 specs | Spec-local `isPaused`, `waitForMetadata` and `videoPlayCount`; shared `commentaryTracks` and `chooseCommentaryTrack` in `commentary-test-helpers.ts` |
| F3 | 22 inline `AnnotationVoice` literals in 17 unit-test files, and 3 home-made `Audio` classes | `voiceAsset(patch)` in `voiceFixtures.ts` (`voiceNote` uses it too) and `stubFakeAudio()` in `voiceAudio.ts` |
| F4 | Owner timeline: two `canSeek` checks that can never fire (`OwnerVideoTools.tsx:78-79`), and the guarded arm written inline next to the named guarded seek (`SpeechWatch.tsx:477`, `:819`) | One marker gate in `OwnerVideoTools`. In `SpeechWatch`, `armOwnerTimelineNote` sits beside `seekOwnerTimeline`, and both share `ownerTimelineSeekable` |

**No user-visible change.**

## What the review established

**CI and build (the constraints on F1 and F2)**
- **CI's `test` job** checks out the whole repo and runs on the host runner:
  - Pest in `api/` (`ci.yml:87-99`);
  - then `npx tsc -b`, `npx eslint .` and `npx vitest run` in `web/` (`:101-115`).
- **CI's `e2e` job** runs Playwright against the docker e2e stack:
  - 8 named specs on Chromium (`ci.yml:348`);
  - `voice-annotations.cross-browser.spec.ts` on Firefox, WebKit and mobile WebKit (`:357`).
  - A spec not named at `:348` never runs in CI. `two-users.spec.ts` is one of them.
- **`tsc -b` type-checks every spec.**
  - The root `tsconfig.json:9` references `tsconfig.e2e.json`. That project includes `tests` (`:44`) with `lib: ["ES2023", "DOM"]` and `types: ["node"]` (`:26-27`).
  - `eslint .` lints the specs too (`eslint.config.js:11`).
  - The Docker `webbuild` stage copies only `web/` and runs `npm run build`, which is `tsc -b && vite build` (`Dockerfile:44-58`, `package.json:8`). So a spec type error also breaks the e2e images.
- **`tsconfig.app.json` has no Node types.** It covers `src`, including `src/test`, with `types: ["vite/client"]` only (`:7`). No `src` test reads a file today.
- **Wherever Pest actually runs, `web/` sits beside `api/`.**
  - The `app` image installs Composer packages with `--no-dev` (`Dockerfile:39`), so it has no Pest at all. Developers run Pest from the host's `api/vendor` (`PLAN-ACCESS-DENIED-STATES.md:736-739`), and the host's `php.ini` needs `-d memory_limit=1G`.
  - The only image with Pest is `whisper-smoke` (`Dockerfile:305-343`). `scripts/whisper-smoke-stack.sh:170` runs it as `php artisan test --filter=RealWhisperAdapterSmokeTest`.
- **No Pest test reads outside `api/` today.** There is precedent for reading a source file instead of copying its contents: `RealWhisperAdapterSmokeTest.php:162-170` reads `docker/whisper/model.lock` "rather than hard-coding the id a second time".
- **e2e specs already import frontend types.** `app-shell.spec.ts:7-8` does `import type … from '../src/features/…/types.js'`.
  - Those modules import nothing.
  - The e2e project has no `@/` path alias, so a type module that an e2e spec imports must stay import-free.

**Status values (F1)**
- **DB CHECKs:**
  - `speech_assets.status IN ('uploading','processing','ready','failed')`, six times across three migrations (PLAN-DRY-VOICE-PLAYBACK.md §7 #10);
  - `annotations.transcript_status IN ('not_applicable','pending','processing','ready','failed')` (`2026_08_18_110002_add_voice_audio_to_annotations.php:28, :45`).
- **PHP:** no enum yet (`api/app/Enums` doesn't exist). The values are bare literals in about 10 files.
- **TS mirrors: five, not two.**
  - `features/annotation/types.ts:11` (`VoiceTranscriptStatus`) and `:15` (`audio_status`).
  - `features/speech/types.ts:18`: `SpeechAsset.status`, all four values.
  - `features/caption/types.ts:24`: `'unavailable'` plus all four. `CaptionController::show` synthesizes `'unavailable'` (`:13-17`).
  - `tests/voice-annotations.spec.ts:28-29`: the e2e payload type.
  - A test cast also spells the list: `routes/SpeechWatch.test.tsx:546`.
- **Why the voice unions leave out two values.** The contract must allow both omissions.
  - **`uploading`:** a voice asset is created as `processing` (`VoiceNoteService.php:81`). Only video uploads ever set `uploading` (`SpeechUploadController.php:123`).
  - **`not_applicable`:** `voice` is null whenever no audio asset is loaded (`AnnotationResource.php:32, :43`).
    - A voice note starts as `pending` (`VoiceNoteService.php:90`).
    - `not_applicable` is written only together with `audio_asset_id => null` (`PurgeDeletedVoiceAnnotation.php:56`, `EraseReviewerVoiceNotes.php:55-56`), or as the column default for written notes.
  - These backend line numbers will move when the backend plan lands.

**e2e helpers (F2)**
- **Helper modules** sit flat in `web/tests/`; there is no `support/` directory.
  - `fixtures.ts`.
  - `voice-test-helpers.ts`: the recorder and audio seams, and `openSpeech`.
  - `commentary-test-helpers.ts`: `selectPlaybackMode`.
  - `friends-fixtures.ts`, `panel-auth.ts` and `xsrf-headers.ts`.
- **Counts in `voice-annotations.spec.ts`** (verified):
  - `(node as unknown as BrowserVideo).paused`: 9, at `:311, :375, :578, :609, :674, :689, :803, :819, :839`.
  - `__voiceVideoPlayCount`: **7 lines but 2 reads.** One installer spans `:72-75` (inside `seekBeforeCrossing`); the reads are `:377-380` and `:387-390`.
  - "Choose commentary track": **6 lines but 4 radio presses.**
    - The presses are `:61`, `:322-323`, `:410` and `:504`.
    - `:417` asserts that a radio is checked; `:534` builds a locator.
    - Across all specs there are 6 presses: those 4, `captions.spec.ts:305-308` and `essay-editor.spec.ts:739-742`.
  - Also repeated:
    - the `readyState` poll (`:69`, `:814`);
    - an inline `play()` at `:359`, which `playVideo` (`:84-89`) already does;
    - Scenario E's `:409-412`, which is `prepareSpeakerInterjection` (`:59-64`) written out by hand.
  - `as unknown as` appears 18 times in all.
- **The double cast is a leftover.** `BrowserVideo` (`:50-57`) predates the DOM lib in the e2e project. `keyboard-shortcuts.spec.ts:68-79` already uses a plain `as HTMLVideoElement` under the same config.
- **`voice-annotations.cross-browser.spec.ts` shares none of these snippets.** Its only overlap is `:24`: the Voice-tab click from `chooseVoiceTool` (`voice-annotations.spec.ts:136-141`), without that helper's two assertions.

**Unit-test literals (F3)**
- **22 inline `AnnotationVoice` literals in 17 files** (`grep audio_status` over `src/**/*.test.*`; table in §2.2).
  - The brief's list misses `types.test.ts:8` (added by the previous plan) and `VoiceAnnotationRow.test.tsx:31, :116, :126`.
  - In this tree, `AnnotationWorkspace.test.tsx`'s literals sit at `:21, :390, :567`: one line down, because the previous plan added an import.
- **The three `Audio` classes** in `SpeechWatchOwnerTimeline.test.tsx` (`:763-772`, `:817`, `:1101-1110`) differ from `FakeAudio` (`test/voiceAudio.ts:5-23`) only in lacking `paused`.
  - The engine never reads `audio.paused`. It uses only `onended`, `onerror`, `play`, `pause`, `removeAttribute` and `load` (`voiceInterjectionController.ts:107-113, :162-175, :341-350`).
  - Every `.paused` read in `src` is on a video.

**Owner timeline (F4)**
- **`TimelineStrip`** calls `onSeek` and then `onMarkerActivate`, and only from a marker button (`TimelineStrip.tsx:163-166, :200, :218`). Its contract says the parent must not seek again (`:9-11`).
- **`OwnerVideoTools`** renders markers only when `canSeek` is true (`OwnerVideoTools.tsx:58-59`). So the `canSeek` checks inside both callbacks (`:78-79`) never see `false`.
- **`SpeechWatch.tsx`:**
  - `:475-477` defines `ownerTimelineSeekable` and the guarded `seekOwnerTimeline`; `:819` writes the guarded arm inline.
  - Both run in the same click task. Between them only `commentary.seek` runs, and it only sets `video.currentTime` (`useCommentaryTrack.ts:23-25, :155`). So the two evaluations always agree.
  - The guard is not redundant with `canSeek`: it also reads `player.isDisposed()` and `getVideoElement(player)` at click time. PLAN-DRY-VOICE-PLAYBACK.md §3.1 keeps it.
- **The `[`/`]` keys** pair an unguarded seek with an unguarded arm (`SpeechWatch.tsx:600-603`). That follows the rule "a caller whose seek is guarded must apply the same guard to `armNote`" (PLAN-VOICE-NOTE-CLICK-AND-ROW-PLAY.md §1.2).
- **`OwnerVideoTools.test.tsx`:**
  - `:115-127` pins the seek-then-arm order.
  - `:129-135` clicks nothing, so its `onVoiceNoteActivate` assertion is vacuous. Its zero-buttons assertion can still fail, if markers rendered while no video is bound, but it duplicates `:219-222`.
- **No route-level test covers the owner Voice-point arm at `SpeechWatch.tsx:819`.** No test in `SpeechWatch*.test.tsx` clicks an owner voice marker.

## Ground rules

- **Put helpers in `.ts` files.** `voiceFixtures.ts`, `voiceAudio.ts` and `commentary-test-helpers.ts` already are.
- **`src/test` is type-checked** with `noUnusedLocals` and `verbatimModuleSyntax`.
  - Use `import type` for types.
  - Delete what a conversion leaves unused: the `createAudio` spy (§2.3) and the `BrowserVideo` interface (§3.3).
- **No new helper is a type guard or calls one**, so TS 6's predicate inference narrows nothing downstream.
- **Order: F4 → F3 → F2 → F1, one commit each.**
  - F4 is the only production-code change apart from F1's types, so it goes first. Write its new test before the change.
  - F3 and F2 change only tests.
  - F1 goes last, and it is blocked: its Pest test needs `App\Enums\SpeechAssetStatus` and `App\Enums\TranscriptStatus` from PLAN-DRY-BACKEND-VOICE.md.
- **After each step, run CI's commands in `web/`:** `npx tsc -b && npx eslint . && npx vitest run`. F1 adds the `api/` commands (§4.5).

## §1 F4: one gate for owner-timeline navigation (do first)

### 1.1 Options

| Option | Removes the second evaluation | Removes the dead checks | Contract change | Verdict |
|---|---|---|---|---|
| **A.** One `onNavigate(seconds, note?)` prop on `OwnerVideoTools` | yes | yes | Yes, and it cuts against two designs. The seek would move out of `TimelineStrip`'s `onSeek` into its identity callback, against `TimelineStrip.tsx:9-11` and PLAN-VOICE-NOTE-CLICK-AND-ROW-PLAY.md §2.4 ("TimelineStrip still does the one seek"). The name would also mean the opposite of `useKeyboardShortcuts`' `onNavigate(note)`, which arms after the seek. Five `OwnerVideoTools` tests change, and `toHaveBeenCalledWith(10)` no longer matches a `(10, undefined)` call | reject |
| **B.** Keep both props and delete the dead checks | no | yes | none | **take** |
| **C.** Add a named `armOwnerTimelineNote` beside `seekOwnerTimeline` | no; the two evaluations stay, but now adjacent and named | — | none | **take, with B** |

**Recommendation: B + C, in one commit.**
- **It keeps the pattern every other navigation site uses:** a seek callback, plus a separate arm under the same guard. Those sites are `Transcript` row clicks, "Go to time", the composer's `handleMarkerActivate` and the `[`/`]` keys.
- **`armNote` stays seek-free**, as PLAN-VOICE-NOTE-CLICK-AND-ROW-PLAY.md rev 1 decided (`armNote` over `seekToNote`).
- **The second evaluation of `ownerTimelineSeekable()` is the price of `TimelineStrip`'s two-callback contract.** It always agrees with the first (see above), and it costs two property reads plus `isDisposed()` and `getVideoElement()`.

### 1.2 Change

**`web/src/components/review/OwnerVideoTools.tsx`**
```tsx
// before (:59, :77-79)
const markers = canSeek ? navigationAnnotations : EMPTY
<TimelineStrip annotations={markers} videoEl={boundVideo} durationSeconds={durationSeconds}
  activeIds={canSeek ? activeIds : []} onSeek={(seconds) => { if (canSeek) onSeek(seconds) }}
  onMarkerActivate={(m) => { if (canSeek && m.kind === 'voice') onVoiceNoteActivate?.(m.annotation) }}

// after
// TimelineStrip seeks and reports only from a rendered marker (TimelineStrip.tsx:163-166),
// so this is the one gate for both callbacks below.
const markers = canSeek ? navigationAnnotations : EMPTY
<TimelineStrip annotations={markers} videoEl={boundVideo} durationSeconds={durationSeconds}
  activeIds={canSeek ? activeIds : []} onSeek={onSeek}
  onMarkerActivate={(m) => { if (m.kind === 'voice') onVoiceNoteActivate?.(m.annotation) }}
```
Keep the `m.kind === 'voice'` filter. It is the marker-kind filter that PLAN-DRY-VOICE-PLAYBACK.md §3.1 keeps on purpose, and `:122` pins it.

**`web/src/routes/SpeechWatch.tsx`**
```tsx
// before (:477, :818-819)
const seekOwnerTimeline = (seconds: number) => { if (ownerTimelineSeekable()) commentary.seek(seconds) }
…
onSeek={seekOwnerTimeline}
onVoiceNoteActivate={(note) => { if (ownerTimelineSeekable()) commentary.voicePlayback.armNote(note) }} onOpenNotes={openOwnerNotes}

// after
const seekOwnerTimeline = (seconds: number) => { if (ownerTimelineSeekable()) commentary.seek(seconds) }
// TimelineStrip seeks, then reports a Voice point. Arm it under the seek's own guard:
// armNote never seeks (PLAN-VOICE-NOTE-CLICK-AND-ROW-PLAY.md §1.2).
const armOwnerTimelineNote = (note: Annotation) => { if (ownerTimelineSeekable()) commentary.voicePlayback.armNote(note) }
…
onSeek={seekOwnerTimeline}
onVoiceNoteActivate={armOwnerTimelineNote} onOpenNotes={openOwnerNotes}
```
Add `import type { Annotation } from '@/features/annotation/types'`. `SpeechWatch.tsx` doesn't import that module today.

### 1.3 Tests

**New: route-level wiring.** Write it first; it passes before and after the change. Put it in `SpeechWatchOwnerTimeline.test.tsx`, inside "draggable timeline owner cache, source and native voice boundaries" (`:900-1153`), whose `scrubSeam` gives the native seek seam (`:388-389`, `:127-136`). Name it "an owner Voice point seeks once to its start and arms it: Play starts it at once". Steps:
1. Route the note's URL to a `deferred` that never resolves, as `:1098-1099` do. No `Audio` stub is needed, because nothing is constructed.
2. Run `watch()`, `await loaded()` and `const instance = currentPlayer()`.
3. Set up the video's paused state as `:1114-1117` do, but **start with `paused = true`**.
4. Run `await armVoiceAhead(instance.video, () => instance.advance(11.5))`. It waits until the engine is live (see its comment, `:339-351`). Don't use RTL's `waitFor` around dispatched events.
5. Run `fireEvent.click(screen.getByTestId('voice-marker-a-voice'))`, then `await flushMedia()` so that the queued `seeking`/`seeked` events run.
6. `expect(instance.seeks).toEqual([12])`: exactly one seek, to the note's start.
7. Run `act(() => { paused = false; instance.video.dispatchEvent(new Event('play')) })`.
8. Run `await findVoiceStatus('Loading voice commentary…', instance.video)`. Then assert that `network.count('/api/speeches/17/annotations/a-voice/voice-playback-url')` is 1 and that `video.play` was never called.

**Why it discriminates:**
- Without the arm, Play at 12.0 starts nothing. `onPlay` raises `previousTime` past the note, and no tick follows (`voiceInterjectionController.ts:181-197`).
- A second seek would show up in `instance.seeks`.

**Change: `OwnerVideoTools.test.tsx:129-135`.** Replace the vacuous test with the invariant that now stands in for the deleted checks:
```tsx
// The seek and arm callbacks fire only from a rendered marker, so rendering none is the whole guard.
it.each([
  ['the video is not ready', { playbackReady: false }],
  ['there is no video', { videoEl: null }],
  ['commentary is loading', { status: 'loading' }],
  ['commentary is off', { mode: 'off' }],
] satisfies [string, Partial<OwnerVideoToolsProps>][])('renders no markers to seek or arm when %s', (_name, overrides) => {
  render(<OwnerVideoTools {...props(overrides)} />)
  expect(within(screen.getByRole('group', { name: 'Annotation timeline' })).queryAllByRole('button')).toHaveLength(0)
})
```
These four cases are the four ways `canSeek` is false (`:57-58`).

**Unchanged, must stay green:**
- `:115-127`, the seek-then-arm order. A Text marker doesn't arm (`:122`).
- `:91-113`, a single seek.
- `:225-252`, the keyboard path.
- The route tests that click `range-marker-a-text` and assert `currentTime` (`SpeechWatchOwnerTimeline.test.tsx:801-804`, `:829-835`).

**Counts:** `OwnerVideoTools.test.tsx` goes up by 3 (one test becomes four cases). `SpeechWatchOwnerTimeline.test.tsx` goes up by 1.

## §2 F3: `voiceAsset` and `stubFakeAudio` (tests only)

### 2.1 Helpers

**`web/src/test/voiceFixtures.ts`.** Add `voiceAsset`, and have `voiceNote` use it:
```ts
/** The `voice` block of a ready voice note (AnnotationResource). Pass asset_id when the test needs a specific one. */
export function voiceAsset(patch: Partial<AnnotationVoice> = {}): AnnotationVoice {
  return { asset_id: 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null, ...patch }
}

// in voiceNote, replace the inline literal
voice: voice === null ? null : voiceAsset({ asset_id: assetId, ...voice }),
```
- **`voiceNote`'s values are identical.** `...voice` still wins, so even an explicit `asset_id: undefined` gives the same result as before.
- **`asset_id: 1` is the default** because it is the most common value in today's literals (7 of 22).

**`web/src/test/voiceAudio.ts`.** Add `stubFakeAudio`, and have `stubVoiceAudio` use it:
```ts
/** A fresh FakeAudio list as the Audio global. Returns the list that each `new Audio()` appends to. */
export function stubFakeAudio(): FakeAudio[] {
  FakeAudio.instances = []
  vi.stubGlobal('Audio', FakeAudio)
  return FakeAudio.instances
}

export function stubVoiceAudio(loadAudio: Mock, { abort = false }: { abort?: boolean } = {}): void {
  stubFakeAudio()
  loadAudio.mockReset()
  loadAudio.mockImplementation(/* unchanged */)
}
```
Calling the stub before the mock setup changes nothing: no test code runs in between. The global is still restored by each file's `vi.unstubAllGlobals()`.

### 2.2 Per file: convert the literal and keep its values

The rule: convert a literal wherever the values stay identical; any value an assertion depends on stays visible in the patch. The payoff comes later: if `AnnotationVoice` gains a field, only `voiceAsset` changes. Each file adds `import { voiceAsset } from '@/test/voiceFixtures'`, or extends that import where it already exists.

| File (scratch tree) | After | Decision |
|---|---|---|
| `features/annotation/types.test.ts:8` | `voiceAsset({ asset_id: assetId, audio_status: audio })` | convert |
| `components/annotation/AnnotationComposerPanel.test.tsx:20` | `voiceAsset({ asset_id: index + 1 })` | convert the inner literal only. The row's duration, body and `client_uuid` differ from `voiceNote`'s |
| `components/annotation/TimelineStrip.test.tsx:10` | `const voice = voiceAsset()` | convert. `voice` is only spread into `Partial<Annotation>` (`:11`) |
| `components/annotation/VoiceNoteMarkers.test.tsx:15` | `voice: voiceAsset()` | convert |
| `components/annotation/VoicePlaybackControls.test.tsx:8` | `voice: voiceAsset()` | convert. The outer `as Annotation` stays |
| `components/annotation/VoiceAnnotationRow.test.tsx:31, :116, :126` | `voiceAsset({ asset_id: 71 })`; `voiceAsset({ asset_id: 71, transcript_status: 'failed', failure_code: 'voice_transcription_failed' })`; `voiceAsset({ asset_id: 71, transcript_status: 'pending' })` | convert the inner literal only. The previous plan kept the factory because its id, lock, duration and body defaults are asserted; asset 71 stays explicit |
| `components/annotation/Transcript.test.tsx:37` | `voiceAsset({ transcript_status: 'pending' })` | convert. The asserted `pending` stays at the call site |
| `components/annotation/AnnotationList.test.tsx:163, :169` | `voiceAsset({ asset_id: 71 })` twice | convert |
| `components/annotation/AnnotationListPagination.test.tsx:200` | `voiceAsset({ transcript_status: 'failed', failure_code: 'x' })` | convert |
| `components/annotation/AnnotationComposerPreview.test.tsx:224` | `voiceAsset({ asset_id: 4 })` | convert |
| `components/annotation/AnnotationWorkspace.test.tsx:21, :390, :567` | `voiceAsset({ asset_id: 7 })`, `voiceAsset({ asset_id: 4 })`, `voiceAsset({ asset_id: 7 })` | convert. Extend the import at `:10`. `:21` sits in an untyped mock return; a typed value is fine there |
| `components/review/TrackSelector.test.tsx:14` | `voiceAsset()` | convert |
| `components/review/OwnerVideoTools.test.tsx:15` | `voiceAsset({ asset_id: 3, audio_status: 'processing', transcript_status: 'processing' })` | convert. The processing values stay visible |
| `lib/commentaryPlayback.test.ts:11` | `voiceAsset({ asset_id: 2, transcript_status: 'pending' })` | convert |
| `hooks/useCommentaryTrack.test.tsx:18` | `voiceAsset()` | convert. Put the import with the top imports (`:1-4`). `voiceFixtures.ts` has only type imports, so the file's `vi.mock` calls are unaffected |
| `routes/SpeechWatch.test.tsx:1631` | `voiceAsset({ asset_id: 70 })` | convert |
| `routes/SpeechWatchOwnerTimeline.test.tsx:255` | `voiceAsset({ asset_id: speechId + 100 })` | convert |
| `voiceNoteUi.test.tsx:11`, `useVoiceInterjections.navigate.test.tsx:12, :188, :240`, `AnnotationWorkspace.test.tsx:636` | — | **leave.** These already go through `voiceNote` |
| `useVoiceInterjections.test.tsx:505` (`{ ...edited.voice!, asset_id: 99 }`) | — | **leave.** It derives from an existing note on purpose: the same note with a new asset |

### 2.3 The `Audio` classes in `SpeechWatchOwnerTimeline.test.tsx`

**`FakeAudio` can replace all three without changing what the tests check.**
- Every assertion reads the `play`, `pause` and `load` mocks, or counts instances. `FakeAudio` has the same `vi.fn` members.
- Its `play` resolves on the same microtask as the local `async () => undefined`.
- It also has a `paused` field, which the engine never reads (see above).
- The file's `afterEach` already calls `vi.unstubAllGlobals()` (`:472`).
- Add `import { stubFakeAudio } from '@/test/voiceAudio'`.

| Site | Before | After |
|---|---|---|
| `:762-772` | `const audios: HTMLAudioElement[] = []` plus a 9-line class that pushes to it | `const audios = stubFakeAudio()`. The assertions at `:789-807` are unchanged |
| `:816-817`, `:832` | `const createAudio = vi.fn()`, a constructor-only class, and `expect(createAudio).not.toHaveBeenCalled()` | `const audios = stubFakeAudio()` and `expect(audios).toHaveLength(0)`. It checks the same thing, that no `Audio` was ever constructed, and it is the first assertion after the URL resolves. Delete `createAudio`, or tsc reports TS6133 |
| `:1100-1110` | as `:762-772` | `const audios = stubFakeAudio()`. `:1129`'s `vi.mocked(audios[0].pause)` still compiles; `audios[0].pause.mock.calls.length` is the simpler form |

Leave the per-test classes in `useVoiceInterjections.test.tsx` (`RejectingAudio`, `HangingAudio`, `DelayedAudio`). They model behavior `FakeAudio` doesn't have.

### 2.4 Check

Each converted file keeps its test count. Record `npx vitest run <file>` counts before and after for the 17 files. `SpeechWatchOwnerTimeline.test.tsx` holds both a literal (`:255`) and the `Audio` classes, so it counts once.

## §3 F2: e2e helpers (tests only; Playwright runs only on the e2e stack)

### 3.1 Placement

- **Shared, in `web/tests/commentary-test-helpers.ts`** (beside `selectPlaybackMode`): `commentaryTracks` and `chooseCommentaryTrack`. Three specs press the radio, and `TrackSelector.tsx:36` owns the accessible name, so one owner for that name in e2e guards against renames silently breaking Playwright.
- **Spec-local, in `voice-annotations.spec.ts`:** `isPaused`, `waitForMetadata` and `videoPlayCount`. Only this spec uses them, it already keeps ten local video helpers (`seekBeforeCrossing`, `playVideo`, `currentTimeOf`, …), and the play counter is installed by its own `seekBeforeCrossing`.
- **No `support/` directory.** The repo's convention is a flat `*-test-helpers.ts`.

### 3.2 `commentary-test-helpers.ts`

```ts
import { expect, type Locator, type Page } from '@playwright/test'

/** The speaker's reviewer picker (TrackSelector.tsx:36). The one e2e owner of its accessible name. */
export function commentaryTracks(page: Page): Locator {
  return page.getByRole('radiogroup', { name: 'Choose commentary track' })
}

/** Selects a reviewer's commentary the way the specs always have: Space on its radio. */
export async function chooseCommentaryTrack(page: Page, reviewer: string): Promise<void> {
  await commentaryTracks(page).getByRole('radio', { name: reviewer }).press('Space')
}
```

### 3.3 `voice-annotations.spec.ts`: helpers

- **`:1`:** add `type Locator`.
- **`:4`:** import `{ chooseCommentaryTrack, commentaryTracks, selectPlaybackMode }`.
- **`:50-57`:** delete `BrowserVideo`, and put these in its place:
```ts
type PlayCountState = typeof globalThis & { __voiceVideoPlayCount?: number }

async function waitForMetadata(video: Locator): Promise<void> {
  await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)
}

async function isPaused(video: Locator): Promise<boolean> {
  return video.evaluate((node) => (node as HTMLVideoElement).paused)
}

/** Native `play` events since seekBeforeCrossing installed its counter. */
async function videoPlayCount(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as PlayCountState).__voiceVideoPlayCount ?? 0)
}
```
- **Why a plain cast:** `node` is `SVGElement | HTMLElement`, and `as HTMLVideoElement` is a legal narrowing there. It is what `keyboard-shortcuts.spec.ts:69-79` does under the same `tsconfig.e2e.json`.
- **The type alias inside `evaluate` is safe.** Types are stripped before Playwright serializes the function.

### 3.4 Every replacement

| Line(s) | After |
|---|---|
| `:61` | `await chooseCommentaryTrack(page, USERS.reviewerA.name)` |
| `:69`, `:814` | `await waitForMetadata(video)` |
| `:71-72` | `const element = node as HTMLVideoElement` and `const state = globalThis as PlayCountState` |
| `:84, :110, :114, :118, :126, :767` | `ReturnType<Page['getByTestId']>` → `Locator` |
| `:86`, `:769` | `const element = node as HTMLVideoElement`. At `:769`, also drop the `& { playbackRate: number }`: `playbackRate` is on `HTMLVideoElement`. `:86` is a plain `BrowserVideo` cast |
| `:111` | `(node as HTMLVideoElement).currentTime` |
| `:311, :375, :578, :609, :689, :803` | `expect(await isPaused(video)).toBe(true)` |
| `:839` | `expect(await isPaused(video)).toBe(false)` |
| `:674` | `await expect.poll(() => isPaused(video)).toBe(false)` |
| `:819` | `await expect.poll(() => isPaused(video)).toBe(true)` |
| `:322-323` | `await chooseCommentaryTrack(nextVisitPage, USERS.reviewerA.name)` |
| `:359` | `await playVideo(video)`. That is the same `play()` awaited in the page |
| `:377-380` | `const videoPlaysBeforeWatchdog = await videoPlayCount(page)` |
| `:387-390` | `await expect.poll(() => videoPlayCount(page)).toBeGreaterThan(videoPlaysBeforeWatchdog)` |
| `:409-412` | `await prepareSpeakerInterjection(page)`. The four lines are its body (`:60-63`), word for word |
| `:417` | `await expect(commentaryTracks(page).getByRole('radio', { name: USERS.reviewerA.name })).toBeChecked()` |
| `:504` | `await chooseCommentaryTrack(page, 'Former reviewer')` |
| `:534` | `const radiogroup = commentaryTracks(page)` |
| `:650` | `await video.evaluate((node) => (node as HTMLVideoElement).pause())` |
| `:654` | `await video.evaluate((node) => { (node as HTMLVideoElement).currentTime = 0.2 })` |

**Other specs**

| File | Change |
|---|---|
| `captions.spec.ts:305-308` | `await chooseCommentaryTrack(page, USERS.reviewerA.name)`; extend the import at `:6` |
| `essay-editor.spec.ts:739-742` | `await chooseCommentaryTrack(page, reviewerName)`; add `import { chooseCommentaryTrack } from './commentary-test-helpers.js'` after `:3` |
| `app-shell.spec.ts:1942` | `const tracks = commentaryTracks(page)` (locator only; the click at `:1943` stays); add `import { commentaryTracks } from './commentary-test-helpers.js'` after `:6` |
| `two-users.spec.ts:99`, `:119` | `commentaryTracks(page)` (locator only); add `import { commentaryTracks } from './commentary-test-helpers.js'` after the fixtures import (`:9`). This spec isn't in CI's e2e list, so it is only type-checked |

**Afterwards:**
- `voice-annotations.spec.ts` has no `as unknown as` left.
- The spelling "Choose commentary track" survives in `web/tests` only in `commentary-test-helpers.ts` and in two comments (`essay-editor.spec.ts:680, :685`).

### 3.5 Left alone

- **`voice-annotations.cross-browser.spec.ts:24`.** Using `chooseVoiceTool` there would add two assertions to a Firefox/WebKit run that has never exercised them.
- **The video helpers in other specs.** They have the same idea in a different shape:
  - `keyboard-shortcuts.spec.ts:68-79` (page-based);
  - `captions.spec.ts:176`'s `BrowserVideoElement` (the same legacy double cast, 7 sites);
  - `app-shell.spec.ts`'s 8 `element.paused` reads through `presentationExpect`.

  §6 covers these.

### 3.6 How to verify (Playwright can't run here)

1. **`npx tsc -b`** type-checks every spec through `tsconfig.e2e.json`. **`npx eslint .`** lints them.
2. **`npx playwright test --list`** on `tests/voice-annotations.spec.ts`, `tests/captions.spec.ts`, `tests/essay-editor.spec.ts`, `tests/app-shell.spec.ts` and `tests/two-users.spec.ts` with `--project=chromium`, before and after. Strip the positions before diffing, because the edits shift every `file:line:col`: `sed -E 's/\.ts:[0-9]+:[0-9]+/.ts/'`.
   - This only collects tests. It imports each spec, plus `voice-test-helpers.ts`, which reads the committed fixture `api/tests/fixtures/whisper-smoke/spoken-fixture.m4a`.
   - It starts no browser and needs no stack. With positions stripped, the test list must be identical: 113 tests in 7 files, 19 of them in `voice-annotations.spec.ts`.
3. **Greps:**
   - `grep -c "as unknown as" web/tests/voice-annotations.spec.ts` gives 0.
   - `grep -rn "Choose commentary track" web/tests` gives only the lines named above.
4. **The real run.**
   - Stop the dev stack first. The harness refuses to start while that stack owns ports 443, 5433 and 8333 (`scripts/e2e-stack.sh:8-25, :96`).
   - Then run `./scripts/e2e-stack.sh up --fresh` and the two seeders (`ci.yml:266-273`).
   - Then run `E2E_POSTGRES_CONTAINER=speechcoach-e2e-postgres-1 npx playwright test tests/voice-annotations.spec.ts tests/captions.spec.ts tests/essay-editor.spec.ts tests/app-shell.spec.ts --project=chromium`.
   - Alternatively, push and read CI's `e2e` job.

## §4 F1: one status list per enum, checked against PHP (last; blocked on the backend enum)

### 4.1 Options

| | (a) shared JSON | (b) Pest reads the TS lists | (c) generate TS from PHP | (d) Pest regenerates a fixture; Vitest reads it |
|---|---|---|---|---|
| New files | JSON, a Pest test and a Vitest test | one Pest test | an artisan command, a generated `.ts` file and a CI freshness step | a JSON fixture, a Pest test with an update mode and a Vitest test |
| Copies of the list | enum, JSON, TS | enum, TS | enum, generated TS | enum, fixture, TS |
| Crossing between `api/` and `web/` | one suite reads the other's tree | Pest reads `../web` | the generator writes into `../web` | Pest writes across, or Vitest reads across |
| Problem | **If the JSON lives in `api/`:** Vitest needs `node:fs`, which `tsconfig.app.json:7` doesn't type, and a static import breaks the Docker `webbuild`'s `tsc -b`, which only has `web/`. **If it lives in `web/`:** it is (b)'s crossing plus a second test | it parses TS source with a regex, and a frontend-only edit fails in Pest rather than Vitest | the exclusions must be coded into the generator; the most machinery for three short lists | everything in (a), plus a write path |

**Choose (b).**
1. **It is the minimum.** One test, no data file, and two copies (the enum and the TS). The TS has to spell the values anyway for its types.
2. **It runs wherever Pest runs:** on the host and in CI's `test` job. The Docker images either have no Pest or run one filtered test. A skip covers an unfiltered `whisper-smoke` run.
3. **All three layers end up checked by one runner.** This test sits next to the DB-CHECK-to-enum contract test that PLAN-DRY-SCHEMA-STATUS-CONTRACT.md adds (`tests/Feature/Schema/CheckListContractTest.php`).
4. **The exclusions are backend facts**, so the test that states them can cite the PHP lines.

**Cost:** a frontend-only change to a list fails in CI's Pest step. The TS comment names the test and the command. The test parses one fixed form and fails with a message naming that form.

**The contract for each list:**
- `list ∩ excluded = ∅`.
- `list + excluded` equals the enum's values as a multiset. `toEqualCanonicalizing` (Pest 4.7.8; already used at `SpeechAssetResourceTest.php:58`) also catches duplicates.

This is stronger than `list ⊆ enum`: a new enum case fails until the frontend lists it or excludes it with a reason.

### 4.2 TS side (a type-only refactor; every consumer compiles unchanged)

**`web/src/features/annotation/types.ts:11-18`.** It stays import-free, because the e2e project imports it and has no `@/` alias (§4.4). So `VOICE_AUDIO_STATUSES` doesn't reference `SpeechAssetStatus`; the Pest test checks that it is a subset instead.
```ts
/** App\Enums\TranscriptStatus without `not_applicable`, which only ever comes with `voice: null`.
 * Checked by api/tests/Unit/FrontendStatusContractTest.php, which parses this exact
 * `export const … = [...] as const` form (cd api && php -d memory_limit=1G vendor/bin/pest tests/Unit/FrontendStatusContractTest.php). */
export const VOICE_TRANSCRIPT_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const
export type VoiceTranscriptStatus = (typeof VOICE_TRANSCRIPT_STATUSES)[number]

/** App\Enums\SpeechAssetStatus without `uploading`: a voice asset is created `processing`. Same contract test. */
export const VOICE_AUDIO_STATUSES = ['processing', 'ready', 'failed'] as const
export type VoiceAudioStatus = (typeof VOICE_AUDIO_STATUSES)[number]

export interface AnnotationVoice {
  asset_id: number
  audio_status: VoiceAudioStatus
  transcript_status: VoiceTranscriptStatus
  failure_code: string | null
}
```

**`web/src/features/speech/types.ts:18`**
```ts
/** App\Enums\SpeechAssetStatus, every case. Checked by api/tests/Unit/FrontendStatusContractTest.php. */
export const SPEECH_ASSET_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const
export type SpeechAssetStatus = (typeof SPEECH_ASSET_STATUSES)[number]
// in SpeechAsset
status: SpeechAssetStatus
```

**Other spellings:**
- **`web/src/features/caption/types.ts:24`:** `status: 'unavailable' | SpeechAssetStatus`, with `import type { SpeechAssetStatus } from '@/features/speech/types'` at `:1`, above the doc comment. That comment documents `Captions`, so an import placed under it would separate it from the interface. No e2e spec imports this file. No separate list is needed: `'unavailable'` is not an enum case.
- **`web/src/routes/SpeechWatch.test.tsx:546`:** `videoStatus = 'ready' as SpeechAssetStatus`. Extend the type import at `:16`.
- **`web/tests/voice-annotations.spec.ts:23-31`:** add `import type { VoiceAudioStatus, VoiceTranscriptStatus } from '../src/features/annotation/types.js'`, following the precedent at `app-shell.spec.ts:7-8`. Type the payload's `voice` block with these two types.

None of the new names collide with existing ones (grep: `SpeechAssetStatus`, `VoiceAudioStatus` and the two `*_STATUSES` names are all new).

### 4.3 The Pest contract test: `api/tests/Unit/FrontendStatusContractTest.php` (new)

A unit test, because it needs no database. `tests/Pest.php` binds `Unit` to `TestCase` without `RefreshDatabase`.
```php
<?php

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;

/*
 * PLAN-DRY-FRONTEND-FOLLOWUPS.md F1. The web client mirrors these enums as
 * `export const NAME = [...] as const` lists. Each list plus its exclusions must
 * equal the enum, so a new case fails here until the frontend lists or excludes it.
 *
 * It reads web/ beside api/, which holds on a host checkout and in CI's `test` job.
 * The app image has no Pest (--no-dev); whisper-smoke runs one filtered test.
 * The skip covers an unfiltered run in an image that bakes only api/.
 */
function frontendStatusList(string $file, string $name): array
{
    $source = (string) file_get_contents(dirname(base_path()).'/web/src/'.$file);
    $count = preg_match_all('/^export const '.$name.' = \[([^\]]*)\] as const$/m', $source, $match);
    expect($count)->toBe(1, "web/src/{$file} must declare `export const {$name} = [...] as const` exactly once");
    preg_match_all("/'([a-z_]+)'/", $match[1][0], $values);

    return $values[1];
}

/** @param list<string> $list @param list<\BackedEnum> $cases @param list<string> $excluded */
function expectFrontendMirror(array $list, array $cases, array $excluded = []): void
{
    expect(array_values(array_intersect($list, $excluded)))->toBe([])
        ->and([...$list, ...$excluded])->toEqualCanonicalizing(array_column($cases, 'value'));
}

$webMissing = fn (): bool => ! is_dir(dirname(base_path()).'/web/src');
$why = 'web/ is not beside api/ (an image that bakes only api/)';

it('lists every SpeechAssetStatus for speech assets', function () {
    expectFrontendMirror(frontendStatusList('features/speech/types.ts', 'SPEECH_ASSET_STATUSES'), SpeechAssetStatus::cases());
})->skip($webMissing, $why);

it('lists SpeechAssetStatus minus uploading for voice audio', function () {
    // A voice asset is created `processing` (VoiceNoteService); only video uploads use `uploading`.
    expectFrontendMirror(frontendStatusList('features/annotation/types.ts', 'VOICE_AUDIO_STATUSES'), SpeechAssetStatus::cases(), ['uploading']);
})->skip($webMissing, $why);

it('lists TranscriptStatus minus not_applicable for voice transcripts', function () {
    // `voice` is null without an audio asset (AnnotationResource), and `not_applicable` is only ever
    // written with `audio_asset_id => null` (purge, erasure) or as the written-note default.
    expectFrontendMirror(frontendStatusList('features/annotation/types.ts', 'VOICE_TRANSCRIPT_STATUSES'), TranscriptStatus::cases(), ['not_applicable']);
})->skip($webMissing, $why);
```
- **Helper names:** they are file-scope functions, as in other test files (`ClamdScannerTest.php:12`). Their names are unique across the suite.
- **`->skip(Closure, string)`** is Pest 4.7.8's signature (`TestCall.php:239`). `RealWhisperAdapterSmokeTest.php:218-221` uses the same form.
- **The regex** matches single-line and multi-line array literals. It fails if the form changes, for example `as const satisfies …`.
- **Lint:** `pint --test` covers the file. PHPStan's `paths` don't include `tests` (`phpstan.neon`).

### 4.4 Prerequisite and fallback

- **The test needs both enums.** If PLAN-DRY-BACKEND-VOICE.md names them differently, change only the `use` lines. `array_column($cases, 'value')` works on any backed enum.
- **If the backend plan ships `SpeechAssetStatus` without `TranscriptStatus`:**
  - ship §4.2 in full, and the first two tests;
  - add the third test when the enum exists;
  - don't put a literal list in the test. It would be a third copy, and no DB check covers it.
- **§4.2 alone does not depend on the backend.** If the backend plan stalls, it can land earlier as a type-only commit. Leave out the comment lines that name the test until the test exists.

### 4.5 Tests and counts

- **Pest:** +3 tests.
- **Vitest:** no test changes.
- **`tsc -b`** proves the unions are unchanged. Every consumer compiles, including the three tests that use `AnnotationVoice['audio_status']` (`types.test.ts:4`, `voiceNoteUi.test.tsx:11`, `useVoiceInterjections.navigate.test.tsx:12`).
- **Optional, during implementation only:** add an `expectTypeOf<VoiceAudioStatus>().toEqualTypeOf<'processing' | 'ready' | 'failed'>()` line to `types.test.ts`. Run `tsc -b`, then delete the line; kept, it would be yet another copy of the list.
- **Commands in `api/`:**
  - `./vendor/bin/pint --test`;
  - `php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G`;
  - `php -d memory_limit=1G vendor/bin/pest tests/Unit/FrontendStatusContractTest.php`;
  - then the full `php -d memory_limit=1G vendor/bin/pest`.

## §5 Verification

After each step, run CI's commands (Ground rules). The rev 2 adversarial pass confirmed every number below except the Playwright column, which needs the stack. The baseline is the previous plan's validated result.

| Step | tsc | eslint | vitest (files / tests) | Pest | Playwright |
|---|---|---|---|---|---|
| Baseline (scratch `81a9da7`) | OK | 0 errors / 5 warnings | 145 / 1598 | — | — |
| §1 F4 | OK | 0 / 5 | 145 / 1602 (+3 `OwnerVideoTools`, +1 `SpeechWatchOwnerTimeline`) | — | no change expected |
| §2 F3 | OK | 0 / 5 | 145 / 1602; each converted file unchanged | — | — |
| §3 F2 | OK | 0 / 5 | 145 / 1602 | — | `--list` identical once positions are stripped (§3.6); stack run green |
| §4 F1 | OK | 0 / 5 | 145 / 1602 | +3 | — |

**Mutation checks.** Each one must turn the named tests red; then revert it.
- **F4:**
  - make `armOwnerTimelineNote` do nothing: the new route test fails at `findVoiceStatus`;
  - drop the `m.kind === 'voice'` condition, so that every marker arms: the `OwnerVideoTools` test at `:115-127` fails at `:122`;
  - set `const markers = navigationAnnotations`: all four cases of the new `it.each` fail.
- **F3:**
  - change `voiceAsset`'s default `audio_status` to `'processing'`: 57 tests fail.
    - TrackSelector's "shows ▶ in Audio only and its Read all feedback…" fails, along with one other TrackSelector test.
    - Through `voiceNote`: 38 tests in `useVoiceInterjections.test.tsx`, 4 in `voiceNoteCoach.test.tsx` and 3 in `AnnotationWorkspace.test.tsx`.
    - Through direct `voiceAsset` calls: 4 in `VoiceAnnotationRow.test.tsx` and 6 in `SpeechWatchOwnerTimeline.test.tsx`.
    - voiceNoteUi stays green: its `voiced()` (`voiceNoteUi.test.tsx:11`) sets `audio_status` itself.
  - drop `FakeAudio.instances = []` from `stubFakeAudio`: "ignores a delayed voice URL…" (`:813`) fails, because the instance from `:759` leaks into it.
- **F1:**
  - add `'archived'` to `VOICE_AUDIO_STATUSES`: the voice-audio test fails;
  - add `'uploading'` to it: the same test fails on the intersection;
  - add a case to `SpeechAssetStatus` locally: both asset tests fail;
  - append `satisfies readonly string[]` after `as const`: the declaration message fires.
- **F2:** this check needs the stack. Make `isPaused` return `!paused`: Scenario C fails at `:311`.

**Host load.** Under a host load average above about 20, unrelated files hit test timeouts; `SpeechWatchOwnerTimeline.test.tsx` is the usual one, and F4 adds a test to it. Re-run that file alone before treating a timeout as a regression.

## §6 Out of scope (found by the review)

- **The point-rule drift between frontend and backend** (PLAN-DRY-VOICE-PLAYBACK.md §6). That plan's §7 #6 put it "in the same pass" as F1. Fixing it changes how erased notes are classified in the UI, so it doesn't belong in a no-behavior-change plan.
- **Duplicated e2e payload builders.** `accessibility.spec.ts:430-485` and `app-shell.spec.ts:681-736` are byte-identical: 56 lines, including `notebookToolsAnnotations` and a `voice()` payload builder. A shared e2e fixture module is the fix.
- **Video helpers across specs** (§3.5). A shared `web/tests/video-test-helpers.ts` makes sense once a second spec adopts the locator-based `isPaused`/`currentTimeOf`. Converting `captions.spec.ts`'s `BrowserVideoElement` belongs in the same pass.
- **Row-button names** in `voice-annotations.spec.ts`: "Play voice commentary at 2 seconds, 1 of 2 with this name" ×4 and the Pause variant ×3. They stay literal: they are the names a user hears, and they are asserted as such.
- **`features/privacy/types.ts:8` `ExportStatus`** belongs to a different enum (data exports).

## §7 Review log

- **rev 1 (2026-11-14):** written from a read-only review of the scratch tree after PLAN-DRY-VOICE-PLAYBACK.md, the repo's `web/tests`, `api/`, the CI workflow and the Docker build. The counts and the claims below were checked by grep and by reading the code. Nothing was run.
- **Corrections to the brief:**
  - **F2 counts:** `__voiceVideoPlayCount` appears on 7 lines, but there are only 2 reads. The "Choose commentary track" radio is pressed 4 times in the voice spec; 6 is the count across three specs.
  - **F4:** `OwnerVideoTools.test.tsx:129-135` can fail, through its zero-buttons assertion. Only its activation assertion is vacuous.
  - **F3 lines:** `AnnotationWorkspace.test.tsx`'s literals sit at `:21, :390, :567` in this tree. Four more literals exist: `types.test.ts:8` and `VoiceAnnotationRow.test.tsx:31, :116, :126`.
  - **F1 mirrors:** there are five TS mirrors of the status lists, not two: `speech/types.ts:18`, `caption/types.ts:24` and the e2e payload type, in addition to the two in `types.ts`.
  - **F1 container constraint:** a Pest test that reads `../web` is not blocked by the container. The app image has no Pest at all, and the one Pest image runs a single filtered test.
- **Found beyond the brief:**
  - the double cast's cause: `tsconfig.e2e.json` already has the DOM lib;
  - the missing route-level test for the owner Voice-point arm;
  - the byte-identical e2e builders (§6).
- **Not covered:** any run. The adversarial pass should apply §1–§4 to a scratch copy (redirect `tsBuildInfoFile` and the Vite caches first, as the previous plan's validation did), run every command in §5 and the mutation checks, and run `--list` for F2.
- **rev 2 (2026-11-14):** the adversarial pass.
  - **How it ran:**
    - rev 1 was applied to a scratch copy of the post-PLAN-DRY-VOICE-PLAYBACK.md `web/` and to the repo's `api/`, in order F4 → F3 → F2 → F1, with one commit per step.
    - Before F1's Pest half, only PLAN-DRY-BACKEND-VOICE.md's two enum files (its §1.1 and §2.1, verbatim) were applied to the scratch `api/`.
    - CI's commands ran after each step. The per-step numbers are in the Status.
  - **Findings and fixes:**
    - **MAJOR, §3.4 "Other specs":** `app-shell.spec.ts` and `two-users.spec.ts` used `commentaryTracks` without importing it. `tsc -b` failed with `TS2304: Cannot find name 'commentaryTracks'` at `app-shell.spec.ts(1942,22)`, `two-users.spec.ts(99,22)` and `(119,16)`. That would fail CI's `test` job and the Docker `webbuild`. Fix: both rows now name the import. With it, tsc passed and nothing else changed.
    - **MINOR, §5 F3 mutation 1:** rev 1 predicted that the voiceNoteUi ▶ tests would fail. None did, because `voiced()` passes `audio_status` explicitly. Fix: the bullet now lists the 57 failures that do occur.
    - **NIT, §3.6 step 2 and the §5 table:** a raw `--list` diff is never identical, because every `file:line:col` shifts (218 diff lines). Fix: strip the positions first. With them stripped, the lists matched: 113 tests in 7 files, 19 in the voice spec.
    - **NIT, §2.4:** the count of converted test files is 17, not 18.
    - **NIT, §3.4 `:86`/`:769` row:** only `:769` has the `& { playbackRate: number }`.
    - **NIT, §4.2 `caption/types.ts`:** the import's place is now given as `:1`, above the doc comment.
  - **Held up:**
    - **F4:** the new route test passed before the change. All three §5 F4 mutations went red. So did an extra one, an arm that also seeks, which failed on `instance.seeks`.
    - **F3:** all 22 conversions produced exactly the §2.2 patches. Mutation 2 went red, including the `:813` test.
    - **F2:** `as unknown as` count 0. The "Choose commentary track" grep matched the lines named in §3.4 (the essay comments are now at `:681, :686`).
    - **F1 types:** the optional `expectTypeOf` check passed, and a narrowed probe failed with TS2344.
    - **F1 contract test:** it passed as written, and pint passed.
    - **F1 mutations:** all four §5 F1 mutations went red. So did these extra checks:
      - dropping a value from `SPEECH_ASSET_STATUSES` and from `VOICE_TRANSCRIPT_STATUSES`;
      - adding a `TranscriptStatus` case;
      - a duplicate value.
    - **F1 edge cases:** a multi-line literal stayed green. With `web/` absent, all 3 tests skipped.
  - **Not verified:**
    - real Playwright runs, including the F2 `isPaused` mutation and the runtime behavior of the new e2e helpers;
    - the Docker `webbuild` and the e2e images;
    - the whisper-smoke filtered run;
    - the rest of PLAN-DRY-BACKEND-VOICE.md. When it lands, the backend line numbers cited here move.
