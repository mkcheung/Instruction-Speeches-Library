# Implementation plan: option C theater entrance and practical workspace

**Status: implementation complete; independent review and available automated checks passed.** Prepared 2026-10-21 from two read-only explorer reports, the current application source, and the final approved preview. Sections 1–8 retain the approved design and original planning record. Section 9 records execution, review findings, the user's narrow scope expansion, and actual verification results, including remaining manual/environment limits.

## 1. Selected design and authority

Implement **option C**, including the user's subsequent requests for different characters, poses, and facial expressions for different navigation activities. The reference is `work/design-previews/theater-workspace-designs.html`, particularly its option-C rules and final “Acting studies” rules. Use that file as a visual reference, not production code.

This decision supersedes the A recommendation, A-specific selection color, and optional alternatives in `PLAN-THEATER-WORKSPACE-STYLING.md` sections 3–5, 8, and rollout guidance. Keep that historical plan unchanged. Carry forward its source-verified accessibility, loading, route, dark-mode, portal, and media safeguards.

The resulting design has three parts:

1. A theatrical login entrance: red curtain edges, a compact red/gold marquee, a friendly original welcome illustration, and an opaque cream form.
2. A practical authenticated shell: restrained burgundy/gold header trim, a cream sidebar, **burgundy selected navigation with paper-colored text**, and one changing decorative activity scene below the links.
3. A readable My reviews dashboard: cream canvas, opaque paper panels, ink text, teal primary actions, clear secondary/destructive actions, and unchanged review content and behavior.

Do not copy mockup-only counts, names, speech examples, labels, page numbers, decorative welcome copy, or working-looking controls. In particular, the preview's local navigation state, `innerHTML`, inert actions, incomplete mobile navigation, in-shell public profile, and sample form behavior are not application requirements.

## 2. Explorer findings reconciled against the source

The code explorer inspected the login, authenticated shell, dashboard, role/navigation helpers, shared primitives, landing artwork, and current test/CI setup. The plan explorer inspected the previous plan and the approved preview, including its later character changes. Their findings agree; the implementation planner independently reread the principal source files and installed router behavior before writing this plan.

| Evidence | Confirmed current behavior | Required implementation consequence |
| --- | --- | --- |
| `web/src/routes/Login.tsx:15–55,58–119` | RHF/Zod form; remember defaults false; existing server errors, verification banner, email/password autocomplete, forgot/register links, loading submit; role-aware post-login continuation. | Wrap and style the existing form. Preserve hooks, submit/error logic, accessible labels, attributes, and navigation destinations. |
| `web/src/components/auth/AuthShell.tsx`; `web/src/lib/roles.ts:203–214` | AuthShell contains guards, not a visual shell. Requested protected destination wins; ordinary admin login continues to the external panel; other users reach onboarding/dashboard. | Leave both files unchanged. Keep MFA and admin continuation intact. |
| `web/src/components/layout/AppLayout.tsx:23–49` | Skip link first; static header, sidebar, focusable `main#content`, `min-w-0`; RouteErrorBoundary surrounds Outlet only. | AppLayout receives a stylesheet import only. Art outside Outlet needs its own failure boundary. |
| `web/src/components/layout/AppHeader.tsx:14–25` | Header is 56 px and nonsticky, with brand, connection requests, notifications, and account controls. | Keep every control, landmark, and destination. Fit trim inside the same 56 px. |
| `web/src/components/layout/AppSidebar.tsx:28–40,55–81` | `nav` named Main; shown from `md`/768 px; 224 px wide, 256 px at `xl`; native external anchor; NavLink receives each item's `end`. | Preserve geometry, link semantics, and visibility source. Add decoration in normal flow below links. |
| `web/src/lib/roles.ts:53–66,133–163`; `web/src/components/layout/UserMenu.tsx:49–105` | Role-filtered `navItemsFor()` is shared by sidebar and mobile account menu; roleless users have baseline navigation. | Do not duplicate or edit permission logic. Keep the complete mobile menu and accessible account name. |
| `web/src/App.tsx:104–108,116–142` | Public `/u/:username` routes are outside AppLayout; authenticated working routes share AppLayout. | Public profile leaves the sidebar. Do not promise a persistent profile cartoon or add an authenticated wrapper. |
| `web/src/routes/Dashboard.tsx:28–132,136–315` | My reviews has loading, verification banner, role-gated profile link, four server-grouped sections, empty states, real timestamps/statuses, invitation notes, and review actions. | Retain all four sections and their order and semantics; preserve null-speech handling and current busy/error behavior. |
| `web/src/components/layout/PageShell.tsx:49–67,79–95` | Deliberate left-aligned gutters and content width; PageHeader already wraps. | Retain PageShell and its width. Add only a route-local background wrapper and responsive card/action styling. |
| `web/src/index.css:4–8,12–85,96–101,142–173`; `web/src/components/ui/button.tsx`; `web/src/components/ui/input.tsx`; `web/src/components/ui/form-message.tsx` | Bundled fonts already exist; OS dark legacy tokens and `.dark` shadcn tokens coexist; some primitives have explicit dark utilities. | No font/CDN dependency or global theme change. Provide complete local light-paper states, including explicit dark-utility overrides where required. |
| `web/src/components/landing/lazyArt.ts:13–57`; `web/src/components/landing/art/SceneDefs.tsx` | Landing art is lazy and uses shared fixed SVG IDs. | New independent small lazy art entry; no landing barrel, SceneDefs duplication, or fixed-ID collisions. |
| `.github/workflows/ci.yml:295–329`; `web/tests/accessibility.spec.ts:30–77` | CI explicitly names browser specs; axe tags/exclusion/critical-serious gate are established. | Extend the existing app-shell/accessibility specs; retain their assertions, axe configuration, and CI inventory. |

Source references identify the planning snapshot; reread the files before implementation. If a contract has changed, stop the affected task and report the mismatch rather than expanding scope.

## 3. Fixed presentation contract

### Palette and typography

Use one new namespace: **`.workspace-*` and `--workspace-*`**. Do not introduce a second `theater-*` namespace.

| Purpose | Value | Required usage |
| --- | --- | --- |
| Cream surround | `#fff5e6` | Login surround, header, dashboard canvas. |
| Sidebar paper | `#f8ecda` | Sidebar only. |
| Working paper | `#fffdf6` | Opaque login/dashboard panels and input backgrounds. |
| Ink | `#2b211b` | Functional text, outlines, noncolor selected indicator. |
| Secondary text | `#66574f` | Helpers, bylines, empty states, timestamps. |
| Burgundy | `#8a1720` | Selected nav fill and restrained wordmark; paper text on selected nav. |
| Curtain red | `#a81e28` | Login curtain treatment and header trim. |
| Gold | `#e9b949` | Decorative trim, form offset shadow, art halo. Never a sole focus/control boundary. |
| Teal primary | `#0f6b66` | Primary actions, links, focus ring. White/paper foreground. |
| Input/secondary outline | `#8a7668` | Visible boundary on light paper. |
| Error | `#b91c1c` | Error text/outline on pale error surface `#fef2f2`. |
| Success | `#166534` | Success text/outline on pale success surface `#f0fdf4`. |

Use existing Geist for fields, labels, navigation, review titles, invitation notes, descriptions, statuses, timestamps, and all user content. Limit Luckiest Guy to the short brand/marquee and My reviews page heading; Patrick Hand is optional only for nonessential artwork lettering, with no functional instruction inside art. Do not change global font imports or timestamp formatting.

### Geometry and responsive behavior

- **Header:** preserve `h-14`/56 px, nonsticky. Use a 4 px burgundy top inset and 1 px gold bottom inset via decorative inset shadow/pseudo-element; they do not consume the 56 px layout or intercept pointer events. Vertically center controls; 44 px header trigger hit areas leave 6 px above/below. Keep all three controls on narrow screens and permit the existing brand text to truncate. Do not reproduce the preview's 76 px header or hide the connection bell.
- **Sidebar:** preserve `hidden ... md:flex`, `w-56`, and `xl:w-64`. Preserve the Main navigation landmark, existing icons, all labels/order, and real link targets. Rows have minimum 44 px height, readable text, and explicit focus treatment; do not add a new “Workspace” heading or mobile tab bar solely because the preview contains one.
- **Sidebar art:** centered **184 × 176 px** reserved box, 16 px above it, in normal flow immediately after the links. No absolute positioning over navigation, `mt-auto`, sticky rail, or fixed positioning. Recompose the final poses within an SVG `viewBox="0 0 184 176"` rather than cropping the preview's 195 px scene. Hide the complete box below 768 px width, below 720 px viewport height, and in forced-colors mode. This height budget accommodates the 56 px header, nine 44 px navigation rows, existing spacing/padding, and the reserved illustration while retaining the illustration in an ordinary 720 px desktop viewport. Verify that complete geometry rather than reducing link hit areas if spacing needs adjustment. Navigation remains scrollable with ordinary page flow at every height; do not lock page overflow.
- **Login:** new presentation frame spans `min-height:100svh`, without a fixed height or vertical clipping. At 1024 px and wider, use a cream inner stage capped at 960 px, two flexible columns, 32 px gap/padding, a 360 × 300 px reserved welcome-art area, and a form panel with 384 px maximum width and `width:100%`. Red curtain edges are 24 px outside the stage content; a compact marquee sits above, outside the form. Below 1024 px, hide the large welcome-art area and use one centered form column. Below 768 px, remove curtain edges and offset shadows, reduce surround padding to 16 px, and retain the compact brand/form. At 320 px the form has no fixed minimum width. Keep the form's Log in heading and Welcome back description. Current CardTitle renders a div: put a semantic `h1` containing Log in inside that existing CardTitle, without editing the shared primitive. Require exactly one h1; marquee/welcome decoration is not another heading or replacement form label.
- **Dashboard:** add a `.workspace-dashboard` route wrapper with `flex:1; min-width:0` and local cream background. Keep its existing content-width PageShell, gutters, ordering, and four sections. No new hero, full-height stage curtains, statistics, fabricated counts, or illustrations in review cards. Wrap title/badge rows and action rows, give title/message children `min-width:0`, and allow long tokens to wrap. Keep action labels complete, including disabled/busy labels, with 44 px minimum hit areas.
- **Other routes:** no cream/background/token override on AppLayout's root, shared main, body, or arbitrary PageShell. Shared chrome changes are expected, but Search, speech upload/watch, account, directory, and other route content retain their current surfaces and behavior.

### Complete local appearance, including dark/portal states

The stylesheet is unlayered and scoped to explicit roots: `.workspace-login`, `.workspace-header`, `.workspace-sidebar`, and `.workspace-dashboard`. Import it once from AppLayout and once from WorkspaceLoginFrame; bundler/module caching handles reuse. No broad root/body/tag/class selectors and no edits to `index.css` or shared primitive defaults.

Set `color-scheme:light` on those roots, and map both token families actually used there: legacy `--color-bg/fg/muted/border/accent/accent-fg/success/danger`, and shadcn `--background/foreground/card/card-foreground/primary/primary-foreground/secondary/secondary-foreground/muted/muted-foreground/accent/accent-foreground/destructive/border/input/ring`. Sidebar additionally maps its `--sidebar-*` tokens. These values never inherit through shared main into other pages.

Provide explicit scoped normal, hover, active, focus-visible, invalid, disabled, loading, and expanded/open trigger states. Account for the existing `.dark` input backgrounds, Button outline/destructive utilities, and success FormBanner text; setting `color-scheme` alone does not override them. Use explicit panel/card/banner/control classes in the owned Login/Dashboard markup plus bounded `[data-slot]` descendant selectors within those roots. Keep primary, secondary, error, and destructive actions visibly distinct.

In AppHeader, add `.workspace-header-actions` to its existing actions wrapper. Style its **direct child buttons** and their existing `data-slot="badge"` descendants with scoped selectors, including `[aria-expanded="true"]` and Base UI open state. These cover the UserMenu and both bell triggers without editing their files. Preserve the avatar span's inline background/foreground pair; do not use a broad descendant `color` rule that recolors it. Header badges retain a red fill and contrasting paper text. Body-portaled menus, popovers, dialogs, and toast surfaces remain on their existing neutral theme; do not restyle body portals by global selectors or alter focus/modal behavior.

## 4. Character library and actual navigation behavior

Create self-contained **React/SVG** artwork matching the approved final silhouettes, characters, colors, and acting. Do not copy the preview's CSS standees, rasterize them, use remote assets/CDNs, or merely swap the color/prop on one unchanged standing figure. Shared private drawing primitives are allowed inside the one art file; keep poses and expression details explicit and reviewable.

| Scene ID | Navigation activity | Approved character, pose, expression |
| --- | --- | --- |
| `reviews` | My reviews | Seated reviewer on a stool, tilted head and downward gaze, thoughtful expression, open notebook. |
| `speeches` | My speeches | Different character striding with stacked film cards, bent/splayed legs, broad pleased smile. |
| `reviewers` | Find reviewers | Two distinct characters greeting, one waving, the other laughing, opposing head tilts. |
| `upload` | Upload a speech | Character holding a slate overhead, raised arms and brows, excited open smile. |
| `search` | Search | Crouching sideways, one eye narrowed behind a magnifier, curious expression. |
| `profile` | Your profile | Tilted framed portrait, wink and asymmetrical grin. **Asset/study only in this scope; see exception below.** |
| `edit` | Edit profile | Different seated character, concentrated expression and tongue detail, page and poised pencil. |
| `account` | Account & privacy | Older character kneeling to lock a chest, closed eyes and satisfied smile. |
| `coach` | Become a Coach | Older glasses/bearded character at a lectern, expressive raised hand, encouraging open smile. |
| `welcome` | Login only | Static friendly welcome character based on the approved login study; no state changes tied to form focus/errors. |

All nine activity drawings exist in the kit and are included in visual acceptance. **Only eight can appear as selected in-shell scenes with the current routing.** Selecting Your profile navigates to the public profile outside AppLayout, so the sidebar and its portrait disappear. The portrait can be reviewed in the component test/QA rendering; do not add a production gallery, new route, authenticated wrapper, fake selected nav, or public-profile redesign to make it appear. The external Admin panel also leaves the shell and has no scene in this scope.

### Active-route contract

`navItemsFor(currentUser)` remains the only source of visible navigation. AppSidebar passes its existing `items` plus `useLocation().pathname` to a pure new `activityForRoute()` helper. Do not store last-clicked state, add fetching, duplicate role checks, or edit `roles.ts`. Map each known visible item's actual destination to its scene; omit external items. The dynamic visible `/u/${username}` item maps to the portrait study, although the actual profile route never mounts this shell.

Preserve every existing NavLink and its `end` prop. The installed `react-router` NavLink currently compares case-insensitively by default, compares exact pathnames first, and permits a slash-boundary prefix only when `end` is false. Its exact match does **not** normalize `/speeches/` to `/speeches`. Implement the helper using that same comparison contract for these existing absolute destinations; do not substitute `matchPath()` on the assumption that its trailing-slash behavior is identical. Queries/hashes are excluded by using `location.pathname`, not by modifying actual link URLs. Keep `aria-current="page"` supplied by NavLink and add a noncolor inset marker/outline to the burgundy active item.

Add parity tests against rendered real NavLinks, not only tests that repeat a homemade comparator. Cover ordinary paths, uppercase paths, trailing slashes, nested paths, slash boundaries (`/searching` must not select Search), query/hash changes, and the exact My speeches list/upload/watch separation. With `/speeches/:id`, **omit the scene** because there is no selected sidebar link; do not select My speeches, retain a previous scene, or add a neutral pose. Unknown/no-active routes omit the art box too. If a future nav inventory creates multiple active items, report the design ambiguity rather than inventing a priority that differs from displayed selection.

### Loading, SVG IDs, and failure isolation

- Define `WorkspaceSceneId` once in a new types file: the nine IDs above plus `welcome`. The helper returns an activity ID or `null`; ActivityScene receives a concrete ID and `variant="sidebar" | "login"`.
- `art/WorkspaceArt.tsx` exports one default component receiving the scene ID. It contains the drawings and private primitives; it does not import landing art or shared SceneDefs. Any definitions must use `useId()`-derived IDs so two renders cannot collide. Prefer plain shapes without filters.
- `lazyWorkspaceArt.ts` memoizes one dynamic import of that file and catches an import rejection to a `NoArt` component. No remote fallback, automatic reload, or repeated retry loop.
- ActivityScene owns a reserved box and art-only Suspense inside an art-local `DecorativeArtBoundary`. A throwing drawing renders an empty reserved box. Login fields and sidebar links are outside both boundaries and remain usable during pending, rejected, or throwing art. Error state may reset on scene change to allow another scene; it must not remount/retry the same failed scene repeatedly.
- Artwork is decorative: wrapper/SVG `aria-hidden`, SVG `focusable="false"`, no tabbable children or essential instruction, pointer events disabled, no live caption announcement. Use a nonaccessible `data-workspace-scene` marker only if useful for test assertions. No animation is required; reduced-motion mode remains static. Art may be suppressed in forced colors while selected markers, labels, and fields remain perceivable.

## 5. Implementation tasks and exclusive file ownership

This is the complete proposed application/test write inventory. A future worker must stop and report if the code differs from this plan or requires an additional file. No two workers may edit the same file. Do not let the browser worker fix component/CSS files; return findings to the owning worker. None of these tasks are being executed now.

| Task / owner | Exclusive files | Dependencies and deliverable |
| --- | --- | --- |
| **T1 — scoped CSS foundation** | New `web/src/components/workspace/workspace.css` | First establish the exact palette, classes, light/dark states, responsive dimensions, trigger-only selectors, forced colors, and no-art layout. This owner alone changes the stylesheet throughout implementation/review. |
| **T2 — artwork and route contract** | New `web/src/components/workspace/types.ts`; `web/src/components/workspace/activityForRoute.ts`; `web/src/components/workspace/activityForRoute.test.tsx`; `web/src/components/workspace/art/WorkspaceArt.tsx`; `web/src/components/workspace/art/WorkspaceArt.test.tsx` | Uses the fixed dimensions/contracts in this document; can run alongside T1. Deliver all ten drawings, nine activity studies, helper, real-NavLink parity/role-inventory tests, and repeated-instance ID tests. No loader or layout edits. |
| **T3 — resilient scene component** | New `web/src/components/workspace/lazyWorkspaceArt.ts`; `web/src/components/workspace/lazyWorkspaceArt.test.tsx`; `web/src/components/workspace/DecorativeArtBoundary.tsx`; `web/src/components/workspace/DecorativeArtBoundary.test.tsx`; `web/src/components/workspace/ActivityScene.tsx`; `web/src/components/workspace/ActivityScene.test.tsx` | After T1/T2 contracts. Implement reserved boxes, shared lazy chunk, rejected/pending/render-throw containment, null-independent concrete scene API, and decorative accessibility. Tests must prove sibling form/link controls survive all three failure states. |
| **T4 — login frame and integration** | New `web/src/components/workspace/WorkspaceLoginFrame.tsx`; `web/src/components/workspace/WorkspaceLoginFrame.test.tsx`; existing `web/src/routes/Login.tsx`; `web/src/routes/Login.test.tsx` | After T1/T3. Frame imports workspace.css and renders static brand/curtain/welcome decoration plus existing form children. Login retains existing Card/form and logic; add scoped presentation classes and the single semantic Log in h1 specified in section 3. Cover labels, heading semantics, verification/errors, loading/disabled, remember false, and unchanged destinations. |
| **T5 — shared chrome and route scene** | Existing `web/src/components/layout/AppLayout.tsx` **(stylesheet import only)**; `web/src/components/layout/AppHeader.tsx`; `web/src/components/layout/AppSidebar.tsx`; new `web/src/components/layout/AppSidebar.test.tsx`; `web/src/components/layout/AppHeader.test.tsx` | After T1/T2/T3. Add bounded header/sidebar/actions/link classes, preserve all existing markup contracts/controls/links, derive route scene from visible items. Correct misleading old breakpoint comments in the owned Sidebar file if touched. Header tests cover original controls/name and classes; sidebar tests cover visible labels, roles, links, active markers, direct/history route scenes, public/external exceptions, and unchanged mobile menu source. |
| **T6 — dashboard presentation** | Existing `web/src/routes/Dashboard.tsx`; `web/src/routes/Dashboard.test.tsx` | After T1; can run alongside T4/T5. Add route-local wrapper including loading presentation, panel/control classes, title/action wrapping and long-text handling. Keep all query/mutation/grouping/navigation logic, timestamps/status labels, empty/error/busy states, and missing-speech exit actions. Extend current behavior regressions only as needed. |
| **T7 — browser/accessibility evidence** | Existing `web/tests/app-shell.spec.ts`; `web/tests/accessibility.spec.ts` | After T4/T5/T6. Extend already CI-selected specs for real login/dashboard/chrome, responsive appearance, route scene changes and history, theme/portal/reflow checks, fresh guest axe and authenticated dashboard axe. Keep fixtures and existing assertions/gates unchanged. Screenshots/reports go into existing ignored Playwright output; no new production routes or test fixture mutations. |
| **Coordinator/reviewer** | This implementation plan only, for a future execution ledger; read-only review of all application/test files | After workers, compare complete diff against scope and acceptance. Send fixes to owners; rerun affected checks. Never overwrite unrelated work. Record actual results/limitations and reviewed screenshots. |

T1/T2 establish the shared contracts; T3 follows; T4/T5/T6 integrate; T7 validates. A future independent reviewer can run read-only inspection and approved tests after integration. The fixed inventory intentionally excludes generic “helpers as needed.”

### Files and systems that remain unchanged

No writes to `index.css`, landing components/art/styles, App routes, AuthShell, `roles.ts`, PageShell, UserMenu, NotificationBell, ConnectionRequestsBell, UI primitives, avatar contrast helpers, public profile, Search/transcript files, video/player/annotation/voice components, backend, database/schema/seeders, dependencies/lockfiles, Docker/nginx, CI configuration, or worker services. The existing preview and previous plan also remain unchanged.

Header-scoped CSS is sufficient for the inspected trigger structure; there is no present justification to edit UserMenu/bells. If implementation proves otherwise, stop that task with the exact source conflict and proposed bounded change. Do not silently broaden the write list.

## 6. Acceptance criteria and verification

### Functional and route acceptance

- Login retains Email, Password, Remember me, Forgot password?, Register, verification notice, field/form errors, default false remember, autocomplete, and loading/disabled behavior. Test normal/roleless and incomplete-onboarding users, requested destinations, both admin tiers and external continuation; run existing guard/role tests. MFA remains untouched.
- Dashboard retains My reviews, Invitations awaiting response, In progress, Published work, Revoked, and every current empty state. Preserve invitation messages/time, review timestamps/statuses, Accept/Decline, Watch/Withdraw/Abandon, busy/error handling, missing speech relation, revoked restrictions, and role-gated profile link. No client sorting or fabricated counts.
- Verify roleless/member, coach, admin/super_admin, username-present and username-absent navigation. Direct visits and Back/Forward update the scene from the current visible active link. Verify `/dashboard`, `/speeches`, `/speeches/`, `/speeches/new`, `/speeches/new/`, `/speeches/9`, `/search`, `/search?q=voice#results`, uppercase equivalents, nested account/profile paths, and unmatched slash-prefix examples against actual NavLinks.
- Public profile remains publicly accessible without AppLayout; its portrait is asset-only in this scope. Admin panel remains a native external link with `rel="noreferrer"`. Watch routes show no selected scene. No last-clicked state remains after navigation or a blocked navigation.
- Form and links remain available with pending art, failed chunk loading, and a render exception. Reserved art geometry does not cause loading shifts, and repeated scenes have no duplicated SVG definition IDs.

### Visual and accessibility acceptance

- Compare actual implementation screenshots against **option C** and every final acting study at its production size. Confirm distinct silhouettes, head tilt, limb posture, eyes/brows/mouth, hair/clothes, and props together—not merely different IDs/colors. Check all poses at 184 × 176 px, including raised slate/arms, waving hands, bent legs, magnifier, stool, and lectern: their bounds and expressive details must not clip. Review the profile asset in the component QA rendering while retaining its public-layout exception. No functional caption belongs in the art box.
- Capture login/dashboard at widths 320, 375, 768, 1024, and 1440 px, plus a short desktop viewport such as 1024×640 and a normal desktop viewport such as 1440×900. Check the rail exactly at 767/768 and the 256 px width at 1280. Art disappears under the height rule while all links remain reachable. Explicitly test 719/720 px heights: below the threshold the box is absent; at 720 px it fits with all nine member navigation links. Set ordinary route/art browser assertions to a desktop viewport such as 1024×900 so they exercise visible illustrations, then test short-height suppression separately. Header remains 56 px with all controls.
- Use long account names/titles, long unbroken text, long invitation notes, several cards, all empty sections, verification/error banners, and loading/busy states. Existing test-local mocks are appropriate for controlled unit/browser rendering; do not modify shared fixture files or seed the user's database for screenshots.
- At 200% and 400% zoom/reflow, no horizontal page overflow, hidden form errors, clipped controls, unreachable links, or artwork overlap. Labels/user content stay normal readable typography. Verify keyboard focus order/skip link and full mobile UserMenu navigation/account accessible name.
- Test system light/dark preference, `.dark` on the root, their combinations, reduced motion, and forced colors. Check rendered normal/hover/open/focus/invalid/disabled states, header badges, avatar paired colors, and unchanged neutral body-portaled menus/popovers/dialogs. Require ≥4.5:1 normal text, ≥3:1 large text and meaningful control/focus boundaries; measure actual rendered pairs, not token names alone.
- Add an axe scan of **unauthenticated login before submission**, using a fresh guest context. Calling the existing login helper first would skip the form under RequireGuest. Separately scan authenticated Dashboard after its actual review data loads. Preserve AXE_TAGS, `.video-js` exclusion, all prior scans, and the critical/serious gate; log lesser findings as before.
- Inspect shared-chrome regressions on Search, upload, directory, account, and speech watch. Search excerpts/yellow marks and video, text/voice commentary, captions, transcript, timeline, keyboard/fullscreen behavior must remain readable and unchanged. No decorations, filters, transforms, or pointer-event layers may wrap media or commentary. Report actual fullscreen/mobile/microphone evidence only if performed.

### Commands to run later

Commands below are from the current `web/package.json`, existing specs, and CI. Run from `web/` after integration; do not run or claim them during this planning-only task.

```sh
npm run test -- src/components/workspace src/components/layout/AppSidebar.test.tsx src/components/layout/AppHeader.test.tsx src/routes/Login.test.tsx src/routes/Dashboard.test.tsx src/components/auth/AuthShell.test.tsx src/lib/roles.test.ts src/routes/Home.test.tsx src/components/landing/Landing.test.tsx src/components/speech/VideoPlayer.test.tsx
npm run test
npm run typecheck
npm run lint
npm run build
```

Use a **preprovisioned disposable E2E environment** with confirmed ownership, expected fixture data, healthy app/media services, and known host/port routing. `playwright.config.ts` has warmup/setup dependencies but no `webServer` that starts the stack. Do not casually call `scripts/e2e-stack.sh prepare/up`: the harness includes host/certificate preparation, seeding, and cleanup behavior. Do not reseed, restart, or stop the user's development environment to obtain styling evidence. If a suitable disposable stack is unavailable, finish nonmutating checks and explicitly report the real-stack/browser evidence as blocked.

Focused real-stack lane, matching current main specs:

```sh
E2E_POSTGRES_CONTAINER=speechcoach-e2e-postgres-1 npx playwright test tests/app-shell.spec.ts tests/accessibility.spec.ts tests/admin-panel.spec.ts --project=chromium
```

Full currently selected CI browser lane:

```sh
E2E_POSTGRES_CONTAINER=speechcoach-e2e-postgres-1 npx playwright test tests/speech-create.spec.ts tests/app-shell.spec.ts tests/essay-editor.spec.ts tests/captions.spec.ts tests/voice-annotations.spec.ts tests/accessibility.spec.ts tests/keyboard-shortcuts.spec.ts tests/admin-panel.spec.ts --project=chromium
```

The container name above is the repository's dedicated-stack example, not proof that the current target is disposable; verify it before execution and use that environment's actual name. Keep caption tests serial/Chromium-only as configured; a skipped non-Chromium invocation is not caption coverage. Current additional CI media lane is:

```sh
npx playwright test tests/voice-annotations.cross-browser.spec.ts --project=firefox --project=webkit --project=mobile-webkit
```

For a relevant secondary-browser presentation check, run the existing app-shell/accessibility specs with `--project=webkit` in the same disposable environment. Record actual browser projects exercised. Automated WebKit/emulated iPhone results do not establish physical iPhone, real microphone, or manually entered fullscreen behavior.

Inspect build output/module imports to confirm workspace art is optional in its own lazy chunk and does not pull the full landing-art barrel into login/dashboard. Record the measured chunk size after drawings exist; this plan makes no asset-size or performance guarantee.

## 7. Review, delivery, and rollback

Before editing, record branch/HEAD/status and identify existing uncommitted search/preview/documentation work. Preserve it. Future implementation does not automatically authorize a commit, deployment, database refresh, or service rebuild.

When workers finish, an independent read-only reviewer compares all changes with this plan and actual source, checks every task/acceptance item, and runs the agreed test lanes in the verified environment. Return defects to the exclusive file owners, then repeat affected checks. Do not weaken tests, fabricate fixture state, or broaden implementation scope to obtain a green result. An unexplained mismatch between selected active link and artwork, a hidden header action, a login/redirect change, or a public-profile scope change blocks acceptance.

Deliver a short summary of changed behavior/presentation, exact test results, representative login/dashboard screenshots and all character-study comparisons, measured build/art boundary evidence, and outstanding manual limitations. The source-only exploration and this plan are not rendered accessibility or browser validation.

No migration or backend release is necessary. To make an eventual implementation visible, serve the updated frontend artifact/Vite workspace in the intended environment and verify that actual build. Treat any frontend deployment/refresh as a separate explicit action; preserve API, data, media, and worker services. Roll back by restoring the prior frontend artifact or reverting only the eventual styling change through ordinary Git review, preserving unrelated work. Missing art must remain a cosmetic loss, never an authentication/navigation outage.

## 8. Planning validation record

- Both requested explorers supplied read-only findings; this planner reconciled them with current Login, Dashboard, AppLayout/Header/Sidebar, navigation/role helpers, UserMenu/bells, PageShell, input/button/banner primitives, App routes, landing loader, global token/font definitions, package scripts, Playwright config, accessibility spec, and current CI command inventory.
- The final option-C preview and final acting-study rules were inspected. The previous plan's A recommendation, gold active state, optional watch pose, approximate artwork dimensions, and vague helper inventory have been replaced with the fixed C decisions above.
- The previous adversarial findings are retained as explicit requirements: art-only failure isolation, no shared-main theme leakage, complete header trigger states, responsive Dashboard wrapping, and guest-login axe before submission.
- Remaining intentional limitation: the public-profile portrait is implemented/reviewed as an asset but cannot persist in the authenticated sidebar on its existing public route. This plan explicitly preserves that route boundary rather than claiming all nine scenes appear in-shell.
- Planning created only this Markdown file. No implementation tasks, runtime tests, browser changes, service commands, migrations, or data operations were executed as part of drafting it.
- Coordinator review checked the draft against the actual login, navigation/roles, router matching, theme primitives, and test configuration. It clarified the login heading task and added a future geometry test at the 720 px artwork-visibility boundary. Document checks confirmed paired Markdown fences, valid existing-source references or explicitly proposed new paths, and no whitespace errors. Hash comparisons confirmed that all 23 pre-existing modified/untracked files remained unchanged; this plan is the only new file from this task.

## 9. Execution and review record — 2026-10-21

### Ownership and implementation

The user subsequently authorized execution. Seven workers implemented T1–T7 with exclusive file ownership and the specified dependencies. The coordinator preserved branch `feat/speech-search-excerpts` and HEAD `b5579c21303aa0a4b9c578039df59fc34c4368de`; no commit, staging, deployment, backend refresh, seeding, or service restart was performed. The original 25 source/test paths remain the implementation inventory, subject only to the explicit two-file exception below. This document is the coordinator's execution ledger.

Delivered: option-C login frame, scoped chrome/dashboard styling, ten original SVG drawings, route-derived sidebar scenes, art-local loading/error containment, responsive controls and text wrapping, and unit/browser regressions. Public-profile routing, external administration, roles, authentication logic, media/commentary, and the existing search work remain unchanged.

### Independent review and corrections

After all seven workers handed off, an independent read-only reviewer compared the complete diff/new files with this plan and ran the frontend test suite, typecheck, lint, production build, and isolated browser checks. Its first full run passed 738 tests across 101 files; typecheck/build passed and lint reported zero errors with five warnings in unchanged files. Initial browser evidence identified an existing bell accessibility defect and intermittent Vite module-delivery failures. Neither the unread-count fixture nor the accessibility gate was weakened.

Corrections were returned to exclusive owners:

- CSS owner preserved the red destructive Revoked badge and constrained long account names without editing UserMenu. The 767 px overflow regression and 719/720 px artwork visibility checks now pass.
- Dashboard owner made Watch the teal primary action while preserving its destination and behavior.
- Sidebar owner corrected stale breakpoint comments.
- Artwork owner aligned the Search magnifier over the narrowed eye, preserving the crouching pose and viewBox.
- Browser owner added optional `WORKSPACE_USE_BUILT_ASSETS=1` delivery inside the two already-owned specs. It serves the exact completed frontend build with realpath-bounded file checks, keeps the browser's app origin, intercepts API responses, and blocks unknown requests. It changes no service/configuration and leaves default CI delivery unchanged. Finish `npm run build` before starting this mode; rebuilding concurrently replaces hashed assets. All six Chromium presentation tests passed against the stable build before the bell correction.
- Browser owner corrected the new keyboard test to use macOS WebKit's native Option+Tab sequence; other platforms retain Tab. The skip-link focus, Enter-to-main, and forced-colors assertions remain intact, with no focus injection or skipped assertions.

### Explicit user-approved scope exception

The user approved **“Allow the two-file fix”** after the coordinator explained that both bell components were excluded by the original plan. The only newly permitted source paths are:

- `web/src/components/layout/NotificationBell.tsx`
- `web/src/components/layout/ConnectionRequestsBell.tsx`

A separate worker exclusively owns those two files. The correction replaces each explicit trigger `aria-label` with screen-reader-only child text containing the exact same name/count, and marks the redundant visible badge `aria-hidden`. Visible badge numbers, `9+`, full announced counts, queries, handlers, and popup semantics are preserved. A temporary browser DOM experiment reproduced both original serious axe failures and verified the proposed correction before source edits. Existing bell tests passed 14/14 after implementation. The original Header test owner added count regressions for 0, 1, and 12 within its existing planned test file; all five Header tests passed. The browser owner strengthened the local axe fixture to include one pending connection alongside one unread notification.

This exception does not authorize other edits to the previously excluded files or systems. Final source/test scope is 27 files plus this execution ledger.

### Final verification and remaining boundaries

After all corrections were handed off, an independent read-only reviewer inspected the final source and reran the checks below. No blocking defects remained. The reviewer verified that Login's hooks, submit handling, and role-aware redirects were unchanged; regression tests cover those behaviors, and the isolated browser checks exercise the actual frontend form with a mocked login response. The original accessibility scans and their critical/serious gate remain unchanged.

| Final check | Result |
| --- | --- |
| `npm run test` | **741 tests passed across 101 files**. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed: zero errors; five existing warnings in untouched files. |
| `npm run build` | Passed; existing large-bundle advisory remains. |
| Built-mode isolated presentation lane, Chromium | **8/8 passed**, including fresh guest Login and authenticated Dashboard axe scans. |
| Built-mode isolated presentation lane, WebKit | **8/8 passed**, including the same axe scans and native keyboard navigation. |
| `git diff --check` and scope/hash audit | Passed; all **23 unrelated baseline files** remain byte-identical, with no unexpected changed paths. |

Both browser lanes used `WORKSPACE_USE_BUILT_ASSETS=1`, `--grep 'option C presentation'`, `--no-deps`, and `--workers=1` for the two owned specs, after the completed production build. Browser projects ran serially without rebuilding between them. The workspace art remains its own optional **18.17 kB chunk / 5.46 kB gzip**, separate from landing art. Ten character studies were checked for distinct poses/expressions and viewBox containment; the Search lens alignment was corrected during review.

Representative screenshots reviewed by the coordinator/reviewer (ignored test outputs; controlled local fixture content):

- [Desktop Login](web/test-results/option-c-independent-final-chromium/app-shell-option-C-present-eca5a-and-local-mocked-submission-chromium/option-c-login-desktop.png).
- [Desktop Dashboard](web/test-results/option-c-independent-final-chromium/app-shell-option-C-present-cfaae-nd-responsive-rail-geometry-chromium/option-c-dashboard-desktop.png).
- [Mobile Dashboard](web/test-results/option-c-independent-final-chromium/app-shell-option-C-present-cfaae-nd-responsive-rail-geometry-chromium/option-c-dashboard-mobile.png).

The existing development stack is the only running backend environment. All presentation browser tests intercept API traffic; no real backend authentication/MFA, mutable media workflow, or database fixture lane is claimed. The unchanged real-stack CI suites still require a preprovisioned disposable environment. Narrow-viewport reflow was tested; physical-device/microphone/fullscreen and actual browser-zoom checks remain manual follow-up. No staging, commit, deployment, service change, or data mutation was performed.
