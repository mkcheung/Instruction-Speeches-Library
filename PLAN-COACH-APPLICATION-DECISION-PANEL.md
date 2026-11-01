# Plan: coach application decision panel

**Status:** approved scope (both phases, pop-up kept). Rev 5, 2026-11-01: **both phases built, reviewed and verified** (see "Phase 1 outcome" and "Phase 2 outcome"). Uncommitted. · **From:** proposal 8 in [PLATFORM-REVIEW-UX-MOCKUPS.html](PLATFORM-REVIEW-UX-MOCKUPS.html)

## Goal

On the review page, an admin should be able to:

- see **why Approve is blocked, in plain text**;
- see a "still scanning" document unlock Approve **without reloading**;
- step to the next undecided application;
- see document readiness in the list.

## Decisions (made 2026-11-01)

1. **Reason field: keep the pop-up** (Option A). The confirm step, the optional-vs-required reason rules and the existing decision tests stay as they are.
2. **Scope: both phases**, built in order. Phase 1 must pass CI before phase 2 starts.

The tabs stay, which keeps your original "switch to documents" request.

## What the code review established

Each row was verified in the repo or in vendor source (Filament 4.12.6, Livewire 3.8.6).

| Fact | Where | Why it matters |
|---|---|---|
| Approve and Reject are **header actions** with confirm modals. Approve's reason is optional, Reject's is required, and both max out at 1000 characters. | `ViewCoachApplication.php` `getHeaderActions()` | They stay as they are. 11 of the test file's 30 test blocks (36 cases with datasets) drive them and must pass unchanged. |
| The page's content area is a **2-column grid** by default. | `ViewRecord::defaultInfolist()` sets `columns(2)` | The new box must be `->columnSpanFull()`, or it sits in column 1 and pushes the Application section sideways. |
| Filament's own `->poll()` re-renders **only its component**. | `Component.php`: `wire:poll…="partiallyRenderSchemaComponent(key)"` | It can't update the header Approve button, so the poll must re-render the **whole page**. |
| Every request re-checks admin access, polls included. | `ViewRecord::hydrate()` → `authorizeAccess()` → `canView()`, plus `hydrateCanAuthorizeAccess()` | A new poll method needs no extra authorization of its own. **Don't override `hydrate()`** in the page. |
| Every request re-reads the record fresh from the database, with no cached relations. | Livewire `ModelSynth::hydrate()` | The scan status a poll sees is current, and `documentsForReview` is queried once per request. |
| While an Approve / Reject pop-up is open, **Filament itself skips the full page render** on any call, polls included. | `PartialsComponentHook::shouldSkipRender()` (via `DataStoreOverride`) | A poll cannot clobber a half-typed reason, so **no guard code is needed**. (Rev 3 planned a `skipRender()` guard. It was redundant, and the spike that "proved" it had no control case.) |
| `wire:poll` is throttled about 95% in background tabs, pauses when its attribute disappears, and stops when its element is removed. | Livewire JS, `directive("poll")` | Polling stops once the box hides, and costs little in background tabs. |
| The active tab survives re-renders. | `tabs.js`: after each commit it resets only if the current tab no longer exists. **Confirmed in Chromium:** 3 full refreshes on the Documents tab stayed on Documents. | Polling won't bounce an admin from Documents back to Request. |
| A full refresh does **not** lose text being typed in an open pop-up. | **Confirmed in Chromium:** a refresh fired mid-typing in the Reject pop-up kept "Half typed plus more words", and the pop-up stayed open | The skip-render guard is a safety net, not a must-have. It stays because it costs nothing and covers slower networks and other browsers. |
| On Postgres, Laravel **throws** `InvalidArgumentException: Illegal operator and value combination` for `where('submitted_at', '>', null)`. | Run read-only on the dev database | Phase 2 must branch on a null `submitted_at` before building the comparison (see phase 2), or that application's page crashes. |
| Today the **Application section fills only the left half** of the page on wide screens: it spans 1 of the 2 grid columns, and the right half is empty. | Rendered HTML (`--col-span-default: span 1 / span 1`) and a 1400 px screenshot | A full-width box above a half-width section would look broken. Phase 1 fixes it. |
| `application_documents.path` is `NOT NULL`. | `create_application_documents` migration | A SQL "clean" count (`status = 'clean' AND path <> ''`) matches `isDownloadable()` exactly. |
| `withdraw()` also accepts a **draft**, so a withdrawn application can have a null `submitted_at`. | `CoachApplication::withdraw()` | Phase 2's next/previous lookup must not break on a null timestamp (see below). |
| No test asserts the tooltip text. One test asserts `assertDontSee('Undecided')` on a withdrawn application, and the check is case-sensitive. | `CoachApplicationReviewPageTest.php:560` | Reordering the blocked reasons is safe. A "Next undecided" button is hidden in that test anyway, since there is only one application. |
| `AdminSceneTest` references this page for its compact scene. | `tests/Unit/AdminSceneTest.php` | Unaffected by these changes. The header gains buttons, so check it for crowding in a browser. |

## Phase 1: visible blocked reason and live refresh (about half a day)

All in `ViewCoachApplication.php` plus tests. There is no migration, route, permission, JavaScript or CSS change.

1. **Reorder `approvalBlockedReason()` so erasing comes first.** No amount of waiting fixes an erasing applicant, so that reason should win, and nobody should poll for scans that can't unlock Approve. Today an erasing applicant with no clean document shows the document reason. This only changes that combined case's tooltip, which no test asserts.
2. **Add a `Callout` as the first component**, above the Application section and directly under the disabled Approve button.
   - Settings: `->columnSpanFull()`, `->warning()`, and visible only while undecided **and** `approvalBlockedReason() !== null`.
   - Heading: **"Approve is unavailable"**.
   - Description, from a new private static `approvalNotice()` that starts from `approvalBlockedReason()`, so one function still decides blocked-or-not:

   | Case | Text |
   |---|---|
   | Erasing (any documents) | "The applicant is erasing their account, so they can't be approved. You can still reject." |
   | No documents | "Approval needs at least one clean document, and the applicant hasn't uploaded any." |
   | At least one document `Scanning` | "Approval needs at least one clean document. 1 document is still being scanned; this page checks again every 10 seconds." (Plural form: "2 documents are…".) |
   | Documents exist, none clean, none scanning (quarantined, purged, erased, scan failed) | "Approval needs at least one clean document, and none of the uploaded documents is clean. The Documents tab shows each one's status." |

   - The scan count is `displayState() === 'Scanning'` over the already-loaded `documentsForReview`, so it needs no extra query.
   - Add `role="status"` through `extraAttributes`, so screen readers announce changes to the text.
3. **Polling lives on the Callout itself**, only in the "still being scanned" case. That means undecided, not erasing, no clean document, and at least one document `Scanning`.
   - Mechanism: `extraAttributes(['wire:poll.10s' => 'pollScanStatus', 'role' => 'status'])`.
   - The text promises "checks again every 10 seconds" exactly when the page does.
   - When the box hides or switches text, the attribute goes with it and polling pauses.
4. **Add `public function pollScanStatus(): void`** whose body only counts (`$this->scanPolls++`). The normal Livewire re-render that follows refreshes everything: the box, the Approve button's enabled state, and the Documents tab statuses.
   - Not Filament's `->poll()`: it renders only the box.
   - **Poll cap (added after review):** `public int $scanPolls` and `MAX_SCAN_POLLS = 30`. After 30 polls (5 minutes) the attribute is dropped and the text becomes "…still being scanned. Automatic checking has stopped; reload the page to check again." Without it, a stuck queue worker (the original bug in this project) keeps an unattended tab polling, and the session sliding, forever.
5. **Make the Application section full width** with `->columnSpanFull()` on `Section::make('Application')`. Today it fills only the left half of wide screens, and the new full-width box above it would make that gap obvious. This is a one-line change, and no test pins the layout.
6. **Keep** the Approve tooltip, the header actions, the confirm modals, `Gate::authorize('role.assign')`, and click-time auditing and signing for downloads.

### Phase 1 tests (added to `CoachApplicationReviewPageTest.php`)

- **Box text** for each case in the table, including singular and plural scan counts. Also: erasing **with** scanning documents shows the erasing text and no poll attribute.
- **Box absent** when Approve is allowed, and on decided applications (approved, rejected, withdrawn) even with no clean document.
- **Poll attribute** `wire:poll.10s="pollScanStatus"` present only in the scanning case. It is absent when one document is clean and another is still scanning, because Approve is already allowed.
- **Live unlock:** a scanning document flips to clean in the database, then `->call('pollScanStatus')` leaves Approve enabled, with the box and the poll attribute gone.
- **Pop-up survives a poll:** mount Reject, fill a reason, change the page (the document turns clean), `->call('pollScanStatus')`. There's no `html` effect, Reject is still mounted and submits exactly that reason. The page must be changed first, or an unchanged render emits no `html` effect either way and the test proves nothing.
- **Re-authorization:** mount as admin, remove the admin role, `->call('pollScanStatus')` returns 403.
- **Regression:** all 30 existing test blocks pass unchanged. If one has to change, the design drifted.

### Spike results (run 2026-11-01, throwaway test deleted afterwards)

The spike used a temporary subclass of the real page with a prototype box and `pollScanStatus()`. The product code was not touched. All 4 passed:

1. **A refresh re-checks the header buttons.** With a scanning document, Approve was disabled. After the document turned clean, one refresh enabled it. **The fallback (moving the buttons into the page body) is not needed.**
2. **A poll with a pop-up open emits no `html` effect.** A normal poll returns `[returns, html, partials]`; one with Reject open returns `[returns, partials]`. **Correction (found while building):** this happens *without* any guard, because Filament skips the render itself. The spike lacked a control, so it could not tell. The test now changes the page first and was mutation-checked (forcing a full render makes it fail).
3. **The box renders as planned.** It carries `wire:poll.10s="pollScanStatus"` and `role="status"` on its own element, and `$record` injection works in its closures.
4. **A demoted admin is refused.** Mounted as admin, then demoted to member: the next `pollScanStatus` call gets 403.

## Phase 2: queue navigation and list readiness (about half a day, after phase 1 is green)

1. **"Previous undecided" and "Next undecided" header link buttons**, placed before Approve and Reject.
   - **Order:** `submitted_at, id` over `UNDECIDED_STATUSES`, always excluding the current application. This ignores the list's filters, because it is the decision queue.
   - **Next:** the first undecided row after the current one in that order. If there is none, **wrap** to the first undecided overall.
   - **Previous:** the mirror image, wrapping to the last undecided overall.
   - Wrapping means older applications are never skipped after a decision.
   - **Null `submitted_at`** (an application withdrawn while still a draft): **skip the "after" and "before" queries and go straight to the wrap query.** Laravel throws `Illegal operator and value combination` when it builds `where('submitted_at', '>', null)` (verified on the dev Postgres), so the comparison must never be built with a null value.
   - **Hidden** only when no other undecided application exists.
   - **Query cost:** worked out once per request (memoised in a private property, which Livewire doesn't persist), using at most four tiny `LIMIT 1` queries served by `ix_coach_app_queue (status, submitted_at)`.
2. **Add an `id` tiebreaker to the list's `defaultSort`**, so the list and the buttons agree when timestamps tie. The existing sort test uses distinct timestamps, so it's unaffected.
3. **A "Documents" list column** that adds no per-row queries.
   - **Query:** the table's `modifyQueryUsing` adds `withCount(['documents', 'documents as clean_documents_count' => status 'clean' and path <> ''])`.
   - **Text:** `0` reads "None"; otherwise "{n} · {clean} clean".
   - **Constraints:** no `->numeric()`, which needs ext-intl and the dev host lacks it. Read the alias through `getAttribute()` to keep phpstan level 8 clean.

### Phase 2 tests

- **Order:** next and previous follow `submitted_at, id`, including two applications with **equal timestamps**.
- **Wrapping:** both buttons wrap at the ends.
- **Skipped rows:** both skip decided rows, and drafts can't appear.
- **Null timestamp:** a withdrawn-from-draft application's page **renders without an exception**. From it, Next goes to the oldest undecided and Previous to the newest.
- **Hidden:** both are hidden when the current application is the only undecided one, or there are none.
- **Column counting:** the Documents column counts a clean row with `path = ''` (purged) as **not** clean, matching `isDownloadable()`.
- **Query count:** rendering the list with 1 versus 3 applications runs the same number of statements that touch `application_documents`.
- **Regression:** all phase 1 and existing tests pass unchanged.

## Not doing

- No inline PDF preview: documents download as attachments only.
- No change to who can decide, or to the decision service's 409 guards.
- No stacking of Statement and Documents into one scroll. The tabs stay.
- No `admin-workspace.css` change in phase 1. If the browser check shows the box needs styling, that is a separate step. Changing the CSS changes its hashed filename, which requires `php artisan filament:assets` and an nginx image rebuild, or the panel loads unstyled.

## Risks

| Risk | Mitigation |
|---|---|
| A stuck scan (queue worker down) keeps an open page polling every 10 s | It stops at "Scan failed" once retries run out, background tabs are throttled about 95%, and admin traffic is tiny. Each poll costs a handful of small queries and a session write. |
| The poll re-renders while the admin is typing a rejection | None in practice: Filament skips the full render while a pop-up is open. Confirmed in Chromium across a real poll: all typed text survived. |
| A newly enabled Approve isn't announced to screen readers | The box has `role="status"`; the button change itself is silent, which is acceptable |
| The box or the header buttons look off in the notebook theme, in dark mode, or on mobile | Browser check below; no CSS change unless needed |
| Postgres versus SQLite | Phase 1 adds no SQL. Phase 2 uses plain `whereIn`, `orderBy`, `limit` and `withCount`, and `path` is NOT NULL on both. |

## How I'll verify

After each phase:
- CI's exact commands: `./vendor/bin/pint --test`, `php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G`, and the full `php -d memory_limit=-1 vendor/bin/pest`. No frontend files change.
- One reviewer agent, as with the original page.

**Browser checks** (need the Docker stack; I'll report them as not done if it isn't running):

Done before the build (2026-11-01, Chromium, application #2, pop-up cancelled, nothing changed):
- the tab survives refreshes;
- typing survives a refresh;
- a hand-typed `?tab=documents` opens the Documents tab, as the page's code comment says.

After the build:
1. Upload a PDF, open the review page while it is scanning, stay on the **Documents** tab, and confirm Approve unlocks within about 10 s.
2. Check the box and the now full-width Application section in light and dark mode, and at phone width.
3. Check the header with four buttons plus the compact scene. Today's header has room at 1400 px; check about 1024 px and phone width.
4. Click Next and Previous across a queue of three, including one withdrawn-from-draft application.

**Test data note:** the dev database has one real application (#2, the e2e member's), and checks so far never submitted a decision on it. Build-time checks that need a scanning document or a queue should use new throwaway applications, not #2.

## Phase 1 outcome (2026-11-01)

**Built:** the `Approve is unavailable` Callout (four texts, `role="status"`, full width), the erasing-first reason order, the `wire:poll.10s` attribute only while a scan can still finish, `pollScanStatus()` with the 30-poll cap, and a full-width Application section. One file changed, `ViewCoachApplication.php`. No migration, route, permission, CSS or JavaScript change.

**Validation:** pint clean, phpstan 0 errors, full Pest 1394 passed / 0 failed (1370 before, 24 new). The 30 pre-existing review-page test blocks pass unchanged. Three mutations were applied to confirm the tests bite (remove the cap, swap the reason order, force a full render), and each failed the intended test.

**Review (adversarial agent, read-only):** no blockers and no authorization regression. Findings acted on:
- an unbounded poll on a stuck scan: **added the cap**;
- missing "Scanning" cases (retries used up but lease live, erased document, quarantined plus scanning) and no test that polling stops when a scan ends badly: **added**.

**Browser (Chromium, live stack, throwaway application #3 with a scanning document):**
- the box reads correctly, with a themed look, in light and dark mode, at 1400, 1024 and 390 px wide, with no horizontal scroll;
- Approve unlocked 7.4 s after the document turned clean, the Documents tab stayed selected, the box disappeared, and **polling stopped** (0 requests in the next 12 s);
- with the Reject pop-up open across a real poll, typed text survived and the pop-up stayed open.

**Environment note:** rebuilding only `app` left the old stylesheet in the nginx image, and the panel loaded unstyled (the known "filament assets" catch). `docker compose up -d --build web` fixed it. Not caused by this change, which has no CSS edits.

## Phase 2 outcome (2026-11-01)

**Built:**
- `CoachApplication::nextUndecided()` and `previousUndecided()`, ordered `submitted_at, id`, with wrap-around. A null `submitted_at` skips the comparison, because Laravel throws on `where(col, '>', null)`.
- Previous and Next undecided header links, in front of Approve and Reject, with per-request memoization.
- An `id` tiebreak on the list's default sort.
- A `Documents` list column (`None`, or `{total} · {clean} clean`), counted by `withCount` with no per-row queries.

**Validation:** pint clean, phpstan 0 errors, full Pest 1408 passed / 0 failed. All earlier test blocks pass unchanged.

**Mutation checks (7 plus 1):** break the null guard, the wrap, the equal-timestamp tiebreak, the clean count, the memoization, Next visibility on decided applications and the list tiebreak, and each is caught. Two lessons:
- PHPUnit counts exceptions as **errors**, not failures, so a mutation script must read both counters. Mine first reported two false "survivors".
- SQLite returns tied rows in row order whatever the SQL says, so the list's `id` tiebreak needed a test on the generated SQL.

**Review (adversarial agent, read-only):** no blockers. Acted on:
- the URL closure is now null-safe, and a test mounts a hidden link directly (it did not reproduce a failure, so this is insurance);
- the memoization test now asserts exactly 2 lookups for a mid-queue record;
- a comment records that nothing enforces a non-null `submitted_at` on undecided rows, and that NULLs sort differently on Postgres and SQLite.

Not acted on: the neighbour lookups re-run on every 10 s poll (2 to 4 `LIMIT 1` queries on `ix_coach_app_queue`), judged cheaper than the extra state needed to avoid it.

**Browser (Chromium, live Postgres stack, throwaway queue of four applications, since deleted):**
- all four pages show the right neighbours, including the application with **no submit date** (it previously would have crashed), and Next on the newest wraps to the oldest;
- the list shows the Documents column and the queue order, with no server errors.

**A defect only the browser could find, fixed:** with four labelled buttons the header was broken at about 1024 px, the title and breadcrumb crushed into a sliver. The two navigation links are now **icon-only** (arrows with tooltips, and the labels kept as accessible names). Re-checked at 1400, 1280, 1100, 1024 and 390 px: no horizontal scroll, and the title has 315 px at 1024.

**Cleanup:** the three throwaway users, applications and documents were removed from the dev database; application #2 is untouched.
