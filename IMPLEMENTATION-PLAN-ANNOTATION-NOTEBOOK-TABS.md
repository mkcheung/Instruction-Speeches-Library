# Implementation plan: Option A annotation notebook tabs

**Status: planning only — implementation is not authorized by this document.** Prepared 2026-10-22 against HEAD `2aadcd5b902b08047f5adab277446f80e2f29327`. The user selected Option A and requested exploration, a root-level plan, two independent integrity reviews and corrections, without application coding. Section 10 records review and preservation evidence.

## 1. Selected design and boundaries

Replace the crowded reviewer-authoring stack with this order:

1. A persistent, clearly labeled speech timeline, with separate **Text** ranges and **Voice** positions on the same time scale.
2. A small **Add commentary** tool selector: **Text note | Voice note**.
3. Exactly one visible creation tool, while both eligible tool instances remain mounted.
4. A collapsible **Saved notes (N)** section containing one mixed, chronological, paginated list with compact expandable rows.
5. The existing publication and review actions, visually separated from creation tools. Keep Clear/Abandon separate from Publish and preserve their conditions and confirmation behavior.

Retain Rehearsal Notebook's cream canvas, plain paper, ink text, teal controls, burgundy accents and restrained header tape/shadow. Use the current legible form typography and existing labels inside editors; this is not a redesign of the underlying Start/End form or its save protocol. Do not reintroduce Kind or Topic.

The accepted illustrative comparison is `work/design-previews/annotation-controls-options.html`. Its four-note demo pages, sample counts, simulated actions, approximate artwork and marker interactions are not a backend/UI specification. This plan sets production page size to **six saved notes**. The comparison remains unchanged.

**Outcomes:** less vertical clutter, clear tool choice, distinguishable text/voice occupancy, and manageable saved feedback. A blank timeline means **no annotation**, not proof that a segment has not been watched or reviewed. Do not add a reviewed-percentage metric or require continuous annotation coverage.

This concerns the reviewer's own authoring workspace. Do not alter the speaker's four commentary-playback modes, speech subtitles, roles, backend/schema, object storage, workers, publication/privacy, or no-overlap rules. Existing sidebar artwork remains; commissioning new characters/poses or wiring new artwork states is a separate task. No art belongs inside footage, the timeline or controls.

## 2. Source findings that constrain the implementation

| Actual code | Consequence |
| --- | --- |
| `AnnotationComposerPanel.tsx` owns serverRows, liveOverrides/merged, pending-work registration, navigation protection and the single authoring timing engine. It currently renders timeline, Composer, eligible VoiceRecorder, full AnnotationList, recovery and actions in one stack. | Change presentation without duplicating this state or engine. Tool selection and pagination must not own annotation truth. |
| The same panel portals its real OverlayStack into the route's player target; the slot/source/ready-player/access guards are in `SpeechWatch.tsx`. | Keep the portal outside both tool panels and outside Saved notes. Local Text/Voice choice and list expansion/page must not disable or relocate it. Preserve outer Notes-only enablement and terminal-denial suppression. |
| `ui/tabs.tsx` wraps installed Base UI; `TabsPanel keepMounted` is already used for outer reviewer Notes. | Reuse real accessible tabs with explicit keepMounted on **both** creation panels, not conditional mounts. Do not modify the shared primitive. |
| `TimelineStrip.tsx` currently packs all annotations into at most two generic rows. Ranges are bars, points are speaker circles; marker click only calls onSeek(seconds). | Introduce actual labeled lanes and an identity-aware activation contract. Existing shared seek-only callers must remain valid where applicable. |
| `isPointAnnotation` includes erased-audio point rows (`timing_type: point`, `voice: null`) and historical audio rows without timing_type. | Classify timeline geometry by this helper, not presence of audio. An unavailable recording remains a point; recording length is not a speech span. |
| `AnnotationList.tsx` owns deletion/Undo and passes its entire annotations prop into each text editor for overlap validation. | Add display paging inside this full-data boundary. Never replace that prop with one page's slice. Keep list/mutation coordination mounted when Saved notes closes. |
| `AnnotationRow.tsx` already shows a compact text summary; its editor mounts only on Edit. VoiceAnnotationRow displays full transcript/status and most actions immediately. | Preserve explicit editing; make read-only detail disclosure consistent, especially for voice. Avoid nested interactive elements in a disclosure button. |
| `useAnnotationEditor.ts` persists local text and reports pending by instance ID; unmount unregisters pending and is not a substitute for explicit Cancel/live cleanup. | Unmounting an edited row during paging/polling can clear guards and leave an optimistic overlay. Section 5 defines a deliberate editing lock and stable row retention. Recovery alone does not satisfy state retention. |
| `VoiceRecorder.tsx` owns MediaStream/MediaRecorder, Blob, captured position, UUID and uncertain-upload snapshot. Unmount releases the microphone; Blob is page-memory only. | A hidden tab must retain the same recorder. Report session state through a small optional callback; do not lift/recreate media resources or infer recording state from a generic pending flag. |
| `C`/`Alt+C` currently invokes the new text composer's capture callback through `useKeyboardShortcuts`. The Notes subtree is kept mounted. | Gate the authoring capture when outer Notes is inactive; when allowed, reveal Text before capture. Do not stamp an invisible field or bypass existing typing guards. |
| Annotation API returns the complete authorized array, ordered by start/id. The 200-note limit is a write cap, not a list pagination contract. | Client-side paging needs no API changes; do not assume historical data can never exceed that cap. All current notes remain available to timing, keyboard navigation and validation. |
| `SpeechWatch.tsx` comments explicitly describe the kept-mounted, chronological, authoritative accessible list. | Update those comments to distinguish one authoritative **paged** list from the complete timing dataset. Preserve its accessible name and avoid a second hidden full list. |

Relevant files were read directly; earlier design-agent findings were rechecked against this HEAD. The first explorer's detailed findings inform the design below. Sections 8–10 define remaining reviews, not permission to execute.

## 3. Tool switching and recording lifecycle

### 3.1 Visible behavior

- Default to **Text note** for each user/speech/review session. Keep local selection out of the URL and preference API.
- Use a labeled `TabsList` for **Add commentary**, distinct from the outer **Your feedback** tablist. Provide Text note and, only when permitted, Voice note. With no voice permission, show the text tool and its heading without a redundant single-choice tab strip.
- Keep the same Composer and eligible VoiceRecorder instances mounted in their fixed panels. Switching changes visibility, not keys, IDs, UUIDs, pending registration or live preview. Hidden content must not accept focus or input and must leave the accessibility tree.
- Tab labels include concise state text, such as **Text note · Unsaved**, **Voice note · Unsaved recording**, **Voice note · Saving**, or **Voice note · Retry upload**. Do not infer text state from all pending work: saved-row edits and recorder work have their own provenance.
- Stop requiring users to see both forms to understand their choice. Keep helper text specific to the selected tool; retain explicit Add annotation/Save voice note/Publish distinctions.

### 3.2 Recorder state contract

Add an optional, typed session-state callback on VoiceRecorder, reporting derived UI facts, for example: phase, pending, hasRecording and blocksToolSwitch. Also add an optional acknowledged-save callback carrying the saved Annotation/ID, emitted only after the existing exact UUID/position/point acknowledgement succeeds, including resolution by polling. Deduplicate the same admission within its recorder session. The recorder remains sole owner of media and submission state. Use stable callbacks and clear only the matching session's report during cleanup; old identity cleanup must not clear a newer session. No callback may send a new save request.

Add an optional `active` prop on VoiceRecorder, defaulting to true for existing standalone callers. The panel supplies `authoringActive && selectedTool === 'voice'`. On inactivity, explicitly pause the recorder's contained native preview audio through its own mounted wrapper ref; a scoped descendant query within that owned wrapper is acceptable. Do not revoke the Blob URL, destroy/recreate WaveSurfer or discard the recording merely because the tool/outer Notes is hidden. A late URL/preview render must also respect inactivity. VoiceWaveformPreview remains unchanged.

| Recorder state | Local Text/Voice switch | Outer Notes/Essay/Transcript switch |
| --- | --- | --- |
| Idle / unsupported / permission denied / no device | Allowed; show the existing precise recorder message inside Voice. | Allowed. |
| Requesting permission / actively recording | Keep Voice visible; disable leaving Voice, with a visible explanation. Stop remains available while recording. | Prevent leaving Notes while the microphone request/recording is active, using disabled sibling tabs plus a guarded controlled onValueChange. Explain why; do not reset the selected tool. |
| Stopped recording / local preview / definitive upload error | Allowed; badge the retained recording and provide an explicit return to Voice. | Existing kept-mounted Notes behavior remains; pending navigation protection stays active. |
| Saving / uncertain upload outcome | Allowed with persistent visible Saving/Retry upload badge and return affordance. Preserve exactly the original Blob, UUID and captured position until acknowledged or explicitly resolved. | Allowed; keep session state and pending protections. No implicit cancellation or replacement request. |

Pass a narrowly scoped recording-activity report from the panel to SpeechWatch for the outer tab lock. Scope the route report to the current user/speech/review and the exact mounted reporter; consume it only for that current reviewer session. Reset/release only matching registrations on teardown. Retained A state must never disable B's tabs after route navigation. Keep unrelated owner tabs and route/source guards structurally intact.

The new callback must cover delayed permission, permission refusal, MediaRecorder constructor/start failure, recorder error, Stop/onStop, 90-second automatic stop, acknowledged/polled uncertain save and unmount. Do not report “not recording” before the recorder has actually stopped. Do not change permission handling, MIME fallback, idempotency or upload-error classification.

### 3.3 Shortcuts and focus

SpeechWatch passes a separate **authoringActive** boolean based on actual outer Notes selection. This is not derived from previewTarget availability: authoring can remain usable when media/preview readiness is changing.

- Keep shared useKeyboardShortcuts implementation/typing guards unchanged. At this call site, omit the text capture callback when Notes is inactive, the session is unwritable, or a microphone request/recording locks tool switching. Preserve the other established media shortcuts unless separately disabled today.
- Otherwise C/Alt+C selects Text and calls the current capture callback; it must never send a save request. The new composer still owns its own state and generation.
- Normal tab switching retains focus on the tab control. Explicit activation of a temporary draft marker selects Text and focuses a labeled text-tool region after it becomes visible, without changing draft contents or timing.
- Use owned React refs and a deliberate reveal-request token for focus; no global document lookup or effect tied to currentTime/polling. No autofocus caused by ordinary playback, successful poll, page clamp or routine rerender.

## 4. Timeline: labeled lanes, accurate geometry, explicit selection

Keep the timeline **outside** the creation tabs and Saved notes disclosure. It stays present while either tool is active and while saved notes are folded. “Persistent” means persistent within the Notes workspace, not a new fixed/sticky screen overlay.

- Render labeled **Text** and **Voice** lanes with one shared horizontal data axis and playhead. Use a teal range band for text and a clearly different point/speaker glyph for Voice. Labels/icons/shape carry meaning in forced colors and without color perception.
- Attach/use the existing playhead positioning loop relative to the data axis, excluding the label gutter. Both lane origins, time ticks and all positions must agree at phone/desktop widths. The unchanged usePlayheadPercent hook normalizes against native video.duration, whereas current marks use asset durationSeconds. Resolve that mismatch locally in TimelineStrip: finite positive native duration takes precedence once loadedmetadata/durationchange arrives; asset duration is only the pre-ready fallback. Before a finite native duration exists, retain the hook's nonadvancing playhead behavior. Reset the axis CSS playhead position to zero on concrete video replacement or loss of a finite duration so a retained DOM node does not freeze the previous source's last position. Rebind/clean duration listeners on concrete video replacement; do not change the shared hook. Test differing native/asset durations. Preserve zero/unknown-duration behavior without NaN/Infinity or fake duration.
- Use exact range start/duration for visual widths. Do not stretch a short interval to a large minimum-width bar and misrepresent occupancy. Voice glyph centers indicate the precise speech timestamp; their recording length appears only in the row summary.
- Add restrained start/mid/end tick labels using actual duration. Clamp drawing at the bounds without changing stored timings. Handle speech-end points and invalid legacy values explicitly/readably rather than silently modifying data.
- Distinguish unsaved temporary text draft markers with a dashed edge and accessible “Unsaved text draft” wording. Explicit selected marker styling is independent of time-driven current highlighting.
- Grandfathered overlapping ranges must remain individually selectable: use enough deterministic subtracks within Text, not the current two-row cap. Dense point glyphs similarly need collision-aware subtracks within Voice, accounting for visible glyph width on resize; timestamp stems still share the same axis. A local ResizeObserver is acceptable for geometry, not for discovering player nodes. No dragging/resizing/automatic retiming is introduced.
- Do not enlarge invisible hit areas until adjacent targets overlap. Keep keyboard-operable marker buttons, sensible focus styling and explicit time/type names. Provide equivalent comfortably sized seek controls in each saved-note row and a clearly labeled Saved notes disclosure, so tiny exact range marks are not the only means of navigating.

Add an optional identity-aware marker activation callback alongside existing seek behavior. A single activation performs one seek; avoid calling onSeek twice from parent and child. The callback receives the selected Annotation (or ID plus kind/temporary classification), not just seconds. Keyboard activation follows the same path.

### Selection behavior

| Explicit action | Expected result |
| --- | --- |
| Saved text/voice/erased-point marker; no saved editor or operation hold | Seek, open Saved notes, select its chronological page, open that row's read-only details, then focus its summary. Do not automatically enter editing or start audio. |
| Temporary text draft marker; tool switching allowed | Seek, select Text and reveal the existing draft. It does not count as a saved row or create a page. |
| Temporary draft marker during microphone request/recording | Seeking may occur, but keep Voice/Stop visible. Explain that the draft can be opened after recording stops; do not stamp or erase it. |
| Saved marker on another page during a saved-edit lock | Seek once, retain the active editor/page and show a concise deferred selection: “Save or cancel this edit, then show the selected note.” Retain the selected ID; offer an explicit Show selected note action when unlocked. Never silently ignore the reveal or silently leave the edit. |
| Saved marker on another page during an in-flight delete/Undo/transcript-retry hold | Seek once, retain the displayed page/operating row and selected ID, and explain “Wait for the current operation, then show the selected note.” Enable explicit Show selected note after all applicable holds settle; do not automatically jump. A same-page read-only reveal may proceed only if it does not collapse/remount an edited or operating row. |
| Ordinary playback / scrub / `[` or `]` media navigation | Update playhead and existing current highlighting using the full dataset. Do not automatically paginate, expand, select tools or steal focus. An off-page current note may have a nonintrusive Show current note action, but no live announcement every frame. |

Use monotonically distinct reveal requests so clicking the same marker twice can deliberately reveal/focus again. Resolve the annotation against the latest complete set. If a selected saved row disappears before reveal, announce that it is no longer available and retain a valid page; never reopen stale details. Scope selection/page state to user/speech/review, with no persistence across accounts/reviews.

## 5. Saved notes: one paginated accessible list and safe editing

### 5.1 Disclosure, summaries and paging

- **Saved notes (N)** is a heading/disclosure button with aria-expanded/aria-controls. Default closed for a populated review to minimize initial clutter; when empty, show a concise “No saved notes yet” message rather than an empty paginator.
- The list/mutation owner stays mounted when folded. Hide its body accessibly; do not conditionally unmount AnnotationList. Keep exactly one authoritative `ol` named **Your commentary**, chronological and timecoded. Closed/off-page content is not simultaneously exposed as a duplicate list.
- Sort once using compareByStartThenId. Page only **saved** rows, six at a time; no separate Text/Voice filter, infinite scroll or server pagination. Retain all rows as the validation/timing dataset. Show **Notes 7–12 of 20 · Page 2 of 4**, Previous and Next. Hide paging controls for one page; disable unavailable directions.
- Each compact summary shows type, time or range, and a bounded excerpt. Voice uses annotationDisplayBody for pending/failed transcript status, plus recording length when available. Erased point: “Voice note · Audio unavailable” with its retained transcript. Never imply that an audio duration is a speech interval or that an ungenerated transcript exists.
- Separate **Go to time**, **Show details/Hide details**, **Edit/Edit transcript**, **Preview audio** and **Delete** interactions. No buttons nested inside buttons or summary links. Details contain full readable text/transcript, existing audio/status/retry controls and editing actions. Delete is secondary and appears in details; preserve its existing mutation/Undo semantics.
- Read-only disclosure must not mount useAnnotationEditor; that hook can emit a live override even before typing. Only explicit Edit starts an editor. Retain the existing acknowledged-voice-version behavior and conditional actions based on processing/ready/failed status.
- Keep point-family rows in a stable VoiceAnnotationRow renderer, including erased-audio points, rather than changing component type when voice becomes null. Extend that row's unavailable-audio wording and transcript-only Edit behavior accordingly. Preserve the same active TranscriptEditor/hook identity through audio erasure, with its dirty/conflict/uncertain state and pending instance IDs. Classify by isPointAnnotation; keep AnnotationRow's existing standalone erased-point compatibility intact.
- Do not let VoiceAnnotationRow's acknowledged saved-object cache revive audio that the latest row says is unavailable. Its current `effective` selection can choose the older object wholesale. Separate acknowledged body/version reconciliation from authoritative current voice availability; a transition to voice:null pauses/removes audio and its actions immediately while retaining the editor. Test erasure while a locally acknowledged body/version is ahead of the poll, as well as during dirty/conflict/uncertain edits.
- Closing a read-only voice detail, paging away, closing Saved notes **or leaving outer Notes** stops any preview audio; it must not keep playing from hidden controls. Thread authoring activity from panel to list/rows independently of detail/page state; retain editor identity while inactive. Use a concrete audio ref and explicit pause/cleanup. A late playback-URL response may cache the URL, but must not reopen details, mount/start hidden audio or steal focus. Existing URL-error retry behavior remains.

### 5.2 Chosen edit policy: finish the saved edit before paging

Use **one active saved-row editor at a time**. This plan deliberately chooses a visible editing lock over a second pinned editor area or a new draft registry.

While any saved-row editor is open (including pristine, dirty, saving, conflict or uncertain state):

1. Keep its row and editor mounted with the same React identity. Keep that row's details and Saved notes open.
2. Disable Previous/Next, opening another saved editor, and collapsing the edited row or Saved notes. Explain **Save or cancel this edit to change pages**. Do not disable a recovery/conflict action the existing editor needs to resolve itself. Saving/uncertain states retain the existing frozen/Retry original save behavior.
3. Creating a new text note or retaining a stopped Voice draft does not by itself lock list pages. Those tools have stable owners outside the list.
4. Do not let a polling reorder, inserted note, deleted neighboring note or page clamp accidentally eject the active editor. Capture the current displayed page's membership when editing begins; keep those IDs until the edit closes, apply current objects for still-present IDs so version/conflict updates reach the existing hook, and retain the edited row's last known object if it disappears remotely. Re-sort retained members by current compareByStartThenId without changing their keys/editor types. Drop a remotely removed nonedited member; do not fill its slot with another page's note while held. Clearly mark a missing edited row and keep its local work; do not claim it is still server-saved. Replace canonical range labels during this hold with truthful text such as **Editing page held · 5 saved notes shown · 20 saved total**, plus a separate **1 unavailable note being edited** indicator if needed. Server authorization and acknowledgement rules remain authoritative for Save.
5. Use the latest **full** annotation array for overlap validation even while display membership is retained. Never freeze validation inputs with the displayed page.
6. When editing ends by acknowledged Save or explicit Cancel, resume canonical chronology and clamp to a valid page. Do not automatically jump to a deferred marker; enable **Show selected note** for the user's deliberate action. Do not silently discard recovery/conflict/uncertain work.

Row components expose stable edit-open reporting to the list owner and preserve original pending-instance IDs when forwarding to the panel. Do not replace all editor IDs with a row ID: transcript retry, save, delete and Undo can have distinct pending operations. Use stable per-row callback boundaries so effect cleanup/re-registration does not falsely release navigation protection.

Short-lived operations use a specific policy: while delete, an invoked Undo or transcript retry is **in flight**, hold page navigation and Saved notes/operating-row collapse, show a busy explanation, and retain the operating row/component even if polling removes it before its promise settles. Use the latest full dataset for all other behavior. Release the hold after settlement unless an editor is still open. Do not lock for the entire six-second Undo toast window: the kept-mounted AnnotationList owns that action and original submission identity after deletion, across subsequent page changes. On an eventual Undo click, capture the currently displayed page for the new short hold; no deleted row must be recreated merely to own the request. An unawaited transcript retry must be exposed via its actual isRetrying/pending report, not assumed complete at click time. All holds are unioned by operation/editor identity; cleanup of one cannot clear another's hold.

### 5.3 List updates and focus

- Without an active editor/operation hold, deletion/polling may clamp the page, but never move focus merely because currentId changed. Keep the focused paginator/disclosure control available; if the focused row is explicitly deleted, move focus to the next surviving row summary or the Saved notes heading when empty.
- New saves update the complete dataset, counts and timeline. If their note lands off-page, offer a Show saved note action rather than auto-switching pages or abandoning another editor. Wire the existing Composer onSaved callback (already accepted through its options) and the new VoiceRecorder acknowledgement callback; no Composer source change is required. Store only the current session's acknowledged ID. Wait for that ID to appear in the full saved dataset before enabling reveal, rather than treating temporary query lag as deletion; stale session callbacks cannot create a notice on a different review.
- Preserve collapse/row expansion while IDs still exist. Remove stale expansion/selection registrations after acknowledged removal. Never use list indices as row keys.
- Normally the visible page is a contiguous ordered subsequence; its items expose appropriate list position/total metadata if used, and page text is available to assistive technology. Held page membership may be noncontiguous after a poll, so use the truthful held-state labels above and never assert stale positional indices/total metadata. An unavailable edited snapshot is explicitly separate from saved counts. Announce deliberate page/selection changes once, not every query poll.
- A failed refresh is not an empty review. Preserve existing error/retry/recovery behavior, access-denial preview protection and unsaved navigation guards.

## 6. Theme, responsive layout and accessibility

Add one local `annotation-workspace.css` under the annotation component directory, imported by the panel. Scope new styles to an explicit authoring root/class. Do not edit global UI primitives, notebook.css, index.css or media theme tokens. New lane containers may override only their own positioning/size rules locally.

- Use the accepted notebook variables within the workspace; retain opaque readable paper under OS dark preference and `.dark`. Keep text, timestamps, errors and disabled controls legible; decorative gold/tape is not a status signal.
- A quiet two-choice tool strip must not compete with outer Notes/Essay/Transcript. Use existing Tabs primitives and normal keyboard semantics, not ad hoc pressed divs.
- On phones, stack existing Start/End field groups and wrap actions normally. No second column, drawer, modal, fixed recording bar or tall sticky header. Do not shrink the video to accommodate tools.
- Saved rows use simple dividers/quiet boundaries, avoiding a heavy notebook frame around every summary. Details wrap arbitrary user text without making the whole page overflow; this scoped reading-area wrapping is not permission to change video overlay text behavior.
- Test 320/375/768/1440px, 200% zoom/reflow, keyboard-only navigation, forced colors, reduced motion, dark preference and `.dark`. Normal buttons/list seeking/disclosures should provide 44px touch targets; exact timeline range marks need equivalent full-size list controls and no overlapping invisible hitboxes.
- Preserve unique accessible names/IDs, logical focus, hidden-panel semantics and one authoritative commentary list. Visible text must be included in accessible names. Tool state, edited-row lock and pending/uncertain errors remain understandable without hover or color alone.

## 7. Exact future file inventory and ownership

These are **proposed edits after separate execution authorization**, not current edits. All paths are relative to the project root. If execution finds a necessary path outside this inventory or a contract inconsistent with this plan, stop and report before expanding it.

| Task / exclusive future owner | Files | Work / dependency |
| --- | --- | --- |
| T1 — recorder session reporting | `web/src/components/annotation/VoiceRecorder.tsx`; `VoiceRecorder.test.tsx` in the same directory | Define optional typed session report, acknowledged-save callback and active-preview pause/cleanup; verify every recorder transition, retained Blob/UUID/anchor and uncertain retry. No upload/media algorithm changes. Hand off callback contract first. |
| T2 — saved list and row disclosure | `web/src/components/annotation/AnnotationList.tsx`; `AnnotationRow.tsx`; `VoiceAnnotationRow.tsx`; existing `AnnotationList.test.tsx`; `VoiceAnnotationRow.test.tsx`; new `AnnotationRow.test.tsx`; new `AnnotationListPagination.test.tsx`, all in that directory | Implement full-data/display boundary, six-row pages, identity reveal request, disclosure, one-editor lock, retained page membership, operation lifetime, focus and audio pause. Hand off list/reveal contract before T4. |
| T3 — timeline lanes/activation | `web/src/components/annotation/TimelineStrip.tsx`; `TimelineStrip.test.tsx` | Lanes, full-data geometry, legacy/collision subtracks, shared axis/playhead, exact ranges, identity callback and accessible markers. Agree selected/reveal inputs with coordinator; no independent mutations. |
| T4 — authoring integration | `web/src/components/annotation/AnnotationComposerPanel.tsx`; existing `AnnotationComposerPanel.test.tsx`; `AnnotationComposerPreview.test.tsx`; new `AnnotationWorkspace.test.tsx` | After T1–T3 contracts and T6 stylesheet handoff: controlled local tabs/keepMounted, independent tool pending badges, local recorder lock, active shortcut capture, persistent portal, Saved notes disclosure and explicit reveal orchestration. Preserve scope key and aggregate pending guards. Use owned wrapper refs for programmatic focus; no Composer/hook API change is planned. |
| T5 — outer reviewer-tab guard | `web/src/routes/SpeechWatch.tsx`; `SpeechWatch.test.tsx` | After T4 prop contract: pass authoringActive; consume exact session-scoped recording lock; guard/disable leaving Notes only during requesting/recording. Update full-list comment to paged-list contract. Do not alter player/preview provenance, owner tabs or roles. |
| T6 — scoped appearance | new `web/src/components/annotation/annotation-workspace.css` | Settle root/lane/list/tool class contracts after T1–T3, then deliver the local stylesheet before T4 imports it. No dependency on a compiled T4 is required. Add notebook styling, reflow, focus, hidden/error/disabled states and forced colors; refine in this same owner after rendered integration. Other owners add agreed classes but do not edit stylesheets. |
| T7 — browser verification/adaptation | `web/tests/app-shell.spec.ts`; `web/tests/accessibility.spec.ts`; `web/tests/annotation-range/authoring.spec.ts`; `web/tests/voice-annotations.spec.ts`; `web/tests/voice-annotations.cross-browser.spec.ts`; `web/tests/keyboard-shortcuts.spec.ts` | After T1–T6: update deliberate tool/details navigation, add isolated populated multi-page cases, retain native overlay/owner/login regressions. Adapt real-stack specs without weakening assertions; run them only in a verified disposable environment. |
| Coordinator | This root plan only, for execution/review ledger | Preserve existing files; reconcile contracts before integration, run checks, send source corrections to exclusive owners and record validation boundaries. |

Inventory: **24 application/test paths** — seven existing production components/routes, one new scoped stylesheet, three new unit test files, seven existing unit test files and six existing browser specs. No two workers edit the same path. Dependency order is T1/T2/T3 contract handoffs → T6 stylesheet → T4 integration → T5 outer-tab integration → final T6 rendered appearance check → T7 stable-build browser checks. T1/T2/T3 may be explored independently; do not make a tested T4 handoff depend on a stylesheet that does not yet exist. Retain the same file owners for review fixes.

Explicitly unchanged: Composer.tsx, AnnotationEditor.tsx, editor/timing/voice/keyboard hooks, VideoPlayer/adapter/OverlayStack, shared Tabs/Button/Card, index.css/notebook.css, annotation API/types/overlap library, backend policies/services/database/Whisper/SeaweedFS, package files/configuration/shared E2E fixtures/artwork and actual speeches/reviews. No new package is required.

## 8. Verification required during later execution

### Unit and integration checks

1. Tool tabs render one visible editor; same actual Composer/VoiceRecorder/Blob/form identities survive repeated switching. No duplicate timing engine/query/player or OverlayStack. Text stays previewed in Voice mode when valid; inner tool choice does not gate the portal.
2. Default Text and role exclusions: member/coach/admin/super-admin and owner/read-only paths preserve current rights. Existing voice notes remain readable even when recording is unavailable.
3. Recorder requesting/recording lock, delayed permission refusal/grant, start/error, Stop, automatic limit, unsupported state, stopped preview, saving, definitive error, uncertain original retry, polled acknowledgement and cleanup. Same Blob/UUID/anchor retained; no hidden active microphone or stale outer lock. Creation preview pauses on tool or outer Notes hiding and does not restart automatically on return; save callbacks report exact acknowledged IDs once per session.
4. C/Alt+C reveals/captures Text only when active/writable/unlocked; does not stamp during outer Essay/Transcript or active microphone. Existing typing/Space/video-control guards stay green. Keyboard media navigation uses all pages' data without auto reveal. Nested tool and outer tabs independently handle Arrow/Home/End/Space correctly with one intended activation and no accidental media toggle/capture.
5. Timeline lane/axis math for portrait/landscape-containing pages, first/middle/end/zero duration, resize, temporary valid/invalid ranges, erased/historical points and legacy overlapping/dense notes. Recording duration never affects point width. Labels do not offset playhead relative to markers. Native/asset duration mismatch, delayed metadata/durationchange and concrete video replacement use one consistent axis and remove old listeners.
6. Saved list cases: zero/one/six/seven/thirteen notes; deterministic equal-start ordering; correct saved-only count; full off-page overlap validation for text and voice; accessible one-list pagination and real summary/details behavior.
7. Marker reveal on page 2/3, repeated same marker, deletion-before-reveal, temporary draft, keyboard activation and no double seek. Playback/scrub/poll never auto-paginates/expands/focuses. Editor or operation holds visibly defer off-page marker reveal; explicit Show selected note resolves after Save/Cancel and/or all in-flight operations settle. Same-page read-only reveals cannot collapse/remount operating or edited rows.
8. Opening a read-only row does not mount an editor or add a live override. Editing locks pages/collapse/another editor; same editor/fields/pending/recovery and live preview survive insertion/reorder/neighbor deletion or disappearance of its own server row. Audio erasure retains the same point-family renderer and active transcript editor, including acknowledged version ahead of a poll, dirty/conflict/uncertain cases; stale acknowledgement never revives audio. Retained members are re-sorted without remount and held-state counts remain truthful. Latest full data still reaches overlap validation. Do not silently drop busy/conflict/uncertain work.
9. Delete/Undo text and voice retain original UUID/tombstone behavior and retry; mutation operation survives all permitted UI changes. Count/page clamp after final deletion, no empty last page, deterministic deletion focus. Voice transcript acknowledgement/version/retry, unavailable audio and lazy URL errors remain intact.
10. Audio pauses when detail/list/page or outer Notes is hidden, and on current-row audio erasure; late URL resolution cannot reopen/start it. Creation preview follows the same inactivity rule while retaining its Blob. Publication/Clear/Abandon remain disabled by all true pending sources, including hidden new drafts and recorder state. New UI wrappers must not clear existing pending IDs. Test bounded mutation holds across poll removal, concurrent operation settlement and Undo invoked after paging; no toast-window lock.
11. Keep source-generation/ready-player/target replacement/StrictMode/access-denial retry regressions from the previous overlay work. New report/ref cleanup must be exact-identity-safe on account/review/speech replacement. Outer tab locks never leak into a new session.

Run from `web/` after implementation:

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

The planning task does not run these as tests of an unimplemented design. Existing suites are a baseline to preserve, not evidence that Option A already works.

### Isolated browser checks

Extend the two existing intercepted-API presentation specs with a distinct describe name **`annotation notebook tools`**. Use exact built frontend assets, fail-closed APIs and a matching populated reviewer/review identity; keep review-22 fixtures strict, with 13 saved mixed annotations, erased/historical points and processing/failure variants. Do not echo arbitrary requested review IDs or weaken existing accessibility rules.

Exercise real native video timing and moving portrait/landscape fixtures, tool/list tab interactions, saved page/reveal/edit-lock behavior, off-page overlap, retained text/Blob seams, requesting/recording locks, same video element/time/metadata track, caption on/off top/default anchor, fullscreen where granted and all existing owner modes. The actual microphone/iPhone and real worker processing remain separate limits; deterministic recorder doubles are not proof of those.

Include populated scans with Saved notes folded/open, each tool, page 2, expanded voice/text detail, editing, busy/error/uncertain states; run normal keyboard navigation and verify no hidden focus targets. Preserve WCAG tags, serious/critical gate and existing media-subtree exclusion; prove media geometry independently. Retain existing login/notebook/Option C/reviewer-overlay lanes. Update old assertions that assumed the full eight-row list was visible, rather than changing their timing/role purpose to match the new page size.

Build fully **before** browser runs. Never replace dist while it is served. Run projects serially, preserve distinct output/report directories and use `--no-deps` for isolated presentation lanes:

```sh
WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts --grep 'annotation notebook tools|reviewer overlay presentation|notebook presentation|option C presentation' --no-deps --project=chromium --workers=1 --output=test-results/annotation-tools-chromium
WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts --grep 'annotation notebook tools|reviewer overlay presentation|notebook presentation|option C presentation' --no-deps --project=webkit --workers=1 --output=test-results/annotation-tools-webkit
```

Set separate PLAYWRIGHT_HTML_OUTPUT_DIR values as well. Inspect actual config and available browsers before executing; report blocked/denied capabilities rather than asking the user to manufacture automation success.

The four updated real-stack specs require their seeded, disposable stack. Verify it exists and is disposable before running; do not provision/reseed/start/stop/rebuild services or mutate development speeches for this task without separate authorization. If unavailable, retain them as adapted-but-unrun and report that boundary. Isolated intercepted login checks plus unit regressions do not prove live backend authentication.

## 9. Consequences, risks and rollback

- There will be a second, deliberately smaller tab selector within Notes. Clear naming and quiet styling are necessary to distinguish choosing a tool from choosing Notes/Essay/Transcript.
- Paginating and folding changes the old “all rows visible at once” presentation. One chronological authoritative accessible list remains, with clear total/page information; timing/navigation/overlap retain the entire dataset. No database migration or server query change is needed.
- Hidden forms must preserve memory, recovery and pending registrations. The microphone/outer-tab lock and saved-row page lock add intentional restrictions; their visible explanations avoid silent loss or disorientation.
- Six notes per page is an initial product choice, not a performance claim. No configurable page-size control, filters, drawer, tool persistence or extra voice playback system is included.
- Local status/report/reveal effects create lifecycle risks under StrictMode and identity replacement; test exact registration cleanup and avoid per-frame upward state or global DOM discovery.
- This plan does not fix existing arbitrary-text overflow inside the shared video overlay. Scoped row wrapping is separate from changing media CSS or saved commentary.
- Rollback would revert only these later approved UI/report/test changes, preserving unrelated work and data. Do not use broad reset/clean operations. No rollback is performed during planning.

## 10. Planning review and preservation record

Baseline: branch/HEAD inspected, with only the existing untracked design comparison present. A SHA-256 snapshot protects **1,086 existing tracked/untracked files**, including that comparison. This document is intended to be the sole new project file for this planning task.

- Initial explorer: completed read-only review of relevant components, hooks, API/service ordering, role gates and current tests. Confirmed real keepMounted support, erased-point classification, full-data validation, pending/unmount risks, voice uncertainty and existing test assumptions. Those findings are incorporated above.
- Independent plan review: completed read-only comparison against source and inventory. Its findings led to stable point-family editor identity during audio erasure, accurate ordering/counts for held pages, outer-Notes audio pause, a precise in-flight-operation hold policy and deferred selection during those holds. The optional native/asset duration-axis clarification and nested-tab keyboard checks were adopted. It verified all 24 distinct future paths (20 existing plus three new tests and one stylesheet). Recheck resolved all original findings; the final hold-selection clarification is included in section 4.
- Independent code review: completed separate read-only trace of state, media, mutations, recovery, keyboard, access and test paths. Its findings added creation/saved audio inactivity handling and a concrete acknowledged-save callback for voice-note reveal. It rechecked the revisions and found no remaining material code-integrity gap within the proposed inventory. Coordinator also specified that stale acknowledged voice objects cannot resurrect erased audio.
- Coordinator revision: all findings incorporated, including truthful held-page metadata, stable pending callback identity, native-duration reset/listeners, full-data validation and exact operation/recording holds. The stylesheet is explicitly delivered before the integration import to avoid a missing-file build dependency. The plan explorer's final targeted recheck confirmed the hold-selection and stylesheet-order corrections and found no remaining contradiction; the code explorer independently cleared the revised state contracts. These are planning clearances, not runtime proof.
- **Final file-preservation verification passed:** all **1,086 pre-existing files remain byte-identical**, including the untracked design comparison. This root document is the only new project file. The 24 future paths are unique, 20 currently exist and the other four are explicitly declared new files; Markdown fences and Git whitespace checks pass. No application code, tests, shared styles, services/data, dependencies, staging or commits changed. No implementation tests or browser runs were performed for this plan.
