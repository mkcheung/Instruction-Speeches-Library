# Admin styling and character design plan

Status: **Backstage Notes implementation completed; independent review repairs applied; validation recorded in section 9.** Prepared 2026-10-29 against `development` at `aa6a3e0`. Separate explorers reviewed the main site's visual system and the Filament admin implementation and reported their findings to the main agent. A comparison study is at [admin-style-options.html](work/design-previews/admin-style-options.html). Its characters are concept sketches and its records are fictional, not live admin screenshots.

## 1. Original appearance and planning review boundary

The main site's rendered My reviews page was inspected in the existing browser session. Its cream shell, burgundy selected navigation, teal actions, paper panels, taped section corners, square warm shadows and expressive sidebar illustration match the current source. It is a **theater-themed rehearsal notebook**, rather than the older global purple/shadcn theme.

The initial browser visit to `/control-panel` returned the intended 403 because the browser was signed in as a coach. The user offered to sign in as an administrator and complete MFA; rendered admin inspection remains pending until that is complete. Admin findings below are source-verified, not a claim that authenticated admin pages were visually inspected. At the planning stage, no account/role changes, credential entry, MFA bypass, database changes, production styling, builds or application tests occurred. Implementation evidence is recorded separately in section 9.

| Surface | Main site now | Admin now, from source |
| --- | --- | --- |
| Shell | Cream paper, burgundy navigation, gold rules | Mostly stock Filament chrome; indigo primary |
| Typography | Geist for functional reading; Luckiest Guy for short headings/brand | Inter Variable default; no custom panel font |
| Working panels | Paper, thin ink outline, 4px corners, offset warm shadow, teal section edge | Standard Filament sections/tables/infolists |
| Characters | Original self-contained SVG companions selected by route/context | No character component or scene mapping |
| Appearance modes | Workspace scopes use light paper tokens | Filament light/dark/system support is enabled by default |
| Responsive behavior | Desktop rail plus compact heading artwork on small/short screens | Collapsible desktop rail and mobile overlay supplied by Filament |

Current sources: [workspace.css](web/src/components/workspace/workspace.css), [notebook.css](web/src/components/workspace/notebook.css), [WorkspaceArt.tsx](web/src/components/workspace/art/WorkspaceArt.tsx), [NotebookPage.tsx](web/src/components/workspace/NotebookPage.tsx), [AdminPanelProvider.php](api/app/Providers/Filament/AdminPanelProvider.php). Historical theater/panel option documents describe earlier proposals; current code and observed rendering take precedence.

## 2. Styling options

| Option | Shell and working surfaces | Character treatment | Tradeoff |
| --- | --- | --- | --- |
| **A. Backstage notebook — selected** | Main-site cream/burgundy chrome, teal actions, paper sections, small tape details and restrained warm shadows; quiet table rows | Original backstage crew, one scene for the active section | Closest continuity; keep decoration around the work rather than behind dense data |
| B. Playbill control room | Stronger burgundy masthead/rail, gold dividers, light work area | More theatrical framing and slightly larger scene | More expressive, but the strongest chrome competes with busy moderation pages |
| C. Quiet archive desk | Same paper/ink/teal palette with fewer shadows/tape details and ledger-like rules | Smaller cameo and subdued props | Best density; less of the main site's playfulness |

Develop A. Retain B/C in the comparison so the user can judge intensity; do not create a production theme switcher for these options.

### Selected visual rules

| Role | Light palette / geometry |
| --- | --- |
| Page / working paper / sidebar | `#fff5e6` / `#fffdf6` / `#f8ecda` |
| Main text / secondary text | `#2b211b` / `#66574f` |
| Selected navigation | Burgundy `#8a1720`, paper text, ink boundary and inset selection cue |
| Primary action / focus | Teal `#0f6b66`; visible 2px focus outline with separation from the control |
| Accent / outline | Gold `#e9b949` / warm outline `#8a7668` |
| Section | Thin outline, 4px radius, restrained `4px 4px #e7d0a5` shadow; pale header and 5px teal edge where appropriate |
| Type | Geist for tables/forms/statuses/body/buttons; Luckiest Guy only for brand and short page titles; normal type for user content |

Keep table bodies calm: readable row separators, stable hover/selected states, clear filters/search/pagination, and no paper texture under text. Do not apply every notebook effect to every nested section. Preserve Filament's available table width, column visibility controls, sticky/scroll behavior and mobile overlay instead of imposing the SPA's narrow form width.

Retain success/warning/danger meaning and explicit destructive labels. Burgundy navigation is not a substitute for danger semantics; teal does not mean every action is safe. Keep modals, validation, toasts, disabled/loading states and keyboard focus legible. Icons remain native Filament/Heroicons; no icon-library migration.

**Dark appearance:** preserve the existing light/dark/system choice and its default; do not silently change user preferences. Implement a warm charcoal partner palette with paper-like light text, muted gold rules and adequate teal focus/action contrast. The light mode is the direct visual match to the main site. The exact dark pairs must be reviewed in rendered states; do not copy light cream values into `.dark` controls or claim contrast compliance from token names.

## 3. New admin cartoon crew

Recommended art family: **seven distinct human backstage specialists**, in the current site's ink-and-paper style. These are new characters with distinct silhouettes/acting, not recolored versions of one standing figure. The preview is a concept study; final production art needs a separate pose/detail review at its actual display size.

| Sidebar destination | Character concept | Acting and props | Context mapping |
| --- | --- | --- | --- |
| Dashboard | Stage manager | Attentive headset/listening pose, folded run sheet, small stage clock | Admin dashboard |
| People → Coach applications | Credential reviewer | Thoughtful folder/magnifier pose; documents with abstract marks | Application list; quieter compact form on review detail |
| People → Users | Community host / casting coordinator | Welcoming gesture beside anonymous name cards | Users list and account detail |
| People → Connections | Stage technician / community weaver | Carefully joining two cables or arranging two linked cue cards | Connection list/detail context |
| People → Audit log | Ledger archivist | Seated reader tracing a ledger entry with a pencil/clock nearby | Audit pages, **super_admin only** |
| Moderation → Reports | Calm mediator | Listening/reading a folded note, neutral attentive expression | Report queue/context |
| Moderation → Speeches | AV archivist | Film reel, headphones or a small editing desk | Speech list and media-inspection context |

Alternative cast structures, if the user prefers them before production art: a smaller recurring crew performing seven activities, or friendly anthropomorphic backstage objects such as a ledger/clipboard/reel. Seven original people are recommended because the user requested more characters and the main site's established cast is human. Object mascots would be a larger change in illustration language.

Art brief: rounded irregular heads, expressive face/head tilt/posture, varied hair/skin/clothes, flat restrained fills, rounded ink strokes and simple ground shadows. Use varied seated/bent/standing poses and role-specific props; faces must remain readable at small size. Existing raster avatar portraits are not the cartoon reference. Artwork contains no account names, document text, record counts or status verdicts.

Tone stays respectful: characters help the administrator do careful work. No police/gavel/punishment imagery, no caricatures of reported users/applicants, and no celebration beside suspension/rejection/deletion. Art does not imply approval, guilt, safety or a successful operation. Avoid motion in the baseline; any later motion respects reduced motion.

### Placement options

- **Header cameo, recommended for the first admin implementation:** one compact scene beside the current page heading, approximately 80–112px on spacious desktop pages and 56px in compact layouts. This is feasible through a scoped Filament heading/page hook and keeps tables wide. Reduce detail pages further; no large illustration in document inspection, MFA or destructive dialogs.
- **Expanded sidebar scene, closest to the main-site rail:** approximately 184×176px below navigation, only when the expanded rail and viewport height leave room. Hide it when collapsed, on the mobile overlay or short screens; use the compact header alternative. It needs verified active-page context across navigation/hydration and must never push links out of reach. The comparison includes this placement to let the user judge the space tradeoff.

Only one large scene appears at a time. Sidebar labels/icons remain the navigation; characters are decorative, pointer-inert, nonfocusable and hidden from assistive technology. Hide decorative art in forced colors and at very narrow sizes rather than shrinking it until faces become unreadable. Failed art loading must not hide a heading, action or navigation link.

## 4. Implementation approach after design approval

Keep Filament as the admin framework. Do not rebuild the panel in React or copy the SPA layout components into PHP. Share a documented visual token/illustration contract across the two stacks; use a panel-scoped implementation rather than importing the entire SPA CSS.

### Theme and asset delivery

The API currently has no attached custom theme build: `api/node_modules`, an API lockfile and `api/public/build` are absent. [Dockerfile](Dockerfile) builds the React frontend and publishes Filament assets; the API nginx host serves only the supported `/(css|js|fonts)/filament/` static namespaces ([nginx configuration](docker/nginx/default.conf)). Merely adding Tailwind classes, `/build/...`, `/images/...` or an ordinary `/css/app/...` asset would not establish working delivery.

Prefer **additive, panel-scoped CSS over the installed Filament theme** for this visual scope. Installed `Css::relativePublicPath()` can publish the application stylesheet below `css/filament/admin/`, which the existing nginx/Docker copy path already serves. Register it through the panel asset system as `loadedOnRequest()` and emit its link once through the panel's `STYLES_AFTER` hook using the registered style URL. Ordinary panel assets appear before the base theme in this version, so registration alone does not guarantee override order. Console panel registration supports asset publishing; verify the published output during image build. Scope rules under `body.fi-panel-admin` and use explicit brand component classes for custom views. Do not modify vendor files or global Filament styles used by other surfaces. Test menus/modals teleported under the panel body as well as ordinary page content.

Use content-versioned asset URLs/filenames: nginx marks these assets immutable for one year, so Filament's package version alone is not a safe invalidation key for repeatedly edited application CSS. Do not weaken caching globally. Asset tests must request actual published CSS/fonts from the API origin; page HTTP 200 is insufficient.

Self-host Geist/display fonts using the already-installed Fontsource assets and retained license files. Package them into the supported Filament font namespace with a small explicit build/publish step. Explicitly select `LocalFontProvider::class` with the Geist family: a custom family otherwise defaults to the external Bunny provider. The registered Font asset emits its stylesheet, so omit a provider URL to avoid loading the same stylesheet twice. Content-version both font CSS and its referenced WOFF2 paths under the immutable cache policy. No external font dependency or new API npm install is needed for the preferred approach. A full `viteTheme()` pipeline is a fallback only if additive styling proves insufficient, requiring a separately reviewed manifest/build/static-delivery change.

Use native self-contained SVG/Blade art partials for production character scenes. This avoids inventing a new image-hosting route and matches current vector art. Do not attempt to import React artwork into Blade or load the entire landing illustration bundle. Avoid shared fixed SVG IDs; repeated header/sidebar renderings must not collide. Register page/header hooks only for known admin page/resource classes; derive the scene from current rendered page context, not last-clicked state or request-path guesses during `/livewire/update`.

### Suggested file ownership

| Task | Ownership | Exit gate |
| --- | --- | --- |
| S1. Capture authenticated baseline and freeze selected styling/placement/art brief | Coordinator; this plan and owned design references | Real admin screenshots after normal sign-in/MFA; preserve roles/data |
| S2. Tokens/theme/asset packaging | Proposed `api/resources/css/filament/admin-workspace.css`; AdminPanelProvider branding/assets/font configuration; bounded font packaging/build changes | Published CSS/font requests succeed with correct MIME/cache version; no new API build assumed |
| S3. Character family and scene mapping | Proposed `api/resources/views/filament/admin/` presentation partials and a small admin-scene mapping class | Seven distinct reviewed scenes; correct mapping, no permission-derived data, decorative fallback |
| S4. Resource/page presentation integration | Existing admin pages/widgets/custom Blade content only where explicit theme classes are needed | Lists/details/modals retain current content/actions; no broad resource rewrite |
| S5. Responsive/dark/a11y/functional verification | Admin feature/browser tests and owned screenshot artifacts | Light/dark, collapsed/mobile rail, focus, tables, modal/media/document boundaries, roles and loaded assets |
| S6. Independent integration review | Explorer plus coordinator | Reconcile complete diff against current styling, art brief and behavior; repair before acceptance |

S2 owns provider/build files; S3 coordinates hook registration through that owner. S4 waits for token/classes and scene contracts before integration. Do not have multiple agents edit AdminPanelProvider or the same resource concurrently. The user selected Option A and subsequently authorized implementation of this plan, including the seven original scenes. That authorization satisfies the earlier design-direction approval checkpoint.

## 5. Scope and behavior boundaries

Preserve `/control-panel`, shared login, MFA enrollment/challenge/recovery, persistent Livewire middleware, actor authorization, resource query scopes, role visibility and every action's meaning. Audit log remains super_admin-only. Preserve document private storage/download signatures, escaped applicant text, report context, published/draft distinctions, native media controls and code/preformatted transcript readability. Character art is not an authorization source or a status signal.

The panel theme does not automatically style Horizon, the SPA, native PDF downloads or standalone 403/suspension views. Their branding can be a separate small follow-up; do not silently redesign them, introduce another admin login, or weaken safeguards to obtain design screenshots. Do not add fake dashboard metrics, change moderation decisions, seed user data, or run destructive actions for visual validation.

## 6. Acceptance and later validation

- Compare authenticated screenshots for Dashboard, Coach applications list/review, Users list/detail, Connections, Audit log, Reports and Speeches. Capture normal and long/empty/loading/error states, filters/pagination and an ordinary read-only modal. Use admin and super_admin fixtures to verify navigation scope.
- Capture 320, 375, 768, 1024 and 1440px widths, short desktop height, collapsed rail, mobile overlay, 200%/400% reflow, light/dark/system, reduced motion and forced colors. Do not force Filament's breakpoint to match the SPA's; verify its actual behavior.
- Check functional text contrast ≥4.5:1 and meaningful control/focus boundaries ≥3:1 in rendered states. Verify focus order, labels, selected navigation, error/disabled/loading states, table overflow and portal menus/dialogs. Decorations must not cover controls or consume essential table width.
- Verify every actual CSS/font request, missing-asset fallback and versioned cache behavior in the built nginx/API path. No external asset requests should be required for production art/fonts. Measure final payloads; avoid loading all seven large scenes on every page.
- Existing backend checks include `DashboardPageTest`, `UserSurfaceTest`, `ReportSurfaceTest`, `AdminMediaReviewTest`, `CoachApplicationReviewPageTest`, `PanelModerationTest` and `MfaStepUpTest` under `api/tests/Feature/Admin`. Extend relevant presentation/asset checks, then run Pint/PHPStan and the affected/full backend suites as appropriate after implementation authorization.
- [admin-panel.spec.ts](web/tests/admin-panel.spec.ts) and [panel-auth.ts](web/tests/panel-auth.ts) provide existing shared-login/MFA browser paths. Inspect their fixture/setup side effects before execution; use isolated accounts/data for screenshots and retain traces. Do not run development seeding/reset helpers for this plan.
- Theme correctness requires visual inspection, not just unit tests or a page status code. Record what was actually rendered/tested; authentication-blocked/source-only findings remain explicitly marked.

## 7. Original planning record (superseded by section 9)

Completed: two explorer reports reconciled; main-site live appearance inspected; admin source/navigation/theme pipeline reviewed; user selected A Backstage notebook; interactive comparison with seven original character sketches created. Its A/B/C and page/placement controls were exercised in the browser, and layouts were inspected at 1024, 736 and 360px. The preview root had no horizontal overflow at those widths; narrow tables keep their own overflow container. These checks apply to the concept preview, not the authenticated Filament implementation. At that point no production styling/assets had changed.

Still open: authenticated admin baseline, final character identities/acting, header-versus-sidebar placement preference, and rendered dark-mode/contrast approval. Recommendation is seven original human crew members with compact header cameos first, retaining a sidebar option when space/context support it. The later user instruction authorized implementation; section 9 records the selected baseline and remaining validation.

## 8. Independent review and corrections

A separate explorer checked the plan against current source and the preview. It confirmed the navigation/role map, current notebook tokens, installed hook/body scope support, console asset publishing, deployment static paths and the source-versus-rendered review boundary. The main agent incorporated its handoff corrections:

- Publish the additive CSS as a registered `loadedOnRequest()` asset and emit its link through `STYLES_AFTER`; ordinary panel registration occurs before the base theme.
- Explicitly select LocalFontProvider. Register the font stylesheet once through Filament’s Font asset, with content-versioned WOFF2 files and stylesheet directory; omit a duplicate provider URL.
- Start the comparison in Header placement to match the recommended initial implementation; preserve Sidebar as an interactive alternative.
- Align preview branding with the main site, use Member rather than an invented Student role, and show live/removed speech state rather than implying public/private speech grants.

The comparison deliberately depicts a super_admin so Audit log is visible; that is a mockup context, not a change to access rules. The reviewer reported no blocking design inconsistency after these corrections. At that planning checkpoint authenticated screenshots, styling implementation, measured contrast and application validation were still future work; section 9 records subsequent progress.


## 9. Implementation and independent review — 2026-10-29

The user authorized explorer-led implementation. The implementation explorer split ownership into theme/assets/provider, scene mapping/Blade artwork, and regression coverage. Three workers completed those segments. Separate explorers then reviewed asset/deployment/CSS contracts and context/accessibility/security/test contracts against this plan and the existing application. Compact header cameos are the implemented placement; the preview’s sidebar placement remains a design alternative.

Implemented: panel-scoped warm notebook CSS; explicit teal primary palette and burgundy navigation; retained native light/dark/system behavior; self-hosted Geist and Luckiest Guy with licenses; content-fingerprinted assets published by the existing `filament:assets` and nginx pipeline; seven allowlisted, decorative SVG scenes resolved by current Filament page scope, including compact account/application detail context. Detail names retain functional Geist typography. Resource actions, authorization, MFA, middleware and media/document views were not changed. Generated Filament public assets are narrowly ignored rather than committed.

Independent review repairs: replaced hue-generated turquoise with explicit teal shades; strengthened inactive enabled form-control boundaries while retaining error/focus behavior; removed duplicate font stylesheet delivery; handled failed asset hashing; strengthened browser assertions for actual theme state, detail typography and Livewire scene continuity. Asset reviewer measured source palette contrast: primary text 6.33:1, hover 4.73:1; inactive input boundaries 4.19:1 light and 5.53:1 dark; checked dark checkbox boundary 3.32:1. These are calculated palette values, not a claim that every rendered state has been measured.

Validation: full backend suite **1,367 passed / 35 skipped**, 7,173 assertions (1,402 collected); PHPStan **zero errors**; Pint and `git diff --check` passed; frontend production build passed (existing large-bundle warning); browser-spec TypeScript, ESLint and test collection passed. The first full backend attempt hit the host’s 128MB limit, then sandboxed ClamAV socket cases failed; rerunning with 1GB and local socket access passed. The existing admin-specific suite passed 243 cases. The new scene/style cases are included in the full suite.

Static delivery was exercised with an isolated nginx server using the repository’s exact static location block and read-only published output: current CSS, font stylesheet and all three WOFF2 files returned HTTP 200, byte-identical content, expected CSS/font MIME types and one-year immutable cache headers. CSS publication succeeded inside the runtime image; Docker/nginx copy-path compatibility was independently reviewed. No rebuilt production image or live deployment is claimed.

**Remaining acceptance:** authenticated rendered dashboard/resource/detail/modal checks, responsive/dark/system/forced-colors screenshots, visual overlap/reflow and browser-spec execution remain unverified. The isolated browser reached the normal MFA challenge, but button/menu actions did not reach the server despite valid script responses. A second source explorer found no changed production authentication code explaining that symptom. No MFA bypass was used and this limitation must not be reported as completed visual acceptance. A separate temporary container (`speechcoach-admin-style-review-20261029`, localhost:8097) uses its own fresh SQLite database and seeded fixtures; the existing development stack and its data remain untouched. Browser login used the real Fortify endpoint and the normal MFA challenge, without a bypass. The dedicated standard E2E harness was not started because the development services occupy its fixed ports.

Temporary validation containers were stopped after checks; their isolated data was retained for diagnosis. No development services, user accounts or existing database records were modified. Nothing was staged or committed.
