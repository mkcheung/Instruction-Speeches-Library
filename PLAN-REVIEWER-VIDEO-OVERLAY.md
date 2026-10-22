# Plan: show the reviewer's timed commentary over the video

**Status: implementation and independent read-only review complete.** Prepared 2026-10-22 against HEAD `803a26359ecfe648e42404561ee99ec3825ac097`; executed under the user's subsequent execute-plan request. Sections 1–7 preserve the approved planning record; section 8 records implementation and verification. Historical planning-only statements below describe the earlier planning task. No commit, deployment or service/data change was performed.

## 1. Problem and intended behavior

The screenshots show the reviewer's **Your commentary** authoring panel. A timed written note becomes visible there when the playhead enters its range, rather than appearing over the video. This is commentary, not the speech's Whisper subtitles. The separate **Captions unavailable** message does not cause this placement problem.

Move that existing live preview into the player's existing React presentation host. Preserve the actual authoring controls and accessible commentary list below the video. Do not introduce a second preview, timing engine, annotation query, or independent copy of draft state.

Acceptance behavior:

- An authorized reviewer viewing Notes sees their saved written ranges and valid live written drafts on the displayed video frame during the existing active interval. Existing provisional dashed styling, fade behavior and simultaneous-note limit remain intact.
- With speech subtitles unavailable or off, commentary sits at the bottom **above the player controls**. When speech subtitles are showing, use the existing top anchor to prevent collision. Do not force everything to the bottom.
- There is no timed-preview box or reserved preview gap inside **Your commentary**. Its timeline, Start/End editor, recording controls, annotation rows and publication controls remain there.
- Switching to Essay or Transcript hides the reviewer video preview immediately. Returning to Notes shows the current interval again. Notes and its draft/recording/editor state remain mounted as today.
- Previewing does not publish anything or make a reviewer's drafts visible to the speech owner or another reviewer. Owner playback and its four commentary modes remain unchanged.

This is a frontend preview-placement correction. It does not add reviewer voice playback, a new subtitles feature, or native iOS/PiP support for HTML overlays.

## 2. Findings verified in the actual code

| Area | Current implementation and implication |
| --- | --- |
| `web/src/components/annotation/AnnotationComposerPanel.tsx` | Owns fetched annotations, live overrides, draft IDs, the single authoring `useTimedAnnotations` call and current time. Around lines 286–288, `OverlayStack` is inside a normal-flow, minimum-height div in CardContent. This directly accounts for the screenshot. |
| `web/src/routes/SpeechWatch.tsx` | Around line 406, `VideoPlayer.presentation` is gated by `isOwner`. Its owner feedback frame, `OverlayPositioner`, voice markers and fullscreen controls are already routed into the actual player. Reviewer previews are absent from that slot. |
| `web/src/components/speech/VideoPlayer.tsx` | Already accepts a generic ReactNode `presentation`, portals it into a detached React-owned host, appends that host to `player.el()`, and detaches it before disposal. Reuse this API; no source change is needed here. |
| `web/src/routes/SpeechWatch.tsx:66` | Exported `OverlayPositioner` applies full-frame positioning and top/bottom justification. It is in a route that already imports the composer, so importing it back from the composer would create a dependency cycle. Keep its use in the route. |
| `web/src/index.css` | `.owner-commentary-host`, `.owner-feedback-frame` and its positioner rules already position the feedback frame within the displayed video rectangle, including portrait/fullscreen geometry and bottom control clearance. They do not guarantee arbitrary text stays contained. These legacy class names can serve the reviewer frame too; do not rename or retheme them for this fix. |
| `web/src/components/annotation/captionsAnchor.ts` | Existing hook derives top/default from the actual captions TextTrack, polling mode changes at 500ms. Reuse its result; do not change subtitle selection or add another poller. |
| Reviewer tabs in `SpeechWatch.tsx` | Controlled `reviewerTab` already exists. Notes uses `keepMounted`; its normal hidden ancestor currently hides the inline preview. A portal escaping that ancestor needs explicit Notes-only visibility. |
| `useMyReviewForSpeech.ts` | Finds the caller's nonrevoked accepted/in_progress/published review with a speech ID matching the route, from existing dashboard queries. Do not widen roles or add access endpoints. |
| Initial playback URL effect in `SpeechWatch.tsx` | `initialUrl` is an untagged string and its initial fetch has no cancellation guard. A retained A response or late A URL result during A→B navigation is a risk for a newly introduced external preview. The existing `currentSpeech` artwork guard alone does not establish which source the player represents. |
| Test coverage | Composer tests currently replace OverlayStack with null. Watch route tests use a stub player. Existing browser reviewer tests use an empty annotation set and check drafts/tabs; populated native overlay tests exercise the owner path. These do not establish populated reviewer overlay placement. |

Git blame places the inline reviewer preview in commit `26a85028`, before the notebook redesign. The notebook commit `803a263` leaves those preview lines in place; this plan must not describe it as a demonstrated notebook-induced move. The preceding investigation ran 39 existing tests across OverlayStack, AnnotationComposerPanel and SpeechWatch successfully; that is baseline evidence only, not proof of the missing behavior.

## 3. Chosen design: portal the existing preview into a route-owned slot

### 3.1 Keep live state with its current owner

`AnnotationComposerPanelInner` continues to own merged annotations, active IDs, current time and draft IDs. Its existing user/speech/review key stays intact. Existing timing hooks, live-change handlers, network subscriptions, publication logic, unsaved-navigation guards and draft recovery are unchanged.

Add required preview inputs named `previewTarget`, `previewEnabled` and `previewAnchor` to the outer/inner composer boundary. Update existing standalone test callers with explicit null/false/default inputs rather than silently retaining an inline fallback:

- A nullable HTML target supplied by SpeechWatch, after route/player ownership checks.
- A boolean indicating the selected reviewer tab permits the preview.
- The existing `'top' | 'default'` captions anchor.

When a valid target exists and previewing is enabled, use React DOM's existing `createPortal` API to place the **existing** OverlayStack there. Keep all its merged-row/active/current-time/draft arguments unchanged, adding the provided anchor. Remove the inline preview wrapper and its min-height gap. With a null target or disabled preview, render no OverlayStack and no panel fallback.

Do not lift draft arrays into SpeechWatch, publish them through context/Redux, or send a ReactNode upward on every timing tick. Do not create another authoring engine in the route. Do not use `document.querySelector`, MutationObserver or CSS fixed positioning to find/imitate a video target.

### 3.2 Extend the existing presentation branch without changing the player API

Keep the existing owner presentation branch structurally intact. For a currently eligible reviewer, the same `VideoPlayer.presentation` prop renders only:

1. The existing video-aspect feedback frame.
2. The existing OverlayPositioner using `captionsAnchor`.
3. An otherwise empty, noninteractive div with a stable test ID such as `reviewer-preview-target` and a callback ref.

This target div is a React-owned container for the composer's portal. It has no children managed by SpeechWatch, no notebook surface class, and no semantic color tokens. Owner and reviewer branches are mutually exclusive. No additional video, presentation host, sidebar, column or new overlay positioning implementation is introduced.

Keep this empty target mounted while the reviewer changes between Notes, Essay and Transcript; pass Notes-only enablement into the composer. That avoids unnecessary target churn. Hiding the portal must not unmount the composer or its existing kept-mounted Notes panel. It is acceptable for the visual OverlayStack to unmount while hidden, clearing its fade timers; on return it derives visibility from the continuing authoring engine.

Do not import OverlayPositioner from SpeechWatch into AnnotationComposerPanel. The dependency stays route → composer; the composer imports only React DOM and its existing child components.

### 3.3 Make ownership and cleanup explicit

Define a preview identity from the authenticated user, route speech, current asset and matching review. Publish the callback-ref target together with that identity; consume it only when it matches the current eligible preview identity. Keep the callback stable by primitive identity; do not capture changing annotation arrays, aspect ratio or freshly allocated objects. Give each actual node registration a token and compare the exact node/registration on cleanup, including replacement within the same identity. A stale callback's cleanup must not clear a newer registration. React 19 callback-ref cleanup can express this ownership; there is exactly one target owner at a time and no global registry is needed.

Enable/provision the reviewer slot only when all of the following hold:

- A finite positive integer speech ID, a resolved speech whose ID matches that route, and no speech-request error/loading state.
- A resolved current user who is not the speech owner.
- The existing matching, access-granting, nonrevoked `myReview` for that speech.
- A ready current asset and a playback source/player bound to that same speech/asset.

Use the existing successful player-ready callback as part of establishing the media binding. Gate the **new preview**, not the existing permission model or all route rendering. Never key/remount the player because the selected tab, review ID, active cue, text draft or artwork changed.

Implement the following bounded source-provenance contract in SpeechWatch:

1. Keep the existing player/composer render state stable during same-identity polling, tab changes and transient refresh failures. `initialUrl` gates both the video and reviewer tab subtree today; do not null it merely to disable the new preview or introduce an effect that clears it on every refetch. Preserve existing genuine initial-load failure behavior.
2. Derive a validated request identity only when the loaded speech belongs to the current route and its asset is ready. Include route/speech/asset identity in the initial-URL effect's stable dependency key; its present `[asset?.id, asset?.status]` dependency list is insufficient. While B retains A's data, do not issue a request pairing B's speech ID with A's asset ID. Ignore late initial-fetch completions using cancellation/request generation when that validated identity changes or unmounts.
3. Carry resolved speech/asset provenance alongside the URL used by the rendered player. Retained A playback during pending B retains A provenance; B preview stays disabled until B's own URL and player are ready. Bind the player's `refreshUrl` callback to that **rendered source record**, not today's route plus possibly retained asset. This prevents an old A player error from requesting B+assetA or loading B media into a still-A player lifecycle. Preserve the adapter's existing refresh-on-403 and caption reattachment behavior.
4. Key VideoPlayer only by the **resolved playback speech/asset identity**. A→B must create a new player even if a fixture or server returns identical URL strings. The composer is not keyed by this player key; same-speech drafts and recording state must survive normal tab/refetch operations. This source-boundary key is an intentional lifecycle correction, not permission to key the route or editors on URL/polling state.
5. Record the concrete ready player/HTML video element and the **initial-source generation** it represents. If `initialUrl` changes for the same speech/asset, VideoPlayer's effect recreates its player but reuses its React presentation host; a target callback alone will not announce that recreation. Compare generation and actual ready element synchronously before enabling the preview. An adapter-only signed-URL refresh keeps the same concrete player/element and generation.
6. VideoPlayer deliberately calls the latest `onPlayerReadyRef`, rather than a callback frozen when its source was constructed. A callback that simply labels readiness with today's route keys is insufficient. The validated source-boundary key, source generation and concrete nondisposed player/element must agree. Do not require native `currentSrc === initialUrl` in a one-shot ready callback: it may still be empty before metadata and legitimately changes after signed-URL refresh. If extra URL checks are introduced, they must observe source readiness and accept same-asset refresh URLs rather than disabling the preview indefinitely.

This stays within the existing route; no general media-loader hook or VideoPlayer source/API change is proposed. Add pending, out-of-order, identical-URL and same-asset source-generation tests before relying on this guard.

Do not rely on `target.isConnected` as the sole readiness mechanism: VideoPlayer deliberately constructs React's host while detached and appends it in its effect. Callback-ref ownership and player-ready state must converge correctly under that lifecycle and StrictMode. A detached stale target must never become visible on a new source.

On no target, route change, access denial, review revocation/removal, player teardown, user/review identity change or unmount, suppress/remove the preview immediately. Clear only the matching registration; do not delete draft storage or reset editors. If the annotation refresh itself reports 401/403/404/410, suppress the new video preview rather than displaying retained authorized rows indefinitely. For a transient refresh failure with unchanged identity, retain existing draft/error-banner behavior; do not silently clear user text.

### 3.4 Preserve timing, media and accessibility contracts

- Preserve the current range filtering: the authoring timed set excludes point annotations. Voice recordings/erased voice markers remain points; their recording duration must not become a written overlay span. Do not introduce automatic reviewer voice playback.
- Preserve live unsaved text, valid Start/End ranges, temporary draft IDs, server/live merge behavior, deferred fade removal, overlap validation and publication visibility.
- Keep OverlayStack aria-hidden and pointer-events disabled. The authoritative annotation list stays in Notes with its existing accessible name and interactions. Do not duplicate it inside the video.
- Reuse existing full-frame/aspect math, container units, control clearance and neutral player theme. A React portal inherits DOM styling from the player target; keep notebook surfaces outside that DOM subtree.
- Owner modes, voice playback, captions, markers, fullscreen controls, native iOS fallback and PiP behavior stay unchanged. HTML player fullscreen should include the reviewer preview through the shared presentation host. Native video-only fullscreen and PiP generally do not include HTML siblings; do not promise reviewer draft text there or add it to actual captions tracks.

## 4. Exact implementation inventory and dependency order

These are proposed future edits, not work authorized now. All other application/test files remain read-only. If actual code requires another production path, stop and report the mismatch before expanding scope.

| Task | Exclusive files | Work and dependency |
| --- | --- | --- |
| T1 — reviewer portal consumer | `web/src/components/annotation/AnnotationComposerPanel.tsx`; `web/src/components/annotation/AnnotationComposerPanel.test.tsx`; new `web/src/components/annotation/AnnotationComposerPreview.test.tsx` | Define/forward preview target, enabled and anchor props; replace inline preview with portal; preserve state and access-error behavior; retain existing isolated tests and add actual portal/OverlayStack regressions in the separate test file. Complete the prop contract before route integration. |
| T2 — route slot and source binding | `web/src/routes/SpeechWatch.tsx`; `web/src/routes/SpeechWatch.test.tsx` | After T1's contract, provision the reviewer frame/target, match ownership, bind source/player identity, pass Notes-only enablement and captions anchor, and handle stale cleanup. Preserve owner presentation and existing tabs/drafts. |
| T3 — real player portal lifecycle regression | `web/src/components/speech/VideoPlayer.test.tsx` | After route/target contract settles, extend the current player-host harness for nested target/portal attachment, StrictMode teardown and source recreation. `VideoPlayer.tsx` stays unchanged. |
| T4 — browser placement regression | `web/tests/app-shell.spec.ts`; `web/tests/accessibility.spec.ts` | After T1–T3, extend test-local fixtures and real rendered reviewer cases. Keep existing owner cases and accessibility gates. No shared fixture, config or service edits. |
| Coordinator and read-only reviewer | This root plan for implementation/review ledger only | Compare actual changes against this scope; return code corrections to file owners; record exact checks and remaining limits. |

The inventory contains **eight application/test paths**: two production components and six test files. For later multi-worker execution, do not overlap editors. T1 and T2 share an API dependency and must run in that order; T3/T4 follow the completed API. No staging, commit or deployment unless separately requested.

Explicitly unchanged: VideoPlayer source and adapter, OverlayStack source, timing/voice/autosave hooks, index.css/notebook.css, UI primitives, role/authentication rules and routing configuration, backend/database/object storage/Whisper, dependencies, artwork/sidebar, publish/access policies, annotation/editor/recorder internals and real data.

## 5. Required regressions and acceptance checks

### Component and route tests

1. Composer renders its real OverlayStack into an external target, with no preview inside its Card and no second stack. The existing test file mocks OverlayStack to null; retain those isolated tests and use the new dedicated preview test file with actual OverlayStack. A controlled timing hook and Composer live-change callback seam are acceptable for DOM ownership tests, but not proof of real playback timing. Do not declare success from a null stub or duplicate production preview logic in a fake.
2. Cover saved written annotations and a valid live draft, including draft border marker, text changes, range changes, current interval, and target replacement/null. Existing annotation rows, Start/End form and publication handlers still work.
3. Notes→Essay→Transcript→Notes removes/restores only the visual preview. Keep the same composer form/textarea, pending text, unsaved recording state and video element; no extra annotation subscription/timing engine/player construction is caused by tab switching.
4. Default bottom anchor and top anchor when subtitles show; changing the anchor does not recreate the video or reset time/drafts. Respect the hook's existing 500ms observation cadence rather than requiring synchronous mode notification.
5. StrictMode setup/cleanup, target replacement within the same identity, source recreation and unmount leave no orphaned overlay/host or stale cleanup that clears a newer registration. Assert exactly one visible reviewer preview target/stack when eligible. Upgrade SpeechWatch's current no-ready-callback player stub and VideoPlayer.test's synchronous-ready fake to support deferred readiness/disposal and the real host lifecycle; do not manufacture source readiness by always calling the latest callback immediately.
6. Same mounted SpeechWatch A→B: cached A while B pending; B403/B404; B200 but initial B URL unresolved; late A URL resolving after B; ready B player; identical A/B URL strings; same-asset new initial-URL generation; and a same-asset adapter URL refresh. No A text over B, no B text over retained A video, no B+assetA refresh request, and no stale completion re-enables the preview. Repeat identity/review removal and annotation-access-denial cases; same-identity transient error/refetch retains drafts, recording and the existing alert without a new subtree unmount.
7. Non-reviewer, revoked reviewer, guest/unresolved identity and owner never acquire the reviewer preview. Members and coaches both retain existing text review rights; voice recorder role restrictions do not change.
8. Owner overlay projection/modes, voice controls, subtitles and player lifecycle tests continue passing. Preserve the existing metadata-track reuse, overlap, Start/End and autosave regressions unchanged.

### Real browser regression — populated reviewer, not just owner

Add distinct tests named **`reviewer overlay presentation`** to the already selected specs. Use the actual built frontend with test-local fail-closed intercepted APIs. Provide a non-owner user, a matching access-granting reviewer and a **nonempty** annotation response with matching review_id; do not substitute the owner's published-feedback flow for this case.

Correct the actual local fixture mismatch explicitly: both current helpers fall back to legacy `/api/reviews` sections containing in-progress review ID 2, while `notebookReview` and its populated track use ID 22. For the new reviewer-overlay fixture, answer `/api/reviews` from the same current-user/review/speech object used for annotations (for example, review 22), and require `review_id` to equal that exact review. Do not echo any requested query ID into a plausible response. Unexpected review IDs must fail closed. Preserve the existing default Option C/dashboard section fixtures and existing owner cases; keep these changes inside the two owned spec files.

Cover both landscape and portrait native moving video fixtures in Chromium and WebKit, using the existing bounded built-asset/media helpers and same-origin native Blob handling. Include a written range plus a legitimate temporary written draft. If save/edit is exercised, implement the exact intercepted mutation response and version fields in the local helper, not a real backend mutation. Unknown requests must still fail closed.

At minimum, verify:

- Seek/play before, inside and after the note interval, allow the normal fade to finish, and scrub backward to reactivate it. Check actual opacity/visibility and text, not data-visible alone.
- For representative bounded notes, the active overlay is a descendant of the **actual video.js presentation host**, not the commentary Card, and its bounding rectangle lies inside the displayed footage frame. Compare its lower edge/control clearance with the existing frame, and check top placement when subtitles show.
- No duplicate inline preview or space previously reserved for it. The timeline/editor remains readable and functional below the video.
- Real live draft updates appear on the video, and unsaved text survives switching tabs. The portal is actually absent/hidden outside Notes, despite the keepMounted panel. Preserve video element identity/currentTime.
- No-caption/unavailable, subtitle-on, dark preference/root .dark, phone and desktop layouts, representative multi-line wrapping note text, reduced motion and fullscreen. Compare media theme tokens to the pre-notebook root baseline and keep art out of the player. Exercise very long/unbroken text separately and compare the existing owner baseline: current overlay CSS has no max-height or overflow-wrap and annotation bodies have no length cap. Do not promise arbitrary text always fits, silently truncate it, or change shared styles within this scope. Report a demonstrated need for shared CSS/overflow-policy work before expanding the inventory.
- HTML fullscreen entry, where granted, contains the reviewer preview and keeps controls usable. Record unsupported/denied fullscreen or PiP as limitations; do not request the user to enable a feature merely to manufacture automation success.
- The accessible Notes list remains singular and usable; the visual preview stays aria-hidden/noninteractive. Add populated-reviewer accessibility scanning outside the existing `.video-js` exclusion; retain current WCAG tags and critical/serious gate. Geometry inside the excluded media subtree is proved separately by the native-media tests.
- Existing owner native commentary-mode/audio cases and login/chrome presentation regressions remain green.

### Future execution commands

From `web/`, after implementation:

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

Build completely before browser tests; never replace dist while it is being served. Run the browser projects serially, with distinct output directories so earlier evidence is retained:

```sh
WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts --grep 'reviewer overlay presentation' --no-deps --project=chromium --workers=1 --output=test-results/reviewer-overlay-chromium
WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts --grep 'reviewer overlay presentation' --no-deps --project=webkit --workers=1 --output=test-results/reviewer-overlay-webkit
```

Also run the existing isolated `notebook presentation|option C presentation` lanes to protect owner media, Login and chrome. Inspect the actual specs/config before choosing any other command. Real-stack workflows may run only in an already verified disposable E2E environment; do not reseed, rebuild/start/stop services, alter certificates or mutate the user's development speeches for this work. Mocked frontend results must not be described as live backend authorization/upload/transcode success.

## 6. Consequences, limits and rollback

The reviewer will see feedback against the actual moment in the video instead of a detached preview below it. Removing the inline preview shortens the panel; annotation timing, saved data and publication visibility do not change. Drafts remain private and previewing remains independent of publishing.

The main new risk is a portal remaining visible after its logical tab/identity becomes inactive; explicit enablement, scoped target cleanup and stale-source tests are required. Other risks are detached-host/StrictMode timing, caption collisions, theme inheritance and player recreation. Reuse the existing host/frame/anchor and test the real reviewer path to address them rather than introducing another playback implementation.

The existing overlay's unbounded text-height/unbroken-word behavior is a known geometry limitation. Hard containment acceptance applies to representative bounded notes; a comprehensive overflow policy would be a separately scoped design decision, not an implicit change to saved commentary or global CSS.

Native video-only fullscreen/PiP, physical iPhone behavior and real microphone recording remain separate manual/environment checks. This change must not inject unpublished draft text into exported/native subtitle tracks to simulate support. No backend migration, schema/dependency change or data backfill is needed.

Rollback only the later reviewer target/portal/binding changes and their tests, preserving unrelated work and the accepted notebook design. No rollback is performed while planning.

## 7. Planning review and preservation record

The coordinator inspected current route, composer, player portal, shared overlay, captions anchor, timing/ghost lifecycle, role/review helper, theme boundaries and actual unit/browser fixtures. Working tree was clean before drafting. A hash snapshot protects **1,083 existing tracked/untracked files**; this root document is intended to be the only project change.

The requested read-only explorer compared the draft with actual components, hooks, fixture helpers and player lifecycle. Its first-pass findings were incorporated:

1. Specify validated route/source effect dependencies, reject retained-A/B requests and ignore out-of-order URL completions.
2. Keep retained-player refresh requests bound to their actual source; key the player by playback speech/asset identity and track initial-source generation/concrete ready element. Do not use a one-shot currentSrc equality gate.
3. Preserve initialUrl's existing subtree-render semantics so same-identity polling/refresh does not discard draft or recording state.
4. Keep target refs stable and compare exact node/registration ownership on cleanup, including same-identity replacement and a reused host on source recreation.
5. Correct the actual review-2/review-22 browser fixture mismatch and add strict review_id validation. Upgrade deferred-ready/disposal test seams and add a dedicated real-OverlayStack preview test file.
6. Limit hard geometry acceptance to bounded notes and document the existing unlimited-text overflow limitation, rather than promising a shared CSS behavior this scope does not implement.

**Revised-plan recheck: complete.** The explorer reread the revised design, file inventory, acceptance checks and limitations against the code and found no remaining blocking defect. Its final wording correction distinguishes positioning the feedback frame from containing arbitrary text; that correction is included above. This is a source-grounded design review, not a guarantee about an unimplemented runtime change.

The coordinator verified all eight proposed paths, unique ownership, the seven existing files and one correctly declared new test file, Markdown fences and whitespace. A hash comparison confirmed **all 1,083 original files remain byte-identical**, and `PLAN-REVIEWER-VIDEO-OVERLAY.md` is the only new project file. Git whitespace checks passed.

No application implementation, new runtime/browser test run, service operation or data mutation has been performed for this planning request. The 39-test result cited above belongs to the preceding investigation, not a test of this unimplemented plan.

## 8. Execution record

The user authorized execution and requested one worker per exclusive task, dependency ordering, stopping on source mismatches, and a read-only reviewer after all workers finish. T1 owns its three composer files; after its API handoff T2 owns its two route files; T3 owns only VideoPlayer.test.tsx; T4 owns the two browser specs after T1–T3. The coordinator owns this ledger only. Review corrections return to the same exclusive owners.

Execution started on branch `development`, HEAD `803a26359ecfe648e42404561ee99ec3825ac097`. The working tree contained only this untracked plan. A new hash baseline protects the existing files and allows only the eight enumerated implementation/test paths plus this ledger. Actual handoffs, review findings, results and environment limits will be recorded below. No prior validation result is treated as proof of this new implementation.

- Baseline: 1,084 existing tracked/untracked files, including this plan; 1,076 unrelated files protected. The scope check currently passes with no unexpected paths or unrelated changes.
- Environment: read-only container inspection found only the healthy existing development stack. No disposable E2E stack was provisioned or modified. Browser checks will use intercepted APIs, exact frontend build assets and `--no-deps`.
- T1 handoff: required preview props and child-owned portal implemented; inline preview gap removed. The separate suite uses the actual overlay/composer/editor/list/timeline and timing hooks with a jsdom text-track seam. Focused composer/preview/unchanged overlay tests passed **28/28 across three files**, including live range/text, point exclusion, null/replacement/enablement/anchor, access errors, retained draft/recording seams and StrictMode cleanup. No source mismatch reported. T2 started only after this complete API/test handoff.
- During integration, a bounded T1 access-lifecycle audit confirmed that installed RTK Query retains successful data during a pending retry while clearing the rejected-state flag. Suppressing the preview only while isError is true could therefore briefly restore denied cached text. T1 retains sole ownership of its three files to add denial→pending retry→matching success regressions and a keyed preview-only suppression latch. This does not alter the handed-off prop API, drafts, publication or global access policies; T2 continues in its separate files.
- Worker turns were interrupted by an account usage limit; at the user's resume request, both original workers continued from their saved files and retained exclusive ownership. The preservation check still passed for all 1,076 unrelated files.
- T1 audit completed: terminal denial now remains suppressed through pending retries and subsequent failures, and releases only on a completed successful current response matching the review. Regressions cover all four denial statuses, cached success during fetching, missing/mismatched current data and retained draft/recording state. The same three focused suites passed **28/28**; scoped lint and whitespace checks passed. No prop change or scope expansion was needed.
- T2 handoff: route-owned target and Notes-only portal wiring, validated/cancelled initial requests, rendered-source-bound URL refresh, playback identity/generation/ready-element checks and registration cleanup are complete. Coordinator inspection caught the new-source initial-failure case: rejecting B's URL must clear retained A playback, while a same-source transient failure retains draft/recording state. T2 repaired it and added the regression. Final focused checks passed **166 tests across 12 files**, including **48 route cases**, plus TypeScript, scoped lint and whitespace. No source mismatch or extra path was needed. T3 began only after this complete handoff.
- T3 handoff: only VideoPlayer.test.tsx changed. Deferred-ready, nested real OverlayStack portals, StrictMode disposal, reused host/new URL, identical-URL identity remount, target replacement and stable presentation cases passed **27/27 across the player and unchanged adapter suites** (11 player cases). Scoped lint/whitespace passed; no production player change was needed.
- Before browser work, T2 reproduced a disposed-player caption attachment race with late B VTT and deferred B readiness. The existing attach effect could reach disposed A through its retained ref and trigger the route error boundary. A bounded route-only disposed/concrete-video guard fixes it; the regression confirms one B track and correct anchor after B becomes ready. Updated focused checks passed **175 tests across 12 files**, including **49 route cases**, plus TypeScript and scoped lint/whitespace. No adapter or other extra path changed. T4 started after T1–T3 and this audit were complete.
- Full frontend integration unit run after T1–T3 passed **834 tests across 107 files**. T4 browser sources/verification remain in progress; the final independent reviewer has not started yet, as requested it follows completion of all workers.
- T4 source handoff is complete in its two exclusive specs: opt-in consistent review-22 fixtures, native reviewer timing/placement/draft/tab/fullscreen cases, existing owner overflow comparison and populated accessibility scans. TypeScript and focused lint passed. Coordinator full TypeScript, lint and production build passed; lint reports five existing warnings in protected files and Vite reports its bundle-size advisory. The completed build is held stable while T4 runs Chromium and WebKit serially against intercepted APIs. No live backend result is claimed.
- T4 Chromium: the first lane passed 23/25 scenarios. Two new native assertions incorrectly required the active note itself to sit exactly at the 48px clearance, although unchanged OverlayStack keeps invisible in-window rows in normal flow. The tests now require stack clearance and hard active-note containment; point notes must remain invisible. Hidden retained-editor identity locators also explicitly include hidden elements. After static checks, both native cases passed in a distinct rerun, covering all 25 scenarios. No production or CSS correction was needed. Coordinator inspected the phone portrait screenshot and confirmed placement above the controls.
- T4 first WebKit lane: all app-shell/native reviewer and owner checks passed. One existing phone notebook accessibility scan reported a captions-toggle contrast failure and its serial group skipped three subsequent accessibility checks. Those four checks were scheduled for an unchanged-gate rerun; the completed result follows below.
- T4 final handoff: **all 25 selected isolated scenarios per browser are covered by passing runs**. Chromium has 23 initial passes plus 2 corrected native passes; WebKit has 21 initial passes plus 4 unchanged accessibility rerun passes (36 seconds). These are combined results, not claims of two uninterrupted clean lanes. The initial WebKit captions-toggle contrast failure did not recur; its cause is not established, and original failure evidence is retained. Both engines granted HTML fullscreen in both reviewer orientations. New and legacy populated accessibility scans preserve the original WCAG tags, media exclusion and critical/serious gate. Native media assertions independently verify the excluded video subtree's geometry, tokens and visibility.
- Browser evidence: `/private/tmp/reviewer-overlay-chromium-t4.log`, `-chromium-t4-r2.log` (interrupted hidden-editor locator investigation), `-chromium-t4-r3.log` (2/2 native passes), `/private/tmp/reviewer-overlay-webkit-t4.log` and `-webkit-t4-axe-r2.log` (4/4 accessibility passes). Corresponding `web/test-results/reviewer-overlay-*` directories contain screenshots, capability JSON and existing owner/reviewer overflow measurements. Unlimited unbroken text reproduces the existing shared-CSS limitation in both branches (approximately 50,555px scroll width in 278px available); no styles or text policy changed. Native PiP HTML, physical iPhone/microphone and live backend authentication/media processing remain unverified.
- All implementation workers finished before a fresh independent read-only reviewer was dispatched. That reviewer is comparing every acceptance step with actual code and browser evidence, rerunning the full frontend suite and static checks, and checking the main login regressions. Final findings and any bounded owner repairs will be recorded below.
- **Independent review complete:** no blocking defect or material missing acceptance step found. The reviewer compared the plan against actual production code, dedicated composer/route/player tests, browser logs, capability JSON and representative Chromium/WebKit screenshots. It independently reran **834/834 tests across 107 files**, TypeScript, ESLint (**0 errors, 5 pre-existing warnings**), scope preservation and whitespace checks. Login and owner regressions pass; intercepted browser checks cover the main login interface, not live backend authentication. No additional source repair was required. The earlier coordinator findings (terminal-denial retry, new-source initial failure and disposed-player captions) were repaired by their original file owners before this final review.
- **Completion and preservation:** all four exclusive tasks and the requested independent review are complete. Only the eight approved application/test paths and this execution record changed; all 1,076 unrelated baseline files remain byte-identical. Existing shared player/adapter, CSS, authentication/backend, data, dependencies and service configuration remain unchanged. No staging, commit, deployment or service/data operation was performed. Build output is local verification output; the running development deployment was not rebuilt or restarted. Browser limitations and the retained initial failure evidence above remain part of the result.
