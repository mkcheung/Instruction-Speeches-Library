# Workspace panel design options

Status: design exploration only, 2026-10-21. No application implementation is authorized or included. These choices extend the **accepted option C**; options 1–3 below are panel treatments, not replacements for that earlier decision.

## Findings from the three read-only explorers

The screenshots show different workspace routes, not just panels inside `Dashboard.tsx`. The earlier implementation deliberately themed Login, shared navigation, and My reviews. These sibling routes still use neutral Cards. The white appearance is therefore the existing scope boundary, rather than a broken theme load.

- Palette roots: [workspace.css](web/src/components/workspace/workspace.css:4). Paper-panel styling is currently specific to My reviews at [line 502](web/src/components/workspace/workspace.css:502). Main content remains unthemed in [AppLayout](web/src/components/layout/AppLayout.tsx:42).
- Actual panels: [My speeches](web/src/routes/MySpeeches.tsx:52), [directory](web/src/routes/ReviewerDirectory.tsx:62), [Search](web/src/routes/Search.tsx:44), [upload](web/src/routes/SpeechCreate.tsx:62), [profile editing](web/src/routes/ProfileEdit.tsx:134), [account](web/src/routes/Account.tsx:27), [coach application](web/src/routes/BecomeACoach.tsx:29), [speech viewer](web/src/routes/SpeechWatch.tsx:331).
- Forms intentionally have a readable 42rem outer measure, text pages 64rem, and grids/media up to 100rem. Existing left alignment and responsive gutters are deliberate: [PageShell](web/src/components/layout/PageShell.tsx:42). Sparse form pages should not be stretched into long lines merely to fill the window.
- Generic Cards clip overflow: [card.tsx](web/src/components/ui/card.tsx:15). A character perched outside a Card would be clipped unless a future implementation reserves a separate decoration area. Do not solve this by changing every shared Card.
- Existing sidebar art is natural-flow and hidden on narrow/short screens. It is not currently persistent: [AppSidebar](web/src/components/layout/AppSidebar.tsx:35), [workspace.css](web/src/components/workspace/workspace.css:591).
- Video, commentary, fullscreen, portals, errors and destructive actions have separate presentation/interaction contracts. They need explicit preservation, not broad inherited theme overrides.

All explorers were read-only. Their findings were reconciled against the current source before these examples were prepared.

## Shared visual language

Keep the established cream `#fff5e6`, working paper `#fffdf6`, ink `#2b211b`, secondary text `#66574f`, burgundy `#8a1720`, gold `#e9b949`, and teal `#0f6b66`. Use opaque backgrounds for every working surface. Real titles, labels, notes, captions, usernames, descriptions and transcript text remain in Geist. Luckiest Guy is confined to short page headings/brand; ordinary card headings remain clear sans-serif.

Use one expressive companion per selected context, rather than a character on every card. Keep artwork separate from actual photos/posters, label text, inputs, status badges and action hit areas. No animation is needed. Do not use textures or ruled lines underneath working text.

The preview compares the same illustrative content across all three directions. It reuses the application's actual character artwork and embedded fonts; the miniature data, form values, status examples and video frame are design samples. Buttons do not save, upload, invite or delete anything. The sample directory filters and Search highlights are local demonstration interactions on one sample speech, not the real search implementation. Search demonstrates separate title, description and transcript matches; a title/description-only match hides the excerpt. The speech-viewer section choices demonstrate the proposed changing companion using ordinary pressed buttons, rather than claiming a complete production tab widget. The neutral video frame contains no real footage and does not establish playback/fullscreen coverage.

## Three directions

| Choice | Visual treatment | Consequence |
| --- | --- | --- |
| **1. Theater stationery — recommended** | Quiet paper panels, thin ink boundaries, gold top rule, cream section heading and burgundy heading text, modest shadow, teal actions. | Most consistent with the current My reviews design. Lowest visual competition with footage, captions, search highlights and long forms. |
| **2. Rehearsal notebook** | Squarer paper cards, a teal header margin, small tape accent confined to the header, warm offset shadow. Text and fields stay on unlined paper. | More playful and tactile. Slightly busier with many panels; use the notebook accent once per main section, not around every tiny field. |
| **3. Playbill panels** | Ink-framed panels, compact burgundy mastheads with paper text and gold separators; directory rows resemble small program tickets. | Strongest theater identity and easiest section separation. Repeated burgundy headings can dominate a dense page; keep the media frame and long reading areas quiet. |

The recommendation is **1 throughout**, optionally borrowing **2 for profile/upload headers** or **3 for speech-library cards**. A single coherent direction is simpler to implement and easier to recognize than a different visual system on every route.

## Options for each page and its panels

| Page/panels | 1 — Theater stationery | 2 — Rehearsal notebook | 3 — Playbill panels | Contextual companion |
| --- | --- | --- | --- | --- |
| **My speeches: speech cards** | Paper metadata under untouched poster; gold outer top rule, clear title, real status, teal Watch. | Small square paper-card shadow, tidy notebook-like metadata. | Compact burgundy title accent and cream status/action footer; heavier ink frame outside image. | Proud striding film-card carrier. A page-context smile is not an assertion that every speech is ready. |
| **Find reviewers: search/filter panel and person rows** | Cream heading, paper list, fine dividers, clearly selected teal filters. | Teal margin on search header; plain name/username rows. | Burgundy Reviewers masthead; individual program-ticket rows with literal Coach/Member badges. | Welcoming pair greeting, with different expressions/poses. Do not add an Invite or Connect affordance to rows: these currently have neither. |
| **Upload: metadata and transfer panels** | Paper production form, small gold rule, original labels and date/select fields. | Teal notebook heading and small tape detail above the fields. | Burgundy Upload a speech masthead with paper form body. | Slate raised eagerly before upload; a patient/attentive variant during actual transfer could be commissioned later. No success pose until the actual upload state succeeds. |
| **Search: search panel and each result** | Clean paper result; title, description, then a subtly inset transcript excerpt when one exists. | Teal quote margin and notebook heading; no ruled background. | Ink-framed result, clear title divider and transcript area. | Concentrating detective with magnifier. Gold decoration stays in rules/headers; **yellow text highlighting remains reserved for real matches**. |
| **Edit profile: Photo** | Warm paper card and cream Photo heading. | Small teal header margin/tape accent. | Burgundy Photo masthead. | Concentrating artist in the separate companion slot. Actual avatar and cropper are always real user content, never replaced by the cartoon. |
| **Edit profile: Username** | Matching card with prominent cooldown help and unchanged Update username action. | Notebook heading; cooldown stays plain readable text. | Burgundy Username masthead with paper controls. | Same page-level artist; no extra figure beside each field. |
| **Edit profile: Profile details** | Paper Display name/Bio/Pronouns/Location form with clear Save and Reset. | Teal heading and modest offset shadow. | Burgundy Profile masthead and quiet white-cream form area. | Concentrated pencil pose; any future saved-state expression must follow a real successful save. |
| **Account: Storage** | Gold top rule, exact byte figures, teal actual-use bar. | Archive-notebook header with unmodified quota meter. | Burgundy Storage masthead; quota text/bar remain ordinary. | Calm lock keeper/organizer. No fake storage improvement or invented quota. |
| **Account: Your data and two export sections** | Paper sections, fine separators, distinct real request/download actions. | Notebook archive heading, plain export rows. | Burgundy Your data masthead; export subheadings stay on paper. | Same calm page-level character. Do not imply the file is ready before real export state says so. |
| **Account: Delete your account** | Restrained pale-red panel, red boundary/action, plain warning text. | Same serious treatment; no tape/comic embellishment. | Same serious treatment; no theatrical masthead or playful shadow. | **No cartoon attached to deletion or its dialog.** Keep the page-level companion separate and nonreactive to destructive actions. |
| **My reviews: invitations/in progress/published/revoked** | Existing palette refined with clear heading strips and modest gold rules. | Teal header margins and notebook treatment for invitation message areas. | Burgundy section mastheads; actual statuses/actions remain literal. | Thoughtful seated note taker. No applause/celebration for revoked/error states. |
| **Become a Coach: statement/documents/status** | Coach's paper desk, plain statement/count and actual document controls. | Notebook heading and quiet writing surface. | Burgundy application masthead; ordinary status/reason text. | Attentive coach/mentor with encouraging expression. A future review/approved/rejected variant must follow real status; never imply credential verification. |
| **Speech viewer: outer video panel** | Gold rule and thin outline **outside** the picture. | Teal/tape treatment confined to the external heading. | Burgundy external masthead; image and control area stay unchanged. | Companion remains outside the player, in reserved sidebar space. Do not add a new column that narrows the video. |
| **Speech viewer: Notes, Essay, Transcript, Reviewers panels** | Quiet opaque paper, readable timestamps, clear active tab, normal text. | Notebook header accents only; no lines/tape behind feedback. | Burgundy section headings, paper content; timestamps and controls remain plain. | Notes: thoughtful listener. Essay: concentrating writer. Transcript: attentive reader/detective. Reviewers: welcoming pair. The preview reuses existing poses; purpose-drawn listening/reading/envelope variants would be a later artwork task. |

## Where the character can stay visible

Recommended desktop treatment: keep **one companion in the existing 224/256px sidebar**, below the navigation, in a reserved slot. On sufficiently tall layouts, let that slot stick within its own column while the long form/list scrolls. This avoids both a floating overlay and a new right-hand column that would reduce the video area. Navigation remains above it in normal page flow and must remain reachable by scrolling; the figure never obscures it. Loading/failure reserves the same space and leaves controls usable.

This is a proposed change from the existing natural-flow artwork, not behavior already implemented. The preview illustrates the slot with sticky positioning. Its actual scroll behavior depends on the preview host; production acceptance would require testing the real page scroll container and sidebar height. Do not make the entire navigation plus art sticky if it exceeds the viewport.

- **Roomy desktop, height at least 720px:** the large companion can stay visible within the sidebar while its parent permits. Test 719/720px boundaries, all visible links, long account names, and scroll-to-bottom containment.
- **Narrow/short screens:** use a small reserved 56px heading cameo where it fits, otherwise suppress it. It stays in normal flow so that the keyboard, form errors and controls win the available space. No fixed footer character.
- **Fullscreen, Picture-in-Picture, forced colors, or very constrained zoom:** hide decoration. A literal always-visible character in every mode conflicts with the user's requirement for an unobstructed speech/usable controls.
- **Speech viewer:** currently no navigation item is selected, so no route scene renders. A tab-sensitive watch companion would be an explicit extension. It must not manufacture an active My speeches link, remount the player, or reset drafts when the user changes tabs.
- **Public profile and external administration:** leave this workspace. They are excluded from these panel options; do not add an authenticated wrapper or claim the sidebar persists there. The preview lists the relevant workspace destinations, not a complete role-aware production menu.

If persistent artwork on a phone is essential, a separate compact sticky context-header option would consume vertical viewport space. That tradeoff needs explicit selection and keyboard/zoom/playback review; it is not included as a silent requirement here.

## Functional and media boundaries for any later implementation

1. Scope future styles explicitly to selected route/panel wrappers. Do not globally recolor `main`, `Card`, `Button`, body, portal surfaces or media tokens. Keep opaque local light surfaces under both OS dark preference and `.dark`.
2. Preserve actual `PageShell` widths and available-width speech grid. Real poster aspect ratio, intrinsic dimensions, fallback reservation, options menu and card identity remain intact: [SpeechPoster](web/src/components/speech/SpeechPoster.tsx:20), [MySpeeches](web/src/routes/MySpeeches.tsx:75).
3. Search retains debounce, owner visibility, errors/live counts, length guard, optional description/excerpt, ellipses and safe yellow text-node marks. The whole result must not become a clickable surface unless separately requested: [Search](web/src/routes/Search.tsx:83), [HighlightedText](web/src/components/search/HighlightedText.tsx:5).
4. Upload retains its existing metadata/upload phases, earlier-attempt explanation, actual Uppy progress/cancel/retry, quota errors and processing message. Theme the surrounding panel first, not Uppy internals: [UploadDashboard](web/src/components/speech/UploadDashboard.tsx:129). Coach-document upload has a separate Uppy surface.
5. Profile keeps independently saved Photo/Username/Profile sections, cooldown, inline cropper, errors and dirty/reset handling. No second character column beside the fixed 288px phone cropper.
6. Export states and storage metrics remain exact. Preserve deletion consequences, typed confirmation, errors and disabled confirmation. Keep destructive dialogs neutral or scope them explicitly; portal inheritance will not theme them automatically.
7. Preserve speech video aspect, width calculation, viewport height budget, relative/absolute layout chain, controls and fullscreen host: [SpeechWatch](web/src/routes/SpeechWatch.tsx:351), [VideoPlayer](web/src/components/speech/VideoPlayer.tsx:112). No art, background pattern, curtain, transform, filter or decoration goes over footage, captions, commentary, timeline, or controls. No companion inside the fullscreen/PiP target.
8. Notes, Essay, Transcript and Reviewers differ for owners/reviewers. Existing `keepMounted` panels protect drafts and accessibility behavior. A future companion reads real selected-tab state without replacing/remounting those panels: [SpeechWatch](web/src/routes/SpeechWatch.tsx:474).
9. Keep real pending/error/failed/revoked/rejected states visible and literal. Characters can be friendly without falsely certifying success, readiness, available permissions or credentials. Character expressions should follow selected context; avoid recording-level animation and reacting to every keystroke.
10. Artwork stays decorative, nonfocusable, pointer-inert, locally lazy and failure-isolated. Controls retain visible labels, native semantics, keyboard focus and 44px touch targets. Check actual rendered contrast (4.5:1 body text, 3:1 meaningful boundaries), reduced motion, forced colors, focus/invalid/disabled/open states, neutral portals and physical narrow-screen keyboard behavior before shipping.

## Design-only review and evidence

The visual examples are in `work/design-previews/workspace-panel-options.html` and are presented directly in the conversation. Use the three direction buttons and the Panel selector; the preview's left navigation also switches examples. Watch opens the sample viewer, whose tabs change the illustration.

The examples are not executable application work, an implementation plan, backend authentication testing, or proof of media playback. The upload-transfer/progress surface, coach documents/decision states, inline avatar cropper and reviewer annotation composer inherit the proposed visual treatment in the written guidance above, but are **not rendered examples** here; they need detailed state/layout review in a later implementation plan. The rendered viewer uses a fixed illustrative 16:9 frame, not the actual measured portrait/landscape video layout.

Read-only critique checked the examples and this document against the actual routes. Corrections made within the design examples/document only:

- Replaced incomplete ARIA tab semantics with ordinary pressed section-choice buttons; switching sections preserves focus on the corresponding button.
- Used another illustrative speaker in My reviews, avoiding an accidental self-review implication for the sample member account.
- Extended the local Search demonstration to title/description-only matches and safe literal highlights, hiding the transcript excerpt when it does not match.
- Made the difference between rendered examples and written guidance for transfer/cropping/authoring states explicit above.
- Kept the surrounding comparison labels readable on a dark conversation background while retaining the approved light-paper product appearance.

Final design-preview checks: **81 page/direction/width combinations** (nine pages × three treatments × 360/736/1024px) without horizontal overflow or broken illustrations; no JavaScript errors and no network requests. Checked local reviewer filters, title/description/transcript matches, markup-like query input, all four viewer section characters and focus retention, dark surroundings, desktop sticky containment, and 719/720px character suppression. Representative desktop and mobile examples were rendered and visually inspected. These are prototype checks, not application acceptance tests.

All **1,068 existing tracked files** remained byte-identical to the initial snapshot. Only this design document and the new preview were created. No application source/test/dependency/service/database changes or commits are part of this task.
