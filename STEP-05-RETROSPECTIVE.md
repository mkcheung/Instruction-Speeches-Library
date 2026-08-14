# Step 05 retrospective — The invitation loop

**Executed:** 2026-08-10 · **Against:** [STEP-05-invitation-loop.md](STEP-05-invitation-loop.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §12 S5 / §6.3 reviews / §7.3 access
**Method:** solo build in commit [`b76d731`](../../commit/b76d731) (dated 2026-08-10). This retrospective re-derives every claim from the current repo state and live test runs rather than the build session's own account of itself, per the skill's standing rule.

---

## What was accomplished

**`api/` — the reviews state machine and the two-tier access model**:
- `reviews` table (`database/migrations/2026_08_09_100001_create_reviews_table.php`) with every invariant the step names as load-bearing: `UNIQUE(speech_id, reviewer_id)` (`uq_reviews_speech_reviewer`, line 114), `reviewer_id` nullable with `ON DELETE SET NULL`, `speech_id` `ON DELETE CASCADE`, no `deleted_at` anywhere (soft deletes deliberately absent), and a counter-cache `CHECK` (`ck_reviews_counter_cache CHECK (published_annotations_count <= annotations_count)`, lines 71-72). The migration is driver-branched with raw SQL specifically to keep the `CHECK` constraint enforced under SQLite (the test DB), not just Postgres.
- `invitation_message`, `allow_preview`, `prior_commentary_shared` columns present on the table and as fillable `@property`s on `App\Models\Review` (`Review.php:31-33,48-53`).
- `App\Services\ReviewService` (258 lines) implementing all six transitions the step calls for: `invite()` (idempotent upsert, reuses declined/abandoned rows, no-ops on live rows), `accept()` (idempotent, `lockForUpdate`, no-ops off `invited`), `decline()`, `withdraw()`, `revoke()` (sets `revoked_at` without touching `status`), `revokeAndPurge()` (hard delete), `abandon()`. `assertNotSelfReview()` runs unconditionally first inside `invite()`.
- `Speech::scopeVisibleTo` (`Speech.php:127-136`) plus the real two-tier split in `SpeechController::show` (`SpeechController.php:56-101`): owner or a reviewer in `Review::ACCESS_GRANTING` gets the full `SpeechResource` with a signed playback URL; an invited-not-accepted reviewer gets a reduced payload (title/duration/owner name, no URL); everyone else 404s.
- `last_transition_at` written by every `ReviewService` transition and used as the sort key for all three non-invited dashboard sections (`ReviewController::index`, lines 118-163); the invited section sorts oldest-first on `invited_at`, matching the demo script's "oldest-first" requirement.
- `ReviewerDirectoryController::index` backed by `User::scopeReviewerCandidates` (`User.php:65-83`) — search + credential filter, categorically excludes admin/super_admin at the query level, not just in the UI.
- Laravel's stock `notifications` migration plus `ReviewInvited`, `ReviewAccepted`, `ReviewDeclined` (`app/Notifications/`), all `ShouldQueue` with `via() = ['mail', 'database']`.
- `SpeechPolicy`, `ReviewPolicy` — `ReviewPolicy::accept` denies admin categorically before any other check (`ReviewPolicy.php:30-39`). `AppServiceProvider::boot()` scopes `Gate::before` with an explicit `$mustFallThrough` list (`review.accept`, `review.decline`, `review.publish`, `review.withdraw`, `review.abandon`, `speech.invite`, plus identity-destructive abilities) so the admin bypass does not silently apply to these.
- 15 review-specific Pest tests (`ReviewInvitationHttpTest.php`, `ReviewServiceTest.php`), part of 101 total in the suite.

**`web/` — invite composer, directory, dashboard, track selector, bell**:
- `InviteReviewerDialog.tsx` — search input, credential filter, per-invitation message textarea, `allow_preview` checkbox, and a conditional "share the previous version's feedback (anonymized)" checkbox gated on `supersedesId`.
- The reviewer directory lives inside that same dialog, backed by `ReviewerDirectoryResource` (paginated id/username/name/credential/avatar_url) — a real filterable feature, not a flat list.
- `Dashboard.tsx` — four sections ("Invitations awaiting response", "In progress", "Published work", "Revoked"), server-driven sort order, `InvitationCard` wired to `useAcceptReviewMutation`/`useDeclineReviewMutation`.
- `TrackSelector.tsx` — `role="radiogroup"`, a synthetic `NO_COMMENTARY = 'none'` option rendered first and for real, each option a `role="radio"` with `aria-checked`.
- `NotificationBell.tsx` — polls `GET /notifications` every 30s, unread badge, mark-read on click.

**Verified live, not just read**: `./vendor/bin/pest` (101/101 passed, 831 assertions), `./vendor/bin/pest --filter=Review` (15/15, 537 assertions), `./vendor/bin/phpstan analyse` (0 errors), `./vendor/bin/pint --test` (clean) — all against SQLite per `phpunit.xml`'s `DB_CONNECTION=sqlite`/`:memory:` pin, not Postgres. `npx vitest run` (75/75 passed, 13 files), `npx tsc -b` (clean), `npx eslint .` (0 errors, 1 pre-existing unrelated warning in `SpeechCreate.tsx`).

### Demo script

Not walked in a real browser this session (see "What was not verified" below). Every step of it maps to a passing automated test instead:

1–3. Invite composer + directory + message → `ReviewInvitationHttpTest.php:98`, exercising the full invite path for two Coaches and one Member.
4–5. Dashboard shows the invitation oldest-first, accept unlocks playback → covered structurally by `ReviewController::index`'s sort and `SpeechController::show`'s two-tier payload, but not walked end-to-end in a browser.
6–7. Track selector offers all three names → same test at `ReviewInvitationHttpTest.php:98`, plus the "Watch for" item covered separately at `:268` (a Member reviewer, not just Coaches, through the full HTTP path — the step calls this out as the path a `hasRole('coach')` habit-check would silently break).
8. Reviewer A cannot reach reviewer B's work, and cannot learn B exists → `ReviewInvitationHttpTest.php:147`.

---

## Difficulties encountered

Not independently reconstructable from this session — this retrospective was run after the build commit landed, with no access to the build session's own transcript, so no first-hand debugging narrative can be verified here (unlike Step 04's retrospective, which was written in the same session as parts of the build). The `CHECK`-constraint-under-SQLite driver-branching in the reviews migration is circumstantial evidence that a SQLite/Postgres divergence was hit and worked around, but the actual failure mode wasn't observed directly.

## Mistakes made

None found that survived to the current state — phpstan, pint, and the full test suite are all clean, and every acceptance-list item and both negative assertions have a corresponding passing test with no gaps. The one real discrepancy is a spec-vs-implementation mismatch rather than a bug:

- **The "Deliberately stubbed" essay tab does not exist.** The step file says *"The essay tab exists in the tab strip and is disabled."* Grepping `web/src` and `api/app` for "essay" (case-insensitive) returns zero matches anywhere in the codebase, and `SpeechWatch.tsx` has no tab strip UI at all — just stacked cards (video, invite panel, track selector). This isn't a built-and-disabled stub, it's simply not there. It doesn't block Step 06 (which needs the track selector and playback access, both of which work), but Step 08 ("The essay") should not assume a disabled placeholder is already wired into `SpeechWatch.tsx`'s layout — that scaffolding still needs to be added from scratch.

## Package/tooling surprises

None beyond what Step 04's retrospective already recorded (SQLite-vs-Postgres test driver, `vendor/bin/pest` absent from the production container). Nothing new surfaced specific to this step's dependencies — no new packages were introduced (Laravel's own `notifications` table and `ShouldQueue` are stock framework features).

---

## What was not verified — and cannot be, from here

- **The demo script was not walked in a real browser.** Every individual step has a passing automated test backing it (cited above), which is real evidence, but nobody clicked through "invite → log in as reviewer → accept → watch → try reviewer B's URL and get 403" as a continuous human session against the live stack.
- **No Playwright/e2e spec exists for this step.** `find`-ing `*.spec.ts` under `web/` turns up only `register-validation`, `onboarding`, and `speech-create` — nothing exercising invite/accept/reviewer-isolation end to end. CP-05 ("Two users in one test") is the checkpoint that would produce exactly this, and it is explicitly optional per the step's own footer — but until it's done, the cross-user isolation guarantee (arguably this step's central security promise) is proven only at the HTTP-test layer, not through a real two-browser-session flow.
- **The full suite was run against SQLite, not Postgres**, per `phpunit.xml`'s pin — same standing gap [STEP-01's retrospective](STEP-01-RETROSPECTIVE.md) and [STEP-04's retrospective](STEP-04-RETROSPECTIVE.md) both flagged, and this step is a particularly relevant one to close it on: it adds a new `UNIQUE(speech_id, reviewer_id)` constraint and a `CHECK` constraint via driver-branched raw SQL specifically because SQLite and Postgres diverge on constraint syntax. The migration's own SQLite branch is not proof the Postgres branch behaves identically — that needs a disposable Postgres instance, not the shared dev database.
- **The invite→mail flow was not observed landing in Mailpit.** `ReviewInvited`/`ReviewAccepted`/`ReviewDeclined` are `ShouldQueue` with a `mail` channel, confirmed by reading the code, but nobody ran the queue worker and watched a real email arrive.
- **Mistakes/Difficulties above are incomplete** for the reason stated: this retrospective has no visibility into the actual build session's false starts, only its final artifact.

---

## Next step

Per [STEPS.md](STEPS.md), [Step 06 — Watch commentary](STEP-06-watch-commentary.md) is next; it lists no container dependency and, per STEPS.md's own table, does not depend on anything beyond what Step 05 already ships (playback access + the track selector, both verified working above). It's safe to start.

Before calling Step 05 itself *fully* finished (separate from "safe to start Step 06 on top of it"):
1. Decide whether to build CP-05's Playwright coverage now — it's optional against Step 06, but it's the only thing standing between "the access-isolation tests pass" and "a real two-user browser session proves it," and the step file itself frames that isolation guarantee as the whole point of the step.
2. Run the backend suite against a disposable Postgres instance before trusting the new `UNIQUE`/`CHECK` constraints across both drivers, not just SQLite — the standing rule from Step 01, still unresolved as of Step 04 and still unresolved now.
3. A human should walk the eight-step demo script in a real browser at least once, including the Mailpit check.
4. Decide, before Step 08, whether the essay tab needs to be scaffolded retroactively into `SpeechWatch.tsx` as a disabled placeholder (matching what Step 05's spec described) or whether Step 08 will just add it fresh — either is fine, but it should be a decision, not a surprise.

## Next CP checkpoint

Per [LEARNING-TRACK.md](LEARNING-TRACK.md)'s table, **[CP-05 — Two users in one test](CP-05-two-users-one-test.md)** runs after Step 05, using Playwright, ~4h. It is explicitly optional — the step's own footer and LEARNING-TRACK.md both say Step 06 does not depend on it, so it's safe to go straight to Step 06 without it. LEARNING-TRACK.md separately flags CP-05 as one of "the most product-specific" checkpoints because it "proves your central security promise" — given that the cross-reviewer isolation guarantee is currently proven only at the HTTP-test layer (see "What was not verified" above), this is a good candidate to actually pick up rather than defer, even though it's optional.
