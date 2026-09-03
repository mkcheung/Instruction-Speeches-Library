# Step 13 retrospective — The social layer

**Executed:** 2026-09-01 · **Against:** [STEP-13-social-layer.md](STEP-13-social-layer.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §12 S13 / §6.7 / §6.11
**Method:** a four-way parallel readiness review (backend/frontend/database-query-performance/cross-cutting-security) resolved into `STEP-13-FROZEN-CONTRACT.md`, two parallel build agents, an independent reconciliation audit, a manual fix pass, then a live run of the Postgres EXPLAIN verify script against a real e2e stack (not left "written but unrun"), and finally an 8-angle `/code-review` pass with its own fix pass. Verified for this retrospective by re-running every real test suite and re-reading the acceptance list against current code, not from conversation memory. This build only happened after the session's own Stop hook rejected an initial pass that completed only the readiness review — the `/goal` had asked to *execute* the plan, and "examine + review" alone didn't satisfy that.

---

## What was accomplished

**`api/` — connections, the profile timeline, and the arc chain**:
- `connections` migration (`ck_connections_*` CHECK constraints, matching this schema's full-table-name convention — corrected from the plan's own abbreviated `ck_conn_*` names), plus a second migration adding the two partial indexes `ix_reviews_timeline`/`ix_reviews_incoming` on `reviews` — the columns those indexes cover (`speech_owner_id`, `last_transition_at`) already existed since STEP-05, so this step's real schema footprint was narrower than its own bullet list implies.
- `ConnectionService` — mirrored two-row writes, lower-user-id-first locking, and the first `INSERT ... ON CONFLICT DO UPDATE` in this codebase's application code (every prior upsert used `updateOrCreate()`, exactly the SELECT-then-write race this pattern avoids) for crossed-request resolution.
- `ConnectionPolicy`, `connection.block` registered in `AppServiceProvider`'s `Gate::before` `$mustFallThrough` in the same commit as its `Gate::define` — the exact omission class that has caused real bugs at least twice before in this project (STEP-05 rev2, a STEP-12 finding).
- `ProfileTimelineController` and `SpeechArcService` — the timeline built entirely from `reviews`, never touching `connections`; the recursive-CTE arc chain (bounded depth 10) re-checks every ancestor against `Speech::visibleTo()` before exposing its content.
- `ReconcileConnectionAsymmetryCommand`, scheduled nightly (`e2e`: every minute) matching the existing three-command pattern.
- `api/tests/Feature/Speech/VisibleToSnapshotTest.php` + its `.sql` fixture — new snapshot-test infrastructure, none existed before this step.
- Filament `ConnectionResource` + a `MostConnectionsWidget` — the first Filament Widget in this codebase.
- `scripts/verify-postgres-connections-timeline-explain.sh` — genuinely run against a live e2e Postgres stack in this session (not merely written), confirmed stable across repeated runs.

**`web/` — the Facebook-style profile**:
- A new `Avatar` component (`web/src/components/ui/avatar.tsx`), extracted from `PublicProfile.tsx`'s previously-inline pattern — no reusable avatar component existed anywhere in this app before this step.
- `connectionApi.ts`, the connections rail, the timeline feed (cursor-paginated via a plain "Load more" button — no new dependency, per the zero-cost constraint), the arc strip, and three nested profile routes (`/u/:username`, `/reviews-left`, `/reviews-received`) — the first nested-tab-route pattern in this app, using real `<nav>` + `<Link>`s rather than a `role="tablist"` widget, per the plan's explicit instruction.
- `ConnectionRequestsBell.tsx`, mounted in the app header — added after the reconciliation audit found no reachable UI path existed at all for a connection-request recipient (see Mistakes).

**Final verified numbers** (re-run for this retrospective, not carried over): backend 462/464 Pest tests (2 pre-existing skips), phpstan 0 errors, Pint clean. Frontend 315/315 Vitest tests, `tsc -b` clean, ESLint 0 errors (2 pre-existing-pattern warnings, same accepted shape as `SpeechCreate.tsx`'s).

**The acceptance list, checked against real tests, not assumed:**
- ✅ `Speech::scopeVisibleTo` snapshot test passes unchanged: `VisibleToSnapshotTest.php` exists and was independently re-verified by the reconciliation audit reading `scopeVisibleTo`, `ProfileTimelineController`, `ConnectionService`, and `SpeechArcService` line-by-line for any `connections` reference in a speech/annotation-visibility path — none found.
- ✅ The same holds for the arc chain: `ProfileTimelineTest.php`'s `'embeds the arc chain per timeline item and redacts non-visible ancestors'` and `'never issues a query against connections while building the timeline'`.
- ✅ A viewer sees only speeches they personally reviewed, with only their own commentary: `ProfileTimelineTest.php`'s `'shows only speeches the viewer personally reviewed, with only their own commentary'`.
- ⚠️ Crossed connection requests resolve to `accepted` under a "concurrency test": `ConnectionServiceTest.php`'s `'resolves a crossed request to accepted on both mirrored rows'` exists and passes, but — read directly, and honestly distinct from STEP-12's `verify-postgres-last-admin-lock.sh` — it is a **sequential simulated-race test** (two calls in one process, matching `ReviewServiceTest`'s established idiom for this class of test on a sqlite-driven suite, per its own docblock), not a true multi-process concurrency test. It proves the idempotent-upsert logic is correct under the interleaving a real race would produce; it does not prove the database-level locking actually serializes two OS processes the way `verify-postgres-last-admin-lock.sh` does for the last-admin invariant.
- ✅ `EXPLAIN` on the timeline query shows no filesort/no temporary: confirmed by actually running `scripts/verify-postgres-connections-timeline-explain.sh` against a live Postgres stack in this session, stable across repeated runs. Not part of the automated Pest/CI suite (same category as STEP-09/12's Postgres-only verify scripts) — a manual, deliberate step, not something `phpstan`/`pint`/Pest would catch on their own.
- ✅ The rail's metric line is one query for the whole rail, asserted by query count: `ConnectionRailQueryCountTest.php`, strengthened during the `/code-review` pass from a substring-match check (`"group by" && "reviews"` in the query text) to a true total-count assertion (`toHaveCount(1)` on every query touching `reviews`) after the reconciliation audit found the original version wouldn't have caught a naive per-tile regression built from plain non-aggregate queries.
- ✅ Unblocking lands on `declined`, never `accepted`: `ConnectionServiceTest.php`'s `'unblock always lands on declined, never accepted'`.

---

## Difficulties encountered

1. **Two build agents independently converged on the same two gaps** — a first for this project (every prior step's cross-agent bug was found by only one side or by the reconciliation audit, never by both build agents flagging the same thing unprompted): `PublicProfileResource` had no numeric `id` (the frontend's Connect button had nothing to send on a never-before-connected profile), and `GET /api/connections` only ever returned `state='accepted'` rows, so nothing surfaced the id a recipient needs to accept an incoming request — meaning the step's own demo script ("Send someone a connection request. They accept.") had no reachable UI path for the recipient's half at all.
2. **The Postgres EXPLAIN verify script had three real bugs, all found only by actually running it** (matching STEP-12's precedent exactly): `::factory()->create()` fails in the production `app` image (no Faker installed, the identical bug the STEP-12 lock-test script hit); 50 seeded rows gave Postgres's cost estimator no reason to prefer either partial index over a sequential scan, so real EXPLAIN verification needed several thousand bulk-inserted noise rows plus an explicit `ANALYZE`; and the original assertion required one specific index (`ix_reviews_timeline`) by name, but the planner's real, stable choice for this two-column-equality query was its mirror (`ix_reviews_incoming`) — an equally correct plan, since both share the same trailing sort columns and neither needs a `Sort` node. Asserting a specific index name was overfitting to a decision the query optimizer is free to make either way.
3. **A stale, leftover `speechcoach-e2e` Docker network from a prior session's incomplete teardown blocked `docker compose up`** with a label conflict. The backend build agent hit this and correctly declined to force through it rather than risk the user's dev stack; confirming the network was genuinely unused (`docker network inspect` showing zero attached containers) before removing it resolved this cleanly in a later pass.

---

## Mistakes made

1. **The first response to this session's own `/goal` invocation stopped after the review phase only.** The goal text asked to "execute the plan... First examine... validate/review/validate" — read too literally as "review only," which the session's Stop hook correctly rejected with the reasoning "examine + review ≠ execute/build." Worth carrying forward: when an instruction names both an investigative phase and an execution phase in the same sentence, completing only the first is not satisfying the ask, even if the investigative phase was thorough and well-executed on its own terms.
2. **`ReconcileConnectionAsymmetryCommandTest.php` — through its build and reconciliation-audit passes — never exercised the mirror-image direction of the bug it was meant to guard against.** The command's missing-mirror repair only fired when the surviving row's `owner_id < peer_id`; an asymmetry where the *higher*-id row survived was silently never repaired, by design or by any scheduled run, forever. Found only by the later `/code-review` pass, not by either build agent or the reconciliation audit — a reminder that a repair command needs a test for **both** directions of the exact asymmetry it exists to fix, not just the direction that happened to get exercised first.
3. **A genuine, deliberately-left-open gap, reported rather than silently patched**: `PublicProfile.tsx`'s "already connected" detection only scans the first page (20 rows) of the viewer's own accepted-connections rail. Past 20 connections, visiting an already-connected profile can still show "Connect" instead of "Connected." The `/code-review` pass correctly declined to paper over this with a client-side workaround, since a proper fix needs a new backend lookup scoped to one peer (e.g. `GET /api/connections?peer_id=`), outside this diff's route surface — this is standing follow-up, not something this step's build resolved.

---

## Package/tooling surprises

- Postgres's real `EXPLAIN` output uses entirely different node names than MODERNIZATION_PLAN §6.7.3's MySQL-era contract text (`ref`/`eq_ref`/`Using filesort`/`Using temporary` never appear in real Postgres output) — this had to be translated into genuine Postgres plan-node assertions (`Index Scan`, absence of a `Sort` node, absence of a `Hash`/`Materialize` spill) before the verify script could mean anything, the same class of stale-MySQL-prose issue this plan document has now produced at STEP-04 and STEP-12 as well.
- `fakerphp/faker` being a `require-dev`-only dependency means `Illuminate\Foundation\helpers.php`'s `fake()` helper is conditionally undefined in every production (`--no-dev`) image this project builds — a structural fact about this codebase since Step 00 that STEP-12's lock-test script hit first and this step's EXPLAIN script hit again, independently, because neither script's author had reason to know the other had already found it.

---

## What was not verified — and cannot be, from here

- **No real-browser/Playwright verification of the profile UI** — the two-column layout, the connections rail's sticky behavior at `lg`, the arc strip's rendering, the cursor-pagination "Load more" button — same category every prior step's rich-interaction work has left open.
- **The "crossed requests resolve to accepted" acceptance criterion is proven by a sequential simulated-race test, not a true multi-process concurrency test** (see Acceptance list above) — this is consistent with this codebase's established convention for this class of test, but is a materially weaker guarantee than STEP-12's genuinely multi-process last-admin lock test, and that distinction is worth remembering rather than treating both as equivalent.
- **The `PublicProfile.tsx` 20-row-pagination gap** (Mistakes #3) is a known, open, unfixed gap — not something to assume closed.
- **`scripts/verify-postgres-connections-timeline-explain.sh` was run and passed in this session, but is not wired into any CI job** — like STEP-09/12's Postgres-only verify scripts, it is a manual step; nothing currently re-runs it automatically on a schema change.
- §11.1's legal groundwork remains entirely unaddressed — unrelated to this step, carried forward since STEP-11.

---

## Next step

Per `STEPS.md`'s table, **[Step 14 — First real deploy](STEP-14-deploy-hardening.md)** is next in sequence. Per `MODERNIZATION_PLAN.md` §12.3's dependency graph, S14 depends only on S2 (thin deploy, already built) — **not on S13** — so it is safe to start immediately regardless of the open gaps above (the 20-row pagination gap, the sequential-not-multi-process concurrency test, the unwired EXPLAIN script). STEP-13's own header names its actual dependent as Step 15 (accessibility), not Step 14.

## Next CP checkpoint

Per `LEARNING-TRACK.md`'s table, **[CP-13 — Visual regression](CP-13-visual-regression.md)** runs after Step 13, teaching Playwright-based visual regression (~3h). It is explicitly optional — `STEP-13-social-layer.md`'s own footer states Step 14 does not depend on it. Not started; no build-plan/status doc exists for it yet.
