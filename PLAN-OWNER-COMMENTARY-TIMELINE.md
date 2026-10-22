# Plan: owner commentary timeline and Frame selector tabs

**Status: plan complete; independent read-only review and revision recheck passed. No application implementation is authorized or performed by this document.** Prepared 2026-10-22 against HEAD `2aadcd5b902b08047f5adab277446f80e2f29327` **plus the existing working-tree changes**. The user requests a below-video progress/timeline view for someone watching feedback on their own speech, switchable with the existing Frame selector, with exploration and an independent code-grounded review before any coding.

## 1. Intended behavior

Within the speech owner's existing video card, retain the video and caption controls, then replace the current standalone Frame selector placement with a small tab strip:

**Commentary timeline | Frame selector**

- Default to **Commentary timeline** for each authenticated owner/speech/video-asset context.
- The timeline shows a moving playhead and separate **Text** range bars and **Voice** point markers, like the supplied screenshot. It represents speech time and the selected reviewer's visible feedback, not completion of reviewing or an annotated percentage.
- Activating a marker seeks the existing video through the existing commentary seek function. The native player's seek bar remains the general continuous scrubber. Do not introduce a new draggable editor/slider, retiming, voice playback system or annotation mutation.
- **Frame selector** reveals the existing **Use current frame** action and sprite thumbnails. Its selection still updates the speech poster; it is not another seek control. Keep that distinction in visible labels/help text.
- Switching these two tabs preserves the actual video/player, playback position, selected reviewer, commentary mode, captions, active voice controller, poster request and success/error feedback.
- The existing **Notes / Essay / Transcript / Reviewers** strip stays below the video card. It remains the place for selecting a reviewer, reading complete feedback and changing commentary playback modes. The new tabs select only the under-video utility.
- The new utility is owner-only. Reviewers retain their own authoring timeline and existing controls; guests, admins or coaches do not gain poster-changing access simply because of their role.

The screenshot is interpreted as a commentary timeline with annotated portions and a playhead. Blank space means no annotation in the current mode, not proof that the speech has not been watched. No database field or viewed-progress persistence is introduced.

## 2. Verified source findings

| Current working-tree code | Design implication |
| --- | --- |
| `SpeechWatch.tsx` renders VideoPlayer, caption controls/status and owner-only PosterFramePicker inside the first CardContent. | Put the utility tabs at the existing picker position, below caption controls/status. Do not put them inside the video positioning wrapper or player presentation host. |
| The same route owns one `useCommentaryTrack` result; TrackSelector and EssayReviewerPicker use its selected reviewer. | Reuse this state. No second reviewer selector, annotations query, playback preference or timing engine is needed. |
| `useCommentaryTrack.ts` uses RTK currentData, user/speech context, roster membership, matching review_id, preference readiness/denial, terminal errors and a 650ms selection crossfade to derive safe source rows. | Consume its projections, not raw fetched/cached annotations. Keep source access guards and crossfade intact. A fetched reviewer name alone does not establish authorization/readiness. |
| `navigationAnnotations` is the existing mode-filtered projection; `allAnnotations` is the full authorized source; `markerAnnotations` contains mode-filtered audio-backed markers only. | Supply navigationAnnotations to the new timeline. markerAnnotations cannot populate Text; allAnnotations would expose marks while commentary is Off and broaden current mode behavior. |
| Current `TimelineStrip.tsx` has labeled lanes, native-duration precedence, exact range/point geometry, erased-point handling, dense subtracks, optional onSeek/activation, active IDs and an rAF playhead. It contains no annotation query or writes. | Reuse the actual component in read-only configuration, without authoring/draft/reveal callbacks. Its pending working-tree implementation is a dependency that must be checked again before execution. |
| Authoring appearance is scoped under `.aw-root` in untracked `annotation-workspace.css`; it also themes authoring controls, lists and tabs. Timeline geometry works independently through its own layout utilities. | Importing that file alone does not give the owner timeline its appearance. Do not apply the broad authoring root to the owner card, frame picker or TrackSelector. Use a small owner-local visual scope instead. |
| PosterFramePicker is exported from SpeechWatch, owns mutation pendingCell/feedback, and reads playerRef.current.currentTime() when clicked. Sprite cells compute poster timestamps and invoke the same poster mutation. | Keep this component, mutation route, sprite dimensions/scaling, labels, failure behavior and refresh semantics. Pass it as a child/ReactNode into the new utility component to avoid a route↔component import cycle. |
| Base UI TabsPanel defaults to unmounting, and the existing wrapper exposes keepMounted. | Both new panels must explicitly stay mounted while hidden and stay outside layout/focus/accessibility when inactive. This protects poster request/result state. |
| `isOwner` can be based on retained speech A while route B is resolving; the route already computes currentSpeech, sourceMatches and sourceReady for its reviewer preview. The owner commentary hook currently receives videoEl based only on isOwner. Conversely, currentSpeech becomes false on any speech-query error, including a same-context transient failure. | Use branch-specific validated owner scope plus one common concrete media-binding predicate. Preserve the reviewer's stricter currentSpeech rule; do not use bare currentSpeech as the new owner mount/enable guard. |
| `setPosterFrame` invalidates the Speech tag after success or failure; cached speech still renders on a transient refresh error. authApi getMe has a void cache key and can retain data after rejection. | A poster request/refetch must not lose its frame result through a transient mount reset, and retained me must not grant controls after terminal auth denial. Distinguish identity, permission and temporary query failures explicitly. |
| Hook unit tests mock API hooks/media. Route tests have a controllable deferred-ready/disposal player harness. Isolated browser mocks currently lack poster-frame POST and are permissive about owner review_id. | Use real RTK-store integration for cached identity cases and extend local browser fixtures narrowly before asserting source isolation or poster mutation behavior. |

The first explorer completed a read-only trace of these areas and reported the findings above to the coordinator. All facts refer to the current working tree, not an assumption that Option A is already committed or fully verified.

## 3. New owner utility component and scope

Add `web/src/components/review/OwnerVideoTools.tsx` with a narrow presentational contract:

- Parent-resolved scope (user, speech, asset), playable/current-ready flag and concrete current video element or null.
- Mode-filtered annotation array, existing activeIds, finite/fallback asset duration, current selected reviewer label and playback mode.
- Presentation state for source/query/preference loading, unavailable/error, empty/mode-empty and Off. These are derived in SpeechWatch from existing guarded results, never a new API query.
- Existing `commentary.seek` as onSeek, guarded by the parent for current ready playback.
- An explicit **Open Notes** action supplied by the route, and the existing frame-selector ReactNode.

Use existing Tabs/TabsList/TabsTab/TabsPanel. Give the new tablist a unique accessible name **Video tools**; retain the existing **Speech tools** and **Your feedback** names. Use visible labels Commentary timeline and Frame selector, and `keepMounted` on both panels. Do not key either panel, VideoPlayer, TrackSelector or the outer route by the selected utility tab.

Key only the utility component's local selection state by validated **user:speech:asset**. A different reviewer or commentary mode must not reset it. An adapter-only signed-URL refresh or same-asset initial-URL generation must not reset its tab or remount its frame picker. Actual account/speech/asset changes intentionally start a fresh utility context; old async completion must not update a newer instance.

The component must not import PosterFramePicker from SpeechWatch. The route continues rendering `<PosterFramePicker ... />` and supplies that stable element/type through the frame-selector slot. Avoid a render path that produces two copies or changes the child key each render.

### Timeline content and states

Show a short context line, for example **Cora Coach · Text + audio**, plus **Open Notes** for changing reviewer/mode. The action only selects the existing Notes tab and, after it is visible, focuses its selected tab or track heading. It does not select a reviewer automatically, create a second radio group, fetch independently, play audio or call markRead itself. Opening the existing readable Notes view retains its normal seen-state semantics. Do not show a stale reviewer label/count on terminal roster/annotation/preference denial merely because fetchedReviewerName is retained.

| Existing playback mode | Timeline input / explanation |
| --- | --- |
| Text + audio (`all`) | navigationAnnotations: all currently authorized, published selected-track rows. Text ranges and Voice points are visible. |
| Written notes only (`written`) | Use the exact existing projection. Audio-backed voice notes are omitted; erased-audio point transcripts can remain because they are readable in the existing written projection. Their geometry remains a Voice point with audio unavailable. Do not rewrite projection semantics here. |
| Audio only (`voice`) | Only the existing audio-backed voice projection. Text lane remains as a labeled empty lane; no written-body excerpt appears. |
| Off (`off`) | No annotation markers. Keep the speech-time axis/playhead and show “Commentary is off. Open Notes to enable it.” Do not use allAnnotations as a fallback. |

At no selected track, unavailable roster, crossfade/loading, no published notes or no notes matching the current mode, show distinct concise contextual help rather than a fake populated timeline. A selected reviewer's label comes from that selected option/current guarded response, never an old track's label. All marker data still comes exclusively from navigationAnnotations.

Handle errors without claiming an empty review: terminal annotation/roster/preference denial yields no markers; a same-context transient refresh failure may retain the exact rows already allowed by useCommentaryTrack, alongside an error notice. preference.loading/loadError/accessDenied and query/error state must be distinguished from successful zero rows. Do not reimplement hook access policy in a second timing hook or expose raw query results just to label an empty state.

Readiness/loading status can be derived from current source readiness, commentary.optionsLoading, selected, error/isFetching, fetchedReviewerName, preference.ready/loading/loadError/accessDenied and the guarded source/projections. The name may help distinguish a crossfade/loading label but is never an authorization gate by itself. If these actual contracts prove insufficient during implementation, stop and report before adding a new hook API/path.

## 4. Source readiness and preservation of existing playback

### 4.1 Bind one canonical owner hook to the correct video

Move/factor the concrete playback-binding computation before useCommentaryTrack: matching rendered speech/asset key and generation, nondisposed ready player and matching concrete video element. Share that predicate between the branches, then conjoin each branch's own valid context. Preserve the reviewer's current sourceReady semantics (`currentSpeech` plus ready asset/binding), its preview identity and the initial playback request's currentSpeech guard. Do not simply broaden those reviewer/request guards to accommodate the owner fallback below.

- Derive an **ownerScope** from a finite positive route speech ID, matching resolved speech.id, authenticated user ownership and the current asset identity. Record only a successfully resolved owner context for this mounted view, keyed by user:speech:asset. A same-ID cached nonterminal refresh error may retain that previously validated context; it may never establish ownership of a new context on its own. Retained A speech while requesting B never matches B.
- Inspect auth getMe error/loading state as well as me.data when deriving this new scope. Terminal **401/403/404/410** on the current speech or authentication suppress the scope even if data is retained; an unresolved/changed account cannot reuse an older account's context. Keep existing logout/account cache-reset middleware intact.
- On a same-user/speech/asset **500/network/other nonterminal refresh failure**, retain the already validated utility, frame picker and canonical owner binding if the media is still exact/current. Show the existing refresh/preparation error without presenting it as successful empty feedback. This preserves pending/settled poster results across the Speech invalidation caused by its own mutation. Do not let an incidental isFetching or error flag alone change the utility key.
- Call the one existing useCommentaryTrack unconditionally, passing enabled from this ownerScope. Pass **null video** until the shared concrete binding matches that ownerScope and ready asset; once ready pass only the bound element. A same-context source recreation suspends media binding/actions, not the mounted utility/picker. Do not accept B annotations while the hook still owns A's video.
- Reviewer authoring and preview use their existing state/props. Do not alter their recording lock, shortcuts, pending work, tabs or portal during this owner change.
- Keep preference hydration, crossfade, revocation, all four modes, same-mode audio-controller identity, caption track reattachment and owner active overlays unchanged. Do not make ownerTab or the new utility tab a hook/source key.
- Changing between Timeline and Frame selector must not call selectMode, select reviewer, markRead, skip/pause/resume commentary, reset voice playback or update notesVisible. The existing owner Notes/fullscreen logic continues controlling readable exposure and seen state.

Add real RTK integration coverage for retained cached A and B, not only mocks returning convenient current rows. During A→B transitions, there must be no A marks on B, B marks on retained A footage, requests pairing B with assetA, or owner hook binding to disposed A. Test same URL across identities, late URL results, same-asset recreation and signed-URL refresh.

### 4.2 Preserve utility and frame state during same-context readiness changes

Render the owner utility only for the validated ownerScope above, ready asset and a rendered playback-source record matching that speech/asset. Preserve that same scope across its nonterminal refresh failures. While that same identity's concrete player is being recreated or not ready, **retain the utility and frame-selector instances**, show a preparation state and disable their playback-dependent actions. Do not gate the entire new component on sourceReady/currentSpeech/query-error and thereby unmount pending frame feedback on every same-asset generation or transient refresh.

When identity is genuinely different/unresolved/denied, suppress stale owner tools rather than applying their controls to a different media source. Follow the route's existing page-level error rendering; do not introduce an unrelated full-route state cache to keep tools alive across access loss.

Add an optional `disabled` flag (default false) to the existing PosterFramePicker in SpeechWatch. Combine it with existing isLoading on both Use current frame and sprite buttons, and guard handlers as well. During retained same-source initial recreation, do not unmount/reset pendingCell or feedback. A previously submitted request retains its original speech/asset/time and settles normally; do not cancel/reissue it on tab changes or falsely report success before the actual promise resolves.

Use current frame must read the **current** nondisposed player when clicked after returning to Frame selector, not a captured timestamp from when the panel first mounted. No current player means no mutation; remove no existing server-side ownership checks. Update standalone picker test doubles to implement actual disposal status rather than weakening the check. A sprite cell still submits its computed poster time once, without seeking the video. Timeline markers must never call the poster mutation.

## 5. Timeline integration, voice and accessibility

Render the existing TimelineStrip with navigationAnnotations, the bound video, durationSeconds, activeIds and one guarded onSeek. Do not pass draftIds, editing callbacks, retiming callbacks, authoring selection/reveal logic or a second annotations source.

- Its existing range/point helper classifies erased voice notes properly. Recording length never becomes a speech interval.
- Reuse its native duration precedence, dense/legacy subtracks and shared-axis playhead; do not add another rAF/timeupdate-to-React loop or another useTimedAnnotations call. The existing component's rAF position writer is presentation, not a second cue engine.
- onSeek delegates once to commentary.seek. It does not call play(), pause(), voicePlayback.skip(), poster selection or a mutation. Existing VoiceInterjectionController seeking/seeked handling cancels a loading/active voice without starting paused video; preserve that path rather than invoking two cancellation/seek systems. A marker is navigation, not a “play this recording” button.
- No full commentary body is added to marker labels/tooltips in Audio only or Off. Type/time/audio-unavailable labels suffice. The existing Notes/fullscreen readable surface remains the only full commentary list; do not duplicate Transcript or track selectors beneath the timeline.
- Keep native progress controls available. Exact small marks have explicit type/time labels and equivalent seek actions in the existing readable feedback list; do not inflate range bars or overlap invisible targets. Test real narrow-screen geometry and dense boundary points; report any pre-existing shared timeline defect rather than silently modifying authoring geometry in this scope.

Use `workspace-notebook-surface` and a new explicit owner utility/timeline class scope. Add `owner-video-tools.css` imported by the new component for its tab chrome and **only its own** `.awt-*` appearance. Match the accepted cream/teal/burgundy/ink tokens without importing or applying `.aw-root`. This intentionally keeps the owner wrapper independent of the current uncommitted authoring CSS work; do not extract/retheme shared CSS for this small addition.

The local rules must leave Base UI hidden keepMounted panels out of layout, focus and the accessibility tree even when layout classes use flex/grid. Avoid broad selectors affecting the frame selector, media tree, outer tabs or reviewer controls. No artwork, transforms or decoration over video/markers. Check OS dark preference, `.dark`, forced colors, reduced motion, keyboard focus and ordinary reading contrast.

At 320/375px, tabs wrap/fit and the timeline uses available width. Frame thumbnails retain their existing local horizontal scrolling and 96px height cap; do not create whole-page overflow. At desktop the component uses the video card width without adding another column or changing the actual footage width/aspect/height budget.

The tabs/timeline live outside the actual player root. HTML fullscreen and PiP retain existing behavior and do not gain an external utility panel. Existing fullscreen commentary controls/voice markers and subtitle behavior remain unchanged. No new iOS fullscreen overlay guarantee or physical-device claim is made.

## 6. Exact future file inventory and dependency order

All paths below are proposed future edits after separate authorization. Preserve all pre-existing uncommitted Option A work and this planning task's snapshot. Re-read the current source/contracts and tests before execution; a changed or unfinished TimelineStrip/route contract is a dependency to reconcile, not permission to revert or overwrite another task.

| Task / exclusive future owner | Paths | Responsibility / dependency |
| --- | --- | --- |
| T1 — owner utility | new `web/src/components/review/OwnerVideoTools.tsx`; new `OwnerVideoTools.test.tsx`; new `owner-video-tools.css`, all in that directory | Presentational tabs/keepMounted, exact context reset, guarded readonly timeline, states/help/Open Notes and local appearance. Receive frame selector through a ReactNode, never import its route. Agree prop contract before T2. |
| T2 — route and frame integration | `web/src/routes/SpeechWatch.tsx`; `web/src/routes/SpeechWatch.test.tsx` | After T1 contract: position utilities, preserve keyed video, factor common media binding and validated ownerScope (transient retention/terminal auth denial) before canonical owner hook, pass current projections/state/seek and frame selector, optional disabled guard on existing picker, maintain local Notes/fullscreen/seen behavior and strict reviewer branch. |
| T3 — real cache/source regression | new `web/src/routes/SpeechWatchOwnerTimeline.test.tsx` | After T2: use actual RTK store/currentData and actual useCommentaryTrack, with deferred native-player harness, to verify cached/out-of-order source/track/account cases, deny/revoke and no second query/engine. Build a fresh production-equivalent store locally in this new test, including commentaryPreferenceSession middleware; the generic createTestStore helper lacks that middleware and cannot prove account isolation. Do not edit the shared helper. No production edits. |
| T4 — isolated browser coverage | `web/tests/app-shell.spec.ts`; `web/tests/accessibility.spec.ts` | After T1–T3 and stable build: strict selected-review fixtures, poster POST handling, moving native video, modes/voice, frame state, keyboard/responsiveness and populated unchanged axe gates. Preserve all current authoring/owner/login regressions. |
| Coordinator | This root plan only for later ledger | Reconcile handoffs, preserve user work, return corrections to owners, record exact results/limits. |

**Eight application/test paths:** three new utility files, two existing route files, one new integration test and two existing browser specs. No overlapping file owners. Source owner changes are confined to the new utility and existing route/picker; shared timeline/hook APIs remain unchanged.

Explicitly excluded: TimelineStrip and its tests, annotation-workspace.css and authoring components, useCommentaryTrack and its tests/source API, projectCommentary/playback preference/voice/timing/keyboard hooks/controllers, TrackSelector/EssayReviewerPicker, OverlayStack/VideoPlayer/adapter, UI primitives/global styles/notebook.css/artwork, caption/editor/recorder internals, backend/database/object storage/Whisper, packages/config/shared browser fixtures and all real speeches/reviews. Read those paths for verification, but stop/report before adding a necessary edit outside the inventory.

## 7. Required verification during later execution

### Component, route and real-store tests

1. Owner-only utility at the former picker location, timeline default, correct independent tablist names; no tools for non-owner reviewer/member/coach/admin/guest, pending **new** identity or terminal-denied identity. Roles alone never grant poster editing. A validated same-context nonterminal background refresh retains the existing owner scope.
2. One actual VideoPlayer/player/HTML video/metadata track across utility switching. CurrentTime, reviewer, mode, caption state and active voice/controller state persist. New utility state resets only on user/speech/asset identity, not outer Notes/Essay/Transcript or preference/track/refetch changes.
3. Correct Text/Voice lanes and published selected-track source; all/written/voice/off projections, erased point in written mode, processing/failed voice, no reviewer/draft leakage, preference hydration/denial, no selected reviewer, successful empty vs mode-empty and loading/crossfade/error states. No allAnnotations fallback when Off.
4. A→B cached data, same URL identities, out-of-order URL result, pending B, B403/404, B source URL/player not ready, B ready, same-asset source generation, signed-URL refresh, revocation/denial. Actual RTK currentData coverage with production-equivalent session middleware must prove stale annotations cannot survive into the wrong source/account. Old player/controller must not receive new speech commentary or drive the new timeline. Explicitly test retained me after rejected auth refetch, current getMe401 cache clearing, and no stale controls after speech/auth 401/403/404/410.
5. No new annotations fetch/subscription/timed engine/voice controller caused by tab switching. Existing hook query/controller lifecycle changes only at its normal source/identity boundaries. Do not assert “one fetch forever”: polling/prefetch already exist.
6. KeepMounted Frame request starts once, stays pending while hidden, resolves to visible success/error when returned; existing sprite timestamp math and poster request body/route remain correct. Its Speech invalidation then causes cached same-context GET-speech 500/network failure: retain the same utility/picker DOM identity, tab, pendingCell and resulting feedback through failure and recovery, including same-asset source-generation changes. Test failed POST followed by failed GET as well as success. Separately assert terminal denial suppresses stale tools. Returning Use current frame reads a newly changed native currentTime. Unknown/disposed player and temporary not-ready source disable/guard actions. Marker activation sends no poster request; frame selection does not seek.
7. Switching utility tabs while voice is loading/playing/paused does not cancel/resume it. Explicit marker seek follows existing cancellation/no-autoplay semantics, including paused video and delayed audio URL. No manual skip()+seek double path.
8. Notes/Essay/Transcript/Reviewers behavior, reviewer authoring recording lock/drafts/portal, owner captions/markers/fullscreen modes and privacy remain green. The utility must not independently mark read or change notesVisible. Test passive Timeline exposure with outer Essay/Transcript active and the video/voice paused: default ownerTab is Notes, whose existing readable-view effect can legitimately mark feedback seen. Existing actual voice playback may also legitimately mark seen; preserve that behavior. Open Notes invokes the established readable-view behavior rather than a new markRead call.
9. Keyboard Tab/Arrow/Home/End/Space activation, visible/inactive panel focus isolation, relevant type/time accessible names, no duplicate lists/radio groups, same wrapper identity under StrictMode and cleanup of source changes/ResizeObserver/rAF listeners.

Run from `web/` after implementation:

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

Retain the existing useCommentaryTrack, preference/controller, TimelineStrip, VideoPlayer, caption and login unit suites. No implementation test run in this planning task can establish the future design's behavior.

### Native browser and accessibility checks

Add distinct **`owner video tools`** describes inside the existing two isolated presentation specs. Use the actual completed frontend build with fail-closed intercepted APIs; no running development-data changes.

- Use a current owner, exact speech/asset and **two distinct published reviewer tracks** with mixed text/voice rows and different marker positions, plus published-empty and unavailable/processing variants. Owner annotation fixture review_id must match a real fixture track; reject unexpected IDs instead of echoing any request into a plausible response. Preserve the existing opt-in reviewer-22 contract and default legacy fixtures; isolate any stricter owner fixture mode.
- Implement only the exact test-local poster-frame POST route/body/response used by the real picker, with delayed success/error control; its GET paths/readiness must match real API envelopes. Unexpected methods/URLs/bodies remain blocked. Count calls and assert the single original time/speech/asset submission.
- With real moving portrait and landscape footage, observe playhead before/inside/after intervals, marker seeking, active audio seek cancellation, frame switching/request state/current-time read, review switching/crossfade and all modes. No duplicate native video or metadata engine on tab changes. Preserve existing reviewer overlay/native owner modes and login/chrome cases.
- Check 320/375/768/1440px, OS dark + explicit `.dark`, reduced motion, forced colors, keyboard interactions and actual lack of hidden focusable controls. Portrait video area/control clearance must remain unchanged. Frame sprite scroll remains local. Do not promise external tools are visible inside fullscreen/PiP; test existing fullscreen playback regressions separately.
- Accessibility scans include **both tool panels in their active state** and a populated below-video timeline. Preserve WCAG tags and critical/serious gate; the existing `.video-js` exclusion must **not** exclude the new under-video timeline. Use separate geometry/native playback evidence for the excluded media subtree.

Build fully before browser checks and keep dist stable until all projects finish. Run Chromium then WebKit serially with separate result/report directories and `--no-deps` for isolated lanes. Example selection from `web/`:

```sh
WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts --grep 'owner video tools|reviewer overlay presentation|annotation notebook tools|notebook presentation|option C presentation' --no-deps --project=chromium --workers=1 --output=test-results/owner-video-tools-chromium
WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts --grep 'owner video tools|reviewer overlay presentation|annotation notebook tools|notebook presentation|option C presentation' --no-deps --project=webkit --workers=1 --output=test-results/owner-video-tools-webkit
```

Use distinct PLAYWRIGHT_HTML_OUTPUT_DIR values as well. Inspect actual current test describes/config first; annotation notebook implementation/tests may still be evolving. Repeated runs need distinct evidence paths.

Do not start/rebuild/stop/reseed services, alter certificates, run setup dependencies against development, change shared fixtures or mutate real poster frames to obtain browser proof. Real-stack tests require an already verified disposable E2E environment; otherwise state that live backend authorization, poster generation/Whisper/transcoding and physical microphone/iPhone remain unverified. Intercepted POST success proves frontend behavior, not FFmpeg poster generation or real backend permissions.

## 8. Consequences and rollback

The owner gains an immediate map of the active commentary without the frame thumbnails occupying the same space. Frame selection remains one tab away. The second utility tab row is intentionally distinct from the existing full speech-tool navigation; label it clearly and keep its visual weight modest.

The plan reuses existing geometry and media/query state. Main risks are hiding/remounting the frame picker during asynchronous work, accidentally broadening Off/read permissions, binding a new speech to stale video, hiding keepMounted controls incorrectly, and applying authoring styles too broadly. The explicit boundaries and regressions above address those risks.

The narrow owner-local timeline styles duplicate only presentation choices, not geometry or data logic, so current uncommitted authoring work need not be restyled/extracted. A later shared-style cleanup would be separate work. Existing arbitrary-text overflow in the video overlay is also outside this plan.

No schema migration, new dependency, stored viewing-progress metric or new backend endpoint is needed. Rollback, if later required, reverts only this addition and tests while preserving the current authoring work and data; no broad Git reset/clean or deletion is appropriate. No rollback happens during planning.

## 9. Exploration, review and preservation record

- Current HEAD and dirty working tree were inspected. Existing source changes, three untracked authoring tests, untracked scoped authoring CSS, Option A plan and design comparison are **pre-existing work**, not changes by this request.
- A hash snapshot records **1,091 pre-existing tracked/untracked files**. This root plan is intended to be the only project file created/edited by this task. Other annotation implementation work is actively changing existing source/tests concurrently; the snapshot is not a claim that every baseline file will remain byte-identical across that other work. Record drift honestly, never revert it, and refresh/review the baseline before later execution.
- Initial explorer completed read-only review of owner route, canonical hook/currentData/modes, current TimelineStrip and scoped styles, frame picker, voice controller and existing unit/browser test seams. Its findings informed the component/slot design, correct mode projection, source binding, keepMounted frame state and stricter local fixtures.
- Coordinator chose a small owner-local stylesheet instead of the explorer's optional shared timeline-style extraction: the current geometry is reusable without modification, and authoring CSS is existing in-flight work with broad author-only selectors. The same palette will be specified/tested locally; no authoring source/style edit is required.
- Independent plan/code review: completed first pass against current source, installed Tabs behavior, backend poster request/resource and existing tests. The blocking finding was that bare currentSpeech becomes false on a transient GET-speech error; poster mutations invalidate the same Speech tag, so the draft could unmount the picker and lose its result. The revised ownerScope/media-binding design retains a validated same-context utility through nonterminal refresh errors while preserving strict reviewer guards and terminal auth/speech denial. Regressions cover both successful/failed poster mutation followed by failed invalidation refresh and recovery.
- Review refinements incorporated: exclude terminal retained getMe errors from owner scope, use commentaryPreferenceSession in the fresh local real-store test, and test unread behavior with outer Essay/Transcript and paused playback instead of incorrectly assuming default Notes cannot mark read. Source behavior and all proposed edits remain within the eight-path inventory. The independent explorer rechecked the revisions against source and found no remaining blocking plan/code contradiction. This is design clearance, not runtime validation.
- **Final document/scope verification passed:** eight distinct future paths, four existing and four explicitly new; balanced Markdown fences and no trailing whitespace. Git whitespace checks pass. This task created only `PLAN-OWNER-COMMENTARY-TIMELINE.md` and edited no pre-existing project file. During read-only exploration/review, ten baseline files changed concurrently through the separate annotation implementation (authoring panel/tests and six browser specs); that drift was observed and preserved, not overwritten or falsely reported as byte-identical. The core owner route/hook/timeline source contracts inspected for this plan remained unchanged from this task's snapshot. Refresh the execution baseline and reconcile all in-flight work before implementing.
- No application code/style/test edits, service/data operations, dependency changes, browser runs, staging or commits have been performed **by this planning task**. No implementation tests were run for this prospective design.
