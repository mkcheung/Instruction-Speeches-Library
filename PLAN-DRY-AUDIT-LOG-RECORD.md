# Plan: one `AuditLog::record()` for the 25 hand-built audit rows

**Status:** rev 2, 2026-11-18. **Validated on a scratch copy; not implemented.** Applied verbatim to a copy of `b2c5e8e`, with the §3 ledger, coverage and all four §5 mutations run. Rev 2 corrects what the run contradicted (§7).
**Scope:** `api/app` only: `App\Models\AuditLog` plus the 25 call sites in 13 files. Existing tests stay unedited. New tests are optional (§4).
**Baseline:** `development` at `b2c5e8e`: `pint --test` passes, phpstan 0 errors, pest 1555 tests (1520 passed, 35 skipped, 7736 assertions). A scratch copy needs `web/src` beside `api/`. Without it, `Unit/FrontendStatusContractTest`'s three web-reading tests skip, giving 1517 passed and 38 skipped.

## Goal

All 25 audit writes build the same row by hand with `AuditLog::query()->create([...])`. One static method owns that shape afterwards:

```php
AuditLog::record(action: AuditAction::REVIEW_WITHDRAWN, actorId: $actor->id, subjectType: Review::class,
    subjectId: $locked->id, metadata: ['speech_id' => $locked->speech_id]);
```

Every call site keeps its place: inside the same transaction, after the same successful action, and with the same values. No row changes.

## What the review established

**Schema** (`api/database/migrations/2026_08_20_100002_create_audit_log_table.php`, table `audit_log`):
- `actor_id` NULL, FK `ON DELETE SET NULL`.
- `action` VARCHAR(64) NOT NULL.
- `subject_type` VARCHAR(255) NULL; `subject_id` INTEGER/BIGINT NULL.
- `metadata` TEXT/JSONB NOT NULL DEFAULT `'{}'`.
- **`ip` VARCHAR(45) NULL and `user_agent` VARCHAR(255) NULL, both with no default.** So an omitted column and an explicit `null` store the same row.
- **`created_at` NOT NULL with no default.** That is why every write sets it.

**Model** (`app/Models/AuditLog.php`): `#[Fillable([...all eight columns...])]`, `public $timestamps = false`, and casts `metadata => array`, `created_at => datetime`.

**Contract** (`STEP-11-FROZEN-CONTRACT.md` §2, :69-95):
- The table is append-only: "no `AuditLog::update()`/`::delete()` call anywhere".
- "Audit writes live in controllers/services, never in a Policy."
- Write "immediately after the real action succeeds (inside the same DB transaction where practical)."

A static method called at the same 25 places keeps all three rules.

**The 25 writes.** All set `actor_id`, `action`, `subject_type`, `subject_id`, `metadata` and `created_at => now()`. No caller uses the returned model.

| # | Site | action | actor | subject | ip / user_agent |
|---|---|---|---|---|---|
| 1 | `Filament/Resources/ReportResource.php:564` | `REPORT_RESOLVED` | `$actor->id` | `Report::class`, `$record->id` | omitted |
| 2 | `Filament/Resources/ReportResource.php:609` | `REPORT_DISMISSED` | `$actor->id` | `Report`, `$record->id` | omitted |
| 3 | `Filament/Resources/SpeechResource.php:574` | `ADMIN_VIEWED_SPEECH` | `$actor->id` | `Speech`, `$record->id` | omitted |
| 4 | `Filament/Resources/SpeechResource.php:664` | `ADMIN_VIEWED_COMMENTARY` | `$actor->id` | `Speech`, `$record->id` | omitted |
| 5 | `Filament/Resources/SpeechResource.php:746` | `ADMIN_VIEWED_SPEECH` | `$actor->id` | `Speech`, `$record->id` | omitted |
| 6 | `Filament/Resources/SpeechResource.php:805` | `SPEECH_TAKEN_DOWN` | `$actor->id` | `Speech`, `$record->id` | omitted |
| 7 | `Filament/Resources/SpeechResource.php:878` | `SPEECH_RESTORED` | `$actor->id` | `Speech`, `$record->id` | omitted |
| 8 | `Filament/Resources/UserResource.php:438` | `$action` | `$actor->id` | `User`, `$record->id` | omitted |
| 9 | `Filament/Resources/UserResource.php:508` | `USER_DELETED` | `$actor->id` | `User`, `$record->id` | omitted |
| 10 | `Filament/Resources/UserResource.php:596` | `USER_RESTORED` | `$actor->id` | `User`, `$record->id` | omitted |
| 11 | `Filament/Resources/UserResource.php:826` | `USER_SUSPENDED` | `$actor->id` | `User`, `$target->id` | omitted |
| 12 | `Filament/Resources/CoachApplicationResource/Pages/ViewCoachApplication.php:262` | `ADMIN_VIEWED_DOCUMENT` | `$actor->id` | `ApplicationDocument`, `$record->id` | omitted |
| 13 | `Http/Controllers/Api/PrivacyExportController.php:36` | `ACCOUNT_EXPORT_REQUESTED` | `$user->id` | `DataExport`, `$export->id` | **from `$request`** |
| 14 | `Http/Controllers/Api/PrivacyExportController.php:77` | `ACCOUNT_EXPORT_DOWNLOADED` | `$user->id` | `DataExport`, `$export->id` | **from `$request`** |
| 15 | `Http/Controllers/Api/ReportController.php:61` | `REPORT_CREATED` | `$user->id` | `$modelClass`, `$reportable->id` | **from `$request`** |
| 16 | `Actions/Fortify/CreateNewUser.php:79` | `ROLE_ASSIGNED` | `null` | `User`, `$user->id` | omitted |
| 17 | `Jobs/PurgeSpeechMedia.php:237` | `SPEECH_MEDIA_PURGED` | `null` | `Speech`, `$this->speechId` | omitted |
| 18 | `Services/CoachApplicationDecisionService.php:103` | approved/rejected ternary on `$outcome` | `$actor->id` | `CoachApplication`, `$locked->id` | omitted |
| 19 | `Services/ReviewService.php:262` | `REVIEW_WITHDRAWN` | `$actor->id` | `Review`, `$locked->id` | explicit `null` |
| 20 | `Services/ReviewService.php:308` | `REVIEW_ACCESS_REVOKED` | `$revokedBy->id` | `Review`, `$locked->id` | explicit `null` |
| 21 | `Services/ReviewService.php:372` | `REVIEW_ACCESS_PURGED` | `$actor->id` | `Review`, `$locked->id` | explicit `null` |
| 22 | `Services/ReviewService.php:446` | `REVIEW_ABANDONED` | `$actor->id` | `Review`, `$locked->id` | explicit `null` |
| 23 | `Services/RoleAssignmentService.php:220` | `$action` | `$actor->id` | `User`, `$target->id` | omitted |
| 24 | `Services/SpeechDeletionService.php:83` | `SPEECH_DELETED_BY_OWNER` | `$locked->user_id` | `Speech`, `$locked->id` | explicit `null` |
| 25 | `Services/Privacy/AccountErasureService.php:290` | `ACCOUNT_ERASED` | `$user->id` | `User`, `$user->id` | omitted |

**Existing coverage.** 11 test files read audit rows: `Privacy/DataExportHttpTest`, `Privacy/AccountErasureServiceTest`, `Privacy/ReportHttpTest`, `CoachApplication/CoachApplicationDecisionTest`, `Admin/PanelModerationTest`, `Admin/CoachApplicationReviewPageTest`, `Admin/UserSurfaceTest`, `Admin/AdminMediaReviewTest`, `Speech/SpeechDeletionServiceTest`, `Review/ReviewRevocationAuditTest`, and `Media/PurgeSpeechMediaTest`. (Rev 1 also listed two files that don't read them. `Admin/ReportSurfaceTest` mentions audit only in comments; `PanelModerationTest` covers resolve and dismiss. `Unit/AdminSceneTest` only maps the `ManageAuditLogs` page class.) More files exercise the writes than read them: the ledger shows 23 test files reaching at least one site (§3 step 4). **None asserts `ip` or `user_agent`.** §5's first mutation confirms it: with `ip` dropped from `record()`, every test still passes. That is why §3's ledger diff, not the existing assertions, is the proof that rows are unchanged.

## Ground rules

- **Same place, same values.** Each call keeps its exact position (same transaction and ordering) and passes the same five values. Only `ip` and `user_agent` change form: omitted or explicit `null` becomes the helper's `null`.
- **Use named arguments at every call site.** A swapped actor and subject can then be caught by reading.
- **No new update or delete path,** and no observer or event-driven writes. The contract keeps writes explicit at their call sites.
- **Never run `php artisan` in a copy whose `api/.env` points at a real database.** Run code only through pest, which uses SQLite `:memory:`.

## §1 The helper (`app/Models/AuditLog.php`)

```php
use Illuminate\Http\Request;

/**
 * Appends one audit row. Call it where the audited action has just succeeded, inside that action's
 * transaction where there is one (STEP-11-FROZEN-CONTRACT.md §2). Rows are never updated or deleted.
 *
 * @param  array<string, mixed>  $metadata
 */
public static function record(
    string $action,
    ?int $actorId,
    ?string $subjectType,
    ?int $subjectId,
    array $metadata,
    ?Request $request = null,
): self {
    return self::query()->create([
        'actor_id' => $actorId,
        'action' => $action,
        'subject_type' => $subjectType,
        'subject_id' => $subjectId,
        'metadata' => $metadata,
        'ip' => $request?->ip(),
        'user_agent' => $request?->userAgent(),
        'created_at' => now(),
    ]);
}
```

- **Placement.** Put the import after the `BelongsTo` import and the method between `protected $table` and `actor()`. pint passes with that order.
- **Nullable subject types** match the columns. Every current caller passes non-null values.
- **phpstan (validated).** Level 8 reports 0 errors with `?int $subjectId`, before and after clearing the result cache. Every id at the 25 sites is typed `int`, so no widening is needed.

## §2 Conversion

- **Convert the sites in the table order,** one file at a time. Each `AuditLog::query()->create([...])` becomes an `AuditLog::record(...)` with named arguments:
  - `$request` is passed only at sites 13–15;
  - the `ip => null`, `user_agent => null` lines at sites 19–22 and 24 disappear;
  - pass the arguments in parameter order (`action`, `actorId`, `subjectType`, `subjectId`, `metadata`, then `request`).
- **Comments inside the array** (sites 8 and 17) move with their argument. At site 17, the "Null actor = the system" comment now sits above `actorId: null`, one line below `action:`.
- **Imports.** Add `use App\Models\AuditLog;` where it is missing. Remove any import that becomes unused (pint's `no_unused_imports`). Validated: this is a no-op. All 13 files already import `AuditLog`, and nothing becomes unused.
- **After** (rev 1's expected outputs for both greps were wrong):
  - `grep -rn "AuditLog::query()->create\|AuditLog::create\|AuditLog::insert" app` returns **nothing**, because the helper writes through `self::query()->create`. The helper's single insert is `grep -n "query()->create" app/Models/AuditLog.php` (one line);
  - `grep -rn "AuditLog::record(" app` returns 25 lines in 13 files. Each call is a bare statement ending in `);`, so no caller uses the return value, before or after;
  - `grep -rn "AuditLog.*->\(update\|delete\)" app` returns exactly one line. That line is the model docblock's own warning (``* adds `AuditLog::query()->update(...)` or ...``), at `AuditLog.php:17` after the import is added and `:16` at `b2c5e8e`. Anything more is a new write path.

## §3 The audit-row ledger (the behavior proof; scratch only; never lands)

**What it is.** A temporary listener records every audit row the whole Pest suite writes. The ledger from the refactored code must equal the baseline ledger.

1. **The hook.** Register it in the scratch copy's `tests/Pest.php` with `pest()->beforeEach(...)->afterEach(...)->in('Feature', 'Unit')`, which runs for both suites.
   - **Not a bare `beforeEach(...)`.** In `Pest.php` that binds to `Pest.php` itself and silently never runs. Both ledgers then come out empty and the diff "passes" (validated: 0 calls across 8 tests).
   - **Keeping it out of commits:** keep the hook in a file outside the repo and append one `require '<path>';` line to `tests/Pest.php`. `git checkout -- api/tests/Pest.php` removes it.
   - Take the ledger path from an env var (`AUDIT_LEDGER`). The hook does nothing when it is unset.

   ```php
   pest()->beforeEach(function () {
       $test = static::class.'::'.$this->nameWithDataSet();
       gc_collect_cycles();      // before the seed; see step 2
       mt_srand(crc32($test));
       AuditLog::created(function (AuditLog $row) use ($test) { /* append one JSON line */ });
   })->afterEach(function () { /* append DB::table('audit_log')->orderBy('id')->get() */ })->in('Feature', 'Unit');
   ```

   - **`created` rows.** Register the listener per test: each test builds a fresh app and event dispatcher. Write one JSON line per row with:
     - the test name above and a per-test sequence number;
     - `action`, `actor_id`, `subject_type`, `subject_id`, `ip` and `user_agent`, read from `$row->getAttributes()` with a missing key as `null`. Only the omitted-versus-explicit form differs, and §1 makes them equal;
     - the decoded `metadata` with keys sorted;
     - the call-site file: the first backtrace frame outside `vendor/` and `app/Models/AuditLog.php`. Compare the file, not the line, because lines move;
     - **not** `id` or `created_at`.
   - **Stored rows.** The `afterEach` runs before RefreshDatabase rolls back. There, read the table back and write the same fields plus the raw stored `metadata` string. That records the row as stored, not as it was handed to Eloquent. Catch the exception the read throws in Unit tests that have no schema.
   - **Sanity bar: the baseline ledger is not empty.** At `b2c5e8e` it has 264 lines:
     - 133 `created` rows: 126 from the 25 sites and 7 that tests insert themselves;
     - 131 stored rows. `CoachApplicationDecisionTest`'s outer-rollback case writes `role.assigned` and `coach_application.approved` inside a transaction that its caller rolls back. A write moved out of its transaction would show up there as a stored row.
2. **Determinism check.** Run the full suite twice on the unrefactored code and diff the two ledgers, keyed by (test, source, sequence).
   - **Unnormalized, 42 of 264 lines differ.**
     - Faker values: `report.resolved`/`report.dismissed` `reason` (6 lines, 3 tests), `speech.deleted_by_owner` `title` (16 lines, 8 tests), and the `account.erased` byte counts from `SpeechAssetFactory`'s `byte_size` (4 lines, 2 tests).
     - `speech.media_purged`'s `speech_ulid` (a ULID) and `taken_down_at` (wall clock minus the window): 16 lines, 8 tests.
     - `ip`, `user_agent`, the ids and the actions never vary.
   - **Seed after a collection.** In the `beforeEach`, call `gc_collect_cycles(); mt_srand(crc32($test));`. Seeding alone is not enough:
     - `Faker\Generator::__destruct()` calls `mt_srand()` with no seed;
     - the previous test's generator is freed by the cycle collector at an arbitrary point, which reseeds the stream mid-test;
     - so with seeding alone, one row still varied, and repeated runs of `tests/Feature/Admin` gave it three different values.
   - **Normalize** ULIDs (`\b[0-9A-HJKMNP-TV-Z]{26}\b`) and ISO-8601 timestamps to placeholders. Only `speech.media_purged`'s `speech_ulid` and `taken_down_at` match. A UUID pattern matches nothing and is harmless.
   - **Result:** 0 of 264 lines differ. The hook doesn't move pest totals: 1555 tests (1520 passed, 35 skipped, 7736 assertions).
3. Apply §1 and §2 and run the suite again. **Pass bar:** an empty ledger diff against the baseline, with the same pest totals.
   - Validated: 264 = 264 lines, 0 differing, call-site files included.
   - Per-test outcomes are identical too, compared through `--log-junit`.
4. **Coverage.** All 25 sites appear in the baseline ledger, so no characterization test is needed.

   | Sites | Exercised by (`tests/Feature/…`) |
   |---|---|
   | 1, 2, 4, 6, 7, 11 | `Admin/PanelModerationTest` |
   | 3, 5 | `Admin/AdminMediaReviewTest` |
   | 8 | `Admin/PanelModerationTest`, `Admin/UserSurfaceTest` |
   | 9, 10 | `Admin/UserSurfaceTest` |
   | 12 | `Admin/CoachApplicationReviewPageTest` |
   | 13, 14 | `Privacy/DataExportHttpTest` |
   | 15 | `Privacy/ReportHttpTest` |
   | 16 | `Auth/RegistrationTest`, `Identity/DefaultRolesMigrationTest` |
   | 17 | `Media/PurgeSpeechMediaTest` |
   | 18 | `CoachApplication/CoachApplicationDecisionTest`, `CoachApplication/CoachApplicationHttpTest`, `Admin/CoachApplicationReviewPageTest` |
   | 19 | `Review/ReviewRevocationAuditTest` |
   | 20 | `Review/ReviewRevocationAuditTest`, `ReviewServiceTest`, `ReviewInvitationHttpTest`, `ReviewRosterHttpTest`, `RevokeReviewRequestHttpTest` |
   | 21 | `Review/ReviewRevocationAuditTest`, `ReviewInvitationHttpTest`, `RevokeReviewRequestHttpTest`, `Annotation/VoiceLifecycleTest` |
   | 22 | `Review/ReviewRevocationAuditTest`, `ReviewServiceTest` |
   | 23 | `Admin/RoleAssignmentServiceTest`, `Admin/PanelModerationTest`, `Admin/UserSurfaceTest`, the three coach-application tests of site 18 |
   | 24 | `Speech/SpeechDeletionServiceTest`, `SpeechEditDeleteHttpTest`, `SpeechEditDeletePolicyTest`, `Privacy/DataExportHttpTest` |
   | 25 | `Privacy/AccountErasureServiceTest`, `Privacy/PrivacyEraseCommandTest` |

   - **Every arm of a variable value is exercised:**
     - site 8: `user.suspended` and `user.unsuspended`;
     - site 18: `coach_application.approved` and `coach_application.rejected`. Its ternary makes it variable too, which rev 1 missed;
     - site 23: `role.assigned` and `role.revoked`;
     - site 15's subject type: `Speech` and `Review`.
   - **Action plus subject type doesn't identify a site,** because some pairs repeat. Sites 3 and 5 both write `admin.viewed_speech` on `Speech`, 8 and 11 both `user.suspended`, and 16 and 23 both `role.assigned`. Use the call-site file and line instead.
   - A site no test exercised would still need a characterization test before refactoring (§4), or a recorded reason why a static read is enough.
5. Remove the listener (`git checkout -- api/tests/Pest.php`). It must never be committed.

## §4 Optional tests

- **`tests/Unit/AuditLogRecordTest.php`:**
  - `record()` writes all eight columns;
  - `ip` and `user_agent` come from the request when given, and are `null` otherwise;
  - `created_at` is set and `metadata` round-trips.
  - **It needs `uses(RefreshDatabase::class);`.** `tests/Pest.php` binds RefreshDatabase to `Feature` only, so as rev 1 wrote it, both tests error with "no such table: users" / "no such table: audit_log". Putting the file under `tests/Feature/` works equally well.
  - Validated: 2 tests, 13 assertions. `Request::create(..., server: ['REMOTE_ADDR' => …, 'HTTP_USER_AGENT' => …])` supplies the request, and `Carbon::setTestNow()` pins `created_at`. The suite becomes 1557 tests (1522 passed, 35 skipped, 7749 assertions). Its 4 ledger lines are the only ledger change.
  - It is the only test that catches §5's first mutation, which otherwise only the ledger sees. That makes it worth keeping, not just optional.
- **Characterization tests** for any site §3 step 4 found unexercised. They must pass on the unrefactored code first. At `b2c5e8e` there are none (§3 step 4).

## §5 Verification

- **CI's commands, from `api/`:** `./vendor/bin/pint --test`, `php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G`, `php -d memory_limit=1G vendor/bin/pest`. The host's php.ini is 128M, which is why pest needs the flag.
- **Expected:** pint passes; phpstan 0 errors; pest 1555 tests (1520 passed, 35 skipped), plus any §4 tests.
  - Validated after §1 and §2: exactly that, with 7736 assertions and per-test outcomes unchanged.
  - With §4's test added: 1557 tests (1522 passed, 35 skipped).
  - **Scratch copies:** copy `web/src` beside `api/`, or expect 1517 passed and 38 skipped (see Baseline).
- **Mutation checks** (the ledger diff and/or tests must go red; revert after each). All four went red as predicted, and each revert left `git diff -- api/app` empty:
  - drop `'ip' => $request?->ip()` from `record()`: the ledger goes red on 14 lines (`ip` on every `account.export.requested`, `account.export.downloaded` and `report.created` row) while all 1555 tests stay green. With §4's test present, that test fails too;
  - swap `actor_id` and `subject_id` in `record()`: 14 tests go red (9 failures and 5 errors, one of them an `audit_log` FK violation). The ledger goes red on 133 lines: 131 differing and 2 missing;
  - pass `metadata: []` at site 19: `ReviewRevocationAuditTest`'s withdraw test errors (`Undefined array key "speech_id"`), and the ledger goes red on 4 lines;
  - pass `REVIEW_WITHDRAWN` at site 22: `ReviewRevocationAuditTest`'s abandon test fails, and the ledger goes red on 6 lines.

## §6 Out of scope

- **The remaining work in this area:**
  - turning `App\Support\AuditAction` into a PHP enum;
  - Filament audit "view" logging policy;
  - adding `ip` and `user_agent` to more sites. That would change rows, so it's a behavior decision, not DRY;
  - bounding `user_agent` to its `VARCHAR(255)`. On Postgres, a longer `User-Agent` header should fail the insert at sites 13–15; this is pre-existing, and `record()` would be the one place to fix it. SQLite doesn't enforce the length, so the suite can't show it, and it wasn't run against Postgres here. Truncating changes rows, so it's a behavior decision too.
- **Model observers or automatic auditing.** The STEP-11 contract keeps writes explicit at their call sites.

## §7 Review log

- rev 1 (2026-11-18): drafted from an inventory of every `AuditLog` write at `b2c5e8e`, the `audit_log` migration, the model, the STEP-11 contract §2, and the list of tests that read audit rows.
- rev 2 (2026-11-18): adversarial validation on a scratch copy of `b2c5e8e` (only `api/` and `web/src`; pest on SQLite `:memory:`, no artisan, no database server).
  - **Applied verbatim:** §1, then §2 with named arguments at all 25 sites. pint passes, phpstan 0, pest 1555 (1520/35). The ledger diff against the baseline is empty (264 = 264 lines) and per-test outcomes are identical.
  - **Each site checked mechanically:** the same five expressions, `request:` only at 13–15, and the null `ip`/`user_agent` dropped only at 19–22 and 24.
  - **Coverage:** all 25 sites exercised; no characterization tests needed.
  - **Held up:** the site table (every line number, 25 sites in 13 files), the schema facts, "no caller uses the returned model", "none asserts `ip` or `user_agent`", and all four §5 mutations.
  - **Findings and fixes:**
    - **MAJOR, §3 step 1:** "add a `beforeEach`" to `tests/Pest.php`. A bare `beforeEach()` there never runs, so both ledgers come out empty and the diff passes vacuously. Fix: `pest()->beforeEach(...)->afterEach(...)->in('Feature', 'Unit')`, plus a non-empty sanity bar (264 lines at `b2c5e8e`).
    - **MAJOR, §3 step 2:** "seed Faker in the same `beforeEach`" doesn't make the ledger deterministic. `Faker\Generator::__destruct()` calls `mt_srand()` with no seed when the cycle collector frees the previous test's generator mid-test, and one row kept changing between runs. Fix: `gc_collect_cycles()` before `mt_srand(crc32($test))`.
    - **MINOR, §3 step 2:** the normalization list (ULID/UUID) missed wall-clock timestamps (`speech.media_purged`'s `taken_down_at`). Fix: normalize ISO-8601 too. The 42 volatile lines and their sources are now listed.
    - **MINOR, §2:** both greps' expected outputs were wrong. The create grep returns nothing (the helper uses `self::query()`), and the update/delete grep returns the model's own docblock line, already present at `b2c5e8e`. Fix: corrected outputs, plus positive checks (25 `record(` calls in 13 files, all bare statements).
    - **MINOR, §4:** the test as specified errors in `tests/Unit`, which has no schema. Fix: `uses(RefreshDatabase::class)`. Validated, and it is the only test that catches the `ip` mutation.
    - **MINOR, Existing coverage:** two of the 13 listed files (`Admin/ReportSurfaceTest`, `Unit/AdminSceneTest`) don't read audit rows; 11 do. The ledger shows 23 files exercising the sites.
    - **MINOR, §3 step 4:** only sites 8 and 23 were named as variable. Site 18's ternary emits two actions, and site 15's subject type varies. Every arm is exercised; the coverage table is added.
    - **MINOR, Baseline:** a scratch copy without `web/src` gives 1517 passed / 38 skipped. Noted.
    - **NIT:** §1 placement specified, and its phpstan widening caveat is moot. §2's comment handling at sites 8 and 17 specified, and its imports step is a no-op. §3's ledger now also records a per-test sequence, the call-site file and the stored row read back in `afterEach`. §6 notes the `user_agent` length.
