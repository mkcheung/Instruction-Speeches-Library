# STEP-13 Frozen Contract

Resolves every gap the four parallel readiness agents (backend/frontend/database-perf/
cross-cutting-security) surfaced, into concrete decisions, before any build agent writes code.
Method matches STEP-07/08/09/11/12's frozen-contract precedent. **Read-only review pass — no
code was written or modified to produce this document.** Load-bearing claims below were
independently spot-checked by direct grep/read, not taken on an agent's word alone.

## 0. Two stale-plan-text corrections, confirmed by direct read

**§12's S13 summary text is wrong about `is_granting`.** It says "the `is_granting` generated
column" ships in S13. It doesn't exist anywhere in this schema and shouldn't — **§6.7.3 is
authoritative**: on Postgres (§5.8a), a partial index (`ix_reviews_timeline`,
`ix_reviews_incoming`) does the same job with no generated column, no table rebuild risk. This
is the same class of stale MySQL-era prose surviving into a later, Postgres-corrected section
that STEP-04/12 both hit — don't propagate the S13-summary framing to a build agent.

**§6.7.3's EXPLAIN contract is written in MySQL terminology and cannot be verified on sqlite
(this project's CI driver) or matched literally against real Postgres.** Postgres's `EXPLAIN`
never prints `ref`, `eq_ref`, `Using filesort`, or `Using temporary` — those are MySQL node
names. Translate before building any verify script:
- `ref` → an `Index Scan`/`Index Only Scan` on the named index
- `eq_ref` (unique lookup) → an `Index Scan` on a unique/PK index with `rows=1`
- "no filesort" → **absence of a `Sort` node** above the index scan (ordered output comes
  straight off the index because the leading index columns match `ORDER BY`)
- "no Using temporary" → absence of a `Hash`/`Materialize`/`GroupAggregate`/`WindowAgg` spill
Follow the existing `scripts/verify-postgres-*.sh` pattern (docker-compose exec + psql), not a
new mechanism — see §6 below.

## 1. `reviews.speech_owner_id`/`last_transition_at` already exist — S13's only new schema work here is two partial indexes

Confirmed: both columns were built at STEP-05 (`2026_08_09_100001_create_reviews_table.php`),
years ahead of where §12's original text implied. **Decision: S13 adds only**
`ix_reviews_timeline`/`ix_reviews_incoming` (the two partial indexes from §6.7.3), with the
EXPLAIN test (translated per §0 above) that justifies them — no new columns, no data migration.

## 2. `speeches.supersedes_id`/`change_note` already exist — S13 only builds the query + UI

Confirmed built at STEP-03 per §6.11's own instruction. S13's arc-chain work is the recursive
CTE query (bounded depth 10, already specified in §6.11) plus the frontend arc strip — not new
columns.

## 3. `connections` migration — exact schema, matching this codebase's real conventions

Template: `api/database/migrations/2026_08_22_100001_create_coach_applications_table.php`
(driver-branch on `Schema::getConnection()->getDriverName() === 'sqlite'`, raw `CREATE TABLE`
per branch, separate `CREATE INDEX`/`CREATE UNIQUE INDEX ... WHERE ...` statements after).

**One correction to §6.7.2's literal CHECK-constraint names**: every existing CHECK constraint
in this schema uses the **full table name**, never an abbreviation (`ck_speech_assets_kind`,
`ck_coach_applications_status`, `ck_reviews_status` — confirmed by listing every `ck_*` name in
the schema). §6.7.2's `ck_conn_no_self`/`ck_conn_initiator`/`ck_conn_blocker`/`ck_conn_blocked`
break that convention. **Decision: rename to `ck_connections_no_self`,
`ck_connections_initiator`, `ck_connections_blocker`, `ck_connections_blocked`.**

Everything else in §6.7.2's schema (two mirrored rows, `owner_id`/`peer_id`,
`initiated_by_id`/`blocked_by_id` carrying the same value on both mirrored rows, no
`deleted_at`, the three named indexes) is confirmed sound against real conventions and ships
as written.

## 4. The timeline query's poster join — column name correction

§6.7.3's literal SQL joins on `p.primary_flag = 1`. **That column doesn't exist.** The real
column is `is_primary` (boolean), and the real index is the two-column partial unique index
`uq_assets_primary ON speech_assets (speech_id, kind) WHERE is_primary` (confirmed —
**not** a three-column `(speech_id, kind, primary_flag)` index as §6.7.3's prose describes).
**Decision:** the timeline query's poster join condition is
`p.speech_id = s.id AND p.kind = 'poster' AND p.is_primary AND p.status = 'ready'`, and it
already has the index it needs — no new index for this join.

## 5. `ConnectionService` — lower-id-first mechanism, made concrete

§6.7.2 says "always write the pair lower-user-id-first" but never states the mechanism.
**Decision:** `ConnectionService`'s public methods (`request`, `accept`, `decline`, `block`,
`unblock`) take the two user ids as ordinary parameters and internally compute
`[$lowId, $highId] = $a->id < $b->id ? [$a, $b] : [$b, $a]` before opening the transaction —
row locks (and the mirrored-pair writes) are always acquired in that fixed order, regardless of
which user initiated the action. This mirrors `ReviewService`'s `lockForUpdate()` idiom
(confirmed present throughout that class) applied to two rows instead of one.

**Crossed-request resolution**: this is the first `INSERT ... ON CONFLICT DO UPDATE` in this
codebase's application code (confirmed — every existing upsert uses Eloquent's `updateOrCreate()`,
exactly the SELECT-then-write race §6.7.2 warns against). Confirmed no sqlite portability
problem — this environment's sqlite (3.51.0) has supported `ON CONFLICT` upsert syntax since
3.24 (2018). Write it as raw `DB::statement()` inside `ConnectionService`, following the raw-SQL
precedent every other race-sensitive write in this codebase already uses at the migration level,
now extended to a service-layer write.

**`declined → pending` reuses the row via the same endpoint** `POST /api/connections` handles
both "new request" and "re-request after decline" — mirroring `ReviewService::invite`'s own
idempotent-upsert docblock pattern exactly (confirmed as the established idiom for this exact
"terminal-but-reusable state" shape).

## 6. Postgres-only EXPLAIN verification — new script, existing pattern

`scripts/verify-postgres-connections-timeline-explain.sh`, following
`verify-postgres-last-admin-lock.sh`'s exact shape (`docker compose -f compose.yaml -f
compose.e2e.yaml exec -T ... psql -Atc`, `log()`/`fail()` helpers) — asserting the translated
Postgres plan-node contract from §0 above via `EXPLAIN (FORMAT TEXT)` output, not literal
MySQL-term string matching. **Given this project's own history (STEP-12's lock-test script was
"written but unrun" and had three real bugs only found by actually executing it), this script
must be run against a real local e2e stack before being trusted, not just read.**

## 7. Nightly asymmetry reconciler — exact command shape

`app/Console/Commands/ReconcileConnectionAsymmetryCommand.php` (signature
`connections:reconcile-asymmetry`), scheduled in `routes/console.php` following the confirmed
existing three-command pattern exactly: `if (app()->environment('e2e')) { ->everyMinute(); }
else { ->daily(); }` — same split `media:reconcile`/`privacy:purge-expired-exports`/
`coach:purge-expired-documents` already use.

## 8. Rate limiting (R17) — concrete numbers, since neither doc gives any

STEP-13.md and §6.7.2/R17 both say "per-pair rate limit" with no number. **Decision** (a
product default, not derived from anywhere in the plan — flag for confirmation same as any
other undocumented default in this project's history): 5 connection requests per (requester,
target) pair per 24 hours, using `RateLimiter::for('connection-request', ...)` in
`AppServiceProvider`, matching `FortifyServiceProvider`'s existing `RateLimiter::for('login', ...)`
convention (confirmed as this codebase's only precedent for a named limiter).

**Blocking does NOT retroactively gate `ReviewService::invite`.** Confirmed as a genuine
plan-silence, not an oversight — MODERNIZATION_PLAN.md and STEP-13.md both scope the `blocked`
check to the connection-request-creation path only. Decision: leave `ReviewService::invite`
untouched by this step; a blocked pair can still invite each other to review (review invitation
is a separate, pre-existing surface with its own consent model — accept/decline — that already
handles unwanted invitations). Revisit only if a future step asks for it explicitly.

## 9. RTK Query envelope, routes, and cursor pagination — pinned

Confirmed greenfield on every count (no cursor-pagination UI anywhere in this app, no `Avatar`
component, no nested-tab route precedent beyond generic `<Outlet>` layout nesting). Pinned:

- **Envelope**: `{connection: Connection}` singular / `{connections: Connection[], meta:
  {next_cursor: string|null}}` list — matching the existing `{reviewers: ..., meta: {...}}`
  convention from the reviewer directory (confirmed established shape), extended with a
  `next_cursor` field rather than page-number `meta`.
- **Cursor param**: query string `?cursor=<opaque>`, where the opaque value is the base64 of
  `"{last_transition_at}|{id}"` — never a raw exposed tuple, matching this codebase's general
  preference for not exposing internal sort keys directly (ULIDs over bigint PKs elsewhere for
  the same reason).
- **Pagination UI**: a plain "Load more" button, `useState` + fetch-next-page-on-click — **no
  new dependency** (`react-intersection-observer`/virtualization libraries are explicitly not
  installed and shouldn't be added; this matches the zero-cost/self-hosted constraint already
  governing every other dependency choice in this project).
- **Routes**: `/u/:username` (About/default, the existing route), `/u/:username/reviews-left`,
  `/u/:username/reviews-received` — three sibling routes under a shared profile layout with its
  own `<Outlet>` (the first instance of nested tab-routes in this app; the general `<Route>`
  nesting mechanics already used for `AppLayout`/`RootLayout` apply, just not previously used
  for same-page tabs).
- **New component**: `web/src/components/ui/avatar.tsx` — confirmed missing everywhere in this
  codebase (both `ReviewerDirectory.tsx` and `InviteReviewerDialog.tsx` render reviewers with no
  avatar at all; `PublicProfile.tsx`'s current inline `<img>`+fallback-div pattern should be
  extracted into this new shared component, not left inline, since the connections rail needs
  the identical avatar-with-fallback behavior in a 1:1 tile grid).
- **Poster reuse**: `web/src/components/speech/SpeechPoster.tsx` (confirmed exists, already
  does real `<picture>`/srcset/CLS-safe sizing) — the timeline's 16:9 hero reuses this directly,
  no new component.
- **Request-creation UI precedent**: `InviteReviewerDialog.tsx`, not `CoachApplicationForm.tsx`
  (confirmed the better match — peer-to-peer search+select+submit, not a one-shot form) — copy
  its RTK-mutation-plus-`applyServerErrors` shape for "send connection request."
- **Arc-strip data-fetch**: embedded per-review in the timeline card payload, not a separate
  per-speech endpoint — avoids an N+1 on the frontend mirroring the exact N+1 risk R19 already
  warns about backend-side for the rail metric.

## 10. Security-critical: the core invariant needs more than the snapshot test

Confirmed `Speech::scopeVisibleTo` (`api/app/Models/Speech.php:141-150`) exactly, and confirmed
`toRawSql()` is available (Laravel 13.24.0 installed, well past the method's introduction) — the
acceptance criterion's snapshot test is executable exactly as MODERNIZATION_PLAN §6.7.1 writes
it. New test file: `api/tests/Feature/Speech/VisibleToSnapshotTest.php` with the SQL fixture at
`api/tests/Feature/Speech/__snapshots__/visible_to.sql` (no existing snapshot-fixture directory
convention to defer to — this establishes one).

**But the snapshot test alone is not sufficient**, and this is the single highest-severity
non-negotiable for this step: it only catches `scopeVisibleTo` itself being edited. A build
agent could leave that method byte-identical while adding a *second*, connections-aware
scope/query and wiring the new profile-timeline controller to call that instead — technically
passing the snapshot test while still widening access. **The reconciliation audit and any
`/code-review` pass on this step must explicitly grep every new controller/query for a
`connections` table reference returning speech or annotation content**, not just diff
`scopeVisibleTo`. `AnnotationPolicy::readAnnotations`/`Annotation::scopeVisibleTo` are confirmed
unchanged and untouched by anything this step adds (both gate strictly on `reviewer_id`/
ownership, no viewer-connections input at all) — any future PR that adds one is the regression
to catch.

## 11. `Gate::before`'s `$mustFallThrough` — the recurring bug class, restated

Confirmed current list has zero `connection.*` entries (clean slate). **Whatever
`ConnectionPolicy` abilities this step defines (`connection.block` at minimum; `request`/
`accept`/`decline` likely don't need Gate abilities at all since they're self-scoped like
`account.eraseSelf`, no ownership ambiguity) must be added to `$mustFallThrough` in the same
commit as their `Gate::define`** — this exact omission has caused a real bug at least twice
before in this project (STEP-05 rev2, a STEP-12 `/code-review` finding). Admin's blanket
`Gate::before` bypass must never silently grant an admin an ability whose whole point is
consent between two ordinary users.

## 12. Filament `Connections` resource — reuse, not reinvent

`SpeechResource.php`'s `modifyQueryUsing(fn ($query) => $query->withTrashed()->with([...]))`
(confirmed) is the exact seam for the required `owner_id < peer_id` dedup on the admin table.
`UserResource.php`'s confirmation-gated-action + `AuditLog::create()` + `Gate::authorize()` +
catch-`AuthorizationException` pattern (confirmed, and the exact pattern STEP-12's `/code-review`
pass had to retrofit onto — build it in from the start this time) is the template for any admin
block/unblock action. The "most connections in last 7 days" widget has zero precedent in this
codebase (no `app/Filament/Widgets` directory exists yet) — first Filament widget in this
project, build from Filament's own widget API directly.

Related: [[project-state]] · [[feedback-subagent-claim-verification]] ·
[[feedback-parallel-agent-seams]]
