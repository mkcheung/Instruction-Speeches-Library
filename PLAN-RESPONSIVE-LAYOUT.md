# PLAN — Responsive Layout & Page-Width System

**Status:** ✅ Implemented and verified. Uncommitted on `development`.
**Date:** 2026-10-05
**Scope:** Frontend layout only. No API, schema, or behaviour changes.

---

## 1. Evaluation of the current design

Every authenticated route hand-rolled its own page wrapper, all variations on:

```tsx
<div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
```

Fourteen routes, four different `max-w` values, no shared rule. That produced
five distinct problems, which compound on a large window.

### P1 — Width ceilings far below the available space

| Route | Old cap | Rendered width | Usable width @1920 |
|---|---|---|---|
| `MySpeeches`, `Dashboard`, `Search`, `ReviewerDirectory`, `SpeechWatch` | `max-w-3xl` | 48rem (768px) | ~106rem |
| `SpeechCreate`, `BecomeACoach` | `max-w-xl` | 36rem (576px) | ~106rem |
| `Account` | `max-w-2xl` | 42rem | ~106rem |

An index page used **under half** the window; a form used **under a third**.

### P2 — Centred inside `<main>`, not inside the window

`mx-auto` centres within the area *after* the 14rem sidebar. The content island
therefore sat right of true centre and read as detached from the navigation it
belongs to. This — not the narrowness alone — is what made the pages feel
"awkward": a floating slab with a large void on its left, between it and the nav.

### P3 — Vertically centred forms

`SpeechCreate`, `BecomeACoach`, `ProfileEdit` and `Onboarding` used
`flex-1 … justify-center`, floating a short form in the middle of a tall
`<main>`. The upload form sat ~350px below the header with nothing above it, and
the first field moved vertically as the form grew or shrank.

### P4 — Grids that stop reflowing

`MySpeeches` was `grid-cols-1 sm:grid-cols-2` — a hard two-column ceiling. Width
beyond 768px bought nothing at all.

### P5 — Fixed chrome at every size

- Gutters pinned at `px-4` from 320px to 2560px.
- Sidebar pinned at `w-56`, and `hidden lg:flex` — so between **768px and
  1024px** (a small laptop, a landscape tablet) the nav vanished entirely into
  the avatar dropdown despite ample room for it.

---

## 2. The approach

One shared primitive instead of fourteen hand-tuned wrappers:
**`web/src/components/layout/PageShell.tsx`**, exporting `PageShell`,
`PageHeader` and `CardGrid`.

**The key decision: left-aligned, not centred.** `PageShell` has no `mx-auto`.
Content flows from the sidebar with a consistent gutter and grows into the window
up to a per-variant ceiling — the normal layout for a sidebar app, and the fix
for P2.

Width is chosen by **content type**, not by page:

| Variant | Cap | For | Why |
|---|---|---|---|
| `form` | `max-w-2xl` | Inputs, prose | A wider form helps nobody fill it in; the cap is a readable measure |
| `content` | `max-w-5xl` | Lists, detail views | Mostly text — a line length, not a container |
| `wide` | `max-w-[100rem]` | Card grids, media, tables | Genuinely uses every pixel; a no-op below ~1700px |
| `full` | none | Page manages its own width | |

Supporting rules:

- **Gutters and rhythm scale:** `px-4 py-6 → sm:px-6 sm:py-8 → lg:px-8 lg:py-10`,
  and the header matches so chrome and content share one left edge.
- **Grids reflow by available width, not by breakpoint.**
  `CardGrid` uses `repeat(auto-fill, minmax(min(100%,16rem), 1fr))`. The column
  count derives from the *container*, so it stays correct inside the sidebar
  layout at every width — including sizes between breakpoints, where a
  `sm:2 lg:3 xl:4` ladder leaves half-empty rows. `min(100%, 16rem)` rather than
  a bare `16rem` so a 320px phone collapses to one column instead of overflowing.
- **No vertical centring anywhere.** Forms anchor to the top, so the first field
  is always in the same place.
- **Sidebar from `md` (768px), not `lg`**, widening to `w-64` at `xl`.

---

## 3. Results

Measured against the same pages, logged in as `member@e2e.test`.

| Screen | Before @1920 | After @1920 |
|---|---|---|
| My speeches | 2-col ceiling in a 768px column, ~70rem empty | Fills to 100rem, auto-fill grid, action button in the header row |
| Upload a speech | 576px card floating dead-centre vertically | Top-anchored `form` measure under the header |
| Become a coach | ~230px cramped column, description wrapping to 3 lines | Comfortable measure, description on 2 lines |
| Dashboard | 768px centred island | Fills `content` width, title + action on one row |

Responsive nav contract, verified live at three widths:

```
phone  390   sidebar=hidden   user menu carries all destinations; "Edit profile" → /profile
tablet 820   sidebar=VISIBLE  (previously hidden — the 768–1024 dead zone)
laptop 1280  sidebar=VISIBLE
```

---

## 4. Files changed

**Added:** `web/src/components/layout/PageShell.tsx`

**Chrome:** `AppSidebar.tsx` (`md:flex`, `xl:w-64`), `AppHeader.tsx` (matching gutters)

**Routes converted:** `MySpeeches` (`wide` + `CardGrid` + `PageHeader`),
`Dashboard` (`content` + `PageHeader`), `SpeechCreate` ×2, `BecomeACoach` ×5,
`Account`, `Search`, `ReviewerDirectory`, `ProfileEdit`, `SpeechWatch` ×2.
`PublicProfile` got responsive gutters only — its 36.25rem feed measure is a
deliberate §6.7.4 decision and was left intact.

**Untouched:** the unauthenticated routes (`Login`, `Register`, `ForgotPassword`,
`ResetPassword`, `VerifyEmail`, `Onboarding`) still centre a narrow card on an
empty page, which is correct for those screens.

---

## 5. Test changes

`tests/app-shell.spec.ts` asserted the sidebar visible **unconditionally**, which
fails on the `mobile-webkit` project (iPhone 13, 390px) for a layout behaving
exactly as designed. CI never saw it: `ci.yml` runs this file with
`--project=chromium` only. It now asserts the real responsive contract:

- rail visible at ≥768px, hidden below;
- the two sidebar-specific tests skip below `md` with a stated reason;
- the Tab/skip-link assertions skip on touch projects, where sequential Tab
  traversal is not a real user flow;
- **a new test** pins the collapsed-nav half — that `UserMenu` carries the
  sidebar's destinations below `md` and navigating from it works.

---

## 6. Verification

`npx tsc -b` clean · `npx eslint .` **0 errors** (2 pre-existing warnings in the
untouched `SpeechCreate` React-Compiler rule) · `npx vitest run` **62 files, 339
tests passing** · `app-shell.spec.ts` green on chromium · responsive nav contract
confirmed live at 390/820/1280.

No test couples to layout classes (`grep` for `max-w-`/`grid-cols`/`mx-auto`
across `src/**/*.test.tsx` and `tests/` returns nothing), which is why a
restyle of this size moves no assertions.

**Local e2e caveat, unchanged from before this work:** `auth.setup.ts` logins and
`warmup.setup.ts` stall intermittently against the Vite dev server under host
load — the failure `auth.setup.ts`'s own docblock documents at "roughly two runs
in five". Several runs here hit it. CI serves the built bundle via
`scripts/e2e-stack.sh` and does not share this failure mode.

---

## 7. Deliberately not done

- **A mobile drawer/hamburger.** Below `md` the avatar menu already carries the
  full nav list (now tested). A drawer is a real improvement but a larger change
  than the brief, and the current path is not broken.
- **Reflowing `SpeechWatch`'s player/timeline into a side-by-side layout on wide
  screens.** Its wrapper now uses `wide`, but the internal composition is
  STEP-06/09 territory and deserves its own pass.
- **Widening `PublicProfile`'s feed.** Its measure is a deliberate design spec.
