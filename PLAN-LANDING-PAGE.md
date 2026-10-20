# Plan: an illustrated, more fun landing page

**Status (2026-10-19):** ✅ **Option C · Curtain Up chosen and implemented** (uncommitted). See "Shipped" at the end. The three mockups remain on the canvas for reference.
**Mockups:** design canvas at https://claude.ai/artifact/MZ2RucsgLdQm4qK1f3WTTi, with artboards A · The Daily Strip, B · Opening Night and C · Curtain Up. Each mockup is a working page that reflows at phone width. The canvas holds the source markup (`project/Main.dc.html`, `project/OpeningNight.dc.html`, `project/CurtainUp.dc.html`) and is the durable copy to port from. The crowd-generator scripts were only temporary.

**The character in all three:** an original speaker, not a Peanuts character. He has a round head, a forward quiff of hair, a teal sweater (the only teal in any scene, so the eye finds him), a red bow tie and navy trousers. The drawing style borrows from classic newspaper strips. No Peanuts characters, names or signature details appear anywhere.

---

## 0. Constraints every option keeps

From reading the code, not assumed:

- **Behaviour.** `Home.tsx` keeps its redirect logic exactly as it is:
  - `useGetMeQuery()` → `getPostLoginDestination`.
  - Admins go to the panel via `window.location.replace`.
  - Everyone else signed in gets `<Navigate>` to `/dashboard` or `/onboarding`.
  - `UnauthenticatedRedirect` keeps skipping `/` (`EXACT_PUBLIC_PATHS`).
- **Copy, verbatim.** The h1, lede, privacy rule and mechanism sentence stay word for word. So do §7.9's four required messages: what the product is, the privacy rule, how the loop works, and a way in.
- **Test contract (`web/src/routes/Home.test.tsx`).** All five tests must pass unchanged:
  - exactly one `Register` link → `/register`
  - exactly one `Log in` link → `/login`
  - exactly one element matching `/fade/i`
  - exactly one element matching `/unless you.*invited/i`
  - the logged-in redirect

  Text inside SVG `<title>` and `<text>` counts toward these queries, so the art never repeats those phrases. All three mockups were checked against this.
- **CTAs** stay `Button render={<Link to=…/>}`, the codebase's only button-as-link idiom; a bare `<Link>` loses Space-key activation. Deliberately *not* `nativeButton={false}`: `Dashboard.tsx` documents that it stamps `role="button"` on the anchor, the wrong role for navigation, and it would break the tests' `getByRole('link')`. Restyle through `className`, since `cn` is twMerge.
- **Theme.** The app is light-only: `.dark` is never applied and the body is always `bg-background`. A dark landing page (Option B) is a deliberate, route-scoped departure.
- **Fonts** are self-hosted via `@fontsource/*` packages, like `@import "@fontsource-variable/geist"` at `index.css:4`. No font CDN at runtime (zero-cost / self-hosted rule).
- **SVG** is written as inline JSX, like `NotificationBell.tsx`. There is no SVG-import plugin (Vite plugins are only `react()` and `tailwindcss()`).
- **No CSP** is configured, so inline SVG and `style` attributes work.
- **Reduced motion** follows the existing precedent at `index.css` (`.annotation-overlay` rule).

## 1. Shared architecture (whichever option is picked)

```
web/src/routes/Home.tsx                     keeps the redirect logic; renders <Landing/> for logged-out visitors
web/src/components/landing/Landing.tsx      page layout, copy, CTAs (eager, small)
web/src/components/landing/landing.css      @keyframes, crowd palette classes, .eyes, reduced-motion rules
web/src/components/landing/art/Defs.tsx     shared <symbol>s: hero head, crowd heads, sweat drop, wobble filter; rendered once, aria-hidden
web/src/components/landing/art/<Scene>.tsx  one component per scene, lazy-loaded
web/src/components/landing/art/crowd.ts     crowd placement data: [symbol, paletteClass, x, y, rotate, scale][]
```

Porting steps:

1. **Pull the chosen artboard** from the canvas files.
2. **Convert markup to JSX:**
   - `class` → `className`
   - kebab-case SVG attributes → camelCase (`strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `paintOrder`, `fontFamily`)
   - `style` strings → objects
   - drop the canvas-only `{{motionClass}}` tweak; motion becomes always-on CSS, gated by reduced motion
3. **Crowds become data.** A one-off script turns the artboard's `<use>` lines into `crowd.ts`. The scene maps them to `<use href={'#' + s} className={pal} transform={…} />`.
4. **Unique ids:** `useId()` for each scene's `<title>` id and its `aria-labelledby`.
5. **Lazy-load the art.** `Home` is imported eagerly (`App.tsx:4`), so about 50KB of SVG markup would otherwise land in every visitor's main bundle.
   - Load scenes with `lazy(() => import('./art/…'))` inside `<Suspense>`.
   - The fallback is a fixed `aspect-ratio` box, so there's no layout shift.
   - Signed-in visitors never download the art, because `Home` returns `<Navigate>` first.
6. **Fonts:**
   - Add only the needed weights as `@import "@fontsource/<family>/<weight>.css"` lines after `index.css:4`.
   - Expose them as `@theme` tokens (e.g. `--font-comic`).
   - Font files only download on pages that use the family.
7. **Motion:**
   - The jitter is `.14s linear` × 25 iterations (3.5s total), so it stops on its own within 5 seconds (WCAG 2.2.2).
   - It replays on hover via a second keyframe name.
   - It's `animation: none` under `prefers-reduced-motion`. The static shake lines and sweat drops keep the meaning.
8. **Tab title.** Fix `web/index.html`'s `<title>web</title>` → `Instruction Speeches Library`.

Tests and checks:

- `Home.test.tsx`: unchanged, must pass. Add two tests:
  - each scene exposes `role="img"` with an accessible name
  - the privacy sentence appears exactly once (`getAllByText(…)` length 1)
- `web/tests/accessibility.spec.ts`: add a fourth test that visits `/` logged out, waits for the h1, and calls the existing `scanAndAssert(page, 'landing')`. The axe gate covers only signed-in screens today. This file is already in CI's spec list, so no workflow change is needed.
- Before calling it done:
  - `npx tsc -b`, `npx eslint .`, `npx vitest run`
  - the accessibility spec
  - Playwright screenshots at 1440 and 390 wide (the same check run on the mockups, which caught five layout defects)

Rollback: one route file plus one new folder; no API or database changes. Reverting means restoring `Home.tsx` and deleting `components/landing/`.

---

## 2. Option A — The Daily Strip (recommended)

A newspaper comics page:
1. knees knocking at a near-empty house
2. uploading and inviting exactly three reviewers
3. the three watching playback with notes pinned at "0:42"
4. the speaker cheering from the middle of a packed house of 277, the three reviewers in the front row, the shout balloon bursting out of the frame

The buttons sit right under panel 4; the privacy rule is a boxed "Notice".

- **Components:**
  - `Masthead`: the h1 between double rules, plus a dateline.
  - `Strip`: `grid-cols-2`, `lg:grid-cols-4`.
  - `StripPanel`: figure plus caption box, with `@container` so caption and balloon text scale.
  - The four panels: `PanelNerves`, `PanelInvite`, `PanelPlayback`, `PanelPacked`.
  - `ShoutBurst`.
  - `CtaRow`: `col-span-full justify-center`, `lg:col-start-3 lg:justify-end`.
  - `NoticeBox`: the privacy sentence.
  - `HowItWorks`: the lede with a `::first-letter` drop cap, then the mechanism.
- **Fonts:** `@fontsource/playfair-display` (`900.css`, h1 only) and `@fontsource/comic-neue` (`400.css`, `700.css`).
- **Palette:**

  | Role | Hex |
  |---|---|
  | page | `#F3EEE1` |
  | panels | `#FFFDF7` |
  | ink | `#1F1A17` |
  | captions | `#FFE38A` |
  | Register | `#B8321A` on white text |
  | dateline | `#5C5048` |

- **Size:** about 1,040px tall at 1440 wide. On phones the 2×2 strip puts both buttons about 600px down.
- **Effort:** small–medium, one focused session. **Risk:** low. It stays light like the rest of the app, has one animation, and two fonts.

## 3. Option B — Opening Night

A theater at night. The title is up on a lit marquee. A split stage follows: on the left, the speaker shakes alone beside a bare "ghost light"; on the right, he's on a round stage in the middle of a 178-person theater-in-the-round. Register and Log in are tickets under the happy side, the privacy rule is on a red box-office sign, and the mechanism is printed on a playbill.

- **Components:**
  - `Marquee`: the h1 plus decorative bulbs.
  - `Lede`.
  - `StageFrame`: proscenium and valance.
  - `NervousScene`: dim overlay over the art only.
  - `ConfidentScene`: crowd ringed around the platform.
  - `TicketLinks`:
    - Register is a gold ticket with an `aria-hidden` "ADMIT ONE · BY INVITATION" stub that tilts on hover/focus.
    - Log in is a dashed ticket.
    - The notches come from `::before`/`::after` circles in the page colour. No clip-path or mask on links, which would clip the focus ring.
  - `BoxOffice`: the privacy rule.
  - `Playbill`: the mechanism.
- **Fonts:** `@fontsource/bungee` (400) and `@fontsource/nunito` (400, 700), or `@fontsource-variable/nunito`.
- **Dark page, scoped to the landing route only:** wrap `Landing` in `min-h-screen bg-[#1B1F3B]` and leave the global body white. If iOS overscroll shows a white band, toggle a class on `document.documentElement` from an effect while the page is mounted.
- **Phone:** the tickets currently land about 1,040px down, just below the first screen. During the port, shrink the scenes below 768px (nervous band about 140px, bright scene about 220px) to pull the buttons up.
- **Size:** about 1,530px tall at 1440 wide.
- **Effort:** medium. **Risk:** medium: dark-route scoping, ticket CSS, and the bulb animation (must stop within 5s).

## 4. Option C — Curtain Up

A vertical show framed by red velvet curtains. The title, pitch and both buttons are all on screen one. Then three acts:
- **Act I:** the speaker shakes alone on an empty stage beside a "Closed rehearsal" sign carrying the privacy rule.
- **Act II:** the mechanism plus a timeline whose reviewer sticky notes slide in as you scroll, the way notes appear in the app.
- **Act III:** the speaker cheering in the middle of a packed, tiered house.

A footer link returns to the top.

- **Components:**
  - `CurtainFrame`: side curtains as grid columns at ≥900px; the valance always shows.
  - `TitleRibbon`: the h1, keeping `{" "}` before the `<br/>` so the accessible name stays exactly "Instruction Speeches Library".
  - `Lede`, `CtaRow`, `StageLip`.
  - `ActHeading` ×3.
  - `RehearsalScene` and `ClosedRehearsalSign`.
  - `PlaybackTimeline`: notes from a const array; timestamp pills in Space Mono.
  - `FullHouseScene`.
  - `CurtainFooter`: "↑ Back to the top" → `#top`. Its name doesn't collide with the Register/Log in tests.
- **Fonts:** `@fontsource/luckiest-guy`, `@fontsource/patrick-hand`, `@fontsource/space-mono` (400, 700). This is the heaviest font load of the three.
- **Scroll notes:** keyframes inside `@supports (animation-timeline: view())`. The page root uses `overflow-x: clip`, not `hidden`, or `view()` stops working. Browsers without support simply show the notes.
- **Size:** about 3,100px tall at 1440 wide. The buttons are on screen one at every width.
- **Effort:** large. **Risk:** medium–high: the longest page, three fonts, and scroll animation that depends on the browser.

## 5. Mixing

The parts are modular, so combinations are cheap. For example:
- A's strip with C's scroll-in sticky notes standing in for panel 3
- A with B's ticket buttons

## 6. Decisions

1. **Option C**, chosen by the user.
2. Option B's dark page no longer applies.
3. **Shake auto-plays** for 3.5s, replays once per hover, and is off under reduced motion. I chose this default; say if you'd rather it wait for hover.

---

## Shipped: Option C

Built by two agents working in parallel, each in an isolated git worktree, meeting at a fixed contract:
- the **art agent** built the five exports from `components/landing/art/`
- the **page agent** built everything around them

I merged their work as patches, after checking that each changed file still matched what the agent started from. `index.css` was the exception: it carries unrelated uncommitted work, so its 7 font lines were re-applied by hand.

**What landed:**
- `web/src/components/landing/`:
  - `Landing.tsx`, `CurtainFrame`, `TitleRibbon`, `Act`, `ClosedRehearsalSign`, `PlaybackTimeline`, `LandingFooter`
  - `landing.css`
  - `lazyArt.ts`, which memoizes one `import('./art')`. A failed chunk leaves empty frames instead of crashing `/`.
  - `art/`:
    - `SceneDefs`, `StageLip`, `RehearsalScene`, `FullHouseScene`, `NoteAvatar`
    - `crowd.ts`, with 319 entries
    - `art.css`
- `Home.tsx`:
  - redirect logic untouched
  - logged-out visitors get a lazily loaded `<Landing />`, so the page's JS and CSS stay out of the main bundle
  - the art is a second lazy chunk
- Fonts:
  - `@fontsource/luckiest-guy`, `@fontsource/patrick-hand`, `@fontsource/space-mono`, all 5.3.0
  - imported in `index.css`, with `--font-landing-*` theme tokens
- `index.html` title: "Instruction Speeches Library".
- Tests:
  - `Landing.test.tsx` (6) and `art.test.tsx` (23)
  - `Home.test.tsx`: the original 5 unchanged, plus 2 integration tests on the real art, plus an `afterEach` that waits for the lazy art
  - `accessibility.spec.ts`: a new logged-out landing scan, run under reduced motion so the sticky notes are visible to the contrast checks

**Verified against the live stack:**
- Page height is 3,110px desktop and 2,896px phone, against the mockup's 3,110 / 2,897.
- No sideways scrolling.
- All four fonts load self-hosted.
- The axe landing scan passes.
- The notes reach opacity 1 on real scroll and are static under reduced motion.
- The jitter stops by 3.5s, replays once on hover-in, and doesn't replay on hover-out.
- `tsc -b` clean; eslint 0 errors (the 1 warning was already on HEAD); vitest 551/551.

**Fixed from `/code-review`:**
1. The hover replay also fired on hover-out. Now it adds a second animation instead of swapping the name.
2. The axe scan couldn't check the scroll-hidden notes' contrast.
3. `landing.css` was in the main bundle. `Landing` is now lazy.
4. `Home.test.tsx` could finish before the lazy art settled.
5. The ribbon-tail reserve was 72px against 80px of overhang.

**Flagged, not changed:**
- **No retry after a failed art chunk.** It stays empty until a reload, because `React.lazy` caches the result. A real retry needs re-created lazy components, which is too much machinery for a rare failure on a marketing page.
- **Button colours duplicated** between `Landing.tsx` classes and `landing.css`. A maintainability refactor, not a bug.

**Note for whoever pulls this:** the lockfile changed, so restart the Vite dev server (`npm run dev`); it re-optimizes dependencies on start. A dev server left running from before the install keeps serving the old `index.css`, without the fonts.
