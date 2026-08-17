# Step 08 retrospective — The essay

**Executed:** 2026-08-16/17 · **Against:** [STEP-08-essay.md](STEP-08-essay.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §6.6 (the essay), §7.3 (access rules), §10.2 (optimistic locking)
**Method:** a two-subagent readiness review first (backend + frontend, in parallel, plus direct library-licensing research), written into a frozen contract, then two parallel background build agents (backend, frontend) implementing against it, then a manual reconciliation-audit pass by the orchestrating session. Both build agents died once mid-way on an account-wide session limit after only completing their dependency installs, and were relaunched cleanly from that point with no rework.

---

## What was accomplished

**`api/` — the essay backend**, added beside Step 07's annotation-writing stack:
- Migration `2026_08_16_100001_add_essay_columns_to_reviews_table.php` — six columns on `reviews`: `essay_html`/`essay_text` (mediumText, nullable), `essay_published_at`/`essay_updated_at` (timestamp, nullable), `essay_words` (unsignedInteger, default 0), `essay_lock_version` (unsignedInteger, default 0) — a plain `ADD COLUMN` migration, no driver branching needed since no `CHECK` constraint is involved.
- `App\Services\EssayHtmlSanitizer` — the single sanitization boundary via `symfony/html-sanitizer`, allowlisting `p, br, strong, em, u, s, h2, h3, blockquote, ul, ol, li, code, pre, a[href]`, restricting `a[href]` to `http`/`https`/`mailto`, forcing `rel="noopener noreferrer nofollow"` on every link on output regardless of input. Applied on write **and** on read (R14's defense in depth) — `EssayResource` is the only place `essay_html` is allowed to reach a JSON response, and it re-sanitizes on every read.
- `App\Services\EssayService` — `update()` (lockForUpdate + optimistic-lock against `essay_lock_version`, derives `essay_text`/`essay_words` on write) and `publish()` (idempotent, 422 on a blank essay).
- `App\Exceptions\EssayConflictException` — 409 body `{message, conflictSource: 'self', current: EssayResource}`, copied field-for-field from `AnnotationConflictException`.
- `App\Http\Resources\EssayResource` — bare resource (no envelope inside it; the controller wraps it in `{essay: ...}`, matching `AnnotationResource`'s convention).
- `App\Services\Essay\EssayRenderer` interface + `NullEssayRenderer`, bound in `AppServiceProvider::register()` mirroring the existing `TranscoderContract`→`FakeTranscoder`/`FfmpegTranscoder` shape — throws `RuntimeException` (no `NotImplemented` class existed in this codebase to reuse).
- `App\Http\Controllers\Api\EssayController` — `show`/`update`/`publish`, all deriving the caller's own review server-side from `(speech, $request->user())` on writes (never a client-supplied `review_id`, same security property `AnnotationController` already documents), `readAnnotations` reused unmodified for the review-level read gate, with a row-level publish-mask (only `essay_html`/`essay_text`) applied on an in-memory clone in `show()` — the loaded model is never mutated.
- New Gate abilities `essay.update`/`essay.publish`, both delegating to the existing `GrantsReviewWriteAccess::reviewerOwnsActiveReview` trait, and both added to `Gate::before`'s `$mustFallThrough` list — the exact bug class flagged in the 2026-08-16 readiness review (skipping this would let an admin silently bypass their own write denial).
- Routes: `GET/PUT /api/speeches/{speech}/essay`, `POST /api/speeches/{speech}/essay/publish`.
- `tests/Feature/Essay/EssayHttpTest.php` — 7 tests, one per STEP-08 acceptance-list item (see "Acceptance list, verified" below).

**`web/` — the essay editor**, added beside Step 07's annotation composer:
- `useEssayEditor` (`web/src/hooks/useEssayEditor.ts`) — the same `AutosaveState` union and debounce → flush → pagehide-beacon shape as `useAnnotationEditor`, minus the pieces that don't apply to a single-writer-per-review essay (no tmp-id/create branch, no cross-tab `BroadcastChannel` sync, no second-write-path resync).
- `web/src/components/essay/EssayToolbar.tsx` + `EssayEditorPanel.tsx` (TipTap `StarterKit`-only editor, `data-testid="essay-autosave-state"` distinct from annotations' own `data-testid="autosave-state"`, inline `role="alert"` conflict banner with `keepMine`/`useTheirs`/`toggleShowBoth`, publish button, unsaved-changes `AlertDialog`) and `EssayReadOnlyPanel.tsx` (the speaker's read-only view, with an honest "hasn't published an essay yet" empty state).
- `web/src/components/ui/tabs.tsx` — a new wrapper around `@base-ui/react`'s previously-unused `Tabs` primitive, following how `card.tsx`/`button.tsx` already wrap other Base UI primitives.
- `web/src/features/essay/essayApi.ts` — a new RTK Query slice, own `tagTypes: ['Essay']`, following `annotationApi.ts`/`reviewApi.ts`'s conventions.
- `web/src/routes/SpeechWatch.tsx` — the `Notes | Essay` tab strip, wrapping the existing `AnnotationComposerPanel` ("Notes") and the new essay editor ("Essay") for reviewers, and the equivalent read-only tabs for the speaker's track-selector view.
- **`web/src/App.tsx` migrated from `<BrowserRouter>`/`<Routes>` to a data router** (`createBrowserRouter`/`RouterProvider`/`createRoutesFromElements`, with a new `RootLayout` hosting `UnauthenticatedRedirect`) — `useBlocker` (needed for the contract's unsaved-changes guard) throws under a declarative router. Verified by direct diff read to be a faithful 1:1 translation of the existing route tree (same guards, same nesting, same paths); `web/src/test/renderWithProviders.tsx` updated to `createMemoryRouter` for the same reason, and no other `BrowserRouter`/`<Routes>` usage was left orphaned anywhere in `src`.
- New deps: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` (all confirmed MIT, StarterKit alone covers the full formatting allowlist — bold, italic, headings, blockquote, lists, links — with no Pro-tier extension needed, resolving R15).

**Acceptance list, verified against real code and real test runs, not asserted:**

| STEP-08's acceptance item | Verified by |
|---|---|
| Reviewer writes an essay, navigates away and is warned, returns to find the draft intact | Backend: `EssayHttpTest` "lets a reviewer write an essay draft that persists across requests." Frontend: `EssayEditorPanel.test.tsx` "blocks in-app navigation while dirty" (asserts the real `essay-unsaved-changes-dialog` appears) — draft persistence past a literal close-and-reopen was not walked in a live browser (see "not verified," below). |
| Speaker cannot see it until published | `EssayHttpTest::'hides essay_html from the speaker until the essay is published'` — direct API assertion, not just a UI gate. |
| A second reviewer on the same speech cannot read it by any route | `EssayHttpTest::'refuses a second reviewer...any read'` — read directly for bidden (`assertForbidden`), and confirmed a write attempt against the same route touches only the attacker's own (empty) review, never reviewer A's essay. |
| Stored-XSS payload neutralized on write and (if bypassed) on read | `EssayHttpTest::'neutralizes a stored-XSS payload on read...'` — writes `<script>`, `onerror=`, `javascript:`, and `<img>` directly to the DB column (bypassing the write-time sanitizer entirely), then asserts the read endpoint strips all four while preserving the legitimate `<p>Hello</p>`. Read personally to confirm this is a real payload and a real assertion, not a placebo test. |
| `clearAnnotations` does not clear the essay | `EssayHttpTest::'leaves essay columns untouched...'`. |
| A 30,000-word essay round-trips without truncation | `EssayHttpTest::'round-trips a 30,000-word essay...'` — this one caught a real bug (see "Difficulties," below). |

All 7 backend tests exist with names matching every acceptance-list item one-to-one; none were skipped or left as a TODO.

**Fresh, re-run verification (not carried over from either build agent's self-report):**
- Backend: `php artisan test` → **174/174 passed**, 1192 assertions. `phpstan analyse` (level 5, `--memory-limit=1G`) → **0 errors**. `pint --test` → **passed**.
- Frontend: `vitest run` → **29/29 test files, 156/156 tests passed** (one run flagged a stray "1 error" attributed to `useAnnotationEditor.test.tsx`, a pre-existing unrelated file; a clean rerun showed no error at all — not reproducible, treated as a fake-timer flake rather than a real regression). `tsc -b --noEmit` → clean. `eslint .` → clean except one pre-existing unrelated warning in `SpeechCreate.tsx`. `npm run build` → succeeds.

---

## Difficulties encountered

1. **Both build agents died mid-implementation on an account-wide session limit** ("You've hit your session limit · resets 12am America/Los_Angeles"), having completed only their dependency installs (`composer require symfony/html-sanitizer`; `npm install @tiptap/react @tiptap/pm @tiptap/starter-kit`). `git diff` on `composer.json`/`package.json` confirmed exactly what had landed before relaunching both agents fresh, telling them explicitly not to redo the install step — no wasted work, no divergence.
2. **The reconciliation audit caught one real cross-agent contract bug**, continuing this project's pattern from Step 05 and Step 07 (each had exactly one): `EssayController::show/update/publish` all wrap their success response in `{essay: EssayResource}` — the same envelope convention `AnnotationController` already uses — but `essayApi.ts`'s three RTK Query endpoints were typed and consumed as a bare `Essay` with no `transformResponse`, so `updated.essay_lock_version` would have been `undefined` against the real backend. Worth naming precisely: the frontend agent's own report had flagged the matching risk **for the request body** ("guessed `{html, lock_version}` — flag for reconciliation," which turned out correct, confirmed field-for-field against `UpdateEssayRequest`), but missed the *response* envelope, and its own test mocks returned the un-enveloped shape — which is exactly why 156/156 tests passed despite the bug being live. Fixed by adding `transformResponse` to all three endpoints (matching `annotationApi.ts`'s existing convention) and correcting the now-stale test mocks in three files to wrap success bodies in `{essay: ...}`, leaving 409/410 error bodies unenveloped (matching the real, unwrapped `EssayConflictException::render` shape).
3. **Symfony's `HtmlSanitizerConfig` defaults `maxInputLength` to 20,000 *characters***, which silently truncated the required 30,000-word round-trip test — found by the backend build agent running its own test, not anticipated by the frozen contract's prose. Fixed with `withMaxInputLength(8_000_000)`.

## Mistakes made

- **The response-envelope mismatch (difficulty #2, above) is the standing lesson to carry forward**: mocked-response frontend tests can mask a real backend contract mismatch that a live call would not, specifically when a frozen contract states one side's exact shape (the request body, here) but leaves the response envelope only implicit by analogy ("mirrors `AnnotationResource`'s convention"). The fix going forward, already applied here: a reconciliation pass must read the *actual* controller/response code on both sides side-by-side, not just diff each side's stated assumptions against the contract document — the contract itself can be silently underspecified in exactly the direction neither build agent happens to guess wrong.
- No other rediscovered mistake this step — the frozen-contract method continues to convert what used to be genuine cross-agent guessing (STEP-06's guessed notification-bell contract) into a single, named, auditable seam per step.

## Package/tooling surprises

- **`symfony/html-sanitizer`'s default input-length cap** (difficulty #3) — not a licensing or maintenance surprise (both were verified against upstream before adoption: MIT, v8.1.1, actively maintained as of 2026-07), but a default-config trap the plan's prose didn't anticipate.
- **`@tiptap/starter-kit` v3.30.1 already bundles everything STEP-08 needs** — Bold, Italic, Heading, Blockquote, BulletList, OrderedList, ListItem, Link, Code, Strike, Underline — confirmed against the installed package, not just the plan's reasoning. No extension configuration was needed to *restrict* formatting to the allowlist; the backend sanitizer is the actual security boundary, the editor's own toolbar is UX only.
- **`useBlocker` requires a data router**, not the declarative `<BrowserRouter>`/`<Routes>` this app had used through every prior step — not anticipated by STEP-08-essay.md's own prose (which additionally misnames the installed router version, see below), and not something a smaller-scoped implementation could have worked around; the migration was real, necessary, and (per the direct diff review above) correctly scoped to a mechanical translation.

## What was not verified — and cannot be, from here

Same category every prior step has flagged, for the same reason — no GUI browser is available from this session:

- **No Playwright/real-browser coverage of the TipTap editor exists.** `EssayEditorPanel.test.tsx` mocks `@tiptap/react` entirely (a fake `useEditor`/`EditorContent`) specifically to keep unit tests focused on this codebase's own autosave/conflict/blocker logic rather than fighting ProseMirror's DOM/selection assumptions under jsdom. The demo script's actual click-path — type into a real contenteditable, click toolbar buttons, watch the autosave word change, trigger and dismiss the real navigation dialog — has not been walked by anything other than a human. This is the same gap STEP-06/STEP-07 left open for the annotation composer, now also open for the essay editor; **CP-08 (below) exists specifically to close it.**
- **"Come back tomorrow, draft intact" was verified at the data layer** (the backend's persistence test proves the mechanism: essay content lands in the database on every autosave PUT, independent of client-side state), not at the literal 24-hour boundary or across a real browser close/reopen — the same distinction STEP-01's retrospective drew about onboarding resumability.
- **`git diff --stat`'s 925 insertions / 104 deletions across 16 files is what's in the working tree**, not what's committed — nothing from this step has been committed yet (per the user's own explicit choice not to ask for it during this session; STEP-01's retrospective flagged the identical situation).

---

## Next step

**STEPS.md's table lists Step 09 (Captions) immediately after Step 08, but the real dependency graph (§12.3 of MODERNIZATION_PLAN.md, confirmed by direct read: `S4 --> S9`) means Step 09 depends on Step 04, which remains deliberately unbuilt/skipped in this project** (per the 2026-08-08 Step 04 readiness review — no `ffmpeg-worker`, no HEVC transcode, no poster pipeline exist yet). Step 09 is therefore **not** actually buildable next despite its table position.

**Per the same dependency graph, [Step 11 — Privacy and erasure](STEP-11-privacy-erasure.md) is the step that's genuinely unblocked next** (`S7 --> S11`, and Step 07 is built and passing) — this matches STEP-08-essay.md's own header line ("**Unblocks:** [11](STEP-11-privacy-erasure.md)"), which names S11 explicitly rather than S09.

Before calling Step 08 *fully* finished (not blocking the start of Step 11, per the same "a step can be safe to start without every gap closed" principle STEP-01's retrospective used):
1. A human should open the SPA in a real browser and walk STEP-08's literal demo script — write a few hundred words with the real TipTap toolbar, navigate away and confirm the real warning dialog, come back and confirm the draft, publish, and check the speaker's view — the one thing no test suite here substitutes for.
2. Commit Step 08's changes (nothing has been committed yet).
3. Correct STEP-08-essay.md's own prose, which says "React Router 8 blockers" — the repo is on React Router 7.18.2, and the feature was correctly built against the real installed version, but the step file's text itself was never fixed.

## Next CP checkpoint

Per [LEARNING-TRACK.md](LEARNING-TRACK.md), **[CP-08 — testing a rich-text editor](CP-08-testing-rich-text.md)** (Playwright, ~3h) is next, immediately after Step 08 and explicitly optional — Step 09 (or, per the corrected dependency above, Step 11) does not depend on it. It has no existing build-plan/status doc yet (unlike CP-02's `CP-02-BUILD-PLAN.md`), so nothing about it is started; it is placed here specifically because Step 08 just produced the real rich-text component CP-08 would test against, per LEARNING-TRACK.md's own framing — and closing it is exactly what would resolve this retrospective's biggest open gap (no real-browser TipTap coverage).
