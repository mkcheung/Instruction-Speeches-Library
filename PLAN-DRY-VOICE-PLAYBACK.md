# Plan: apply DRY to the voice playback code (items 1–4)

**Status:** rev 2, 2026-11-14. **Ready for implementation; not implemented.**
- **Adversarial review:** two agents. One applied the plan to a scratch copy of `web/` and ran CI's commands; the other checked every claim against the code. Rev 1 failed CI in four places and broke one test file when read literally. Every finding is folded in (§8).
- **Validation:** with rev 2 applied to the scratch copy, CI's commands pass. `tsc -b` is clean; `eslint .` gives 0 errors and the same 5 warnings; `vitest run` passes 145 files and 1598 tests (baseline 144 and 1583; +15 new tests). All three mutation checks in §5 turn their tests red.

**Scope:** frontend only (`web/`). The backend and database schema were reviewed to pin down the rules the frontend must mirror. Items 1–4 need no change there, and §7 lists what those reviews found for later.

**Baseline:** the uncommitted working tree after the voice-note click-and-row-play work and its code-review fixes.

**Line numbers** refer to that baseline tree. Each step shifts the lines after it; after §1, for example, controller lines from `:218` on move down by one.

## Goal

Four duplications in the voice playback code, each with one owner afterwards:

| # | Duplication | One owner after |
|---|---|---|
| 1 | "Is this voice note playable?" (`audio_status === 'ready'`): 7 checks, plus 2 "same playable note" identity checks (9 in all) | `isPlayableVoiceNote` / `isSamePlayableVoiceNote` in `features/annotation/types.ts` |
| 2 | The engine starts an audio element the same way in `playNext` and `resumeCommentary` | one private `startAudio` |
| 3 | Voice-note test fixtures (6 factories) and audio-mock setup (8 blocks) | `web/src/test/voiceFixtures.ts` and two helpers in `web/src/test/voiceAudio.ts` |
| 4 | The `if (note.voice)` guard before `armNote` at 3 call sites | an early return inside `armNote` |

**No user-visible change**, except one edge case in item 4 (§3.3).

## What the reviews established

**Backend** (what the frontend predicate must mirror)
- The playback URL endpoint is `VoiceAnnotationController::audioUrl` (`api/app/Http/Controllers/…/VoiceAnnotationController.php:46-74`, route `api/routes/api.php:189-191`). It serves audio only when the linked asset's status is `ready`. `processing` and `failed` return 409; any other status returns 404. It doesn't look at the transcript status.
- So the frontend rule is exactly `note.voice !== null && note.voice.audio_status === 'ready'`.
  - Rows in the list have already passed the endpoint's visibility checks.
  - The frontend can't see an erasure in progress, a revocation after the list loaded, or email verification, and doesn't need to.
- **Asset status values.** There is no PHP enum. The database CHECK allows `uploading | processing | ready | failed`, and voice assets only ever hold the last three. The frontend type (`types.ts:15`) matches what voice notes can carry.
- **Re-recording creates a new annotation id and a new asset id.** An annotation's `asset_id` only ever changes from a number to `null`, on erasure or purge. The engine's `(id, asset_id)` identity is defensive and stays.
- **Payload shape** (`AnnotationResource.php:35-49`):
  - `id` is a string; `start_seconds` and `duration_seconds` are floats.
  - `timing_type` is always present; `body` is never null.
  - `voice` is `{asset_id: int, audio_status, transcript_status, failure_code}` or `null`.

**Schema**
- **Start times compare safely.** `start_seconds` is `NUMERIC(10,3)`. The model casts it with `decimal:3` and the resource sends it as `(float)`. Equal stored values arrive as equal JS numbers, so the engine's `===` on start times is safe for server data.
- **Same-time notes are rare.** The app, not the database, blocks two point notes at the same millisecond within one review (`AnnotationTiming.php:89-90`). Same-time groups in one reviewer's list therefore mostly come from optimistic `tmp_…` rows.

**Frontend** (verified in the baseline tree)
- **Playable sites ("P"):**
  - `voiceInterjectionController.ts:94-95, :218, :235, :297`
  - `Transcript.tsx:71` (dedupe) and `:137` (▶)
  - `VoiceAnnotationRow.tsx:107` ("Preview audio")
- **Identity sites ("I"):** `voiceInterjectionController.ts:64-67` (`canonical`) and `useVoiceInterjections.ts:35-36`.
- `{ id, assetId: note.voice!.asset_id }` is built by hand at controller `:151`, `:277` and `:311`.
- **Leave these alone; they mean something else.** Converting them would hide processing or failed notes that must stay visible.
  - Display labels (Ready / Unavailable / Processing): `Transcript.tsx:160`, `VoiceAnnotationRow.tsx:97, :116-117`, `TimelineStrip.tsx:183`.
  - "A voice record exists, any status" checks:
    - `types.ts:48` `isVoiceAnnotation` and `:53` `isPointAnnotation`
    - `TimelineStrip.tsx:213`, `VoiceNoteMarkers.tsx:14`, `AnnotationList.tsx:338`
    - `AnnotationComposerPanel.tsx:222`
    - `VoiceAnnotationRow.tsx:62, :69, :82, :88-89, :118`
    - `commentaryPlayback.ts:17-18`, `annotationTiming.ts:59`
- `Transcript.tsx:46` sorts with an inline copy of `comparePlaybackOrder` (`crossedNotes.ts:13-14`). D4 of PLAN-VOICE-NOTE-CLICK-AND-ROW-PLAY.md needs the list order to equal the engine order.

## Ground rules

- **Put helpers in `.ts` files, never `.tsx`.** `eslint.config.js:16` applies `reactRefresh.configs.vite`, whose `only-export-components` rule is an error in `.tsx` files, and CI runs `npx eslint .`.
- **The helpers live in `web/src/features/annotation/types.ts`.** It has no imports, so it can't create a cycle, and `lib/` already imports from it. Keep `crossedNotes.ts` Annotation-agnostic: it works on the generic `VoiceNoteTiming`.
- **TypeScript is 6.0.3, which infers type predicates.** An arrow that returns a type-guard call becomes a type guard itself, and that narrows the types downstream. §2.1 relies on this.
- **Order: 2 → 1 → 4 → 3, one commit each.**
  - Items 1, 2 and 4 change production code. Doing them while the old test fixtures are untouched means the unchanged suite checks each refactor.
  - Item 3 changes only tests, so it goes last.
  - After each step, run CI's commands in `web/`: `npx tsc -b && npx eslint . && npx vitest run`. `tsc --noEmit` is a silent no-op here.

## §1 Item 2: one `startAudio` in the engine (do first)

### 1.1 What differs between the two paths (and must stay different)

| | `playNext` (`:145-177`) | `resumeCommentary` (`:345-361`) |
|---|---|---|
| Entry | `clearTimer`, `clearAudio`, dequeue the next canonical note, or `finish(true)` if none | returns unless `this.audio` exists and state is `'paused'`; keeps the same element |
| `active` | sets it (`:151`) | unchanged |
| `++generation` | after setting `active` (`:152`) | first (`:348`) |
| `loading` publish | `{state:'loading', current, hint:null, error:null, source}` | `{state:'loading'}` only |
| 15 s bound | spans the URL load and `play()` | spans `play()` only |
| URL request | `loadUrl`, `this.request`, `unwrap`, stale check, `request = null`, `new Audio`, `this.audio = audio` | none |
| Budget after play | `max(0.001, duration) * 1000 + 3000` | `this.remaining`, frozen by `pauseCommentary` (`:338`) |
| After `await play()`, `playing` publish, `arm(remaining)`, `catch → fail` | identical | identical |

### 1.2 The helper (place it directly after `playNext`)

```ts
/** Wires the end and error handlers to this generation, plays, then starts the safety budget. */
private async startAudio(audio: HTMLAudioElement, generation: number, budgetMs: number): Promise<void> {
  audio.onended = () => { if (this.connected && generation === this.generation) void this.playNext() }
  audio.onerror = () => { if (this.connected && generation === this.generation) this.fail() }
  await audio.play() // a rejection reaches the caller's catch
  if (!this.connected || generation !== this.generation) { audio.pause(); return }
  this.remaining = budgetMs
  this.publish({ state: 'playing' })
  this.arm(this.remaining, generation, this.fail)
}
```

- **`playNext`:** replace `:161-173` with `const audio = new Audio(response.audio.url); this.audio = audio; await this.startAudio(audio, generation, Math.max(0.001, note.duration_seconds) * 1000 + 3000)`. Keep its `try/catch`.
- **`resumeCommentary`:** keep `++generation`, the `{state:'loading'}` publish and `arm(15_000)`. Delete the handler lines `:349-350`, and replace `:354-357` (inside the existing `try {`) with `await this.startAudio(audio, generation, this.remaining)`.

**Why it behaves identically** (confirmed by the review; the existing tests pass unchanged):
- **Handler timing on resume.** The handlers now attach after the publish and the 15 s arm, not before. Nothing can observe that: `publish` only notifies listeners, and media events arrive as later tasks.
- **When `remaining` is read on resume.** It is now read before the `await` instead of after. During the `await` the state is `'loading'`, so `pauseCommentary` returns early (`:337`) and can't change it. `finish` zeroes `remaining`, but it also bumps `generation`, so the helper returns before using the value.
- **Write order.** The writes to `this.audio`, `this.request` and `this.remaining` keep their order. The stale check still comes before the `remaining` write on both paths.
- **Rejection path.** When `play()` rejects, `fail()` now runs one microtask later, because the rejection passes through one more `await`. The success path's `'playing'` publish lands on the same tick as before, so the microtask-counted tests at `:120` and `:232` still pass.
- **Handler operand order.** The two handler conditions were written in opposite orders. Both are side-effect-free, so the order doesn't matter.

### 1.3 Tests to write first (they pass on the current code)

Add a `describe('resumeCommentary')` block in `useVoiceInterjections.test.tsx` after `:147`.

**Setup:**
- Use a note **reached by playback** (`tick(video)`, then wait for `'playing'`, then `pauseCommentary()`), not a ▶ note. A ▶ note starts with `ownsPause = false` (`:321`), so "the video stays paused" would pass vacuously.
- For a `play()` that never settles, start the resume with `act(() => { void result.current.resumeCommentary() })`. `await act(async () => …)` would hang.

**The tests:**
1. **A rejected `play()` on resume:**
   - the note ends with the error "Could not play voice commentary. Play the video to continue.";
   - `video.play` is never called (`pauseCommentary` set `resumeSuppressed`).
2. **`audio.onerror` after a successful resume:** same result as test 1.
3. **A pending `play()` on resume, under fake timers:** the state is still `'loading'` at 14 999 ms and fails at 15 000 ms. `video.play` is never called.
4. **Skip during a pending `play()` on resume, then `play()` resolves:**
   - the stale branch pauses that audio once more than after Skip (`clearAudio` already paused it once);
   - the state stays `'idle'`;
   - `video.play` is never called.
5. **`resumeCommentary()` while the note is playing:** no `play()` call and no re-render (count renders).

The existing `playNext` coverage stays as is: `:42`, `:69`, `:204`, `:232`, `:387`, `:459`, `:494`, and navigate `:299`, `:381`, `:502`.

## §2 Item 1: one "playable voice note" rule

### 2.1 Add to `web/src/features/annotation/types.ts` (after `isVoiceAnnotation`, `:48`)

```ts
/** A voice note whose audio the playback URL endpoint will serve (VoiceAnnotationController::audioUrl). */
export type PlayableVoiceNote = Annotation & { voice: AnnotationVoice & { audio_status: 'ready' } }

export function isPlayableVoiceNote(note: Annotation): note is PlayableVoiceNote {
  return note.voice?.audio_status === 'ready'
}

/** The same recording, still playable: a replaced or erased asset is a different note. */
export function isSamePlayableVoiceNote(note: Annotation, id: string, assetId: number | undefined): boolean {
  return note.id === id && note.voice?.asset_id === assetId && isPlayableVoiceNote(note)
}
```

**`isSamePlayableVoiceNote` returns `boolean` on purpose. It is not a type guard.**
- If it were a guard, TS 6 would infer one for the hook's `notes.find((note) => isSamePlayableVoiceNote(…))`. That would narrow `current`, and with it `VoicePlayback['current']` (`useVoiceInterjections.ts:12`), to `PlayableVoiceNote | null`.
- That breaks 8 test type-checks that pass a plain `Annotation` as `current`: `AnnotationComposerPanel.test.tsx:292, :318, :325`, `voiceNoteUi.test.tsx:87`, `VoicePlaybackControls.test.tsx:26, :31` and `TrackSelector.test.tsx:118, :145`.
- A guard would also be unsound: when it returns false, an argument already typed `PlayableVoiceNote` would narrow to `never`.
- The one place that needs narrowing, `canonical`, writes the guard explicitly (§2.2).

### 2.2 Call sites

| Site | Before | After |
|---|---|---|
| controller `canonical` `:64-67` | inline id + asset + ready | `return this.notes.find((n): n is PlayableVoiceNote => isSamePlayableVoiceNote(n, identity.id, identity.assetId))`; return type `PlayableVoiceNote \| undefined` |
| controller `readyNote` `:271` | returns `Annotation \| undefined` | returns `PlayableVoiceNote \| undefined` (it delegates to `canonical`) |
| controller `playNext` `:148` | `let note: Annotation \| undefined` | `let note: PlayableVoiceNote \| undefined`. **Required:** a declared `Annotation` type stops assignment from narrowing, and `identityOf(note)` fails to compile (TS2345). |
| controller hint survival `:94-95` | `note.id === hint.id && note.voice?.audio_status === 'ready'` | `note.id === hint.id && isPlayableVoiceNote(note)`. **Keep it id-only on purpose:** the comment at `:96` relies on it missing a replaced asset. |
| controller `onTime` `:218`, `refreshHint` default `:235` | inline filter | `this.notes.filter(isPlayableVoiceNote)` |
| controller `startCue` `:297` | ready check inside the timing filter | `this.notes.filter(isPlayableVoiceNote).filter((note) => /* timing condition unchanged */)`. One combined filter would not narrow the type. |
| controller `:151`, `:277`, `:311` | `{ id: note.id, assetId: note.voice!.asset_id }` | module-private `const identityOf = (note: PlayableVoiceNote): VoiceIdentity => ({ id: note.id, assetId: note.voice.asset_id })`. `:151` becomes `identityOf(note)`, `:277` becomes `notes.map(identityOf)`, `:311` becomes `{ ...identityOf(chosen), seconds: chosen.start_seconds }`. `begin(notes: readonly PlayableVoiceNote[], …)`. |
| controller `playNote` `:318` | `chosen.voice!.asset_id` | `chosen.voice.asset_id` (already narrowed) |
| hook `useVoiceInterjections.ts:35-36` | inline id + asset + ready | `notes.find((note) => isSamePlayableVoiceNote(note, snapshot.current!.id, snapshot.current!.voice?.asset_id)) ?? null`. Equivalent: an `undefined` asset only matches notes without voice, which fail the ready check. `current` stays `Annotation \| null` because the helper returns `boolean`. |
| `VoiceAnnotationRow.tsx:107` | `voice?.audio_status === 'ready'` (`voice` is `annotation.voice`, `:61`) | `isPlayableVoiceNote(annotation)` |
| `Transcript.tsx:71`, `:137` | see §2.3 | see §2.3 |

**Types and imports:**
- **Keep `VoicePlaybackSnapshot.current` and `.hint` typed as `Annotation`.** Every `note.voice!` non-null assertion in the controller goes.
- `crossedNotes(playable, …)` is generic over its input (`crossedNotes.ts:24`), so a `PlayableVoiceNote[]` in gives one out, and `begin(crossed, …)` type-checks.
- **New imports:**
  - controller: `isPlayableVoiceNote`, `isSamePlayableVoiceNote` and `type PlayableVoiceNote`;
  - hook: `isSamePlayableVoiceNote`;
  - `Transcript.tsx`: `isPlayableVoiceNote` and `comparePlaybackOrder`;
  - `VoiceAnnotationRow.tsx`: `isPlayableVoiceNote`.

### 2.3 `Transcript.tsx`: tie ▶ to the names map

Today the ▶ condition (`:137`, `canPlayNotes && ready`) and the dedupe set (`:71`, ready) are written separately, and `:162`'s `names.get(a.id)!` assumes they stay equal. Make ▶ follow the map:
- `:71`: `const ready = sorted.filter(isPlayableVoiceNote)`.
- Once per render, before the `return`: `const rowPlayback = voicePlayback?.canPlayNotes ? voicePlayback : undefined`.
- In the row, delete `playable`. Use `const name = names.get(a.id)` and render `{rowPlayback && name !== undefined && <RowPlayButton note={a} name={name} playback={rowPlayback} />}`. No `!` is needed.

### 2.4 `Transcript.tsx:46`: reuse `comparePlaybackOrder` (beyond the four items, same reason)

`[...annotations].sort((a, b) => a.start_seconds - b.start_seconds || a.id.localeCompare(b.id))` becomes `[...annotations].sort(comparePlaybackOrder)`. It is the same comparator, and D4 needs the list and the engine to share one definition. `Annotation` is assignable to `VoiceNoteTiming`.

### 2.5 Tests

New `web/src/features/annotation/types.test.ts`:
- `isPlayableVoiceNote`: `voice: null`, `processing` and `failed` give false; `ready` gives true.
- `isSamePlayableVoiceNote`, false when:
  - the id is the same but the asset differs;
  - `assetId` is `undefined` on a voice note;
  - the id and asset match but the note is processing.

  True when everything matches.

The existing `voiceNoteUi.test.tsx` cases cover §2.3: no ▶ on processing or failed rows, and the ", N of M with this name" suffix counts only ▶ rows.

## §3 Item 4: the guard moves into `armNote`

### 3.1 Change

At the top of `armNote` (`voiceInterjectionController.ts:308`), before `if (this.busy) this.finish(false)`:
```ts
// Only a voice note can be armed. Anything else leaves a playing note and the cue alone (its seek, if any, cancels).
if (!note.voice) return
```
Remove the now-redundant caller guards:
- `Transcript.tsx:149` → `onClick={() => { onSeek(a.start_seconds); voicePlayback?.armNote(a) }}`
- `AnnotationComposerPanel.tsx:454` → `onNavigate: armNote`. `T` resolves to `Annotation` here (`AnnotationComposerPanel.tsx:204-213`). `useKeyboardShortcuts` re-reads its callbacks from refs on every render (`:148-156`), so passing the method instead of an arrow changes no dependencies.
- `SpeechWatch.tsx:603` → `onNavigate: isOwner ? commentary.voicePlayback.armNote : undefined`

**Update the one test that pinned the old caller guard.** `voiceNoteUi.test.tsx:69-75` asserts that clicking the written row never calls `armNote`. After the change it does call it; the engine ignores it, as the new §3.4 test A pins. Rename the test to "row click seeks then arms (armNote ignores rows without voice); ▶ never seeks". Replace `expect(p.armNote).not.toHaveBeenCalled()` with:
```ts
expect(p.armNote).toHaveBeenCalledWith(notes[0])
vi.mocked(p.armNote).mockClear()
```
The `mockClear()` keeps the test's later `invocationCallOrder[0]` check (`:79`) valid.

**Keep these filters; they are harmless.**
- **The marker-kind filters** at `AnnotationComposerPanel.tsx:439` (`activation.kind === 'voice'`) and `OwnerVideoTools.tsx:79` (`m.kind === 'voice'`). `TimelineMarkerActivation` isn't a union (`TimelineStrip.tsx:51-61`). Its `kind` is `'voice'` exactly when the note has voice (`:213-214`), and erased points get `'erased-voice'`. After item 4 these filters are redundant, but they also exclude text markers by name.
- **The click-time `ownerTimelineSeekable()` check** at `SpeechWatch.tsx:819`. `canSeek` doesn't cover it (`SpeechWatch.tsx:475-477`).

### 3.2 Why `!note.voice` and not "not ready"

- **For the three callers, it's a pure move:** `!note.voice` is exactly the guard they already apply.
- **It keeps one rule synchronous for every voice note:** navigating to any voice note, even one still processing, cancels the active note at once.
- **"Not ready" would weaken that.** It would push the cancel for processing or failed notes to the seek's `seeking` event, one task later. The cancel would be lost entirely if no `seeking` fires (a video with no data yet).

### 3.3 The one behavior change

"Go to time" on an **erased** voice point (a point note whose `voice` is `null`) reaches `armNote` unguarded (`AnnotationComposerPanel.tsx:605` → `AnnotationList.tsx:430` → `VoiceAnnotationRow.tsx:104`).
- **Before:** that call cancels a playing note and clears the cue synchronously.
- **After:** the seek's `seeking` event does both one task later.

Two caveats:
- **A cue within 0.05 s of the erased point survives.** Within one review, two point notes can't share a millisecond, so this is practically unreachable.
- **If no `seeking` fires, nothing cancels.** That needs a video with no data while a note is playing, and a playing note means the video had data.

This is the only `armNote` path that changes; the review checked all seven, including the `[`/`]` keys (`useKeyboardShortcuts.ts:171, :182`). Accept the change and note it in the commit message.

### 3.4 Tests

In `useVoiceInterjections.navigate.test.tsx`, inside "Fix A: armNote":
- **Test A:** `armNote` on a note without voice leaves a playing ▶ note playing and an existing cue armed. Nothing calls `finish`, the state stays, and `hint` is unchanged. It fails before the change and passes after.
- **Test B:** `armNote` on a processing voice note still cancels a playing note synchronously. This pins §3.2. It passes both before and after.

Existing coverage to keep green: navigate `:173`, the updated `voiceNoteUi.test.tsx` row-click test, and the coach arm tests in `voiceNoteCoach.test.tsx`.

## §4 Item 3: shared test fixtures and audio mocks (tests only; do last)

### 4.1 `web/src/test/voiceFixtures.ts` (new; follows `web/src/test/friendsFixtures.ts`)

```ts
import type { Annotation, AnnotationVoice } from '@/features/annotation/types'

export type VoiceNoteOverrides = Partial<Omit<Annotation, 'voice'>> & { voice?: Partial<AnnotationVoice> | null }

/** A ready voice note shaped like the API payload (AnnotationResource). asset_id defaults to Number(id). */
export function voiceNote(id: string, start: number, { voice, ...rest }: VoiceNoteOverrides = {}): Annotation {
  const assetId = voice?.asset_id ?? Number(id)
  // NaN never equals itself, so the engine's identity check would treat the note as replaced.
  if (voice !== null && !Number.isFinite(assetId)) throw new Error(`voiceNote('${id}'): pass voice.asset_id for a non-numeric id`)
  return {
    id, timing_type: 'point', start_seconds: start, duration_seconds: 2, kind: 'observation', topic: null,
    body: `voice ${id}`, lock_version: 0, client_uuid: `uuid-${id}`, ...rest,
    voice: voice === null ? null
      : { asset_id: assetId, audio_status: 'ready', transcript_status: 'ready', failure_code: null, ...voice },
  }
}
```
- `duration_seconds: 2` matches today's fixtures. Tests depend on it: the timer-budget tests advance 5001 ms, and 4000 + 999 then 2 ms (`useVoiceInterjections.test.tsx:137-145, :247`).
  - In the real API, 1.0 is only the placeholder written at creation (`VoiceNoteService.php:88`).
  - Normalization writes the measured length (`FfmpegVoiceNoteProcessor.php:87`).
- `timing_type: 'point'` is new for the two engine test files. The engine never reads `timing_type`.

### 4.2 Per file

| File | Change | Values afterwards |
|---|---|---|
| `hooks/useVoiceInterjections.test.tsx:13-25` | delete the local `voice`; add `import { voiceNote as voice } from '@/test/voiceFixtures'` (the alias keeps dozens of call sites unchanged); **delete the now-unused `import type { Annotation }` (`:3`)**, or tsc fails with TS6133 and eslint with `no-unused-vars` | identical, plus `timing_type: 'point'` |
| `hooks/useVoiceInterjections.navigate.test.tsx:11-15` | `const voice = (id: string, start: number, status: AnnotationVoice['audio_status'] = 'ready') => voiceNote(id, start, { voice: { audio_status: status } })`; import `voiceNote` and `type AnnotationVoice` | identical, plus `timing_type` |
| `components/annotation/voiceNoteCoach.test.tsx:37-41` | delete the local `voice`; alias-import as in the first row; **delete the unused `import type { Annotation }` (`:5`)**, and drop `FakeAudio` from the `@/test/voiceAudio` import once §4.3 lands | identical |
| `components/annotation/voiceNoteUi.test.tsx:10-11` | `const voiced = (id: string, s: number, audio: AnnotationVoice['audio_status'] = 'ready') => voiceNote(id, s, { body: \`v-${id}\`, client_uuid: id, voice: { audio_status: audio } })`; import `voiceNote` and `type AnnotationVoice`; `base` and `written` stay | identical (`client_uuid: id` kept on purpose) |
| `components/annotation/AnnotationWorkspace.test.tsx:632-633` | delete the local `voiceNote`; import it; call `voiceNote('v1', 1, { body: 'Spoken words', voice: { asset_id: 5 } })` | identical (the old one spread `note(id, start, 2)`, `:11-13`) |
| `components/annotation/VoiceAnnotationRow.test.tsx:21` | **leave**: its defaults (id `'17'`, lock 4, asset 71, duration 3, body) are what the assertions check | — |
| about 15 other files with inline voice literals | **leave**: each spreads a file-local written-note base | §7 |

Optional, same commit: the asset-swap literals at navigate `:197` and `:249` can become `voiceNote('1', 1, { voice: { asset_id: 99 } })`. The validation applied them.

### 4.3 Audio mocks, in `web/src/test/voiceAudio.ts`

```ts
import type { Mock } from 'vitest'

/** The voice-URL mock, a fresh FakeAudio list and the Audio global. Call in beforeEach; vi.mock/vi.hoisted stay in the test file. */
export function stubVoiceAudio(loadAudio: Mock, { abort = false }: { abort?: boolean } = {}): void {
  FakeAudio.instances = []
  loadAudio.mockReset()
  loadAudio.mockImplementation(({ annotationId }: { annotationId: string }) => ({
    unwrap: () => Promise.resolve({ audio: { url: `https://media/${annotationId}.m4a`, expires_at: '' } }),
    ...(abort ? { abort: vi.fn() } : {}),
  }))
  vi.stubGlobal('Audio', FakeAudio)
}

export function restoreVoiceAudio(): void {
  vi.useRealTimers()
  vi.unstubAllGlobals()
}
```
- **Plain functions**, called from each file's own `beforeEach` and `afterEach`. That matches `src/test/`, where no helper registers hooks itself.
- **Type-only imports are required.** `src/test` is type-checked under `tsconfig.app.json` (`"include": ["src"]`, `:30`), which sets `verbatimModuleSyntax`.
- **The `Mock` type fits.** `Mock` defaults to `Procedure` in vitest 4.1.10, which accepts each file's `vi.hoisted(() => vi.fn())`.

| File | Change |
|---|---|
| `hooks/useVoiceInterjections.test.tsx:28-40` | `beforeEach(() => stubVoiceAudio(loadAudio))` and `afterEach(restoreVoiceAudio)`. The per-test stubs (`RejectingAudio :74`, `HangingAudio :464`, `DelayedAudio :497`, `:506`) stay. |
| `hooks/useVoiceInterjections.navigate.test.tsx` (4 identical blocks: `:43-50`, `:263-270`, `:396-403`, `:454-461`) | one **file-level** `beforeEach(() => stubVoiceAudio(loadAudio, { abort: true }))` and `afterEach(restoreVoiceAudio)`. Every test sits inside one of the four describes, so this is equivalent. |
| `components/annotation/voiceNoteCoach.test.tsx` | **Replace only `:69-76`** (the FakeAudio reset, `localStorage.clear()`, the mock reset and implementation, the `Audio` stub) with `localStorage.clear()` and `stubVoiceAudio(loadAudio, { abort: true })`. **Keep `:77-78`** (`const data = …` and `queryState = …`): without them every test in the file fails (`Cannot destructure property 'data'`). Its own `afterEach` stays too: the `cleanup` and target-removal order matters, and it never uses fake timers. |
| `components/annotation/AnnotationWorkspace.test.tsx:637-638` (inside `setup()`) | `stubVoiceAudio(loadAudio)`. The extra reset is a no-op: the file-level `beforeEach` (`:132-133`) already reset both, and no test touches `loadAudio` before `setup()`. The only id is `'v1'`, so the URL is unchanged. |

### 4.4 Check

Item 3 doesn't change the total test count, and each converted file keeps its own count. Validation: 45, 35, 5, 10 and 31 tests in those files, before and after.

## §5 Verification

After each step, run CI's commands in `web/` (Ground rules). The validation's numbers per step:

| Step | tsc | eslint | vitest |
|---|---|---|---|
| Baseline | OK | 0 errors / 5 warnings | 144 files / 1583 |
| §1 (item 2) | OK | 0 / 5 | 144 / 1588 |
| §2 (item 1) | OK | 0 / 5 | 145 / 1596 |
| §3 (item 4) | OK | 0 / 5 | 145 / 1598 |
| §4 (item 3) | OK | 0 / 5 | 145 / 1598 |

**Mutation checks.** Each must turn the named tests red, then be reverted; all three did in the validation.
- **Item 2:** drop the stale check in `startAudio`. §1.3 test 4 fails.
- **Item 1:** make `isPlayableVoiceNote` also accept `'processing'`. The `types.test.ts` processing cases and the voiceNoteUi "processing row gets no ▶" test fail.
- **Item 4:** delete the early return. §3.4 test A fails.

**Host load.** Under a host load average above about 20, unrelated files hit test timeouts (`SpeechWatchOwnerTimeline.test.tsx` is the usual one). Re-run the file alone before treating that as a regression.

**E2E:** no Playwright change is expected; ▶ names, list order and engine behavior are unchanged. Run `voice-annotations.spec.ts` before merging if the dev stack can be stopped.

## §6 Out of scope (found by the reviews)

- **Tie order between same-time notes.** `comparePlaybackOrder` compares ids as text (`'10' < '9'`). The server orders by numeric id (`AnnotationService.php:49-50`). It's practically unreachable within one review (see Schema), and after §2.4 it's a one-line fix in one place.
- **The "is point" rule differs between frontend and backend.**
  - Frontend: `voice !== null` (`types.ts:53-54`).
  - Backend: `audio_asset_id !== null || transcript_status !== 'not_applicable'` (`Annotation.php:59-63`).
  - Erasure sets `transcript_status` to `'ready'` only when the body is non-empty (`EraseReviewerVoiceNotes.php:56`). So an erased note with a non-empty body and a null `timing_type` is a point on the server but not in the UI.
- **Erasure can hand out a dead URL.** Erasure claims a `ready` asset without changing its status, then deletes the files (`EraseReviewerVoiceNotes.php:35-46`). The URL endpoint doesn't check `purge_claim_id`, so it can return 200 for a deleted file.

## §7 Next areas to examine for DRY

Ranked by payoff, highest first.

**Backend (highest value: the copies have already drifted)**
1. **The normalization-failure routine exists twice, with two drifts.** The copies are `NormalizeVoiceNote.php:70-112` and `FfmpegVoiceNoteProcessor.php:165-205`, both with the same message, reviewer lookup and quota release.
   - The first leaves `transcript_failure_code` as is (`:95`); the second sets it to null (`:178`).
   - The second filters its update on `status = 'failed'` (`:205`); the first doesn't (`:110`).
2. **Asset status strings have no enum.** The literals `'processing'`, `'ready'` and `'failed'` are repeated in about 10 files: the controller, three jobs, two processors, the erase and purge services, `ReviewService` and `VoiceNoteService`. A `SpeechAssetStatus` backed enum with `isPlayable()` would mirror item 1 on the server. It would be used by `VoiceAnnotationController.php:71, :91` and `TranscribeVoiceNote.php:38`.
3. **"Claim, delete files, release quota" is written three times:** `PurgeVoiceAsset.php:40-72`, `PurgeDeletedVoiceAnnotation.php:35-62` and `EraseReviewerVoiceNotes.php:25-66`. The copies differ on purpose, so a shared helper must take the difference as a parameter:
   - `PurgeDeletedVoiceAnnotation` marks the asset `failed` (`:42`);
   - `PurgeVoiceAsset` doesn't (`:46`);
   - Erase fails only `processing` assets (`:36-38`).
4. **"Mark the transcript failed if dispatch throws" is written twice:** `VoiceAnnotationController.php:101-107` and `NormalizeVoiceNote.php:57-65`.
5. **The annotation cap of 200 is a bare literal in four places:** `VoiceAnnotationController.php:134`, `VoiceNoteService.php:47`, `AnnotationService.php:99, :226`.

**Frontend**

6. **The status lists are defined in three layers:** the DB CHECKs, PHP and `types.ts:11, :15`. Once #2 lands, a contract test (or TS unions generated from the PHP enum) would keep them in step. Fixing the §6 point-rule drift belongs in the same pass.
7. **The e2e spec repeats helper code** (`web/tests/voice-annotations.spec.ts`): `.paused` reads ×9, `__voiceVideoPlayCount` reads ×7, the "Choose commentary track" radio press ×6. Candidates: `isPaused(video)`, `videoPlayCount(page)`, `chooseReviewer(page, name)`.
8. **Inline voice-asset literals in tests.** The `{asset_id, 'ready', 'ready', null}` literal appears in the files item 3 leaves alone; the count is not verified. A `voiceAsset(patch)` helper fits next to `voiceNote`. Also, `SpeechWatchOwnerTimeline.test.tsx:763, :817, :1101` stub `Audio` with their own classes and could use `FakeAudio`.
9. **The owner timeline pairs a seek with an arm at two call sites.**
   - `ownerTimelineSeekable()` is evaluated twice per click (`SpeechWatch.tsx:477, :819`).
   - `OwnerVideoTools.tsx:78-79` has two `canSeek` checks that can never fire.

   One `onNavigate(seconds, note?)` prop would collapse both. It changes a prop contract and the order test at `OwnerVideoTools.test.tsx:115-127`.

**Schema (never rewrite applied migrations)**

10. **Migrations repeat the same definitions:**
    - the speech_assets status CHECK list ×6 (`2026_08_08_150003:64, :101`; `2026_08_08_160001:79, :179`; `2026_08_18_110001:48, :131`);
    - the kind and format CHECKs, three or more times each;
    - the SQLite rebuild column lists ×3;
    - `ck_annotations_*` and the annotations index trio ×2.

    Migrations that have already run must stay exactly as written. **Future migrations should also keep literal lists rather than call app code.** Pointing a migration at `SpeechAssetStatus::values()` would let a later enum edit silently change what a fresh `migrate` builds for an old migration. The DRY move is a **contract test** that compares the database's CHECK list to the enum from #2.

## §8 Review log

- **rev 1 (2026-11-13):** drafted from four read-only reviews (backend, schema, frontend production, frontend tests). Claims spot-checked against the tree.
- **rev 2 (2026-11-14), adversarial pass.** One agent applied rev 1 to a scratch copy of `web/` and ran CI's commands after each step, then the §5 mutation checks. A second agent checked about 45 citations and every equivalence claim, without running anything.
  - **Found by both:**
    - `playNext`'s `let note: Annotation | undefined` (`:148`) blocks narrowing; `identityOf(note)` failed tsc. Fixed in the §2.2 table.
    - TS 6 inferred a type guard from the hook's `.find`, narrowing `VoicePlayback.current` and failing 8 test type-checks. Fixed by making `isSamePlayableVoiceNote` return `boolean` (§2.1). I re-validated that variant myself: tsc clean, and 653 tests in the touched folders, then the full suite at 1598, pass.
    - Removing the Transcript guard failed `voiceNoteUi.test.tsx`'s "voice rows only" test. That test is now updated in §3.1. The cited "SpeechWatch arm tests in voiceNoteUi" don't exist; the reference is removed.
    - The voiceNoteCoach `beforeEach` rewrite dropped the `queryState` setup, so all 5 tests in that file failed. §4.3 now says to replace `:69-76` only.
  - **Found by the executor:** deleting the local factories left unused `Annotation` imports (tsc TS6133 and eslint errors) and an unused `FakeAudio` import. §4.2 now says to delete them.
  - **Minor fixes:**
    - §1.3 now spells out test setup: a note reached by playback, `act(() => { void … })` for a pending `play()`, and test 4's pause count.
    - Line ranges corrected: `:354-357`, the navigate setup blocks, `AnnotationTiming.php:89-90`, and the migration CHECK lines.
    - Imports and the `startAudio` placement are now listed.
    - §2.3 picks one render form.
    - §3.1's "union discrimination" wording is corrected to marker-kind filters.
    - §3.3 gained the no-`seeking` caveat.
    - The "leave alone" list was completed.
    - The Goal table count is fixed (7 + 2).
    - §4.1's "real notes are 1.0 s" is corrected.
  - **§7 fixes:**
    - #10 no longer suggests migrations call app code; it now proposes a contract test.
    - #3 notes the copies differ on purpose.
    - #1 lists its second drift.
    - §6's point-rule example is narrowed to non-empty bodies.
  - **Held up under review:** §1.2's equivalence argument, §2.3, §2.4, §3.2 and the single behavior change in §3.3, all fixture values in §4, and the navigate file-level hooks.
  - **Reference implementation:** the validated diff is in the session scratchpad (`scratchpad/dry/plan-applied-rev2.diff`, 15 files, +278 −147). It may be cleared and is not a deliverable.
