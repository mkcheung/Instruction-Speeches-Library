# Step 06 retrospective — Watch the commentary

**Executed:** 2026-08-12 · **Against:** [STEP-06-watch-commentary.md](STEP-06-watch-commentary.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §5.4 / §6.3 / §7.3 / §8 / §12 S6
**Method:** two parallel background subagents (backend, frontend) building from a frozen written contract, followed by a dedicated read-only reconciliation-audit subagent, followed by a manual fix pass on its confirmed findings, then re-validation.

---

## What was accomplished

**`api/`:**
- `database/migrations/2026_08_12_100001_create_annotations_table.php` — driver-branched raw SQL matching the `speeches`/`speech_assets`/`reviews` precedent (needed because SQLite's Blueprint has no CHECK-constraint equivalent). `review_id NOT NULL` FK cascade, `client_uuid`, `body`, `start_seconds NUMERIC(10,3)`, `duration_seconds NUMERIC(6,3) DEFAULT 6.000`, `kind` CHECK'd to `praise|correction|observation`, `topic`, `published_at` (null = draft), `lock_version`, soft delete. CHECK `start_seconds >= 0 AND duration_seconds > 0 AND duration_seconds <= 120`. Indexes `(review_id, start_seconds)` and `(review_id, published_at)`, both leading with `review_id` as §6.3 requires. Partial unique index `uq_annotations_review_client_uuid ON (review_id, client_uuid) WHERE deleted_at IS NULL`.
- `app/Models/Annotation.php` — soft deletes, `decimal:3` casts, `scopeVisibleTo($user, $review)` (row-level filter).
- `app/Policies/AnnotationPolicy.php::readAnnotations` — reproduces §7.3's worked example including its three explicit corrections: a revoked author gets `false` (not a lingering `true`), the speaker branch checks `status === 'published'` only and never reads `revoked_at`, and `published_annotations_count` (a counter cache) is never used as an authorization input. Admin gets unconditional `true` plus a defensive `assert()` that no admin ever also holds a `reviewer_id` on that speech.
- `app/Services/AnnotationService.php` — the repository-layer wrapper §8.5 requires (`Annotation::visibleTo($user)` must not be a controller's responsibility); the only caller of the scope, applies `ORDER BY start_seconds, id`.
- `app/Http/Controllers/Api/AnnotationController.php` + `Http/Requests/Annotation/ListAnnotationsRequest.php` + `Http/Resources/AnnotationResource.php` — `GET /api/speeches/{speech}/annotations?review_id=` (confirmed registered: `php artisan route:list --path=annotations` → `api.speeches.annotations.index`). 404 if the review doesn't belong to the speech, 422 if `review_id` missing, 403 via policy gate, `id` cast to string, decimal columns cast to float (the classic Laravel decimal-casts-as-string trap was caught and worked around).
- `app/Console/Commands/SeedAnnotationsCommand.php` — `annotations:seed {review}`, three published fixture rows at 0:14 (6s), 1:02 (8s), 1:04 (7s) — the last two deliberately overlap (62+8=70 > 64). Idempotent via a deterministic UUIDv5 `client_uuid` per (review, slot), so re-running doesn't duplicate rows.
- `tests/Feature/Annotation/AnnotationEndpointTest.php` — read directly, confirmed to actually do what it claims: a published row plus a draft created strictly *after* publication, asserting the draft's body and id are both absent from the speaker's response (`AnnotationEndpointTest.php:26-59`); a revoked-author-tombstone case; wrong-speech-review → 404; missing `review_id` → 422.

**`web/`:**
- `src/lib/engine.ts` — `normalize`/`computeActive`/`timingSignature`, the single source of truth both the reconciler and cue-builder use. `src/lib/engine.test.ts` read directly and confirmed to cover every category the acceptance list names: exact-boundary inclusion/exclusion, mid-overlap, before-any-cue, after-all-cues, NaN start, NaN `t`, negative start (clamped), zero duration (defaults to 6s), empty list, full overlap, and four explicit microsecond-precision cases (`10 ± 0.000001`).
- `src/hooks/useTimedAnnotations.ts` — three drivers (`texttrack`/`rvfc`/`timeupdate`) behind one signature, default `rvfc` with a code comment citing SPIKE-RESULTS.md's actual measured numbers (rvfc ~11.5ms Chrome / ~23.4ms Safari, vs. texttrack's ~5.8ms/~118.8ms WebKit split and timeupdate's ~69/~118ms) as the justification for overriding the plan's provisional "texttrack" placeholder. `WeakMap`-cached metadata `TextTrack` per `<video>`, incremental cue diffing (mutates existing `VTTCue.startTime`/`endTime` rather than recreating), `try/catch` around every `new VTTCue`, always-on 250ms reconciler while playing, set-equality bail, and listens to `seeked, seeking, loadedmetadata, ratechange, play, pause, ended, emptied` for scrub correctness.
- `src/components/annotation/OverlayStack.tsx` — read directly and confirmed: every node in the render window stays mounted, `data-visible` toggles the CSS fade, the 3-simultaneous cap is applied here (not in `computeActive`) with a `(start_seconds, id)` stable tie-break dropping the oldest-started on overflow, `useDeferredRemoval` keeps exiting nodes mounted as ghosts through the 650ms transition, render window is `[t−12s, t+12s] ∪ visible ∪ ghosts`.
- `src/components/annotation/Transcript.tsx` — `<ol>`, `aria-current`, click-to-seek, auto-scroll suppression.
- `src/hooks/useIosFullscreenSubtitles.ts` — `webkitbeginfullscreen`/`webkitendfullscreen` listeners driving a client-built `kind="subtitles"` track from the same annotation JSON.
- `src/components/annotation/captionsAnchor.ts` — the "anchor overlay to top when captions showing" logic, confirmed to have exactly one reference project-wide (a comment in `OverlayStack.tsx` noting nobody calls it yet) — coded but genuinely inert until Step 09, with the required explanatory comment so it doesn't read as dead code.
- `src/hooks/useCommentaryTrack.ts` + `src/routes/SpeechWatch.tsx` + `src/components/review/TrackSelector.tsx` — wires the radiogroup (including "No commentary"), the cross-fade on track switch (suppress → swap after 650ms → fade in), hover-prefetch, and an explicit error state on 403/404 rather than a silent "No commentary" fallback.
- `src/features/annotation/{types,annotationApi}.ts` — RTK Query slice calling the confirmed real endpoint.

**Demo script, walked against real output:**
1. `php artisan annotations:seed {review}` — confirmed to write 3 rows, two overlapping (62–70s and 64–71s), via direct read of the command source and its idempotency test (`SeedAnnotationsCommandTest.php`).
2–9. Not walked in a live browser this session — see "What was not verified," below. The backend contract these depend on (correct rows, correct visibility, correct ordering) is independently verified by the feature test suite; the frontend engine mechanics (fade timing, stacking, cap, scrub re-activation, cross-fade, iOS fullscreen) are built and unit-tested where jsdom allows, but the actual on-screen behavior has not been watched by a human.

**Fresh validation, run in this session (not carried over from earlier claims):**
- `php artisan test` → 111/111 passed, 864 assertions.
- `composer analyse` (phpstan/Larastan) → 0 errors.
- `composer lint` (Pint) → passed.
- `npm run build` (`tsc -b && vite build`) → succeeded (one pre-existing chunk-size warning, unrelated to this step).
- `npm run lint` → 0 errors, 1 pre-existing warning in `SpeechCreate.tsx` (React Hook Form's `watch()`, unrelated to annotations).
- `npm run test` (Vitest) → 96/96 passed, 16 files.

---

## Difficulties encountered

None that blocked the build — the two build agents each reported a clean run in isolation. The real difficulty surfaced only in the reconciliation-audit pass (see below), which is exactly why that pass exists as a distinct step in this project's working method rather than being folded into "the agents said tests pass."

## Mistakes made

**A nullable-`reviewer` mismatch shipped past both agents' own self-reports and was caught only by the dedicated seam-audit agent.** `reviews.reviewer_id` is `ON DELETE SET NULL` (a reviewer's account can be deleted independently of their reviews — see the recent "delete dependent speeches before user" work), so `AnnotationController@index` correctly emits `"reviewer": null` when that's happened. The backend agent handled this deliberately. The frontend agent, working only from the written contract (which didn't spell out nullability) and never seeing the backend's actual controller code, typed `reviewer: AnnotationsReviewer` as non-nullable and wrote `fetched?.reviewer.name` — an unguarded property access that would throw and crash the watch page for any review whose reviewer account was later deleted. Both agents' isolated test suites passed because neither one's tests constructed that specific state. Fixed: `reviewer: AnnotationsReviewer | null` in `types.ts`, `fetched?.reviewer?.name` in `useCommentaryTrack.ts`; confirmed clean on a fresh `npm run build`/`lint`/`test` afterward.

**Standing rule this reconfirms** (already recorded from Step 05, and worth restating because it repeated in a materially different form): a frozen written contract prevents *guessed* endpoints, but it does not prevent *nullability* mismatches, because a contract written before either agent sees the other's real model/migration code can't spell out every DB-level nullability consequence. The fix isn't a better contract — it's that the reconciliation-audit pass must specifically read the actual response-producing code (resource/controller) against the actual response-consuming code (frontend types), not just check that the field names match.

**A second, smaller gap** the same audit surfaced: the "scrub backwards/forwards re-activates correctly" acceptance criterion has no automated test (jsdom implements neither `requestVideoFrameCallback` nor a real `TextTrack`) and, unlike `Transcript.tsx`'s explicit comment about jsdom's `scrollIntoView` limitation, nothing said so. This wasn't a bug, but leaving an acceptance criterion silently unverified is the same failure mode in a different shape — a future reader (or a future agent) could mistake "no test exists" for "verified" rather than "needs a human." Fixed with an explicit code comment on `useTimedAnnotations.ts` naming exactly what's untested and why, and pointing at CP-06 as where it gets closed.

## Package/tooling surprises

None beyond the decimal-cast gotcha already known from prior steps (Laravel serializes `decimal:N`-cast attributes as strings by default) — the backend agent caught and handled it correctly in `AnnotationResource` without it needing to be flagged as a surprise this time.

## What was not verified — and cannot be, from here

STEP-06's own acceptance list requires a **real browser**, same limitation as Step 00:
- "Seeded annotations at three timestamps, two overlapping; each fades in on time and out after its duration, the pair stacked" — the mechanism is built and unit-tested at the pure-function and DOM-independent-component level, but nobody has watched it fade on an actual screen.
- **"Scrubbing backwards and forwards re-activates the correct cues"** — explicitly flagged (see above) as needing a real browser; jsdom cannot exercise `requestVideoFrameCallback` or `TextTrack.cuechange`.
- "Verified in Chrome and Safari, and on iOS including native fullscreen" — not done. No GUI browser is available in this environment, exactly the S0 precedent.
- The cross-fade-on-track-switch timing (650ms suppress → swap → fade in) is implemented and matches the CSS transition duration by inspection, but its actual on-screen feel is unverified.

Everything else on the acceptance list — annotation table shape/constraints, `readAnnotations` policy semantics (including all three of §7.3's named corrections), the draft-after-publish visibility rule, and `computeActive`'s exhaustive unit coverage — was independently re-derived from the actual files in this session, not carried over from either build agent's or the audit agent's self-report.

---

## Next step

Per [STEPS.md](STEPS.md)'s critical path (`00 → 01 → 03 → 05 → 06 → 07`), **[Step 07 — Write commentary](STEP-07-write-commentary.md)** is next. STEPS.md's own reordering note is explicit and worth repeating here: **"Do not parallelize 06 and 07 with a second developer — they share the overlay component and the store shape, and two people writing `useTimedAnnotations` and the composer simultaneously will produce two disagreeing normalizations."** Step 07 is safe to start now — the backend/frontend contract, engine, and policy this step produced are the exact surface Step 07's authoring UI builds on top of. The one thing worth closing before calling Step 06 *fully* done rather than *safe to build on*: a real-browser pass (Chrome, Safari, iOS native fullscreen, and the scrub-reactivation criterion) by a human, since nothing here can substitute for that.

## Next CP checkpoint

Per [LEARNING-TRACK.md](LEARNING-TRACK.md), **[CP-06 — Testing time-based UI](CP-06-testing-time-based-ui.md)** is next, before Step 07. It is optional and doesn't block Step 07 (STEP-06-watch-commentary.md says so explicitly: "This is optional. Step 07 does not depend on it — go straight on if you'd rather."), but it is unusually well-timed here specifically because this step is the one that left a named, unclosed gap (scrub-reactivation, Chrome/Safari/iOS) that only a real browser can close — CP-06's whole subject is testing exactly that category of time-based UI behavior with Playwright. No CP-06-specific build-plan/status doc exists yet in this repo (unlike CP-02), so it hasn't been started in any form.
