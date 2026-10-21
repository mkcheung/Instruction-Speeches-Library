# Theater and comic styling for login and the coaching workspace

Status: design plan only, revision 2 after adversarial findings were verified and incorporated. No application styling, illustration assets, routes, or behavior have been changed for this task. The options below are proposals; option A is the recommendation, not an implemented selection.

Prepared 2026-10-20 on `feat/speech-search-excerpts`, HEAD `b5579c2`. Existing uncommitted search implementation and its documentation are unrelated work to preserve. This audit used the supplied landing-page screenshots and current source; it did not inspect the login/dashboard in a browser or establish rendered accessibility compliance.

## 1. Goal and boundaries

Extend the landing page's warm theater setting and economical newspaper-comic drawing language to `/login` and `/dashboard`, with small original character scenes representing sidebar activities. Continue the existing illustrated cast: rounded heads, dot eyes, expressive posture, simple ink outlines, restrained flat colors, and familiar rehearsal props.

The interface must remain immediately usable: recognizable fields, obvious labels, primary/secondary/destructive actions, strong focus indication, and readable status messages. Keep user-written descriptions, invitation notes, commentary, captions, transcripts, timestamps, and media controls in the normal functional typeface. Illustrations support navigation and atmosphere; they do not replace labels or convey an action/state on their own.

Scope for the recommended design:

- A new presentation frame around the existing login form.
- A restrained themed authenticated header/sidebar. These are shared by all existing `AppLayout` routes, so their visual impact must be tested outside `/dashboard` too.
- Presentation changes inside the existing My reviews dashboard; its sections, data, permissions, and actions retain their current meaning.
- Small route-driven decorative scenes in the desktop sidebar, plus a login welcome scene.
- Readability regressions on speech playback/commentary and the already implemented search highlighting.

Do not redesign authentication, MFA, roles, navigation destinations, review workflows, media layout, or annotation behavior. No backend, schema, seeding, new dependency, theme-preference service, public-profile layout migration, or Filament redesign is needed. Do not deploy a plan or modify the existing search work as part of this planning task.

## 2. Two explorer reports and source reconciliation

Two independent read-only explorers reviewed the landing implementation and the login/dashboard/application shell. Their findings agree on these constraints:

| Source | Finding | Design consequence |
|---|---|---|
| `web/src/components/landing/landing.css` and `art/art.css` | Cream paper, red curtains, gold trim, teal actions, dark ink outlines, offset shadows, and original SVG speakers/reviewers already establish the visual vocabulary. CSS is deliberately prefixed and unlayered. | Reuse the visual vocabulary in a new scope; do not apply landing classes or full scenes across application content. |
| `web/src/index.css:4–8,96–101` | Geist, Luckiest Guy, Patrick Hand, and Space Mono are already imported. | No font package is necessary. Keep Geist for functional reading; use display/handwriting fonts sparingly. |
| `landing/lazyArt.ts` and `routes/Home.tsx` | Landing content and the approximately 50 KB source art barrel are intentionally lazy. Signed-in visitors bypass landing rendering. | New workspace art needs its own small entry. Do not make authenticated users download the complete landing scene bundle. |
| `landing/art/SceneDefs.tsx` | Existing scenes depend on shared fixed `land-art-*` SVG definitions mounted once. | New artwork should be self-contained, with unique IDs where definitions are necessary. Repeated original `SceneDefs` would create ID collisions. |
| `landing/CurtainFrame.tsx` | Its fixed `#top`, centered landing column, inherited handwriting, curtains, and 66 px valance are landing-specific. | Reference its appearance; do not reuse it as the authenticated layout or place a form inside its constrained landing column. |
| `routes/Login.tsx:59` | Login owns its centered form/Card markup, form state, banners, autocomplete, remember checkbox, and destinations. | Change only presentation and retain its functional form contract. |
| `components/auth/AuthShell.tsx` | Despite its name, this file contains authentication/guest/verification guards, not the visual form shell. | Leave this file's guards unchanged. A new visual frame belongs in presentation components. |
| `routes/Dashboard.tsx:57` | `/dashboard` is **My reviews**: Invitations awaiting response, In progress, Published work, Revoked. | Preserve those headings, status meanings, ordering, invitation messages, actions, timestamps, and role-dependent profile link. It is not the admin dashboard. |
| `layout/AppLayout.tsx`, `AppHeader.tsx`, `AppSidebar.tsx` | Shared SPA layout, nonsticky 56 px header, desktop navigation and main content. Actual rail breakpoint is `md` (768 px); some comments still say `lg`. | Preserve semantics, breakpoint, sizing, skip-link focus and error containment. Do not add sticky header behavior for decoration. |
| `layout/PageShell.tsx` | Deliberate left-aligned responsive gutters and form/content/wide/full width ceilings. | Keep these dimensions. No second centered/narrow stage wrapper around the workspace. |
| `layout/UserMenu.tsx` and `lib/roles.ts` | Mobile navigation duplicates role-filtered links; the mobile account name remains accessible even when visually clipped. | Preserve this menu and the single `navItemsFor()` visibility source. |
| `components/ui/dropdown-menu.tsx`, `popover.tsx`, `alert-dialog.tsx`, `toast.tsx` | Popups use body portals outside the shell DOM. | A scoped shell stylesheet cannot reliably theme them by inheritance. Keep them neutral in this baseline proposal. |
| `routes/SpeechWatch.tsx`, `speech/VideoPlayer.tsx`, `index.css:199–287` | Media geometry, commentary scrims/font, pointer events, stacking, and the presentation portal inside the fullscreen player are deliberate. | No character art or inherited decorative effects inside media/commentary. Preserve their current surfaces and layout. |

## 3. Three design options

| Option | Login | Dashboard and navigation | Character treatment | Relative work and tradeoff |
|---|---|---|---|---|
| **A — Backstage workspace, recommended** | Cream entrance frame, compact red/gold brand strip, one welcoming character beside an opaque near-white form on large screens. | Cream chrome, thin ink rules, teal primary actions, near-white dashboard cards, gold selected-nav fill with an ink marker. Current content widths stay intact. | One modest changing scene below desktop nav links. No repeated scenes in working cards. | Moderate illustration work, limited presentation changes, strongest balance of identity and clear coaching tools. |
| **B — Comic rehearsal notebook** | Clean illustrated notebook/check-in panel with a small pencil-holding character. | Cream surrounds and panel outlines; occasional paper-tab accents on existing dashboard section headings. All content remains upright and untextured. | Selected-nav scene plus optional small section/empty-state poses. | More illustration and visual hierarchy work; greater risk of competing decorations in a busy dashboard. |
| **C — Theater entrance, practical workspace** | The most theatrical choice: compact curtain edges, simplified marquee and static welcome scene around the form. | Narrow burgundy brand trim and a quiet cream workspace; never full-height curtains around task content. | Stage-prop scenes reflecting the active destination. | Closest visual continuity with the landing page; needs extra width/height checks so framing never squeezes the form or media. |

All options preserve actual button labels and normal UI typography. B does not turn review messages into handwritten sticky notes. C does not place stage lights, curtain folds, textures, or a stage floor behind a video or form.

### Option A layout sketches

These sketches describe hierarchy, not final dimensions or implementation code.

```text
LOGIN — wide screen
┌ compact brand / restrained red-and-gold trim ──────────────┐
│ cream surround                                           │
│ welcoming original character    ┌ near-white form ──────┐ │
│ with rehearsal clipboard        │ Log in               │ │
│ (static decorative artwork)     │ Email    [__________] │ │
│                                 │ Password [_________] │ │
│                                 │ Remember me          │ │
│                                 │ [ Log in ]           │ │
│                                 │ Forgot / Register    │ │
│                                 └──────────────────────┘ │
└──────────────────────────────────────────────────────────┘
PHONE: compact brand + form; hide large artwork and curtain edges.

DASHBOARD — desktop
┌ brand / existing connection, notification and account controls ┐
│ Main navigation       │ My reviews                            │
│ icon + visible label  │                                       │
│ ■ selected item       │ Invitations awaiting response          │
│ other existing links  │ ┌ ordinary readable review card ─────┐ │
│                       │ │ title, message, status, actions     │ │
│ small activity scene  │ └─────────────────────────────────────┘ │
│ in reserved space     │ In progress / Published work / Revoked │
└───────────────────────┴───────────────────────────────────────┘
PHONE: current header account-menu navigation; no illustrated sidebar.
```

For A, the sidebar scene is the dashboard's principal character illustration. Avoid adding a second large hero scene above the invitation list: the first actionable section should remain easy to reach.

## 4. Recommended art direction and selected-navigation scenes

Use the existing original speaker/reviewer cast as the starting point for new poses. Maintain consistent head/body proportions, simple expressions, warm flat palettes, rounded ink strokes and modest irregularity. Props make the action recognizable: notebook, speech cards, slate, magnifier, name card, lectern, and prop chest. Keep characters expressive and friendly without turning them into control icons.

Prefer small repo-native React/SVG drawings, consistent with the existing landing art. A compact pose library can share a few character/prop primitives without importing the landing barrel. No raster generation is needed for this implementation direction. If bitmap concept art is later requested, review it as a separate design artifact before replacing crisp SVG assets.

| Existing sidebar item | Current destination | Proposed scene/action | Scope/visibility that must remain |
|---|---|---|---|
| My reviews | `/dashboard` | Character listening while marking a notebook beside a small playback screen. | Baseline for authenticated users; dashboard remains My reviews. |
| My speeches | `/speeches` | Character sorting labeled speech cards beside film reels. | Preserve `end: true`; the list link must not become selected on upload or watch routes. |
| Find reviewers | `/reviewers` | Two characters meeting across a rehearsal table, one offering a feedback notebook. | Existing nonadmin visibility only. |
| Upload a speech | `/speeches/new` | Character carrying a video slate onto a small rehearsal platform. | Baseline; do not confuse it with the My speeches index. |
| Search | `/search` | Character inspecting transcript words with a magnifier. | Baseline; preserve new search cards/excerpts/yellow marks. |
| Your profile | `/u/${username}` | Character pinning a portrait/name card to a board. | Concept mapping only in the base scope: this public destination is outside AppLayout, so its sidebar disappears. Do not wrap it in authentication to retain a scene. |
| Edit profile | `/profile` | Character updating a name card with a pencil. | Baseline. |
| Account & privacy | `/account` | Character closing a rehearsal prop chest with a small padlock. | Baseline; decorative, not an added security promise. |
| Become a Coach | `/become-a-coach` | Character demonstrating speaking beside a lectern and encouraging a peer. | Existing nonadmin/noncoach visibility only. |
| Admin panel | External `${API_URL}/control-panel` | Stage-manager-with-clipboard concept. | Existing real external anchor; the destination is Filament on another origin. No selected SPA scene or admin restyle is promised. |

Implementation rules for selection:

- `navItemsFor(currentUser)` remains the source of rendered/visible items. The presentation helper receives that list; it must not duplicate role checks or fetch extra user data.
- Derive the scene from the **actual current route**, with the same `NavLink` matching/end rules. Do not store “last clicked item” as state: deep links, browser Back/Forward and failed navigation would make it wrong.
- Keep current active semantics and `aria-current`. Add a noncolor selected marker/border and sufficient ink text contrast. Do not change the `/speeches` matcher to obtain a scene on speech-detail pages.
- A watch/detail route currently has no dedicated selected sidebar link. Show a quiet neutral rehearsal pose, or omit the decorative scene there. The video stays the focal point.
- Public profile and external admin navigation leave this shell. Record their visual discontinuity rather than inventing protected routes or a fake SPA admin page. Extending those separate layouts requires a separately reviewed scope decision.
- Keep the scene in natural flow below the links, not absolutely positioned over them and not `mt-auto` at the bottom of a potentially very tall page. Reserve approximately 120–140 px of height and the existing rail width. Hide the scene before sacrificing navigation at short viewport heights; keep the text links reachable.
- Preserve the current 224/256 px rail and the `md` breakpoint. Below that breakpoint retain UserMenu navigation and omit the sidebar artwork. A small mobile illustration is optional only if it does not push useful content below the fold; A's baseline omits it.

## 5. Palette, typography, controls, and appearance scope

### Palette

Use new presentation names such as `--workspace-paper`, `--workspace-ink`, and `--workspace-primary`, scoped to new `.workspace-*` roots. Do not replace root tokens in `index.css` or append broad `body`, `svg`, `button`, `.card`, or typography selectors.

| Purpose | Proposed value | Use |
|---|---|---|
| Surround | `#fff5e6` | Login surround and restrained application chrome. |
| Working paper | `#fffdf6` | Opaque login and dashboard reading surfaces. |
| Ink | `#2b211b` | Labels, outlines, headings and active-state marker. |
| Secondary text | `#66574f` | Descriptions and helper text on working paper. |
| Primary | `#0f6b66` | Main actions and links, with appropriate contrasting text. |
| Gold | `#e9b949` | Decorative trim and selected background, paired with ink text/border. |
| Curtain red | `#a81e28` | Brand trim only, not a replacement for every action/state color. |
| Input outline | `#8a7668` | Clear input boundary on paper; focus adds a stronger explicit ring. |

Source-only contrast calculations for opaque pairs: ink/paper 15.44:1; muted/paper 6.78:1; white/teal 6.33:1; teal/paper 6.22:1; ink/gold 8.61:1; input-outline/paper 4.24:1. **Gold/paper is only 1.79:1**: gold alone cannot identify an input edge, focus state, icon or selected control. These calculations do not verify the eventual rendered UI, opacity states or image backgrounds.

### Typography and controls

- Geist for labels, inputs, buttons, navigation, user content, metadata, validation and commentary. Aim for 16 px form text/labels and comfortably readable body text; keep navigation compact but legible.
- Luckiest Guy for short display headings or a small brand flourish. Patrick Hand only for nonessential illustration captions. Do not inherit handwriting from a page root. Keep existing timestamps/timing editors stable; any Space Mono treatment is limited to display metadata, not a rewritten timing control.
- Clearly label Email, Password and Remember me. Retain autocomplete, input types, validation associations, loading/disabled behavior, verification banner and all current link text/destinations.
- Use solid teal for the primary action; outlined paper/ink for secondary actions; keep existing destructive actions visually distinct and semantically unchanged. Avoid giving Decline/Withdraw/Abandon the same attention treatment as Accept/Watch.
- Target at least 44 px for primary touch controls/rows, keep generous hit areas and spacing, and preserve normal focus handling. Do not use hover-only information, moving buttons, rotated working cards, or shadows that replace the visible control boundary.
- Dashboard invitation messages and review descriptions remain normal paragraphs on opaque paper. Status badges retain their labels; never communicate invited/published/revoked only by brand color.
- The current dashboard title/badge and Watch/Withdraw/Abandon rows are nonwrapping flex layouts, while buttons are `shrink-0 whitespace-nowrap`. Larger touch targets require presentation fixes in the owned Dashboard file: allow action rows and title/badge rows to wrap, give long-text children `min-width:0`/appropriate overflow wrapping, and preserve complete action labels. Test busy labels too. Keeping the old row classes unchanged would not guarantee a usable 320 px layout.

### Scoped light paper, existing dark behavior, and portals

The current code has both legacy `--color-*` tokens controlled by system preference and shadcn tokens controlled by `.dark`, with no production theme provider found. This task should not create one.

For A, deliberately style the login form and dashboard reading panels as **light paper surfaces**, with `color-scheme: light` and explicit foreground/background/control states. At those specific presentation roots, map both token families needed by the existing form/card/banner controls to a coherent light palette. This is local to login/dashboard paper surfaces, not an AppLayout-wide override of `--card`/`--primary` or a global root theme change. Include legacy error/success colors and helper text so system-dark colors do not become pale text on cream. Check `.dark` utility variants as well: `color-scheme` alone does not cancel them.

Scope cream application chrome to **AppHeader and AppSidebar**, and the cream dashboard canvas to the Dashboard route's own wrapper. Do not paint or recolor the AppLayout root, shared `<main>`, body, or other routes' transparent PageShell regions. A cream ancestor behind unchanged `.dark` foreground utilities could otherwise produce white-on-cream text on Search, speech upload, Account, and other routes. Keep those routes' existing foreground/background pairing intact.

Header/sidebar need a complete **local** control palette too. Map the existing `--sidebar-*` tokens only on the sidebar and the button/foreground/muted/border/ring tokens needed by header controls only on the header. Add scoped header trigger-state CSS where necessary for the current UserMenu and bell controls: normal, hover, keyboard focus, expanded/open, `.dark` background utilities, and notification badges must all remain legible. Retain the identity avatar's existing inline contrast colors. This can be done from the owned stylesheet/header scope without editing UserMenu, popup components, or global primitives. A cream header plus ink inherited text alone is insufficient because existing hover/open utilities can still supply dark backgrounds.

Other routes' cards, player and commentary retain their existing neutral/light or dark surfaces. System-dark and `.dark` combinations require rendered verification; do not claim dark-mode support merely because a cream background was added.

Leave body-portaled UserMenu, notification/connection popovers, toasts and confirmation dialogs on their existing neutral surfaces. They must remain readable and functional even beside a cream frame. Do not move portal containers or set a global body theme to make their colors inherit. A future themed-popup option would require explicit popup call-site classes and separate tests, outside this baseline.

## 6. Readability and media protection rules

The original user explicitly prioritizes distinguishable controls and readable comments/video. Treat these as acceptance conditions:

- Keep the existing PageShell widths/gutters and `min-w-0` layout contracts. Do not center all authenticated pages inside a narrow stage.
- No illustration, pattern, curtain, spotlight, grain or translucent artwork under a video, caption, transcript, annotation, composer or feedback action.
- Do not change video aspect-ratio calculation, the `min(60svh,620px)` height budget, video.js controls, native caption styling, timing fonts or the `PageShell width="wide"` watch layout.
- Do not change `.annotation-overlay`, `.owner-commentary-host`, `.owner-feedback-frame`, the commentary scrim, overlay font, stacking, or pointer-event rules. Do not add inherited decorative typography to those regions.
- Preserve the React presentation portal **inside `player.el()`**, the real fullscreen target. Sidebar/header art belongs outside it. Do not move overlays into AppLayout for theming.
- No new `transform`, `filter`, `perspective`, overflow clipping or whole-layout animation on ancestors of the player/main content. Such changes can affect fullscreen, fixed-position descendants, stacking and controls.
- Keep header positioning nonsticky and preserve skip-link focus and `main#content` behavior. New decoration must not cover header buttons, tab controls, editor fields, error banners or notification panels.

## 7. SVG loading, resilience, motion, and accessibility

- Proposed new small `components/workspace/art/` library, with its own direct lazy import entry. Do not import the existing landing art barrel or mount existing SceneDefs in multiple places.
- Prefer simple shapes without per-character turbulence/displacement filters. Use `useId()` for any clip paths, gradients, filters or symbols; no duplicated fixed IDs across login, sidebar, tests or future repeated instances.
- Artwork is decorative: `aria-hidden="true"`, `focusable="false"`/empty alt as appropriate, and `pointer-events:none` on the artwork wrapper. Keep it out of tab order. Do not put functional labels or instructions inside an SVG or decorative speech bubble.
- Reserve dimensions/aspect ratio before loading. Put **Suspense around the art alone**, with a reserved empty fallback; memoize imports and catch import rejection to a `NoArt` fallback, following the existing landing loader's resilience pattern. Keep the login form and navigation outside this boundary.
- Add an art-local decorative error boundary for render failures. The existing RouteErrorBoundary wraps only Outlet; the sidebar is outside it, and login has no such boundary. Do not let an art error reach the root boundary and replace navigation or the login page. Tests must cover both rejected loading and a throwing art component, with form/links still usable. No failure fallback may retry in a loop or fetch a different remote asset.
- Static poses are the baseline. No automatic audio, perpetual jitter, animation behind content or animation tied to form focus. Any optional later transition must respect reduced motion and leave controls fixed.
- Respect forced colors: links, fields and selected markers remain visible even if decorative fills disappear. The artwork may be suppressed in that mode.
- Do not rely on a successful image load, color perception, hover, or a cartoon's expression to explain a destination or status.

## 8. Proposed implementation tasks after a design option is chosen

The following inventory describes future work. New paths are proposed; existing search changes remain outside this work. Assign a single owner to each shared stylesheet/component when implementing.

| Task | Proposed exclusive write scope | Dependency |
|---|---|---|
| A — scoped presentation foundation | New `web/src/components/workspace/workspace.css`, `WorkspaceLoginFrame.tsx`, and presentation helpers as needed. | Fix the selected option, light-surface token map, typography and explicit chrome/surface boundaries first. Do not edit global token values or UI primitive defaults. |
| B — original character kit and route mapping | New `web/src/components/workspace/art/*`, a small lazy loader, art-local error boundary, `ActivityScene.tsx`, `activityForRoute.ts` and tests. | After A's art dimensions/style contract. Accept visible nav items as input; do not edit `roles.ts` or duplicate role logic. |
| C — login presentation | `web/src/routes/Login.tsx` and `Login.test.tsx`. | After A/B. Preserve current form/auth logic and all labels/links. Existing AuthShell/roles/Home tests are run, not rewritten for styling. |
| D — chrome and dashboard presentation | `web/src/components/layout/AppLayout.tsx`, `AppHeader.tsx`, `AppSidebar.tsx`; `web/src/routes/Dashboard.tsx`, `Dashboard.test.tsx`; new targeted sidebar/scene tests if needed. | After A/B. Preserve UserMenu, PageShell, routing, public-profile and Filament boundaries. Render one scene, retain semantic navigation/selected state, and add responsive action/title wrapping without changing behavior. Coordinate any additional shared CSS with A's single owner. |
| E — browser/a11y and visual acceptance | Extend `web/tests/app-shell.spec.ts`, `web/tests/accessibility.spec.ts`, and login/dashboard screenshots/QA artifacts through existing test conventions. | After C/D. Both existing specs are already selected in CI. Preserve all other assertions and fixture contracts. |
| Coordinator documentation | This plan's future execution/review record. | Record selected option, artwork review, checks, screenshots and any limitations after actual implementation. |

No planned writes to `index.css`, landing art/styles, AuthShell, `lib/roles.ts`, App routes, UserMenu, general UI primitives, video/commentary components, backend, Docker/nginx, media/Whisper workers, or the existing search feature. If a concrete source constraint requires adding one of those files to the write scope, report and review that specific change rather than silently broadening the design.

## 9. Validation plan and delivery consequences

### Functional and accessibility checks

- Login/guard/role tests: ordinary onboarded and roleless users, onboarding, both admin tiers, explicit protected destination, verification notice, Remember me, failed/validation/network states and disabled submission. Preserve actual admin continuation and MFA. No second login form or themed fake admin dashboard.
- Dashboard tests: all four sections, personal invitation messages, normal timestamps/statuses, Accept/Decline, Watch/Withdraw/Abandon, busy/error states, revoked restrictions, absent speech relation, and role-gated profile link.
- Navigation: visible labels/icons and `aria-current`, exact list/upload separation, quiet watch fallback, direct URL navigation, Back/Forward, role-dependent items, username unavailable, mobile menu and its accessible account name. Public profiles remain publicly reachable outside AppLayout; admin remains an external anchor.
- Art: repeated instances have unique SVG IDs; pending/rejected imports and a render-throwing scene do not block controls; no layout shifts, art focus targets, accidental duplicate product/control labels, or generated text treated as HTML.
- Contrast targets for implementation: normal text at least 4.5:1, large text at least 3:1, and actionable boundaries/focus indicators at least 3:1 against adjacent colors. Verify actual hover, active, disabled, invalid and selection states separately. These are acceptance targets, not an accessibility certification.

### Visual and browser checks

- Capture actual login/dashboard screenshots at 320/375, 768, 1024, and 1440/1920 px. Include long titles, messages, large invitation/review counts, empty sections, validation banners, long account names and narrow screens with the keyboard visible where available.
- Test 200% and 400% zoom/reflow. No horizontal page overflow, clipped form fields, illustration-over-control overlap, unreachable nav links or hidden errors. Hide art before useful content is squeezed.
- Test system light/dark preference, an existing `.dark` root, reduced motion, forced colors and failed art loading. Preserve neutral portaled menus/dialogs; inspect their focus/selected states and header badges.
- Extend the existing real-browser accessibility spec to cover login and dashboard: it currently covers landing/authoring/playback/public profile, not these two pages. Inspect login **before submission in a fresh unauthenticated context**; a signed-in visit redirects away through RequireGuest, and the existing `login()` helper submits immediately. Scan dashboard separately after authenticating and waiting for actual review content. Preserve the existing axe tags, exclusions and critical/serious gate; add checks without weakening the helper or existing assertions. Keep existing landing copy/link/accessibility tests passing.
- Run existing app-shell and admin-panel browser suites to verify shared login/nav/MFA remain working. Perform actual speech-watch inspection with portrait and landscape videos, written and voice commentary, captions, transcript/search yellow marks, keyboard shortcuts and fullscreen controls. Existing media suites are regression lanes, not files to restyle.
- `captions.spec.ts` remains serial/Chromium-only because it mutates shared caption fixtures; a WebKit invocation that skips it is not coverage. Report secondary-browser, physical-device and actual fullscreen evidence only when performed. Do not weaken browser gesture requirements or tests to accommodate decoration.
- The CI browser command explicitly names specs in `.github/workflows/ci.yml:295–319`. Extending its already selected app-shell/accessibility specs avoids adding an unrun new test file. A standalone new theme spec would require a separate explicit CI inventory adjustment.

Future implementation should run the relevant frontend unit tests, then the full frontend suite, typecheck, lint and production build; include Login, Dashboard, AuthShell, roles, Home/Landing, layout/scene and VideoPlayer regressions. Use existing real-stack browser infrastructure and role fixtures in a disposable environment for mutations. Do not reseed or stop the user's development stack merely to obtain test coverage. No runtime tests or browser screenshots were produced by this planning task.

### Consequences and rollout

The recommended option adds a small illustration library and presentation CSS, not a new application framework. Exact shipped asset size must be measured after drawing; preserve the landing lazy boundary and verify route art does not download the full landing scene chunk. Existing globally imported fonts are not a new saving to claim.

There is no data migration or backend deployment requirement for this presentation-only design. The frontend must be served from the updated build or Vite workspace; an unchanged built web image will not acquire new styling just because files were edited. Any future refresh should target the appropriate frontend artifact, preserve API/data/worker services, and be verified in the environment actually being viewed. Record that deployment separately from implementation tests.

Rollback is restoring the previous frontend artifact. Keep illustration loading optional so a missing chunk cannot lock a user out. Preserve all existing uncommitted search changes and the search plan when preparing a future styling branch or commit.

## 10. Adversarial review record

Independent read-only agent `/root/theme_plan_adversarial` checked revision 1 against actual source and confirmed the route/role boundaries, actual sidebar breakpoint, portal/fullscreen constraints, file inventory and CI selection. It reported five actionable gaps. The coordinator inspected the cited files and incorporated the following in revision 2:

| Finding | Verified evidence | Correction |
|---|---|---|
| Artwork loading/errors could replace sidebar or login. | `AppLayout.tsx` places RouteErrorBoundary only around Outlet; `landing/lazyArt.ts` catches rejected imports. | Require art-only Suspense, memoized import rejection fallback, local render-error containment and failure tests; leave controls outside art boundaries. |
| A cream AppLayout backdrop could collide with unchanged dark foregrounds on other routes. | `index.css` has separate system/`.dark` token families; multiple PageShell regions have transparent backgrounds. | Restrict shared cream backgrounds/foregrounds to header/sidebar, and the dashboard canvas to Dashboard's wrapper; preserve the main/body/other-route pairings. |
| Header hover/open/focus states were not fully specified. | `UserMenu.tsx` uses inherited text plus `hover:bg-muted`; bell outline Button uses dark/expanded-state utilities. | Specify local header/sidebar token maps and scoped trigger-state CSS, retain avatar contrast and neutral body portals, test all states. |
| Larger controls could overflow existing dashboard rows. | `Dashboard.tsx` has nonwrapping title/badge and action rows; `button.tsx` supplies `shrink-0 whitespace-nowrap`. | Explicitly allow responsive wrapping and `min-width:0`/long-text handling in the owned presentation file, keeping complete labels and behavior. |
| Authenticated scans would miss the login surface. | `RequireGuest` redirects authenticated visitors; the existing accessibility `login()` helper submits immediately. | Require a fresh guest context before submission, separate authenticated dashboard scan, and unchanged axe rules/severity gate. |

The adversarial reviewer completed its final read-only recheck of revision 2 and confirmed that all five findings were resolved, with no remaining blocking contradiction against the inspected source. It reconfirmed the role/route, media/fullscreen, portal, file-ownership and CI boundaries.

Coordinating document validation checked source references, Markdown structure/whitespace and worktree scope. Hash comparisons verified that all pre-existing changed/untracked files remained byte-identical and the tracked diff was unchanged. Only this new plan was added for the styling task. This remains planning only: no application code, illustration assets, browser state, containers or data were changed, and no runtime tests were run.
