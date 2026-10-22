# Implementation plan: Rehearsal Notebook workspace panels

**Status: implementation complete; available automated checks passed, with manual/environment limits recorded in section 10.** Prepared 2026-10-21 and executed under the user's subsequent authorization. The user selected **2 · Rehearsal notebook** from the panel studies. Sections 1–9 retain the approved design/planning record; section 10 records implementation, separately approved accessibility exceptions and actual verification. Historical planning-only statements below describe the earlier planning task.

## 1. Authority, scope and baseline

Design references:

- `work/design-previews/workspace-panel-options.html`, specifically `.pco-direction-2` and the corresponding page examples.
- `DESIGN-OPTIONS-WORKSPACE-PANELS.md`, retaining its code findings and functional safeguards. Its recommendation of option 1 is superseded by the user's selection of option 2.
- `IMPLEMENTATION-PLAN-OPTION-C-THEATER-WORKSPACE.md` for the accepted theater entrance/chrome, artwork isolation, navigation, roles and media boundaries. This plan explicitly extends its earlier panel scope and proposes sticky/contextual companions; it does not replace the login or landing design.

“Dashboard panels” means the workspace pages shown in the screenshots and their related panels, not only `Dashboard.tsx`:

| Route | Included surfaces |
| --- | --- |
| `/dashboard` | My reviews: invitations, in progress, published, revoked, empty/loading/verification states. |
| `/speeches` | Speech cards, real posters/fallbacks, title/status/action areas, empty/loading states. |
| `/reviewers` | Directory panel, search, credential filters, rows, pagination and permission/error states. |
| `/speeches/new` | Metadata form, conditional earlier-attempt fields, surrounding upload/quota/completion panels. |
| `/search` | Search form, live status/errors, title/description/excerpt result boxes and yellow matches. |
| `/profile` | Photo/cropper surroundings, Username and Profile forms with their independent saves. |
| `/account` | Storage, both data-export sections, and a deliberately restrained deletion section. |
| `/become-a-coach` | Statement, document-upload surroundings, application loading/error/draft/decision states. |
| `/speeches/:id` | External media-panel chrome and the actual owner/reviewer Notes, Essay, Transcript and Reviewers surfaces. |

Exclude the landing/login/register/password/MFA/onboarding pages, public `/u/:username` pages and profile subroutes, external admin panel, route guards, permission rules, API/database/workers/storage, search logic, player internals, dependencies and infrastructure. Public profiles still leave AppLayout; no persistent workspace character is promised there.

Planning snapshot: branch `development`, HEAD `3246204fa54362e11c39187c9d5234d41152b959`. Existing untracked work is the design-options document and panel preview above. Preserve both byte-for-byte. A future implementation must recheck branch/HEAD/status and source contracts rather than assuming this snapshot remains current. No new branch, staging, commit, deployment, service command or data change is part of this planning task.

## 2. Source findings that constrain the design

| Current source | Actual behavior | Consequence |
| --- | --- | --- |
| `web/src/components/workspace/workspace.css:4,472,502` | The local light palette/paper cards currently cover Login, header/sidebar and My reviews. | Other white panels are expected. Add deliberate page/panel opt-ins; do not globally change Card/main/body. |
| `web/src/components/layout/PageShell.tsx:42–66,99–120` | Left-aligned form/content/wide ceilings are 42rem/64rem/100rem; the speech grid is based on available width. | Preserve measures/gutters/grid behavior; no empty-space-filling stretched forms or art column that narrows footage. |
| `web/src/components/ui/card.tsx:15` | Card has overflow clipping, vertical padding, gap and ring utilities; CardTitle is a div. | Put tape inside reserved header space; deliberately override only opted-in outer card spacing/ring. Do not hang drawings outside clipped Cards. Page h1s must be real headings. |
| `web/src/components/ui/button.tsx:84–90` | Button emits `data-slot="button"`, but does **not** emit a variant attribute. | Do not write selectors against an imagined `data-variant` on Button. Keep variant colors or add explicit local markers at owned call sites. Badge does expose its variant. |
| `web/src/components/layout/AppSidebar.tsx:29–43` | Main navigation is itself the flex-column rail; artwork follows its links in normal flow. | Preserve the Main landmark, all links/order/roles and 224/256px widths. Sticky artwork needs its own reserved child, not a sticky whole navigation. |
| `web/src/components/workspace/activityForRoute.ts:23–35` | Scene matching mirrors actual visible NavLinks; no active link means no route scene, including watch routes. | Keep this helper's semantics. A watch-specific companion is separate display state and must not fabricate active navigation. |
| `web/src/components/workspace/ActivityScene.tsx:6–23` | Two concrete variants, art-only Suspense and keyed local error boundary. | Extend with a compact variant; preserve lazy isolation, geometry, pointer-inert/decorative semantics and repeated-instance safety. |
| `web/src/routes/SpeechWatch.tsx:115,351–424,474–637` | Owner tabs are controlled; reviewer tabs default to Notes. Media geometry is precise; some feedback/invitation panels deliberately stay mounted. | Control reviewer tab selection only to observe it; preserve mount/lifecycle behavior, player sizing and every existing keepMounted flag. |
| `web/src/components/speech/VideoPlayer.tsx:112–118,153` | Feedback is portaled into the actual player/fullscreen root. | Notebook tokens/art must not enter or recolor that media host. No player implementation edits are necessary. |
| `web/tests/app-shell.spec.ts:184–338`; `web/tests/accessibility.spec.ts:164–288` | Existing isolated presentation helpers optionally serve exact built assets and intercept APIs. Original tests use real-stack setup dependencies. | Extend the isolated lanes for presentation, retain original tests/gates, and distinguish mocked frontend evidence from real auth/media evidence. |

## 3. Fixed notebook design contract

### Colors, typography and panels

Use the existing `workspace-*` namespace. Introduce a distinct `workspace-notebook-*` family within it, not a second theme system. Keep existing cream `#fff5e6`, paper `#fffdf6`, ink `#2b211b`, secondary text `#66574f`, burgundy `#8a1720`, gold `#e9b949`, teal `#0f6b66`, outline `#8a7668`, and existing error/success pairs.

- Canvas: warm cream on **opted-in route wrappers only**.
- Main panels: opaque paper, 1px outline, approximately 4px corners, static 4px-by-4px warm shadow `#e7d0a5`, reserving space so the shadow is not clipped at page edges.
- Section header: pale cream `#fbf2df`, 5px teal leading margin, a small noninteractive gold tape accent **inside** the header, and a clear bottom separator. Reserve space for text/actions; do not position tape over badges, menus, headings or user text. Headerless panels receive a quiet edge treatment, not invented content.
- Body: unlined/untextured paper; normal Geist for fields, actual speech titles, comments, essays, descriptions, statuses, timestamps and transcripts. Luckiest Guy remains limited to short page headings/brand. No new fonts or remote art.
- Gold is decoration, not a replacement focus boundary. Yellow remains uniquely legible for actual Search matches; no broad gold/yellow result backgrounds.
- Primary actions remain teal with paper text. Secondary actions remain light with a visible ink/brown outline. Destructive actions and failures retain red treatment; success text retains its true semantics. Never recolor all buttons into a single action class.
- Repeated subrows/export sections/annotations get fine dividers or quiet inset outlines, not their own large tape/shadow. One main notebook treatment per logical panel avoids visual clutter.
- Keep neutral body-portaled menus/dialogs/toasts unchanged. Their trigger should fit the page, but a local token boundary does not automatically theme its popup. Retain all popup focus/placement/confirmation behavior.

### CSS boundaries and explicit markup

Create `web/src/components/workspace/notebook.css`. Import once from AppLayout, after the current workspace stylesheet; NotebookPage may also import it for isolated component rendering. Use explicit specificity so correctness does not rely solely on bundler import order. Do not edit `index.css`, global primitives, or the existing login/header styling rules.

Define these opt-ins:

| Class/marker | Responsibility |
| --- | --- |
| `.workspace-notebook-page` | Cream canvas, `flex:1`, `min-width:0`, notebook-only custom properties. **No application semantic-token overrides here**, particularly around the player. |
| `.workspace-notebook-surface` | Explicit local legacy + shadcn light token pairs, light color scheme and readable working text; only nonmedia working surfaces receive it. |
| `.workspace-notebook-panel` | Paper frame, local padding/ring handling, modest shadow and direct-child header treatment. Existing Card remains the actual card node. |
| `.workspace-notebook-heading` | Page-heading/compact-art layout; min-width zero, wrapping actions and reserved cameo space. |
| `.workspace-notebook-poster-card` | Frame/metadata treatment around a real poster; no header stripe/tape over the image. |
| `.workspace-notebook-result` / `.workspace-notebook-excerpt` | Search result boundaries and quiet transcript margin; safe existing marks remain untouched. |
| `.workspace-notebook-media` | Explicit **outer** background/border only; no semantic tokens, inherited text/color/font reset, filters, transforms or geometry changes on the video-bearing ancestor. |
| `.workspace-notebook-danger` | Serious pale-red frame; disables tape and comic shadow. |
| `.workspace-notebook-embedded` | Boundary identifying existing Uppy/cropper/native-media content; do not target its internals with blanket native-control selectors. |

Use direct-child Card slot selectors for headers/content so an ancestor does not decorate every nested card twice. Avoid global native `button/input/textarea` rules. Owned call sites may add `.workspace-notebook-control` and explicit primary/secondary/destructive/toggle modifiers where local dark utilities require correction. Elsewhere preserve existing component variants and use only bounded geometry/focus rules. Do not infer Button variant from its position, label, class-string substring, or nonexistent data attribute.

Account for both OS dark preference and root `.dark`: defining color-scheme alone does not override explicit dark utility styles. Verify input/select/textarea/contenteditable text, placeholders, invalid/focus/disabled/open states, native checkbox accents, badges and formatting toggles. Preserve primary/secondary/destructive and selected/unselected distinctions, including aria-pressed/checked states. No unexpected recoloring of player overlays or neutral portals.

### Page wrapper and heading integration

New `NotebookPage.tsx` is a pure presentation frame: it wraps the existing PageShell, keeps its `width` contract, and renders optional `beforeHeading` content, an optional existing/new PageHeader, then children. It accepts an explicit `scene` prop (existing scene ID or null), renders compact art when applicable, and has no router/Redux/companion-context dependency. It must not create a second main landmark, nested form, duplicated PageShell, synthetic metrics, renamed controls or another h1. Existing PageHeader actions and verification-banner order are retained. Route owners call the T2 read hook unconditionally before early returns and pass its result to the frame; T1 can therefore finish before T2 starts.

- List/text routes supply their current heading and actions.
- Forms currently without an h1 gain one short page heading (Upload a speech, Edit profile, Account & privacy, Become a Coach), while retaining real Card titles/help.
- Dashboard retains its present heading/action/banner and behavior. Keep its existing useful classes and add notebook opt-ins with deliberate CSS precedence; do not regress login through shared selectors.
- SpeechWatch does not repeat the speech title as an additional page banner. Its actual CardTitle can contain the single h1, and its existing media CardHeader hosts the compact cameo. Do not consume another vertical row above the video just for art.
- Loading/empty/error/denied branches receive an appropriate stable route canvas/status surface, without changing alerts, permissions or success/failure distinctions. Hooks remain unconditional and in existing order.

## 4. Character placement, selection and lifecycle

### One companion, adaptive presentation

Reuse the existing original SVG drawings and their separate lazy chunk. No new illustration library or bitmap generation is needed. Use these mappings:

| Context | Existing scene / acting |
| --- | --- |
| My reviews | `reviews`: thoughtful seated reader. |
| My speeches | `speeches`: proud striding film-card carrier. |
| Find reviewers | `reviewers`: welcoming greeting pair. |
| Upload | `upload`: enthusiastic slate holder. |
| Search | `search`: focused magnifier/detective. |
| Edit profile | `edit`: concentrating writer/artist. |
| Account | `account`: calm lock keeper. |
| Become a Coach | `coach`: encouraging mentor. |
| Watch Notes / Essay / Transcript / Reviewers | `reviews` / `edit` / `search` / `reviewers`, respectively. |

Expressions reflect **selected context**, not upload/save/approval success. No celebrations for errors/deletion/revocation, no reaction to every keystroke, and no new state-driven art variants in this scope. The character is never the real avatar or speech poster.

- Desktop: maintain the existing 224px rail from 768px, 256px from 1280px. Group existing links without changing their semantics/order/gaps, and reserve the existing 184×176 art box below them. Make **only that box** sticky with a 16px viewport offset, constrained by the stretched rail. No fixed layer, locked overflow, extra player column, sticky whole navigation, or mt-auto placement. All links remain reachable in ordinary page flow. Check geometry with the maximum real navigation inventory, not only the shorter preview menu.
- Below 768px width **or** 720px height: suppress the large box; show at most one reserved 56×56 compact cameo beside the route heading, in normal flow. At 320px, prioritize complete heading/actions/inputs; suppress the cameo if the actual heading composition cannot fit rather than shrinking controls or forcing overflow. The phone keyboard and focus/error visibility take precedence over art.
- Forced colors: hide all decorative boxes/tape/shadows, use Canvas/CanvasText and a meaningful selected/focus outline. Ensure the new compact display rule cannot override the existing forced-colors hide rule.
- Fullscreen/PiP: no art is ever a descendant of the player/fullscreen host. The external page art does not become part of the fullscreen or PiP picture. No new media permission/event/transport system is introduced.
- Long-page persistence is conditional on available viewport/parent height. Do not describe art as universally always visible on a phone, in forced colors or beyond its parent. The slot can be empty during loading/failure without losing navigation/form usability.

### Sharing watch context with the sidebar

Do not replace `activityForRoute()` or infer a user's active page from the last clicked navigation item. Ordinary route scenes still derive from the actual visible `navItemsFor(user)` and current pathname, preserving NavLink case/end/slash behavior and public/external exceptions.

Add a small local display-context provider around AppLayout's existing tree. It introduces **no DOM wrapper**, API request, route change or permission state. Proposed files:

- `workspaceCompanionContext.ts`: shared types/context only.
- `WorkspaceCompanionProvider.tsx`: provider and override state.
- `useWorkspaceCompanion.ts`: read-scene and watch-publication hooks; exported helpers separate from the provider for refresh/lint boundaries.

The read hook uses the existing getMe query/cache and unchanged nav helper for route scenes. Additional getMe subscriptions must dedupe, not trigger another endpoint or poll. The only override is a watch scene published by the actual SpeechWatch instance after its applicable owner/reviewer UI is known.

Override entries carry **router location key plus a stable publisher token**, and contain only the scene or null. Ignore entries whose location key differs from the current route. Publication callbacks are stable; identical payloads are a no-op. Cleanup clears an entry only when both its key and publisher token still match. This prevents a departing watch instance/StrictMode cleanup from erasing newer state, and prevents stale artwork on Back/Forward, another speech, query/hash navigation, denied loads or route errors. An absent provider/override safely yields route fallback or null rather than throwing.

In SpeechWatch:

1. Keep the current ownerTab state and handler meaning. Add reviewerTab state initially Notes and pass value/onValueChange to the existing reviewer Tabs root; do not key/remount tabs or change panel mounting policy.
2. Publish only from the valid currently rendered owner/reviewer branch. For **decorative scene calculation only**, require a positive valid speech ID, a resolved nonloading/nonerror response, and `Number(speech.id) === speechId`. RTK Query's current `data` binding can retain the previous argument's response; a loaded-looking object alone is insufficient. Loading, an ID mismatch, invalid/missing/denied speech (including explicit 403/404), another query error and a nonowner without the actual eligible feedback branch publish null. Reviewer eligibility also retains the existing myReview/ready/playback-URL gates; no art implies permission. Do not change getSpeech's `data` binding, media/query behavior or existing render guards to implement this cosmetic check.
3. Update the scene from that branch's real selected tab. Reviewers is owner-only. Pass the same directly derived valid scene to the watch-header cameo and publish it to the rail; do not make the local cameo wait for a provider effect. Registration hooks run before early returns and never fetch review data themselves.
4. Keep `ownerTab`'s existing influence on commentary visibility/keyboard behavior unchanged. Cosmetic tab observation must not become a new playback control or mutate selected reviewer, voice mode, captions, notes, draft or publishing state.
5. Preserve all existing keepMounted flags and error boundaries. Scene changes update only decorative state; no new keys above the player/editor/Uppy/forms.

On ordinary routes the compact cameo and sidebar use the same read-hook result; on watch the header receives the valid locally derived scene and the rail receives its published equivalent. Both DOM instances may exist for responsive CSS, but only one is visible; the shared lazy loader still imports once, and repeated SVG instances remain collision-safe. Reuse ActivityScene's art-local Suspense/error containment. A failed chunk/drawing remains a cosmetic loss.

## 5. Per-page application details

| Page | Changes to make later | Behavior to preserve |
| --- | --- | --- |
| My reviews | Apply notebook accents to the existing four sections/cards, retaining useful wrapping classes. Quiet invitation-message inset; plain headings for repeated cards. | Server grouping/order, null speech handling, verification notice, role-gated profile action, Accept/Decline/Watch/Withdraw/Abandon, real timestamps and destructive badges. |
| My speeches | Notebook frame and paper metadata; teal Watch/upload; no tape on imagery. Deliberately reconcile Card padding around poster without changing intrinsic image size/aspect/object-fit. | Available-width grid, portrait/landscape posters, ULID-color fallback, three-second polling, status/retry/queued states, earlier-attempt badge, options menu and controlled edit/remove dialogs. Exactly one actual Card per speech remains. |
| Directory | Notebook search/list panel; plain divided rows with wrapping names and badges; teal selected filters. | All/Members/Coaches aria-pressed states, query/debounce/page reset, pagination, total count, forbidden/request-error/empty distinctions. Rows remain noninteractive; no invented Invite/Connect actions. |
| Upload | Notebook metadata and surrounding transfer panel, existing conditional change-note field, true success/processing banner. Mark an embedded wrapper around the existing Uppy component. | Existing two phases and conditional controls, mutation values/errors, quota/transfer/cancel/retry. Uploaded does not mean video/captions are ready. Do not recreate, restyle or alter Uppy internals/lifecycle. |
| Search | Notebook outer form; quiet result outline/teal quote margin, untouched yellow marks. | 300ms debounce, owner-only results, 255-character guard, current-query/stale-response logic, refetch convergence, title links, optional descriptions/excerpts/ellipses and safe text rendering. No excerpt if no content match; result body stays noninteractive. |
| Edit profile | Three notebook panels and separate heading cameo. Keep cropper in its own full-width embedded region. Wrap Pronouns/Location and action rows as needed for narrow screens. | Real avatar, accepted file types, fixed 288px cropper interaction, independent avatar/username/profile requests/errors, cooldown, dirty/reset logic and notices. No combined save or mascot replacing avatar. |
| Account | Notebook Storage/Your data panels; quiet nested export rows. Delete card is a serious pale-red exception without tape/shadow/cartoon decoration. | Exact bytes/quota/zero-quota semantics, accessible meter, both export kinds and preparing/failed/resolving/ready/download states. Delete dialog stays neutral, with full consequences, typed DELETE and original disabled/error behavior. |
| Become a Coach | Notebook application/status cards and document surroundings. Long statement/file/reason text wraps; actual status badge remains clear. | 404-as-no-application handling, other-error distinction, localApplication precedence, 2,000-character limit/count, draft/save/document/submit/restart workflow and PDF restrictions. Admin review is not certificate verification. |
| Speech viewer | Notebook outer media header/border; separately opted-in feedback surfaces, with compact art in existing header and desktop art in the rail. | See the exact media and panel boundaries below. No new tool controls, workflow, publishing interaction or permissions. |

### Speech viewer: decorate actual surfaces, not a mock viewer

- Keep PageShell wide and the existing `min(100%, video-budget × aspect)` wrapper, `--video-budget: min(60svh,620px)`, measured ratio, relative/absolute chain and responsive media size intact. Do not add video padding, alter player height or duplicate the title/toolbar.
- `.workspace-notebook-media` paints the **outer Card** background/border without mapping semantic theme tokens. Its existing CardHeader gets a local surface/header accent. Video-bearing CardContent, `.video-js`, `.owner-commentary-host`, feedback-frame/positioner/OverlayStack, markers and fullscreen controls remain outside notebook surface-token boundaries. Their computed foreground/background tokens and geometry must remain unchanged.
- Caption controls/poster-frame picker may have separate nonmedia local surroundings; retain ownership gates, error/processing state, real sprites and hit areas. No pattern or drawing covers the controls or image.
- Owner Notes: mark TrackSelector's existing Card as a notebook surface/panel. Its body keeps the existing selector, four playback modes, accessible feedback and errors. Do not add another Card around it.
- Reviewer Notes: mark AnnotationComposerPanel's existing Card; protect the timeline/preview, Composer Start/End controls, per-track overlap rule, voice recorder/rows, accessible AnnotationList and unsaved-feedback blocker. Style only its external surface/header and normal controls. No ruled canvas behind annotation text, timeline or waveforms.
- Owner Essay: use a **non-Card** notebook reading surface around the current EssayReviewerPicker/EssayReadOnlyPanel, with at most one local heading. Preserve the single shared reviewer selection, sanitized rich text, links and honest empty/loading/error states.
- Reviewer Essay: mark EssayEditorPanel's existing Card. Preserve TipTap editor identity, toolbar pressed state, autosave/conflict/deleted-speech notices, publish gate and unsaved-navigation confirmation. Do not remount or change editor extensions/content handling.
- Owner Transcript: add a local paper reading surface around CaptionSettingsToggle and CaptionEditor; do not replace them. Preserve autosave/retry/sync/error/off/readiness states, live region and editable lines.
- Reviewer Transcript: similarly frame the actual TranscriptPanel, retaining timecoded seek buttons, empty/error states and accessible ordered list. Do not add a second commentary transcript.
- Owner Reviewers: mark existing roster cards and invitation Card; keep roster before invitation, access to drafts while the tab is inactive and actual actions. `hideHeading` currently omits the invite CardHeader: keep that contract and apply a quiet headerless edge instead of inventing another heading.
- Body-portaled report/clear/delete dialogs and EssayEditorPanel's unsaved-navigation alert dialog remain neutral. AnnotationComposerPanel's **Unsaved feedback** blocker is currently inline (`AnnotationComposerPanel.tsx:395`), so it stays within its annotation surface with ordinary readable warning controls; parent surface styling can reach it. Do not move either kind of dialog, change its semantics/focus/confirmation behavior, or introduce a global popup stylesheet.

## 6. Future task division and exclusive write inventory

This inventory is a proposed later implementation boundary, not permission to edit now. Dependencies are explicit so workers can own separate files. If actual code differs or another path is needed, report the mismatch and revise scope before implementation; do not improvise broad changes. CSS corrections always return to T1; no other worker edits its file.

| Task | Exclusive files | Depends on / deliverable |
| --- | --- | --- |
| **T0 — compact drawing wrapper contract** | Existing `web/src/components/workspace/ActivityScene.tsx`; existing `web/src/components/workspace/ActivityScene.test.tsx` | First extend the variant union/derived wrapper class with compact, retaining concrete scene IDs and current failure/decorative behavior. No notebook/context import. Actual compact CSS belongs to T1; browser geometry is verified after integration. |
| **T1 — notebook surfaces and frame** | New `web/src/components/workspace/notebook.css`; new `web/src/components/workspace/NotebookPage.tsx`; new `web/src/components/workspace/NotebookPage.test.tsx` | After T0, establish the class/markup/width/token contracts and finish the pure frame accepting an explicit scene-or-null prop. No T2 hook/context import; no shared primitive/global CSS changes. |
| **T2 — contextual companion and rail** | New `web/src/components/workspace/workspaceCompanionContext.ts`; new `web/src/components/workspace/WorkspaceCompanionProvider.tsx`; new `web/src/components/workspace/useWorkspaceCompanion.ts`; new `web/src/components/workspace/WorkspaceCompanion.test.tsx`; existing `web/src/components/layout/AppLayout.tsx`; existing `web/src/components/layout/AppSidebar.tsx`; existing `web/src/components/layout/AppSidebar.test.tsx` | After T1, complete provider/read/publication APIs and shell integration. AppLayout changes are limited to the no-DOM provider and notebook import. Preserve navigation helper/art/roles/login/header/bells. |
| **T3 — lists and Search** | Existing `web/src/routes/MySpeeches.tsx`; existing `web/src/routes/MySpeeches.test.tsx`; existing `web/src/routes/ReviewerDirectory.tsx`; new `web/src/routes/ReviewerDirectory.test.tsx`; existing `web/src/routes/Search.tsx`; existing `web/src/routes/Search.test.tsx` | After T1/T2 APIs settle. Adopt the frame/surfaces and preserve actual list/search semantics. |
| **T4 — forms and account** | Existing `web/src/routes/SpeechCreate.tsx`; existing `web/src/routes/SpeechCreate.test.tsx`; existing `web/src/routes/ProfileEdit.tsx`; new `web/src/routes/ProfileEdit.test.tsx`; existing `web/src/routes/Account.tsx`; existing `web/src/routes/Account.test.tsx`; existing `web/src/routes/BecomeACoach.tsx`; existing `web/src/routes/BecomeACoach.test.tsx`; existing `web/src/components/coach/CoachApplicationForm.tsx` | After T1/T2. Frame both upload phases/all coach branches; mark actual nested application Card. Use parent/wrapper styles for existing Uppy/export/quota/cropper without editing their implementations. Route tests cover their real state transitions/independent saves with controlled mocks. |
| **T5 — My reviews alignment** | Existing `web/src/routes/Dashboard.tsx`; existing `web/src/routes/Dashboard.test.tsx` | After T1/T2. Integrate frame and notebook overrides, retaining current section/action/error regressions. |
| **T6 — media route and actual feedback surfaces** | Existing `web/src/routes/SpeechWatch.tsx`; existing `web/src/routes/SpeechWatch.test.tsx`; existing `web/src/components/review/TrackSelector.tsx`; existing `web/src/components/review/TrackSelector.test.tsx`; existing `web/src/components/annotation/AnnotationComposerPanel.tsx`; existing `web/src/components/annotation/AnnotationComposerPanel.test.tsx`; existing `web/src/components/essay/EssayEditorPanel.tsx`; existing `web/src/components/essay/EssayEditorPanel.test.tsx`; existing `web/src/components/review/InviteReviewerPanel.tsx`; existing `web/src/components/review/ReviewerRoster.tsx`; existing `web/src/components/review/ReviewerRoster.test.tsx` | After T1/T2. Presentation-only opt-ins in child files; route owns local tab observation/registration and reading wrappers. No media/player, hooks, overlap/autosave/search/transport logic edits. Preserve current child props and mount behavior. |
| **T7 — integrated presentation/a11y evidence** | Existing `web/tests/app-shell.spec.ts`; existing `web/tests/accessibility.spec.ts` | After T3–T6. Extend already selected specs with a separate `notebook presentation` isolated describe. Extend only local mock helpers/fixtures inside these files as required; retain original test coverage, grep-compatible option C tests, AXE_TAGS, `.video-js` exclusion and critical/serious gate. Scope legacy art selectors to the intended responsive instance and add compact checks as detailed below; do not weaken fixtures/behavior checks. No fixture seed/service/config/CI changes. |
| **T8 — separately approved timestamp accessibility repair** | Existing `web/src/components/caption/CaptionEditor.tsx`; existing `web/src/components/caption/CaptionEditor.test.tsx` | Added during execution with explicit user approval after the browser gate exposed an existing label-content-name mismatch. Include the visible timecode in the seek button's accessible name and verify label/seek behavior. No other caption logic change. T1 owns these two paths exclusively for this repair. |
| **T9 — separately approved timeline accessibility repair** | Existing `web/src/components/annotation/TimelineStrip.tsx`; existing `web/src/components/annotation/TimelineStrip.test.tsx` | Added during execution with explicit user approval after the reviewer axe scan exposed an existing aria-prohibited-attr failure. Give the already-labeled timeline container role="group" and verify the named group. No visual, event, geometry or mutation change. T7 owns these two paths exclusively for this repair. |
| **T10 — separately approved toolbar accessibility repair** | Existing `web/src/components/essay/EssayToolbar.tsx`; new `web/src/components/essay/EssayToolbar.test.tsx` | Added during execution with explicit user approval after the deeper reviewer Essay scan found three label-content-name mismatches. Include visible H2/H3/1. list text in those accessible names and verify unchanged formatting commands. No other formatting or visual behavior change. T7 owns both paths exclusively. |
| **Coordinator/read-only reviewer** | This plan only for later execution ledger; all production/test paths read-only during review | Compare complete changes to plan/source, return fixes to exclusive owners, recheck and record exact results/limitations. No commits without explicit instruction. |

The dependency order is **T0 → T1 → T2 → T3–T6 → T7**. T0's existing art component has no new frame/context import; T1 uses its completed compact API and imports no T2 hook. Then route integrations use the completed read/publication APIs. Each task has exclusive files, so there is no competing editor or circular dependency. The same owners retain their files throughout corrections. T7 reports route/CSS defects to the corresponding owner.

All files not enumerated above remain unchanged. In particular: existing workspace.css/art/loader/boundary/helper/types, App routes, PageShell, AuthShell, roles, header/bells/UserMenu, Login/landing/public profile, UI primitives, VideoPlayer/overlay/media CSS, Composer/VoiceRecorder/timeline/annotation editor logic (except the separately approved T9 container role), caption/essay/read-only components and hooks (except the separately approved T8 and T10 accessible-name repairs), UploadDashboard/CoachDocumentUpload/AvatarCropper/QuotaMeter/ExportSection/DeleteAccountDialog, test shared fixtures, dependencies, backend and infrastructure. If a needed control fix cannot be made safely within its approved parent surface/owned file, stop and report the exact additional path instead of hiding the defect with a global rule.

## 7. Verification required after later implementation

### Focused unit/integration regressions

- NotebookPage: one PageShell/one page h1, correct original width, before-heading notice order, real actions, no extra main/form, compact art failure/pending states do not affect controls. Surface opt-ins do not engulf the media subtree.
- Companion provider/hook: real visible NavLink parity (retain helper tests), ordinary/direct/history/query/hash routes, member/roleless/coach/admin/super-admin/username-absent menus, watch owner/reviewer tab selection, no false active nav, no stale override after navigation/denial/error/unmount, StrictMode registration/cleanup ownership, no redundant state loops or additional HTTP request. Add a **same mounted SpeechWatch instance A→B** transition retaining cached `data` for A while B loads/fails 403/404: neither rail nor local cameo may claim B's tab context from A's data. Keep media/query/render behavior unchanged. Chunk rejection/render throws remain cosmetic.
- Route tests retain current loading/empty/error/permission cases and business behaviors. Add meaningful missing coverage for directory pagination/filtering and profile independent saves/cropper/cooldown; use current API contracts and Redux/router harnesses, not a second fake implementation.
- Search: title-only/description-only/transcript matches, no empty/artificial excerpt, preserved highlights/ellipsis/long Unicode/query-length/error/stale-result rules. Run existing API/highlight tests unchanged.
- Media: switching companion/tab does not initialize/dispose another player, reset time/voice/reviewer/caption state, refetch playback solely for art, or discard existing kept-mounted note/invitation drafts. Check controlled reviewer Tabs still provides Base UI keyboard/ARIA behavior. Preserve existing separate Essay unmount/autosave semantics; do not falsely promise keeping every editor mounted.
- Run existing range/voice/autosave/role/guard/login regressions. Do not add tests merely asserting class strings when a rendered/control/lifecycle check better verifies the risk.

### Actual browser/visual acceptance

Use real frontend rendering for all nine pages and all meaningful states, with intercepted APIs for presentation where safe. Never run mutable workflow tests against the user's live development data merely to get screenshots.

1. Compare against **direction 2**, not the old option-1 recommendation or preview sample content. Show notebook headers/shadows, readable plain bodies, literal real labels, selected control differences and relevant character poses. Include empty/error/busy/long-title/unbroken-message/file-name examples.
2. Widths 320, 375, 767/768, 1024, 1279/1280 and 1440; short height 640 and exact 719/720 boundaries. Keep header 56px, rail 224/256px, all navigation and mobile account-menu controls. Check actual maximum visible menu, not the preview's abbreviated menu.
3. Verify sticky art through long-page scrolling and parent end containment; no overlap/clipping/hidden links. One visible art instance; compact cameo must not obstruct forms, dates, native file inputs, cropper, notifications or keyboard focus. Document intentional suppression at constrained sizes.
4. Light/dark preference × root `.dark`, focus/hover/open/invalid/disabled/loading/selected states, reduced motion, forced colors, keyboard-only navigation and skip link. Check actual rendered text/boundary contrast and body-portal neutrality. Do not infer accessibility from palette values alone.
5. Verify 200%/400% actual browser zoom/reflow where available. Narrow CSS viewport checks are useful but do not establish actual browser zoom or physical phone/keyboard behavior.
6. Real landscape **and portrait** footage/fixtures: compare player frame bounds/aspect/control positions and computed overlay theme values with baseline. Play/seek, show captions, show readable written/voice feedback, use all commentary modes, switch sections, enter/exit actual fullscreen where permitted and inspect PiP. No decorative pixel/DOM layer enters those targets; no extra player column. A black sample frame or excluded axe subtree is not media evidence.
7. Owner and reviewer flows: annotation Start/End/add/edit/publish, nonoverlap behavior, voice role restriction, pending text/recording and invitation preservation, essay conflict/autosave, caption editing/sync, reviewer selection and roster. Existing logic should be unchanged, but styling can still hide controls; verify visibility/keyboard/focus and at least the existing relevant regression lanes.
8. Fresh guest Login/landing and public-profile checks must show their current design/routing unchanged. My reviews and the new route-panel axe scans wait for actual frontend data render. Preserve the existing WCAG tags, media exclusion and critical/serious gate without weakening fixtures to obtain a pass.
9. Verify own lazy artwork chunk remains independent of landing art, measured build size, no new remote font/image request, and form/navigation usability when art load/render fails.

Existing option C tests currently locate art globally, for example `app-shell.spec.ts:419,439–446,503–518`. T7 must scope their rail-scene/size assertions to Main navigation or `.workspace-scene--sidebar`, then separately test `.workspace-scene--compact`. Keep the original 184×176 rail geometry and 719/720 threshold assertions; below the threshold the **rail** art is hidden while a fitting compact cameo may now intentionally appear. Verify visibility exclusivity and forced-colors suppression for both copies. This is an explicit representation/behavior update required by the chosen design, not permission to drop checks or weaken a11y gates. The old watch-omission test uses a 404 fixture (`app-shell.spec.ts:306,525`): preserve denied-watch/no-art coverage and add a separate valid owner/reviewer watch fixture for the new tab-sensitive companion.

### Commands for the future implementation phase

From `web/`, after all integrations:

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

Build completely **before** browser lanes; do not rebuild while hashed assets are being served to a test. Extend the two already-owned test-local helpers for missing route responses, blocking unexpected requests rather than letting them escape to the backend. Keep their realpath-bounded optional delivery behavior; no manufactured product HTML or changed production server.

New isolated presentation tests should use a distinct `notebook presentation` name, so the following later commands run them without real auth setup:

```sh
WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts --grep 'notebook presentation' --no-deps --project=chromium --workers=1
WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts --grep 'notebook presentation' --no-deps --project=webkit --workers=1
```

Also rerun existing isolated `option C presentation` cases to protect Login/chrome after CSS/context changes. Run browser projects serially. An installed WebKit/emulated iPhone lane is not physical-iPhone evidence.

Original app-shell/captions/voice/essay/keyboard/admin real-stack lanes may run only against a verified preprovisioned disposable environment with known fixture ownership and healthy media services. Check current CI/spec requirements before choosing commands. Do not call stack prepare/up/down, reseed, rebuild services, install certificates, or change security settings without separate authorization. If unavailable, finish nonmutating checks and explicitly record live auth/MFA/media/fullscreen/device evidence as unverified. Mocked presentation success must not be reported as real end-to-end workflow success.

## 8. Delivery, risks and rollback

Future delivery should include per-page screenshots at desktop/phone size, the selected notebook design, exact unit/type/lint/build/browser results, scope comparison and existing-warning counts, character/lifecycle evidence, media baseline comparison and remaining manual/environment limits. Main Login must retain real existing form/guard/redirect behavior; record how that was checked and whether live backend authentication was actually exercised.

Main risks: semantic-token leakage into media/fullscreen, repeated decorative clutter, clipping due to Card defaults, sticky geometry around long navigation, stale cross-route art, accidental tab/editor remount, hidden dark-mode/destructive controls, and overclaiming mocked preview coverage. The explicit boundaries and checks above address each risk; a planner cannot guarantee an implementation has no bugs before these checks run.

No schema/backend release is needed. A future rollback should revert only notebook changes or restore the prior frontend artifact, preserving unrelated work. Missing art must remain cosmetic. Do not commit, deploy or alter running services as part of drafting this plan.

## 9. Planning validation record

The coordinator read the current routes, layout/navigation helpers, actual Card/Button/Badge/Tabs markup, workspace CSS/art APIs, relevant review/essay/caption/upload/account child surfaces and test setup. Existing design artifacts were read without modification.

After the draft was written, the requested read-only explorer compared it with the actual source and direction-2 preview. It verified the proposed source/test paths, Card/Button/Badge marker assumptions, fullscreen DOM token boundary, provider/error-boundary placement, reviewer-tab feasibility and command/project names. Its four findings were incorporated:

1. Removed the frame/context dependency cycle. NotebookPage receives a scene prop; the explicit T0/T1/T2 sequence completes the compact API, pure frame, and provider in that order with exclusive ownership.
2. Added decorative current-speech identity/loading/error checks and same-instance cached A→B/denied-request tests. The media/query/render logic remains outside this cosmetic change.
3. Authorized precise legacy selector updates for duplicate responsive art instances while preserving rail geometry, denied-watch coverage and a11y gates; added compact visibility and valid-watch checks.
4. Distinguished the inline annotation blocker from the portaled essay/navigation dialogs, preserving each existing location and behavior.

The explorer reread the revised plan and confirmed that all four findings were addressed, the task order is executable, and no unresolved source contradiction or additional required file was found. The coordinator's final structural check verified all **42 proposed source/test paths**, correct existing/new declarations and exclusive ownership; Markdown fences/whitespace passed. Hash comparisons confirmed that all **1,070 prior tracked/untracked files** remained byte-identical and this root plan is the only new file from this request. `git diff --check` passed.

Runtime geometry, dark controls, contrast, real media/fullscreen/PiP and physical-device behavior remain implementation-time evidence, not guarantees from this plan. The earlier preview checks are prototype evidence only; no application runtime test result is claimed for this planning task.

No implementation code, runtime suite, browser/service operation, migration or data mutation has been performed for this planning request.

## 10. Execution record

The user subsequently authorized execution and requested explorer reviews followed by repairs. Implementation began on branch `development`, HEAD `3246204fa54362e11c39187c9d5234d41152b959`. A preservation snapshot records 1,071 existing tracked/untracked files, including the two prior design artifacts and this plan. Only the 42 enumerated application/test paths and this coordinator ledger are authorized for changes.

Tasks follow T0 → T1 → T2 → T3–T6 → T7 with exclusive file ownership. No commit, staging, deployment, backend/data refresh or service modification is authorized by this execution record. Actual checks, review findings, repairs and limits will be recorded as work completes.

### Implementation handoffs

- T0: compact ActivityScene API; 10 targeted tests passed.
- T1: pure NotebookPage and scoped notebook.css; 10 frame tests, typecheck, scoped lint and CSS parsing passed. Follow-up CSS addresses dark success banners, plain poster metadata, export/deletion trigger wrappers, selected essay toolbar, and the 320px fixed-width cropper parent without editing embedded implementations.
- T2: companion provider/hooks, grouped navigation and sticky-art integration; 74 companion/sidebar/unchanged route-helper tests passed, including identity-request deduplication, StrictMode cleanup ownership and retained shell/drafts. Typecheck/scoped lint passed.
- T3: My speeches, directory and Search; 23 targeted tests passed, preserving poster/query/result semantics and adding directory/error/Unicode/long-content regressions.
- T4: upload/profile/account/coach panels; 22 targeted route/account tests passed, with independent-save/cooldown/avatar/metadata-to-upload regressions. The avatar input gains an accessible name. Existing cropper/Uppy/quota/export/deletion implementations remain unchanged.
- T5: My reviews; 18 tests passed, retaining sections/actions, verification order and identity-request deduplication.
- T6: media exterior and actual feedback surfaces; 46 focused tests passed. New regressions cover owner/reviewer context, same-instance cached speech A→B with 403/404/success, player identity, and retained invitation/commentary drafts. Reviewer tab observation preserves existing mount behavior.

An account usage-limit interruption occurred after most route edits; execution resumed from the saved files and original owners completed their checks. Two unrelated Finder metadata files (`.DS_Store`, `work/.DS_Store`) appeared during the pause. They are preserved as unrelated user state, not implementation outputs; a supplemental hash snapshot records them. The original 1,037 unrelated files remain protected, alongside these two metadata files. The prior design document/preview remain untouched.

T7 presentation/browser coverage and the full integration checks are in progress. Only the existing development Docker stack was observed; no disposable test stack was provisioned or modified. Presentation tests must continue to intercept APIs and use `--no-deps`, with no real backend mutations.

### Integration and independent review

The complete unit suite passed **783 tests in 105 files**. TypeScript and full lint passed before T7 finished authoring browser sources; lint reported five existing warnings and no errors. A build attempted while those test helpers were being written was stopped by incomplete test-source references; it is not counted as a completed build and must be rerun after T7 handoff. The final CSS follow-up gives native reading-surface buttons 44×44px minimum targets, outside embedded media.

Two read-only explorers are reviewing the completed production changes independently: one checks functional/context/media lifecycle and login boundaries; the other checks notebook styling, accessibility and responsive boundaries against the actual code. Final browser evidence, findings and repairs remain pending.

The completed production build subsequently passed. Workspace artwork remains a separate 18.17kB chunk (5.46kB gzip), separate from landing artwork; no dependency/font/image service was added. The existing large-main-bundle warning remains.

The functional explorer found no actionable production defect and independently passed **108 tests across 11 files**: 53 companion/watch/feedback regressions and 55 Login/AuthShell/login-frame/redirect/role regressions. It confirmed unchanged authentication, routing, role helpers, original workspace CSS and player/hooks, correct publisher cleanup and cached-speech guards, retained tabs/player/drafts, and the 1,039-file preservation check. These are frontend regression checks, not live backend authentication.

The design explorer identified selected-toggle hover contrast, unready-watch dark text and several uncovered native 44px targets. Corrections remain within the existing CSS/route inventory. The first Chromium lane also exposed an existing CaptionEditor timestamp-name mismatch. The user explicitly approved a narrow two-file caption label/regression repair; T8 records this exception. Authorized application/test paths therefore increase from 42 to **44**, plus this ledger; **1,037 unrelated files** remain protected. The original T6 owner was unavailable at repair time, so T1 received sole ownership of the processing-fallback correction in SpeechWatch and its test; no concurrent editor touched those paths.

Those findings were repaired: selected hover has explicit dark-teal precedence with paper text; processing text has a local light surface outside the player; narrowly scoped geometry covers native annotation/caption/retry/voice-position controls and marked checkbox labels. The caption seek name now includes literal and spoken time, with a regression proving the same seek callback and no accidental editor opening. Focused watch/caption tests passed 28/28. The complete final unit run passed **784 tests in 105 files**; final TypeScript/build and lint passed, with the same five lint warnings and existing large-bundle warning.

The first Chromium presentation run yielded 13 passed, six failed and one serially skipped. It reproduced the selected-hover and existing caption-label issues rather than weakening checks. Remaining failures were corrected test assumptions: nested badge text, applying an actual essay formatting change, and a cross-origin synthetic-media canvas read. The media fixture is now served at an exact intercepted same-origin endpoint; no browser security setting or product-player logic changed. Both portrait/landscape fixtures had already decoded, played and sought before that test canvas error. Final serial Chromium/WebKit runs use the completed build and retain the same axe tags, media exclusion and critical/serious gate.

The next Chromium lane passed all 18 executed functional/login/media cases; the deeper reviewer accessibility scan exposed an existing labeled timeline div without a valid role, causing one failure and one serially skipped case. The user explicitly approved T9's two-file semantic-role repair. Authorized application/test paths now total **46**, plus the ledger; **1,035 unrelated files** remain protected. Presentation axe waits for finite control transitions before measuring stable colors; no accessibility rule, fixture content or exclusion is weakened.

T9 adds only role="group" to the existing labeled container, with a named-group/unchanged-seek-controls regression; its six timeline tests passed. The complete unit suite then passed **785 tests in 105 files**. Native media cases now also include a published reviewer track with a written range, transcribed voice marker and existing AAC fixture, verifying actual enabled mode controls, written/voice projections and native commentary playback controls rather than claiming coverage from an empty track. All state-changing API requests remain intercepted fixtures.

After T1's completion, T7 received exclusive ownership of any final bounded notebook.css touch-target correction discovered by populated-track measurements; no editors overlap. The coordinator also checks the populated owner commentary transcript, whose native row buttons differ from the speech Transcript tab and must receive the same nonmedia 44px target treatment.

The populated Chromium native cases passed all four modes, readable written/voice overlays and actual AAC pause/resume/skip; both orientations also entered actual fullscreen and PiP with no decorative art inside the media target. The deeper reviewer Essay axe scan found an existing unnamed TipTap textbox and three toolbar label mismatches. Naming the editor stays within T6's owned editor panel; the user separately approved T10's toolbar/test exception. T7 has exclusive repair ownership of the editor panel/test and toolbar/test after T6's completion. Inventory now permits **48 application/test paths plus the ledger**, protecting **1,034 unrelated existing files**. Accessibility gates remain unchanged.

Final corrections are complete: the native commentary rows measured 28px high before the bounded 44px CSS repair; the existing TipTap textbox is named "Your essay"; the three approved toolbar names include literal visible text while invoking the same commands. Focused timeline/editor/toolbar tests passed 13/13. The coordinator reviewed the actual diffs and confirmed no formatting/event behavior changes. Full integration now passes **788 tests across 106 files**, TypeScript, lint (zero errors/five existing warnings), and the production build (existing large-bundle warning). Workspace art remains separately loaded at 18.17kB/5.46kB gzip; no new remote font/image request or dependency was introduced.

Latest Chromium verification passed 19 cases in the complete lane and the remaining reviewer case on a targeted rerun. That test now waits for the actual asynchronously rendered Transcript button before measuring; it still rejects empty measurements. All **20 unique Chromium cases** are verified on the final production artifact, including all four accessibility cases. No product change was needed for that test timing correction.

Initial WebKit verification reached the actual native media/controls but exposed a test-delivery difference: WebKit sends browser-local blob URLs through the Playwright route handler, whereas Chromium did not. The dist helper incorrectly treated those local VTT/cropper blobs as missing HTTP assets. The bounded test-only correction permits native continuation only for `blob:` URLs inheriting the exact app origin; HTTP/API and other schemes/origins remain intercepted or blocked. No browser security setting, production path or backend behavior changes. Final WebKit rerun is pending.

### Final result and evidence boundaries

Implementation and the requested two independent explorer reviews are complete. All reported implementation defects and explicitly approved accessibility defects were repaired and verified against actual source. The final WebKit rerun passed **20/20** in 1.2 minutes. Combined with the final Chromium lane's 19 passes and corrected Transcript timing case's targeted pass, **all 40 unique browser cases are verified** on the same final production artifact. No product code changed between those browser runs; subsequent changes were bounded test waits/native-blob delivery fixes.

| Final check | Result |
| --- | --- |
| Full frontend unit suite | 788 passed in 106 files |
| Independent functional explorer | 108 passed in 11 focused files, including 55 Login/auth/redirect/role regressions |
| TypeScript | Passed |
| Full ESLint | Passed: zero errors, five existing warnings |
| Production build | Passed; existing large-main-bundle warning retained |
| Chromium isolated presentation | All 20 unique cases verified: 19 in full lane plus one corrected test's targeted rerun |
| WebKit isolated presentation | 20/20 passed in clean final full lane |
| Accessibility | Existing WCAG tags, video exclusion and critical/serious gate retained; phone/desktop scans passed for all nine routes and owner/reviewer tabs |
| Preservation/whitespace | 1,034 unrelated existing files unchanged; no unexpected paths; git diff --check passed |

Browser evidence includes actual production frontend bytes, all nine pages at 375/1440px, required reflow/breakpoints/height thresholds, sticky/compact exclusivity, dark and forced-color states, complete navigation and keyboard focus, native cropper geometry, real owner/reviewer tabs and retained drafts/player, title/description/transcript results, and native moving portrait/landscape video fixtures. Populated feedback cases exercise all four commentary modes, written/voice transcript visibility, actual AAC start/pause/resume/skip, captions, decoded frame/aspect and theme boundaries. Actual fullscreen entered in both browsers for both orientations with no decorative art in the target. Chromium PiP entered for both orientations; WebKit exposed the API but rejected entry with NotSupportedError, so WebKit PiP remains unverified.

Final logs: `/private/tmp/notebook-final-unit.log`, `/private/tmp/notebook-final-typecheck.log`, `/private/tmp/notebook-final-lint.log`, `/private/tmp/notebook-final-build.log`, `/private/tmp/notebook-t7-chromium-final2.log`, `/private/tmp/notebook-t7-chromium-transcript-wait.log`, `/private/tmp/notebook-t7-webkit-acceptance2.log`. Per-page phone/desktop screenshots and native capability JSON are under `web/test-results/notebook-t7-chromium-final2/` and `web/test-results/notebook-t7-webkit-acceptance2/`.

Representative screenshots:

- [Desktop My reviews](web/test-results/notebook-t7-webkit-acceptance2/app-shell-notebook-present-b7bc2-d-notebook-panels-at-1440px-webkit/notebook--dashboard-1440.png)
- [Phone Search](web/test-results/notebook-t7-webkit-acceptance2/app-shell-notebook-present-81ae1-nd-notebook-panels-at-375px-webkit/notebook--search-375.png)
- [Native portrait player and populated feedback](web/test-results/notebook-t7-webkit-acceptance2/app-shell-notebook-present-34526-nged-frame-token-boundaries-webkit/notebook-native-portrait.png)

Remaining limits are explicit: these browser cases intercept backend APIs and use test media, so they do not prove real backend login/MFA, object-storage/transcode/Whisper delivery or real microphone/physical-iPhone behavior. Actual 200%/400% browser zoom was not exercised; CSS viewport reflow was. The existing MySpeeches GET-error-to-empty fallback is preserved as a pre-existing behavior, not silently changed by this styling task. No disposable E2E environment was available; the existing development stack and user data were not altered to manufacture those results.

No commit, staging, deployment, dependency change, service restart/rebuild, migration or data mutation was performed. HEAD remains `3246204fa54362e11c39187c9d5234d41152b959` on `development`. The prior design document/preview and unrelated Finder metadata remain preserved.
