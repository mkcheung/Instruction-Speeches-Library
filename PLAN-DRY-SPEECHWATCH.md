# Plan: DRY and split `SpeechWatch.tsx`

**Status:** rev 2, 2026-11-18. **Validated on a scratch copy; not implemented.** Every step was applied as written to a copy of `web/` at `052c392`; the corrections are in §5 (rev 2).
**Scope:** `web/src/routes/SpeechWatch.tsx`, and what it splits into:
- three new hooks in `web/src/hooks/`;
- one new component file in `web/src/components/speech/`;
- one new helper in `web/src/features/review/reviewAccess.ts`.

No other file changes. No behavior change. No test is added, removed or edited. Every comment and the Essay feature move unchanged (Ground rules).

**Baseline:** `development` at `052c392`. `SpeechWatch.tsx` is unchanged since `b2c5e8e`, so the line numbers below are current.

## Goal

`SpeechWatch` is one 791-line function (`:249-1039`): 436 lines of logic declaring 77 locals in one scope, then 355 lines of JSX. Two parts:

- **Part A, DRY inside the file:** 12 expressions or blocks written 2–4 times each become one definition each (§1).
- **Part B, the split:** the logic moves into three concern hooks, and the two tab strips into one component file (§2).

| | After |
|---|---|
| playback source, player binding, aspect ratio, captions | `hooks/useSpeechWatchMedia.ts` |
| owner identity, commentary track, owner timeline and tab | `hooks/useSpeechWatchOwner.ts` |
| reviewer review, preview targets, timeline validation, recording lock and tab | `hooks/useSpeechWatchReviewer.ts` |
| the owner and reviewer tab strips | `components/speech/SpeechWatchTabs.tsx` (`OwnerTabs`, `ReviewerTabs`) |
| route params, queries, fullscreen state, live scrub, companion scene, keyboard map, early returns, header, player, captions bar, owner video tools | stays in `SpeechWatch.tsx` |

Validated result: `SpeechWatch.tsx` shrinks from 1159 to 553 lines. The new files are 180 (media), 109 (owner), 217 (reviewer) and 240 (tabs) lines.

## What the review established

**The duplications (all in `SpeechWatch.tsx`):**

| # | Written | Where |
|---|---|---|
| A1 | "player still bound to its video": `!player.isDisposed() && getVideoElement(player) === video`, or its negation | ×4: `:397` (captions effect), `:436` (`concreteReady`), `:476-477` (`ownerTimelineSeekable`), `:565` (`seekScrub`) |
| A2 | "the rendered source is this route's ready asset": `asset?.status === 'ready' && playbackSource?.speechId === speechId && playbackSource.assetId === asset.id` | ×3: `:437-438` (`ownerSourceMatches`), `:508-509` (`sourceMatches`), `:541-542` (`reviewerScrubReady`) |
| A3 | "a live review that grants access to this speech": `review.speech?.id === speechId && review.revoked_at === null && isAccessGrantingReviewStatus(review.status)` | ×3: `:135-136` (`accessReview`), `:513-515` (`previewIdentity`), `:526-527` (`reviewerValidationScope`). A 4th copy is in `hooks/useMyReviewForSpeech.ts:29`, which is out of scope (§4). |
| A4 | the owner commentary's visibility: `htmlFullscreen ? fullscreenControlsOpen : ownerTab === 'notes'` | ×2: `:445` (`useCommentaryTrack` argument), `:496` (`playbackControlProps.visible`) |
| A5 | the selected reviewer's label: `commentary.options.find((o) => o.key === commentary.selected)?.label` | ×2: `:459-460`, `:889` |
| A6 | the guarded seek: `(seconds) => { if (videoEl) seekVideo(videoEl, seconds) }` | ×4: `:604-606`, `:912-914`, `:1014-1016`, `:1029-1031` |
| A7 | the feedback frame: `<div className="owner-feedback-frame" style={{ '--video-ar': videoAr }}><OverlayPositioner anchor={captionsAnchor}>…` | ×2: `:741-751` (owner), `:767-771` (reviewer) |
| A8 | the reading-panel wrapper: `workspace-notebook-surface workspace-notebook-panel workspace-notebook-reading` | ×3: `:873`, `:900`, `:1026` |
| A9 | "the video can be shown": `asset?.status === 'ready' && initialUrl` | ×4: `:578`, `:701`, `:789`, `:952` |
| A10 | a valid route id: `Number.isSafeInteger(speechId) && speechId > 0` | ×2: `:299`, `:419` |
| A11 | the loaded speech is this route's: `Number(speech?.id) === speechId` | ×4: `:300`, `:420`, `:526`, `:540` |
| A12 | the terminal denials: `isTerminalAccessError(error)` / `isTerminalAccessError(meError)` | ×3 each: `:422-423`, `:532-533`, `:540` |

**Look-alikes that must not merge.** The three duration fallbacks behave differently:
- `:461-462`: non-finite or non-positive → `0`;
- `:754`: `null` → `videoEl?.duration ?? 0`;
- `:1009-1011`: `null` → `0`.

Merging them would change behavior.

**Type narrowing.** A9's condition narrows two things inside its branches:
- `asset`: `:754` and `:1010` read `asset.duration_seconds` with no `!`;
- `initialUrl`, to `string`: `:730` passes `initialUrl={initialUrl}`.

So A9 must be an object that carries both, not a boolean (§1).

**Test coupling.**
- `SpeechWatch.test.tsx:14` imports `SpeechWatch`, `PosterFramePicker` and `OverlayPositioner` from `@/routes/SpeechWatch`; `SpeechWatchOwnerTimeline.test.tsx:26` imports the default export. `App.tsx:22` is the only other importer.
- The tests mock `@/components/annotation/AnnotationComposerPanel`, `@/components/annotation/VoiceRecorder` and `@/components/speech/VideoPlayer`, by module path. Those mocks still apply wherever the importing code lives.
- No test mocks a hook that this plan moves.
- `SpeechWatchOwnerTimeline.test.tsx:899` spies on `OwnerVideoTools` through its module namespace, and `SpeechWatch.test.tsx:139` records every `AnnotationComposerPanel` render (`panelSpy`). Both still see the same renders: `OwnerVideoTools` stays in `SpeechWatch.tsx`, and `ReviewerTabs` re-renders exactly when `SpeechWatch` does.

**Tooling.**
- There is no React Compiler in the build: `vite.config.ts` uses `plugins: [react(), tailwindcss()]`. So moving code changes no memoization.
- eslint runs `eslint-plugin-react-hooks` 7.1, whose compiler-derived rules (refs, purity, set-state-in-render) apply to the new hooks too.
- TypeScript 6.0.3 is strict by default (`tsconfig.app.json` sets no `strict`), with `noUnusedLocals` and `noUnusedParameters` on. An unused import or destructured input fails `tsc -b` (TS6133) as well as eslint's `no-unused-vars`, so each step also moves its imports (listed per step in §2).

**Hook order (the main risk of Part B).** React runs effects in declaration order: layout effects first, then passive ones. The current sequence of hook calls in `SpeechWatch`:

| # | Hook | Line | Effects |
|---|---|---|---|
| 1 | `useParams` | 250 | — |
| 2 | `useSearchParams` | 254 | — |
| 3 | `useGetSpeechQuery` | 256 | RTK |
| 4 | `useGetMeQuery` | 257 | RTK |
| 5 | `useLazyGetPlaybackUrlQuery` | 258 | RTK |
| 6–12 | `useState` playbackSource, readyPlayback; `useRef` playerRef; `useState` videoEl, measuredAr, captionsTrack, sourceRefreshToken | 259-285 | — |
| 13–16 | `useState` ownerTab; `useRef` ownerNotesTabRef, focusOwnerNotesRef; `useState` validatedOwnerKey | 286-289 | — |
| 17–18 | `useState` reviewerTab, recordingLock | 290-291 | — |
| 19–20 | `useState` htmlFullscreen, fullscreenControlsOpen | 292-293 | — |
| 21 | `useEffect` playback-URL fetch | 304 | passive |
| 22–23 | `useCallback` refreshUrl, onPlayerReady | 327, 335 | — |
| 24 | `useEffect` loadedmetadata | 348 | passive |
| 25–26 | `useCaptionsJob`, `useCaptionsBlobUrl` | 381-382 | inside |
| 27 | `useEffect` caption-track attach | 393 | passive |
| 28 | `useCaptionsAnchor` | 410 | inside |
| — | render-time `setValidatedOwnerKey` | 429 | — |
| 29 | `useCommentaryTrack` | 444 | inside |
| 30 | `useEffect` owner Notes focus | 463 | passive |
| 31 | `useMyReviewForSpeech` | 503 | inside |
| 32–33 | `usePresentationTarget` ×2 | 517-518 | — |
| 34 | `useReviewerTimelineValidation` | 529 | layout + passive |
| 35 | `useRef` liveScrub | 546 | — |
| 36 | `useLayoutEffect` liveScrub | 550 | layout |
| 37 | `useCallback` onRecordingLockChange | 568 | — |
| 38 | `usePublishWorkspaceCompanion` | 585 | inside |
| 39 | `useKeyboardShortcuts` | 601 | inside |

**Part B preserves the order of every effect-bearing call** (3, 4, 5, 21, 24, 25–28, 29, 30, 31, 34, 36, 38, 39). It moves only effect-free calls (`useState`, `useRef`, `useCallback`) relative to them. §3 checks this. **Validated:** after every step, the 21 effect-bearing calls (counting the three render-time `setState` calls) keep their order, and all 51 hook calls (local hooks expanded) are still made. Only hooks 13–20 (now after hook 28) and hook 37 (now before hook 35) move.

## Ground rules

- **No behavior change.** Same DOM, same props to every child, same effect order, same callback identities:
  - an inline arrow stays an inline arrow (new each render);
  - a `useCallback` keeps its exact deps;
  - add no `useMemo`, `useCallback`, `memo` or `key`.
- **Every comment moves verbatim with the code it explains. None is deleted, shortened or reworded.** The only allowed edit is a pointer that no longer holds after a move (e.g. "below" now in another file). In that case, name the file instead.
- **The Essay feature moves unchanged** (owner: `EssayReviewerPicker` and `EssayReadOnlyPanel`; reviewer: `EssayEditorPanel`), with the same props.
- **Module and file rules:**
  - Hooks live in `.ts` files and components in `.tsx` files (eslint's react-refresh `only-export-components` is an error).
  - `SpeechWatch.tsx` keeps exporting `SpeechWatch` (default), `PosterFramePicker` and `OverlayPositioner`.
  - Don't touch `PosterFramePicker` or `OverlayPositioner`.
- **Don't edit tests,** and change no file beyond the six this plan names: `SpeechWatch.tsx`, `reviewAccess.ts`, the three hooks and `SpeechWatchTabs.tsx`.
- **Order: Part A, then Part B (B1 → B2 → B3 → B4).** Run CI's commands and the §3 checks after each step. Any step after A can stop the plan without leaving debris.

## §1 Part A: one definition each (inside `SpeechWatch.tsx`)

**Module-level helpers** (`.tsx` files may hold non-exported helpers):

```ts
/** The player is live and still drives this exact `<video>`. */
function isLiveBinding(player: Player, video: HTMLVideoElement): boolean {
  return !player.isDisposed() && getVideoElement(player) === video
}

/** The outlined feedback frame over the video, aligned like the overlay. */
function FeedbackFrame({ videoAr, anchor, children }: { videoAr: number; anchor: 'top' | 'default'; children: React.ReactNode }) {
  return (
    <div className="owner-feedback-frame" style={{ '--video-ar': videoAr } as React.CSSProperties}>
      <OverlayPositioner anchor={anchor}>{children}</OverlayPositioner>
    </div>
  )
}
```

**In `features/review/reviewAccess.ts`**, beside `isAccessGrantingReviewStatus`:

```ts
/** A review that is not revoked and grants access to `speechId`. */
export function grantsSpeechAccess(review: Review | null | undefined, speechId: number): review is Review {
  return review?.speech?.id === speechId && review.revoked_at === null && isAccessGrantingReviewStatus(review.status)
}
```

**In the component body**, as constants computed once per render, where the first use needs them:

```ts
const validSpeechId = Number.isSafeInteger(speechId) && speechId > 0                        // A10
const speechIsRoute = Number(speech?.id) === speechId                                        // A11
const speechDenied = isTerminalAccessError(error)                                            // A12
const authDenied = isTerminalAccessError(meError)                                            // A12
// after playbackSource / initialUrl exist:
const sourceIsCurrent = asset?.status === 'ready' && playbackSource?.speechId === speechId &&
  playbackSource.assetId === asset.id                                                        // A2
const playable = asset?.status === 'ready' && initialUrl ? { asset, url: initialUrl } : null // A9
const seekCurrentVideo = (seconds: number) => { if (videoEl) seekVideo(videoEl, seconds) }  // A6
// in the owner block:
const ownerCommentaryVisible = htmlFullscreen ? fullscreenControlsOpen : ownerTab === 'notes'          // A4
const selectedReviewerLabel = commentary.options.find((option) => option.key === commentary.selected)?.label // A5
const READING_PANEL = 'workspace-notebook-surface workspace-notebook-panel workspace-notebook-reading' // A8 (module level)
```

**Placement (validated):**
- `isLiveBinding` goes after `seekVideo`. `FeedbackFrame` and `READING_PANEL` go after `OverlayPositioner`.
- A10–A12 go right after `const asset`, above the comment on `currentSpeech`.
- `sourceIsCurrent`, `playable` and `seekCurrentVideo` go right after `captionsAnchor`, before `isOwner`.
- `ownerCommentaryVisible` goes after `ownerVideo`, above the comment that explains hook 29. `selectedReviewerLabel` goes right before `ownerReviewerLabel`.
- The `isAccessGrantingReviewStatus` import becomes `grantsSpeechAccess`, and `reviewAccess.ts` imports `Review` beside `ReviewStatus`. That file's existing comment stays as it is; it still describes `isAccessGrantingReviewStatus`.

**Replacements.** Each keeps its expression's value and short-circuit order:

| Site | Becomes |
|---|---|
| `:397` | `if (!player \|\| !videoEl \|\| !isLiveBinding(player, videoEl)) return` |
| `:433-436` `concreteReady` | `… && videoEl === readyPlayback.video && isLiveBinding(readyPlayback.player, readyPlayback.video)` (the earlier conjuncts stay, and so does their narrowing of `readyPlayback`) |
| `:476-477` | `!!(ownerPlaybackReady && readyPlayback && isLiveBinding(readyPlayback.player, readyPlayback.video))` |
| `:563-565` `seekScrub` | `… \|\| latest.player !== playerRef.current \|\| !isLiveBinding(latest.player, latest.video)) return` |
| `:299-300` `currentSpeech` | `validSpeechId && !isLoading && !error && !!speech && speechIsRoute` |
| `:419-421` `ownerCandidate` | `validSpeechId && speechIsRoute && isOwner && asset ? … : null` |
| `:422-423` `ownerDenied` | `speechDenied \|\| authDenied` |
| `:437-438` | `ownerSourceMatches = ownerScope !== null && sourceIsCurrent` |
| `:445`, `:496` | `ownerCommentaryVisible` |
| `:459-460` | `ownerReviewerLabel = commentaryDenied ? null : selectedReviewerLabel ?? null` |
| `:508-509` | `sourceMatches = currentSpeech && sourceIsCurrent` |
| `:513-516` | `sourceReady && me?.user && !isOwner && grantsSpeechAccess(myReview, speechId) ? \`${me.user.id}:${speechId}:${asset!.id}:${myReview.id}\` : null` |
| `:525-528` | `me?.user && !meLoading && !isLoading && !isOwner && speechIsRoute && grantsSpeechAccess(myReview, speechId) ? \`${me.user.id}:${speechId}\` : null` |
| `:532-533` | `denied: authDenied ? \`auth:…\` : speechDenied ? \`speech:…\` : null` |
| `:539-542` | `reviewerNavigation.validated && !meLoading && !meFetching && !isLoading && !authDenied && !speechDenied && speechIsRoute && sourceIsCurrent && concreteReady` |
| `:135-136` `accessReview` | `.find((review) => grantsSpeechAccess(review, speechId))` |
| `:578` | `feedbackVisible = isOwner \|\| (!!myReview && playable !== null)` |
| `:604-606` | `onSeek: isOwner ? commentary.seek : seekCurrentVideo` |
| `:701` | `playable ? (…) : (…)`. Inside: `initialUrl={playable.url}`, `playable.asset.duration_seconds` at `:754`. |
| `:741-751`, `:767-771` | `<FeedbackFrame videoAr={videoAr} anchor={captionsAnchor}>…children…</FeedbackFrame>` |
| `:789` | `{playable && (…)}` |
| `:873`, `:900`, `:1026` | `className={READING_PANEL}` |
| `:889` | `reviewerName={selectedReviewerLabel}` |
| `:912-914`, `:1014-1016`, `:1029-1031` | `onSeek={seekCurrentVideo}` |
| `:952` | `{!isOwner && myReview && playable && (…)}`. Inside: `playable.asset.duration_seconds` at `:1010`. |

**Equivalence notes:**
- **Pure constants.** Every new constant is a pure expression over values that are already in scope, so computing it once gives the same values.
- **`seekCurrentVideo` keeps callback semantics.** It is a new arrow each render, as each inline arrow was, so children see the same identity behavior. `useKeyboardShortcuts` reads callbacks from refs.
- **`FeedbackFrame` renders the identical DOM.** The reviewer branch's `ref={registerPreviewTarget}` child stays inside it, unchanged.
- **`playable` and empty strings.** `{playable && …}` renders nothing where the old `… && initialUrl && …` rendered an empty `initialUrl` string. A signed URL is never empty, and React renders `''` as no DOM either.
- **Eager evaluation.** A few conditions used to skip a call that a constant now always makes: the `meError` half of `ownerDenied`, `sourceIsCurrent` inside `ownerSourceMatches`, the `.find` behind `ownerReviewerLabel`, and the `isTerminalAccessError` calls in the reviewer conditions. All of them are pure. `isTerminalAccessError` and `getErrorStatus` only read `.status`. `commentary.options` is always an array (`(reviews ?? []).map(…)`), and the `.find` predicate is pure. The rest are property reads on RTK data.
- **No new `!`.** The same 7 non-null assertions (`asset!` ×3, `me!`, `ownerScope!`, `playbackSource!`, `readyPlayback!`) exist before and after the plan.

## §2 Part B: the split

### B1 `hooks/useSpeechWatchMedia.ts`

- **Input:** `{ speechId, speech, asset, currentSpeech }`.
- **What moves, in this order:**
  - `PlaybackSource` and `ReadyPlayback`;
  - hooks 5–12 and their declarations;
  - `requestSpeechId` and `requestAssetId` (`:301-302`);
  - hooks 21–28 with the code between them (`:304-410`): the fetch effect, `refreshUrl`, `onPlayerReady`, the loadedmetadata effect, `posterAr`/`assetAr`/`videoAr`, captions, the caption-attach effect, `captionsAnchor`;
  - `concreteReady` (`:433-436`) and `isLiveBinding`, which is **exported**: `seekScrub` stays in `SpeechWatch.tsx` and, from B2, `useSpeechWatchOwner.ts` imports it too. It has to live in a `.ts` file, because `SpeechWatch.tsx` may export only components and a hook must not import from the route.
- **Output:** `{ playbackSource, initialUrl, readyPlayback, playerRef, videoEl, sourceRefreshToken, setSourceRefreshToken, refreshUrl, onPlayerReady, videoAr, captions, captionsTrack, captionsAnchor, concreteReady }`.
- **Where it's called:** `SpeechWatch` calls it right after `useGetMeQuery` and the pure constants it needs: `asset`, A10–A12 and `currentSpeech` (with its comment) move up from `:295-300`. Hooks 13–20 then follow it; they are effect-free, so effect order doesn't change.
- **`SpeechWatch` reads** `playbackSource, initialUrl, readyPlayback, playerRef, videoEl, setSourceRefreshToken, refreshUrl, onPlayerReady, videoAr, captions, captionsTrack, captionsAnchor` from the result. `sourceRefreshToken` and `concreteReady` stay in the output because B2 and B3 read them through `media`. If `SpeechWatch` destructures them, drop both at B3, or `tsc -b` fails (TS6133).
- **Imports leaving `SpeechWatch.tsx`:** the three `videojs-adapter` functions, `useCaptionsAnchor`, `useCaptionsJob`/`useCaptionsBlobUrl` and `useLazyGetPlaybackUrlQuery`. `Player` stays (`LiveScrubBinding`, `PosterFramePicker`).
- **VideoPlayer callback stays inline:** `onSourceRefreshed={() => setSourceRefreshToken((token) => token + 1)}`.

### B2 `hooks/useSpeechWatchOwner.ts`

- **Input:** `{ speechId, asset, me, isOwner, isLoading, error, meLoading, meError, meFetching, requestedReviewId, validSpeechId, speechIsRoute, speechDenied, authDenied, sourceIsCurrent, media, htmlFullscreen, fullscreenControlsOpen }`. Not `speech`: after A11 the owner block never reads it, and destructuring it fails `tsc -b` (TS6133) and eslint (`no-unused-vars`). `error` and `meError` can be typed `unknown`.
- **What moves, in order:**
  - hooks 13–16;
  - `:419-429`, including the render-time `setValidatedOwnerKey`, which still runs during `SpeechWatch`'s render and before hook 29;
  - `ownerSourceMatches`, `ownerPlaybackReady`, `ownerVideo`;
  - hook 29 and `:446-462`;
  - hook 30;
  - `:469-497`;
  - `ownerScrubReady` and `ownerScrubKey` (`:538`, `:543`), which are pure. The comment above them (`:535-537`, "A background auth request…") explains both `ownerScrubReady` and B3's `reviewerScrubReady`. Copy it verbatim above each.
- **Output:** `{ ownerTab, setOwnerTab, ownerNotesTabRef, ownerScope, ownerSourceMatches, ownerPlaybackReady, ownerVideo, commentary, commentaryDenied, ownerTimelineStatus, ownerReviewerLabel, selectedReviewerLabel, ownerDurationSeconds, openOwnerNotes, seekOwnerTimeline, armOwnerTimelineNote, playbackControlProps, ownerScrubReady, ownerScrubKey }`.
- **Stays in `SpeechWatch`:** `isOwner`, `roles` and `canRecordVoice` (`:412-415`), computed before this hook; B3 needs `isOwner` too. Hooks 17–20 also stay above the call (19–20 are its inputs).
- **Imports leaving `SpeechWatch.tsx`:** `useCommentaryTrack`, `type OwnerTimelineStatus` and `type Annotation`.

### B3 `hooks/useSpeechWatchReviewer.ts`

- **What moves into the file:**
  - `PresentationRegistration`, `usePresentationTarget`, `RecordingLock`, `TimelineValidation`, `accessReview` and `useReviewerTimelineValidation` (`:111-247`), verbatim apart from A3;
  - the hook itself.
- **Hook input:** `{ speechId, speech, asset, me, isOwner, isLoading, error, meLoading, meFetching, meError, authRequestId, speechRequestId, speechDenied, authDenied, speechIsRoute, currentSpeech, sourceIsCurrent, media }`.
- **What moves, in order:**
  - hooks 17–18;
  - hook 31 and `:508-516`;
  - hooks 32–33;
  - `:522-528`;
  - hook 34;
  - `reviewerScrubReady` and `reviewerScrubKey` (`:539-542`, `:544`; `:543` is B2's `ownerScrubKey`), under their copy of the `:535-537` comment;
  - hook 37 (`onRecordingLockChange`). It now comes before hooks 35–36, which is safe because `useCallback` has no effect.
- **Output:** `{ reviewerTab, setReviewerTab, myReview, previewIdentity, registerPreviewTarget, previewTarget, registerVoiceControlsTarget, voiceControlsTarget, reviewerRecordingLocked, reviewerNavigation, reviewerScrubReady, reviewerScrubKey, onRecordingLockChange }`.
- **Stays in `SpeechWatch`, after B3:**
  - hooks 35–36 (liveScrub reads both roles);
  - `seekScrub`;
  - `feedbackVisible`, `scenes`, `companionScene` and hook 38;
  - hook 39;
  - both early returns.
- **Imports leaving `SpeechWatch.tsx`:** `useEffect`, `useStore`, `AppDispatch`/`RootState`, `grantsSpeechAccess`, `useMyReviewForSpeech`, `reviewApi`, and `type Review, ReviewSections`. `getErrorStatus` and `isTerminalAccessError` stay (early return, A12).

### B4 `components/speech/SpeechWatchTabs.tsx`

- **Two hook-free components** receive the values their JSX already uses: `OwnerTabs` (the `<Tabs>` at `:838-949`) and `ReviewerTabs` (the `<Tabs>` at `:953-1035`). Their JSX and comments move verbatim, and `READING_PANEL` moves with them. The tab-strip comment at `:832-836` stays in `SpeechWatch`.
- **Define `OwnerTabs` above `ReviewerTabs`.** Their comments point at each other: "the reviewer's `notes` panel below" (`:855`), "the non-owner tab strip below" (`:897`), "mounted above via `TrackSelector`" (`:979`). In that order every pointer still holds. So does the `useKeyboardShortcuts` comment's "`AnnotationComposerPanel` below" (`:596`), through `<ReviewerTabs>` below it, and the captions comment's "tab strip below" (`:786`), through `<OwnerTabs>`. No comment needs an edit.
- **The conditions stay in `SpeechWatch`:** `{isOwner && <OwnerTabs … />}` and `{!isOwner && myReview && playable && <ReviewerTabs … />}`.
- **`OwnerTabs` props:** `tab`, `onTabChange` (keeps `onValueChange={(value) => onTabChange(String(value))}`), `notesTabRef`, `playbackControlProps`, `commentary` (`ReturnType<typeof useCommentaryTrack>`), `htmlFullscreen`, `speechId`, `speech`, `selectedReviewerLabel`, `seekCurrentVideo`.
- **`ReviewerTabs` props:**
  - `tab`, `onTabChange`, and `recordingLocked`. The lock guard `if (recordingLocked && String(value) !== 'notes') return` stays in its `onValueChange`.
  - What `AnnotationComposerPanel` and `EssayEditorPanel` receive today, unchanged in shape: `speechId`, `review`, `previewTarget`, `previewIdentity`, `htmlFullscreen`, `voiceControlsTarget`, `captionsAnchor`, `onRecordingLockChange`, `scrubKey`, `scrubEnabled`, `seekScrub`, `navigation` (`reviewerNavigation`), `videoEl`, `userId` (`me?.user.id`), `canRecordVoice`, `seekCurrentVideo`.
  - Inside, these stay inline expressions, as today: `previewEnabled={tab === 'notes' && !!previewIdentity}`, `authoringActive={tab === 'notes'}`, the `scrub` object (`onSeek: (seconds) => seekScrub('reviewer', scrubKey, seconds)`), and `timelineNavigation={!navigation.validated ? { … } : undefined}`.
  - `durationSeconds`, computed in `SpeechWatch` as `playable.asset.duration_seconds !== null ? Number(playable.asset.duration_seconds) : 0`.
- **Why this keeps behavior:** hook-free components add no effects. They re-render whenever `SpeechWatch` does, since there's no `memo`. Every child keeps its position, props and `keepMounted`.
- **Imports leaving `SpeechWatch.tsx`:** the `tabs` primitives, `InviteReviewerPanel`, `ReviewerRoster`, `TrackSelector`, `AnnotationComposerPanel`, the three Essay components, `CaptionEditor`, `TranscriptPanel` and `CaptionSettingsToggle`.
- **Validated props diff:** the attributes of every JSX element were listed before and after, with the new components inlined and renamed props mapped back. Every child keeps every prop. The only changes are the Part A substitutions (A5, A6, A8, A9 and the `FeedbackFrame` wrapper) and `durationSeconds={durationSeconds}`.

## §3 Verification (in a scratch copy, before any edit and after each step)

**Static and unit checks:**
1. Run CI's commands from `web/`: `npx tsc -b && npx eslint . && npx vitest run`. Record the baseline counts first; every step must match them. Run the two route files alone, and save per-test outcomes with `--reporter=json`. **Pass bar:** the same test names with the same results.
   - In a scratch copy whose `node_modules` is a symlink, run `npx vitest run --configLoader runner`. The default `bundle` loader writes a temp file into the real repo's `node_modules/.vite-temp`. The runner loader gives the same 1612 per-test outcomes.
   - **Validated, at the baseline and after A, B1, B2, B3 and B4:** `tsc -b` exits 0. eslint reports 0 errors and the same 5 warnings, none in a touched file. vitest runs 146 files and passes all 1612 tests with identical per-test outcomes (the two route files have 93 and 66).
   - Under host load (load average above about 20), rerun `SpeechWatchOwnerTimeline.test.tsx` alone before calling a timeout a failure.
   - Pass `--reporter=default` when grepping logs.

**Structural checks:**
2. **Hook order.** List every hook call in render order, expanding the three new hooks, before and after. The order of effect-bearing calls must be identical (the §"Hook order" table). **Validated** after B1–B4 with a TypeScript-AST listing (local hooks expanded, each call labelled by its bindings or deps): the effect-bearing sequence is identical, and the only movers are hooks 13–20 and 37.
3. **Comments preserved.** Extract every comment from the original `SpeechWatch.tsx`: line and block comments, and JSX `{/* … */}`. Each one must appear verbatim, apart from whitespace, in the six touched files, except for any pointer fixed under the Ground rules. List each exception. **Validated** after every step: all 193 comments are present, with **0 exceptions**. One comment (`:535-537`) is deliberately copied (B2). The only other new comments are the one-line JSDocs on the new helpers, hooks and components.
4. **Greps after Part A:**
   - `getVideoElement(` appears only in `isLiveBinding` and `onPlayerReady`;
   - `isAccessGrantingReviewStatus(` appears in the route code only inside `grantsSpeechAccess`;
   - `owner-feedback-frame` appears once in `SpeechWatch.tsx` (the class is also in `index.css`, `SpeechWatch.test.tsx` and `tests/app-shell.spec.ts`);
   - `seekVideo(videoEl` appears once.
   - **Validated:** all four hold after Part A. The first, third and fourth greps are over `SpeechWatch.tsx`; after B1, `getVideoElement(` lives in `useSpeechWatchMedia.ts`.

**Behavior check (offline browser runs):**
5. Build `dist` (in a scratch copy with a symlinked `node_modules`, use `npx vite build --configLoader runner`). Then run:
   ```
   WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test 'accessibility\.spec' 'app-shell\.spec' --project=chromium --no-deps --grep "isolated frontend|annotation notebook tools" --reporter=json
   ```
   These 78 tests open `/speeches/9` as owner and as reviewer: owner tools, notebook pages, reviewer overlay, draggable timeline, fullscreen controls. **Pass bar:** identical per-test outcomes against the baseline.
   - Never run Playwright without `WORKSPACE_USE_BUILT_ASSETS=1` and `--no-deps`. Without them, requests reach the developer's dev server.
   - **Validated:** 78/78, with identical per-test outcomes after A, B1, B2, B3 and B4.
   - **Host load breaks this run.** At load average ~70, B2's first run took 1341 s, with 8 timeouts and 34 serial skips but no assertion failures; its rerun below load 14 was identical. At load ~7, B1's first run had one failure in `app-shell.spec.ts:408` ("mobile menu remains complete…"), a test that only visits `/dashboard` and `/search`. It passed 5/5 alone and in the full rerun. Wait for the load average to drop below ~14, and rerun before calling any difference a regression.

**Mutation checks** (apply one, confirm the named tests go red, then revert):
6. Five mutations, each applied to the finished B4 tree and run against the full vitest suite. When vitest stays green, the 78 browser tests run too. **Validated results:**

   | Mutation | vitest | 78 browser tests |
   |---|---|---|
   | `isLiveBinding` always returns `true` | **red**, 3 tests: `SpeechWatchOwnerTimeline.test.tsx` "rejects an old captured commit after disposed player" and "a marker clicked after its player was disposed does not seek", plus `SpeechWatch.test.tsx` "waits for the new concrete ready player when B captions finish after A is disposed" | not run |
   | `sourceIsCurrent` drops its `assetId` check | **green** (gap) | **green**: a gap in both suites |
   | `grantsSpeechAccess` ignores `revoked_at` | **green** (gap) | **green**: a gap in both suites |
   | `FeedbackFrame` always passes `anchor="default"` | **red**, 2 reviewer tests in `SpeechWatch.test.tsx` that assert `data-anchor="top"` ("preserves same-asset adapter refresh and caption anchor changes…", "waits for the new concrete ready player…"). With only the **owner** frame mutated, both suites stay green (159/159 route tests, 78/78 browser tests): the owner overlay's anchor is not asserted anywhere | not run |
   | `seekCurrentVideo` is a no-op | **green** (gap) | **red**, 2 reviewer tests in `app-shell.spec.ts`: "editing locks paging, a marker reveals its note…" (`currentTime` stays 0, expected 1.8) and "reviewer rail endpoints, keyboard and Escape…" (one seek short) |

   Why the three stay green in vitest:
   - **`assetId`:** route changes are already caught by `playbackSource.speechId`. The `assetId` conjunct only matters when the same speech's `primary_video` changes while the page is open, and no test does that.
   - **`revoked_at`:** `useMyReviewForSpeech` filters `revoked_at === null` itself (the 4th copy, §4), so a revoked review never becomes `myReview`. The only unmasked path is `accessReview` over raw `listMyReviews` data, and no test gives it a revoked row that grants access.
   - **Seek:** no route test seeks through `CaptionEditor`, `TranscriptPanel`, the composer's `onSeek` or the plain viewer's keyboard map. The browser suite does catch it (row above), so this gap is in vitest only.

   These are coverage gaps in the existing suites, not regressions: every check above still passes the refactor. Report any mutation that stays green as a coverage gap. Don't edit tests to close it.

## §4 Out of scope

- **The 4th live-grant copy** in `hooks/useMyReviewForSpeech.ts:29`, and the similar filter in `hooks/useCommentaryTrack.ts:52`. Adopting `grantsSpeechAccess` there is a separate step.
- **The three duration fallbacks.** They differ on purpose (§"What the review established").
- **Comments.** No comment is rewritten or trimmed.
- **Other code:** `PosterFramePicker`, `OverlayPositioner`, and every child component (`AnnotationComposerPanel`, `OwnerVideoTools`, `TrackSelector`, …).
- **Elsewhere in the app:** class strings outside this file, memoization or performance work, and tests.
- **Tests for the three mutation gaps** (§3.6).

## §5 Review log

- rev 1 (2026-11-18): drafted from a full read of `SpeechWatch.tsx` at `052c392` (hook order, every duplicated expression, narrowing uses), its test files' imports and mocks, `reviewAccess.ts`, and the build's plugin list.
- rev 2 (2026-11-18): adversarial validation. Part A and B1–B4 were applied as written to a scratch copy of `web/` at `052c392`, one commit per step. Each step ran CI's commands, the 78 browser tests, the hook-order, comment and props checks (§3, §2 B4), and the five mutations. No behavior change was found: per-test outcomes are identical at every step. Findings and fixes:
  - **MINOR:** B2's input listed `speech`, which the owner block never reads after A11, so `tsc -b` (TS6133) and eslint (`no-unused-vars`) fail. Dropped from B2's input.
  - **MINOR:** the `:535-537` comment explains both `ownerScrubReady` (B2) and `reviewerScrubReady` (B3), and the plan didn't place it. It is now copied verbatim above each (§3.3 still reports 0 exceptions).
  - **MINOR:** three of the five mutations stay green in vitest, against the plan's "expect red": `assetId` and `revoked_at` stay green in the browser suite too, and the seek no-op is caught only there. The anchor mutation is caught only through the reviewer frame; the owner frame's anchor is asserted in neither suite. §3.6 now records the results and the gaps; tests are unchanged (§4).
  - **MINOR:** in a scratch copy with a symlinked `node_modules`, `npx vitest run` writes a temp file into the real repo's `node_modules/.vite-temp`. §3.1 now passes `--configLoader runner`.
  - **NIT:** the Goal's numbers: the function is `:249-1039`, 791 lines, with 355 lines of JSX (77 locals = declaration statements).
  - **NIT:** B1 didn't say `isLiveBinding` is exported, or that the call needs `asset`, A10–A12 and `currentSpeech` above it. Both added.
  - **NIT:** after B3, `SpeechWatch` no longer reads `sourceRefreshToken` or `concreteReady`, so a destructure must drop them (TS6133). Added to B1, together with the per-step import lists (§2), since TS 6's strict defaults fail on any leftover.
  - **NIT:** B3's `:539-544` range included B2's `:543`. Now `:539-542`, `:544`.
  - **NIT:** B4's `ReviewerTabs` props were "every value `AnnotationComposerPanel` receives". Now listed with their inline expressions. `OwnerTabs` must be defined above `ReviewerTabs` so the "below"/"above" comment pointers hold.
  - **NIT:** §3.4's `owner-feedback-frame` grep holds only within `SpeechWatch.tsx`. The Ground rules said "the five" files, but six change.
  - **NIT:** the browser run is load-sensitive (§3.5). It timed out at load ~70 and had one dashboard-only flake at load ~7; both reruns were identical.
  - **Held:** all 12 duplication rows and their line numbers; the look-alike duration fallbacks; the A9 narrowing (no `!` added); test coupling; tooling; the hook-order table; every replacement's value and short-circuit order (eager calls are pure); callback identities (inline arrows stay inline, `useCallback` deps unchanged); the Essay tab and its props; every comment (193/193).
