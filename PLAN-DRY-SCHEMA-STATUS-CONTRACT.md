# Plan: one contract for the schema's CHECK value lists

**Status:** rev 2, 2026-11-14. **Implemented in the working tree on 2026-11-15** (code, tests, command, script, CI step and README; no migration touched). The §6.3 capture was done against the dev stack's PostgreSQL 17 catalog: 25 CHECK rows, 15 in the §1.3 form, `annotations_timing_type_check` as predicted, and `CheckListContract::compare()` on the parsed rows reports no drift. Still not run: the script itself on the e2e stack (needs `./scripts/e2e-stack.sh up --fresh`), and M8.
- **rev 2 validation (adversarial pass).** Nothing ran in the repo, and no artisan command ran outside Pest. The plan was applied in its step order to a scratch copy of `b2b2bee`. The copy first got the sibling plan's two enum files, verbatim (PLAN-DRY-BACKEND-VOICE.md §1.1, §2.1). CI's commands ran after each step:

  | Step | pint | phpstan | pest |
  |---|---|---|---|
  | prereq: the two enums | pass | 0 errors | 1451 (1416 passed, 35 skipped), the baseline |
  | §1+§2 as rev 1 wrote it | pass | **3 errors** (`arrayValues.list`; fixed in §1.1) | — |
  | §1+§2, phpstan fix and `TranscriptStatus` row | pass | 0 errors | 1476 (+25) |
  | §3 | pass | 0 errors | 1478 (+27) |
  | §4, §5 | pass | 0 errors | 1478; `bash -n` and a YAML parse of ci.yml pass |
  | rev 2 fixes (`compare()` and §2.1b, `values()` owners, tightened pass test) | pass | 0 errors | **1484 (1449 passed, 35 skipped), +33** |

  - The inventory held: 15 value-list CHECKs on 9 tables, with the values as tabled. `schema:check-lists` prints `driver=sqlite lists=15 contracted=5 unowned=10`.
  - M1–M7 and M9–M13 (§6.4) went red with the messages quoted there.
  - The rev 2 fixes were validated on the final tree, not replayed step by step. Under the rev 2 text, §1+§2 adds 31 tests and §3 adds 2.
- **Not verified: the PostgreSQL strings.** The host's Postgres 14 install is broken (a missing ICU library), and docker was off-limits. The `pg_get_constraintdef` strings in §1.3 are PostgreSQL's standard normal form, not captured output. Reading the migrations supports that form (§6.3). **Capture the real PG 17 strings (§6.3) before merging, not after**: if they differ, the whole e2e job goes red on the first CI run.

**Scope:** `api/` (one support class, one artisan command, three test files), one new script, one CI step and one new README. **No migration is added or changed.**

**Depends on** `App\Enums\SpeechAssetStatus` and `App\Enums\TranscriptStatus` from PLAN-DRY-BACKEND-VOICE.md (its §1.1 and §2.1; that plan includes both). **This plan lands after that plan's enum steps.**
- It needs only the two enum files and their static `values(): list<string>`.
- If either enum hasn't landed, §1.4 has a fallback.

**Baseline:** `development` at `b2b2bee`, with PLAN-DRY-VOICE-PLAYBACK.md untracked. Line numbers refer to that tree.

**Origin:** PLAN-DRY-VOICE-PLAYBACK.md §7 #10 (`:393-399`). That decision stands and is not reopened:
- migrations that have run are never rewritten;
- future migrations keep literal lists and never call app code;
- drift is caught by a contract test that compares the live database to the PHP lists.

## Goal

| Duplication | One owner after | Guard |
|---|---|---|
| 15 value-list CHECKs on 9 tables repeat values that PHP also holds. Only 3 have a PHP list today; the sibling plan's two enums make it 5. The `speech_assets.status` list alone is written 6 times across 3 migrations. | `App\Support\CheckListContract` maps each `table.column` CHECK to its PHP owner (5), or lists it in `UNOWNED` with what would own it (10). | SQLite: a Pest test in the `test` job. PostgreSQL: `schema:check-lists`, run by a new script in the `e2e` job. Both read the same map. |

After this lands, the build fails when:
- a CHECK list and its enum or constant differ (in either direction, as sets);
- a contracted CHECK disappears (for example, a Blueprint rebuild on SQLite, §6.4 M5);
- a migration adds a value-list CHECK that the map doesn't name;
- a migration refers to a contract owner, the one thing a CHECK-vs-enum comparison can't see (§2.2).

**No user-visible change and no schema change.**

## What the review established

### Inventory (every value-list CHECK, final state after all migrations)

"Live text from" is the line whose text the migrated database actually holds. The two drivers differ, because Postgres alters constraints in place and SQLite rebuilds whole tables.

| # | `table.column` | Constraint | Values | SQLite: live text from | PostgreSQL: live text from | PHP list today | This plan |
|---|---|---|---|---|---|---|---|
| 1 | `speech_assets.status` | `ck_speech_assets_status` | uploading, processing, ready, failed | `2026_08_18_110001:48` | `2026_08_08_150003:100-101` (never dropped) | none; `SpeechAssetStatus` is coming | **contract** |
| 2 | `speech_assets.kind` | `ck_speech_assets_kind` | source, video, captions, poster, sprite, voice_note | `2026_08_18_110001:46` | `2026_08_18_110001:86` | subset only: `PurgeSpeechMedia::PURGED_KINDS` (`PurgeSpeechMedia.php:162`) omits voice_note on purpose | UNOWNED |
| 3 | `speech_assets.format` | `ck_speech_assets_format` | mp4, mov, hls, vtt, webp, jpeg, m4a | `2026_08_18_110001:47` | `2026_08_18_110001:87` | none | UNOWNED |
| 4 | `annotations.kind` | `ck_annotations_kind` | praise, correction, observation | `2026_08_18_110002:26` | `2026_08_12_100001:76-77` | inline literal in `Rule::in([...])`, `AnnotationRules.php:18` | UNOWNED (later) |
| 5 | `annotations.transcript_status` | `ck_annotations_transcript_status` | not_applicable, pending, processing, ready, failed | `2026_08_18_110002:28` | `2026_08_18_110002:45` | none; `TranscriptStatus` is coming | **contract** |
| 6 | `annotations.timing_type` | none on SQLite; Postgres default-names it `annotations_timing_type_check` (unverified) | range, point | `2026_10_20_000001:14`, inline in the column definition | same line | literals only (`AnnotationTiming.php:57, :68, :91-94, :110-111`) | UNOWNED |
| 7 | `reviews.status` | `ck_reviews_status` | invited, declined, accepted, in_progress, published, abandoned | `2026_08_09_100001:78-79` | `:115-116` | subset only: `Review::ACCESS_GRANTING` (`Review.php:100`) | UNOWNED |
| 8 | `speech_transcripts.source` | `ck_speech_transcripts_source` | whisper, edited | `2026_08_17_100002:62-63` | `:82-83` | none | UNOWNED |
| 9 | `reports.reason` | `ck_reports_reason` | harassment, inappropriate_content, impersonation, spam, other | `2026_08_20_100001:52-53` | `:75-76` | `Report::REASONS` (`Report.php:55`) | **contract** |
| 10 | `reports.state` | `ck_reports_state` | open, actioned, dismissed | `2026_08_20_100001:54-55` | `:77-78` | `Report::STATES` (`Report.php:53`) | **contract** |
| 11 | `data_exports.kind` | `ck_data_exports_kind` | account, reviewer_annotations | `2026_08_20_100003:42-43` | `:62-63` | `DataExport::KINDS` (`DataExport.php:34`) | **contract** |
| 12 | `data_exports.status` | `ck_data_exports_status` | processing, ready, failed | `2026_08_20_100003:44-45` | `:64-65` | none. **Not** `SpeechAssetStatus`: it has no `uploading`. | UNOWNED |
| 13 | `coach_applications.status` | `ck_coach_applications_status` | draft, submitted, under_review, approved, rejected, withdrawn | `2026_08_22_100001:54-55` | `:74-75` | subsets only (below) | UNOWNED |
| 14 | `application_documents.status` | `ck_application_documents_status` | pending_scan, clean, infected | `2026_08_22_100002:42-43` | `:60-61` | none | UNOWNED |
| 15 | `connections.state` | `ck_connections_state` | pending, accepted, declined, blocked | `2026_08_30_100001:69-70` | `:100-101` | none (the keys of a private map, `ReconcileConnectionAsymmetryCommand.php:21`) | UNOWNED |

The SQLite column is confirmed by the scratch replay; its parser output lists exactly these 15 rows with these values. The PostgreSQL column comes from following each migration's `else` branch.
- `2026_08_08_160001` drops and re-adds only `kind`, `format` and `kind_format` (`:109-131`).
- `2026_08_18_110001` drops only those three (`:83-85`) and re-adds them (`:86-97`).
- `2026_08_18_110002`'s Postgres branch adds only `transcript_status` (`:39-45`).

**CHECKs that are not value lists** (out of scope; §7):
- `ck_speech_assets_kind_format`: SQLite `110001:49-56`, PG `110001:88-97`, kind↔format pairs.
- `ck_voice_note_not_primary`: `110001:57`, `:98`.
- `ck_annotations_timing`: SQLite `110002:27`, PG `2026_08_12_100001:78-79`.
- `ck_speeches_supersedes_older`: `2026_08_08_150002:54-55, :78-79`.
- `ck_reviews_counter_cache` and `ck_reviews_counters_nonnegative`: `2026_08_09_100001:80-83, :117-120`.
- `ck_connections_no_self`, `_initiator`, `_blocker` and `_blocked`: `2026_08_30_100001:61-68, :92-99`.

**Value lists in partial-index predicates, not CHECKs** (out of scope; §7):
- `ix_reviews_timeline` and `ix_reviews_incoming`: `WHERE status IN ('accepted','in_progress','published')` (`2026_08_30_100002:31-39`), which equals `Review::ACCESS_GRANTING`.
- `uq_coach_app_live`: `WHERE status IN ('draft', 'submitted', 'under_review')` (`2026_08_22_100001:84-85`).

### The six copies of the status list

All six cited lines are right: `2026_08_08_150003:64, :101`, `2026_08_08_160001:79, :179` and `2026_08_18_110001:48, :131`. **Only one copy is live per driver, and it's a different copy on each:**
- **SQLite:** `110001:48`, the last rebuild's `up`.
- **PostgreSQL:** `150003:101`, the create migration. No later migration drops `ck_speech_assets_status` on Postgres.
- **Never live after a full migrate:**
  - `150003:64` and `160001:79` are SQLite tables that later rebuilds replace;
  - `160001:179` and `110001:131` are SQLite `down()` copies.

The kind and format lists have about ten copies each (`150003:60, :97`; `160001:75, :112, :175, :229`; `110001:46, :86, :129, :148`).

### PHP lists that hold the same values

| PHP list | Where | Relation to the CHECK | Decision |
|---|---|---|---|
| `Report::REASONS` | `Report.php:55`; read by `CreateReportRequest.php:30` and `ReportFactory.php:26` | equal to #9 | **now** |
| `Report::STATES` | `Report.php:53`; only comments refer to it (`ReportPolicy.php:24`, `ModerationQueuesWidget.php:126`) | equal to #10 | **now** |
| `DataExport::KINDS` | `DataExport.php:34`; read by `RequestDataExportRequest.php:23` | equal to #11 | **now** |
| `SpeechAssetStatus` (planned) | sibling plan §1.1 | equal to #1 | **now** (the dependency) |
| `TranscriptStatus` (planned) | sibling plan §2.1 | equal to #5 | **now** (the dependency) |
| `Rule::in(['praise','correction','observation'])` | `AnnotationRules.php:18` (inline, not a constant) | equal to #4 | later: extract `AnnotationRules::KINDS`, then contract it |
| `Review::ACCESS_GRANTING` | `Review.php:100` | subset of #7; equals the predicate of two partial indexes | later: a subset contract (§7) |
| `CoachApplication::UNDECIDED_STATUSES` | `CoachApplication.php:50` | subset of #13 (submitted, under_review) | no: a subset by design |
| `CoachApplicationResource::STATUS_BADGES` | `:65-71` | #13 minus `draft` ("drafts never reach the panel", `:73-74`) | no |
| `PurgeSpeechMedia::PURGED_KINDS` | `PurgeSpeechMedia.php:162` | #2 minus `voice_note`, on purpose (`:155-157`) | no |
| `CommentaryPlaybackPreference::MODES`, `VoicePreferenceController.php:29` modes, `SpeechDeletionReason`, `AuditAction`, `Role` | — | no CHECK exists (`deleted_reason` deliberately has none: `2026_09_02_100001:16-20`) | n/a |

**There is no PHP enum in the app today.** `grep -rl '^enum ' api/app` is empty and `api/app/Enums/` doesn't exist, so `SpeechAssetStatus` will be the first.

### Infrastructure (verified)

**Tests**
- Tests run on SQLite `:memory:` (`phpunit.xml:26-27`).
- Feature tests get `RefreshDatabase` (`tests/Pest.php:17-19`). It runs `migrate:fresh` once per process and keeps the in-memory PDO (`RefreshDatabase.php:83-91, :117-120`), then wraps each test in a transaction.
- Unit tests boot the app (`Pest.php:24-25`) but don't migrate.
- There is no `tests/Feature/Schema/` yet. Feature folders are named by domain. Unit is mostly flat: `tests/Unit/KeysetCursorTest.php` covers `App\Support\KeysetCursor`, and there are two subfolders.
- **Existing CHECK tests are behavioural.** They insert a bad value and expect a `QueryException` (for example `SpeechTranscriptsMigrationTest.php:30-38`). No test reads `sqlite_master` or `pg_constraint`.
- **The one pgsql-gated Pest test never runs in CI.** It skips itself everywhere CI runs it (`TranscriptControllerTest.php:265-267`).

**CI**
- The `test` job runs `./vendor/bin/pest` (`ci.yml:99`) with no Postgres (`:89-98`).
- The `e2e` job installs no PHP or Composer on the runner (`ci.yml:177-188`). It builds and migrates the stack through `scripts/e2e-stack.sh up --fresh`: `_compose build` at `:173` and `migrate --force` at `:182`. New `api/` code is therefore baked into the image the e2e scripts exec into.
- It then runs `./scripts/verify-postgres-voice-schema.sh` (`ci.yml:288-289`).

**`verify-postgres-voice-schema.sh`**
- It reads definitions with `pg_get_constraintdef` (`:26-33`), but **checks substrings only** (`:41-44`, `:47-50`).
- `*"processing"*` passes for any list that contains the word. Adding a case to an enum never fails it, and neither does adding a value to the CHECK.

**The app image**
- `composer install --no-dev` (`Dockerfile:39, :41`), so the container has no Pest.
- `laravel/tinker` is a runtime dependency (`composer.json:17`).
- All of `api/` is copied in (`Dockerfile:40, :118`).
- Commands in `app/Console/Commands/` are auto-discovered: `bootstrap/app.php:17` leads to `ApplicationBuilder.php:334-346`. `AuditAnnotationTimingCommand` is registered nowhere else.

**Laravel 13.24.0** (`composer.lock:2666`). Two SQLite behaviours matter here, both reproduced in the scratch replay:
- **`ADD COLUMN` inserts the new column after the last column definition, before the table constraints.** `2026_08_18_110006`'s two Blueprint columns land as `updated_at DATETIME NULL, "purge_reviewer_id" integer, "normalization_candidate_path" varchar,`. `timing_type`'s unnamed CHECK lands inline on the `deleted_at` line (§1.2).
- **A Blueprint `->change()`, `->foreign()`/`->constrained()`, `dropForeign`, `->primary()` or `dropPrimary` rebuilds the table from column metadata.** These are the alter commands at `SQLiteGrammar.php:34-43`, and `compileAlter` (`:324-371`) does the rebuild. In the replay, `->foreign('purge_reviewer_id')` on `speech_assets`:
  - dropped all five CHECKs;
  - turned `uq_assets_primary` (`… WHERE is_primary`) and `uq_assets_captions_one_per_speech` (`… WHERE kind = 'captions'`) into plain unique indexes;
  - raised no error.
- **No migration does this to a CHECK-bearing table today.** The only `->change()` is on `users` (`2026_08_07_004005:23, :46`), and `users` has no CHECK. `2026_08_18_110002`'s `->constrained()` (`:40`) is in the Postgres branch only.

**Migrations that already use app code.** `2026_08_07_000612_create_default_roles.php:3` uses `App\Support\Role`, and `2026_09_01_100001_backfill_member_role_for_roleless_users.php:3-4` uses `App\Models\User` and `App\Support\Role`. Neither touches a CHECK list. **So §2.2's guard forbids contract owners only, not all of `App\`.** No migration mentions `Report::`, `DataExport::`, `SpeechAssetStatus`, `TranscriptStatus` or `App\Enums` (grep exit 1).

**Docs**
- There is no conventions doc. `api/README.md` is the stock Laravel README, and the root `README.md` is the project summary. The repo has no `CLAUDE.md` and no `api/stubs/`.
- The migrator only globs `*_*.php` (`Migrator.php:581`), so a README in `database/migrations/` is never run.

**Coding conventions:** pint `laravel` preset (`pint.json`), phpstan level 8 (`phpstan.neon:53`). Raw `select()` rows are read with casts elsewhere (`SpeechArcService.php:49`).

### Facts from the brief, checked

| Claim | Result |
|---|---|
| Tests run on SQLite `:memory:` (`phpunit.xml:26-27`) | correct |
| CI runs `./vendor/bin/pest` in `test` (`ci.yml:99`) | correct |
| e2e runs `verify-postgres-voice-schema.sh` (`ci.yml:289`) | correct (the step name is on `:288`) |
| That script reads `pg_get_constraintdef` | correct (`:26-33`), but it only compares substrings |
| The status list is at `150003:64,101`, `160001:79,179`, `110001:48,131` | correct; only one copy is live per driver, and on Postgres it's `150003:101`, not the newest |
| `ck_annotations_*` in `2026_08_12_100001` and `2026_08_18_110002` | correct; Postgres never re-creates them |
| `transcript_status` CHECK at `110002:28,45` | correct |
| The lists to guard are status, kind, format, transcript and timing | incomplete: 15 value-list CHECKs on 9 tables, 3 with a PHP list today (5 with the sibling enums) |

**None of the stated facts was wrong.**

## Ground rules

- **No migration is edited or added.** The mutation checks (§6.4) add scratch migrations and delete them again.
- **There is one map:** `CheckListContract::contracts()` plus `::UNOWNED`. The Pest tests and the Postgres command both read it; nothing else lists the values. The map holds `table.column` keys, never value literals. The values come from the PHP owners.
- **Lists compare as sets**, so order inside a CHECK doesn't matter. A separate count check catches duplicates.
- **Fail closed:**
  - an unknown driver throws;
  - a CHECK the parser doesn't recognise counts as *missing* (contracted) or *stale* (UNOWNED);
  - a scan that finds nothing fails the command.
- **Seam check before coding.** Memory notes that parallel plans meet at a seam that both sides' green reports miss. Open the merged enums (or the backend plan's final text) and confirm, for `SpeechAssetStatus` and `TranscriptStatus` each:
  - the FQCN is `App\Enums\…`;
  - it is string-backed;
  - its values are exactly the inventory's (#1: four; #5: five);
  - it has `public static function values(): array`, typed `list<string>` (§1.1 reads it).

  rev 2 checked the sibling plan's text: all four hold for both. If an enum is missing, use §1.4's fallback and adjust only the `use` lines and `contracts()` rows.
- **Order and commits:** §1+§2 → §3 → §4 → §5, one commit each.
- **After each step, run CI's commands in `api/`:**
  - `./vendor/bin/pint --test`
  - `php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G`
  - `./vendor/bin/pest`

  On the host, use `php -d memory_limit=2G vendor/bin/pest`. The host php.ini caps memory at 128M, and a full run then crashes inside `AvatarExifStrippingTest`. That crash is not a regression.
- **Never run `php artisan …` by hand in a working copy whose `api/.env` points at a real database.** The developer's copy, and any scratch copy of it, points at the dev Postgres. An override such as `DB_CONNECTION=sqlite` is ignored once config is cached, and `migrate:fresh --force` then wipes that database. Run the command through Pest (`$this->artisan(…)` on SQLite `:memory:`, §2.2) or on the e2e stack (§6.1).

## §1 `App\Support\CheckListContract` (new: `api/app/Support/CheckListContract.php`)

### 1.1 The class

This is the exact text validated in rev 2, against the real `Report` and `DataExport` models and the sibling plan's two enums: pint, phpstan level 8 and Pest are clean.

```php
<?php

namespace App\Support;

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;
use App\Models\DataExport;
use App\Models\Report;
use Illuminate\Database\Connection;
use RuntimeException;

/**
 * The value lists that database CHECK constraints enforce, each tied to the PHP list that owns
 * it (PLAN-DRY-SCHEMA-STATUS-CONTRACT.md).
 *
 * Migrations keep literal lists and never call app code: an enum edit must not change what a
 * fresh `migrate` builds for an old migration. This class is the drift guard instead. It reads
 * every `CHECK (column IN ('a', …))` from the live catalog (sqlite_master on SQLite,
 * pg_get_constraintdef() on PostgreSQL) and compares each list, as a set, to its owner.
 *
 * Run by tests/Feature/Schema/CheckListContractTest.php (SQLite) and by
 * `php artisan schema:check-lists` from scripts/verify-postgres-check-lists.sh (PostgreSQL).
 * Conventions: api/database/migrations/README.md.
 */
final class CheckListContract
{
    /** Value-list CHECKs with no single PHP owner yet: table.column => what would own it. */
    public const UNOWNED = [
        'annotations.kind' => 'AnnotationRules::metadata() inlines the list; extract a constant',
        'annotations.timing_type' => "'range'/'point' literals in AnnotationTiming; a timing-type enum",
        'application_documents.status' => 'no PHP list yet',
        'coach_applications.status' => 'no full PHP list; STATUS_BADGES omits draft on purpose',
        'connections.state' => 'no PHP list yet',
        'data_exports.status' => 'no PHP list yet; not SpeechAssetStatus (no uploading)',
        'reviews.status' => 'no full PHP list; Review::ACCESS_GRANTING is a subset',
        'speech_assets.format' => 'no PHP list yet; pairs with ck_speech_assets_kind_format',
        'speech_assets.kind' => 'no full PHP list; PurgeSpeechMedia::PURGED_KINDS is a subset',
        'speech_transcripts.source' => 'no PHP list yet',
    ];

    /** `CHECK (column IN ('a', …))`, optionally named, in sqlite_master text (any case, quoting, whitespace). */
    private const SQLITE_LIST = <<<'REGEX'
        /(?:\bCONSTRAINT\s+["`\[]?(?<name>\w+)["`\]]?\s+)?\bCHECK\s*\(\s*["`\[]?(?<column>\w+)["`\]]?\s+IN\s*\((?<list>\s*'(?:[^']|'')*'(?:\s*,\s*'(?:[^']|'')*')*\s*)\)\s*\)/i
        REGEX;

    /** The same CHECK as pg_get_constraintdef() normalizes it for a VARCHAR column; anything else is not a list. */
    private const PGSQL_LIST = <<<'REGEX'
        /^CHECK \(\(\((?<column>\w+)\)::text = ANY \(\(ARRAY\[(?<list>'(?:[^']|'')*'::character varying(?:, '(?:[^']|'')*'::character varying)*)\]\)::text\[\]\)\)\)$/
        REGEX;

    /**
     * table.column => the PHP list that owns it.
     *
     * @return array<string, array{owner: class-string, label: string, values: list<string>}>
     */
    public static function contracts(): array
    {
        return [
            'annotations.transcript_status' => ['owner' => TranscriptStatus::class, 'label' => 'TranscriptStatus::values()', 'values' => TranscriptStatus::values()],
            'data_exports.kind' => ['owner' => DataExport::class, 'label' => 'DataExport::KINDS', 'values' => DataExport::KINDS],
            'reports.reason' => ['owner' => Report::class, 'label' => 'Report::REASONS', 'values' => Report::REASONS],
            'reports.state' => ['owner' => Report::class, 'label' => 'Report::STATES', 'values' => Report::STATES],
            'speech_assets.status' => ['owner' => SpeechAssetStatus::class, 'label' => 'SpeechAssetStatus::values()', 'values' => SpeechAssetStatus::values()],
        ];
    }

    /**
     * Every value-list CHECK in the live schema, keyed table.column (several hits for one key is drift).
     *
     * @return array<string, list<array{name: string|null, values: list<string>}>>
     */
    public static function liveLists(Connection $db): array
    {
        $found = [];
        $driver = $db->getDriverName();

        if ($driver === 'sqlite') {
            $tables = $db->select("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL");
            foreach ($tables as $table) {
                foreach (self::parseSqliteTable((string) $table->sql) as $hit) {
                    $found[$table->name.'.'.$hit['column']][] = ['name' => $hit['name'], 'values' => $hit['values']];
                }
            }
        } elseif ($driver === 'pgsql') {
            $checks = $db->select(<<<'SQL'
                SELECT t.relname AS table_name, c.conname AS name, pg_get_constraintdef(c.oid) AS definition
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE c.contype = 'c' AND n.nspname = current_schema()
                SQL);
            foreach ($checks as $check) {
                $hit = self::parsePostgresDefinition((string) $check->definition);
                if ($hit !== null) {
                    $found[$check->table_name.'.'.$hit['column']][] = ['name' => (string) $check->name, 'values' => $hit['values']];
                }
            }
        } else {
            throw new RuntimeException("CheckListContract reads sqlite and pgsql catalogs, not {$driver}.");
        }

        ksort($found);

        return $found;
    }

    /**
     * Every way the live schema disagrees with contracts() and UNOWNED; empty means no drift.
     *
     * @return list<string>
     */
    public static function drift(Connection $db): array
    {
        return self::compare(self::liveLists($db), self::contracts(), self::UNOWNED);
    }

    /**
     * drift() without the database, so each rule is unit-testable on made-up lists.
     *
     * @param  array<string, list<array{name: string|null, values: list<string>}>>  $live
     * @param  array<string, array{owner: class-string, label: string, values: list<string>}>  $contracts
     * @param  array<string, string>  $unowned
     * @return list<string>
     */
    public static function compare(array $live, array $contracts, array $unowned): array
    {
        $problems = [];

        foreach (array_keys(array_intersect_key($contracts, $unowned)) as $key) {
            $problems[] = "{$key}: listed in both contracts() and UNOWNED";
        }
        foreach ($live as $key => $hits) {
            if (count($hits) > 1) {
                $problems[] = "{$key}: ".count($hits).' value-list CHECKs on one column; expected one';
            }
            if (! isset($contracts[$key]) && ! array_key_exists($key, $unowned)) {
                $problems[] = "{$key}: value-list CHECK with no PHP owner; add it to CheckListContract::contracts() or UNOWNED (api/database/migrations/README.md)";
            }
        }
        foreach ($contracts as $key => $contract) {
            $actual = $live[$key][0]['values'] ?? null;
            if ($actual === null) {
                $problems[] = "{$key}: no value-list CHECK found for {$contract['label']}";

                continue;
            }
            $lacks = array_values(array_diff($contract['values'], $actual));
            $adds = array_values(array_diff($actual, $contract['values']));
            if ($lacks !== [] || $adds !== [] || count($actual) !== count(array_unique($actual))) {
                $problems[] = sprintf('%s: CHECK differs from %s (database lacks [%s]; database adds [%s]; %d values in the CHECK)',
                    $key, $contract['label'], implode(', ', $lacks), implode(', ', $adds), count($actual));
            }
        }
        foreach (array_keys($unowned) as $key) {
            if (! isset($live[$key])) {
                $problems[] = "{$key}: listed in UNOWNED but no such CHECK exists; remove the entry";
            }
        }

        return $problems;
    }

    /** @return list<array{column: string, name: string|null, values: list<string>}> */
    public static function parseSqliteTable(string $createSql): array
    {
        preg_match_all(self::SQLITE_LIST, $createSql, $matches, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);

        return array_map(fn (array $m): array => [
            'column' => (string) $m['column'],
            'name' => $m['name'],
            'values' => self::literals((string) $m['list']),
        ], $matches);
    }

    /** @return array{column: string, values: list<string>}|null */
    public static function parsePostgresDefinition(string $definition): ?array
    {
        if (preg_match(self::PGSQL_LIST, $definition, $m) !== 1) {
            return null;
        }

        return ['column' => $m['column'], 'values' => self::literals($m['list'])];
    }

    /** @return list<string> */
    private static function literals(string $list): array
    {
        preg_match_all("/'((?:[^']|'')*)'/", $list, $m);

        return array_map(fn (string $value): string => str_replace("''", "'", $value), $m[1]);
    }
}
```

**Design notes**
- **Keyed by `table.column`, not by constraint name.** `timing_type`'s CHECK has no name on SQLite and an auto-name on Postgres. Each list column has exactly one list CHECK, and the duplicate check enforces that. Names are kept only for messages.
- **The regexes are nowdocs, not `trim()`med strings.** Flexible nowdoc strips the closing marker's indentation and adds no trailing newline (checked). phpstan sees a constant string, which lets it infer the named-group shapes.
- **Why `app/`, not `tests/`.** The class must run inside the `--no-dev` app container for the Postgres side, which has no `Tests\` autoload. It is read-only, like `annotations:timing-audit` (`AuditAnnotationTimingCommand.php:9`).
- **Enum owners are read through the sibling enums' `values()`**, so the list-building code lives in one place (PLAN-DRY-BACKEND-VOICE.md §9 asks for exactly this). rev 1's private `enum()` helper, which rebuilt the list from `cases()`, and its `BackedEnum` import are gone.
- **`drift()` is a thin wrapper over the pure `compare($live, $contracts, $unowned)`.** Each rule can then be unit-tested on made-up lists (§2.1b). The migrated schema never shows most of these failures, so the Feature tests alone can't prove the rules fire. The maps are parameters for the same reason: "a key in both maps" can't be staged with the real constants.
- **phpstan level 8 (validated: 0 errors).**
  - **Don't wrap `array_map()` in `array_values()`.** phpstan 2.2 keeps `list<…>` through `array_map` over a list, and it reports the wrapper as `arrayValues.list` ("Parameter #1 $array (list<…>) of array_values is already a list, call has no effect"). rev 1 had three such wrappers: in `parseSqliteTable()`, `enum()` and `literals()`. `array_values(array_diff(…))` stays, because `array_diff` keeps keys.
  - The other risk points pass: property reads on `select()` rows (precedent `SpeechArcService.php:49`) and the named-group shapes from `preg_match_all`.

### 1.2 What the SQLite parser reads (real text)

`2026_08_18_110001:44-48` writes this (the heredoc's indentation is stripped):
```
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    CONSTRAINT ck_speech_assets_kind CHECK (kind IN ('source','video','captions','poster','sprite','voice_note')),
                    CONSTRAINT ck_speech_assets_format CHECK (format IN ('mp4','mov','hls','vtt','webp','jpeg','m4a')),
                    CONSTRAINT ck_speech_assets_status CHECK (status IN ('uploading','processing','ready','failed')),
```
After `2026_08_18_110006`'s two Blueprint `ADD COLUMN`s, `sqlite_master.sql` holds this (scratch replay, verbatim):
```
    updated_at DATETIME NULL, "purge_reviewer_id" integer, "normalization_candidate_path" varchar,
    CONSTRAINT ck_speech_assets_kind CHECK (kind IN ('source','video','captions','poster','sprite','voice_note')),
    CONSTRAINT ck_speech_assets_format CHECK (format IN ('mp4','mov','hls','vtt','webp','jpeg','m4a')),
    CONSTRAINT ck_speech_assets_status CHECK (status IN ('uploading','processing','ready','failed')),
    CONSTRAINT ck_speech_assets_kind_format CHECK (
        (kind = 'source' AND format IN ('mp4','mov')) OR
        ...
        (kind = 'voice_note' AND format = 'm4a')
    ),
    CONSTRAINT ck_voice_note_not_primary CHECK (kind <> 'voice_note' OR is_primary = 0),
```
The annotations table is `2026_08_18_110002:14-32` plus `2026_10_20_000001:14`'s raw `ADD COLUMN`. Its unnamed CHECK lands inline, before the named ones:
```
    created_at DATETIME NULL, updated_at DATETIME NULL, deleted_at DATETIME NULL, timing_type VARCHAR(8) NULL CHECK (timing_type IN ('range', 'point')),
    CONSTRAINT ck_annotations_kind CHECK (kind IN ('praise','correction','observation')),
    CONSTRAINT ck_annotations_timing CHECK (start_seconds >= 0 AND duration_seconds > 0 AND duration_seconds <= 120),
    CONSTRAINT ck_annotations_transcript_status CHECK (transcript_status IN ('not_applicable','pending','processing','ready','failed')),
```
The create-table migrations split the name and the CHECK across two lines and put spaces after commas (`2026_08_09_100001:78-79`):
```
    CONSTRAINT ck_reviews_status
        CHECK (status IN ('invited', 'declined', 'accepted', 'in_progress', 'published', 'abandoned')),
```
**What the regex accepts:**
- an optional `CONSTRAINT <name>` with any whitespace or newlines before `CHECK`;
- `CHECK (`, then a column (optionally `"…"`, `` `…` `` or `[…]` quoted), then `IN (`;
- one or more `'…'` literals with any spacing (`''` unescapes to `'`);
- `) )`.

It is case-insensitive, so Blueprint's `->enum()` form also parses: `varchar check ("kind" in ('a', 'b'))` (`SQLiteGrammar.php:873-880`).

**What it skips** (verified):
- `ck_speech_assets_kind_format`: `CHECK (` is followed by `(kind = …`, not a column;
- `CHECK (initiated_by_id IS NULL OR initiated_by_id IN (owner_id, peer_id))`: not literals;
- `ck_voice_note_not_primary`;
- `NOT IN`.

### 1.3 What the PostgreSQL parser reads (standard normal form; capture the real text per §6.3)

`pg_get_constraintdef` rewrites `status IN ('uploading', …)` on a `VARCHAR` column as:
```
CHECK (((status)::text = ANY ((ARRAY['uploading'::character varying, 'processing'::character varying, 'ready'::character varying, 'failed'::character varying])::text[])))
```
- `PGSQL_LIST` matches that whole string and nothing looser. Every one of the 15 list columns is `VARCHAR` (checked in each migration). `transcript_status` is Blueprint `string(…, 16)`, which is `VARCHAR(16)` too.
- **Deliberately not matched:**
  - compound CHECKs such as `kind_format`, which contain `= ANY (` inside `OR`;
  - a one-value list, which Postgres prints as `((status)::text = 'x'::text)`;
  - a `TEXT` column's form, `CHECK ((s = ANY (ARRAY['a'::text, 'b'::text])))`.
- **If a contracted column takes one of those forms, it reports as *missing*.** It does not pass silently. A new list CHECK in an unmatched form would be invisible on Postgres, but SQLite stores the migration's literal text, so the Pest side flags it as unowned.

### 1.4 Coordination with PLAN-DRY-BACKEND-VOICE.md

- **Both enums landed (the expected case):** as written. The backend plan includes `TranscriptStatus` (its §2), so §1.1 contracts `annotations.transcript_status` and §4.4 is required.
- **Fallback, if `TranscriptStatus` hasn't landed yet**, don't block:
  - move `'annotations.transcript_status'` into `UNOWNED` (`'TranscriptStatus enum (PLAN-DRY-BACKEND-VOICE.md)'`);
  - drop its `use` line and `contracts()` row;
  - skip §4.4;
  - expect `contracted=4 unowned=11` in §2.2's pass test and §3, and +32 tests instead of +33.
- **Fallback, if `SpeechAssetStatus` hasn't landed yet**, don't block:
  - move `'speech_assets.status'` into `UNOWNED` (`'SpeechAssetStatus enum (PLAN-DRY-BACKEND-VOICE.md)'`);
  - drop the `use` line and the `contracts()` row;
  - change §2.2's anchor from `toHaveKey('speech_assets.status')` to `toHaveKey('reports.state')`;
  - adjust the counts as above.

  Each enum's commit then adds its row back. Tell the backend plan so.
- **Any other enum the backend plan adds whose values equal a row in the inventory** (for example a kind, format or timing-type enum) moves the same way.
- **If the enum's values don't equal the CHECK** (say a `Purged` case), the contract goes red, by design. Fix it with a new migration that changes the CHECK literally (an SQLite rebuild, plus a Postgres drop and add), never by editing the map.

## §2 SQLite side: Pest tests

### 2.1 `api/tests/Unit/CheckListParsingTest.php` (new; pure string tests, no database)

```php
<?php

use App\Support\CheckListContract;

// Fixtures are real text: sqlite_master after migrate:fresh (PLAN-DRY-SCHEMA-STATUS-CONTRACT.md §1.2)
// and pg_get_constraintdef() output (§1.3; paste the captured PG 17 text here, §6.3).

it('reads every value-list CHECK in real sqlite_master text', function (string $sql, array $expected) {
    expect(CheckListContract::parseSqliteTable($sql))->toBe($expected);
})->with([
    'speech_assets after 2026_08_18_110006' => [<<<'SQL'
        CREATE TABLE speech_assets (
            created_at DATETIME NULL,
            updated_at DATETIME NULL, "purge_reviewer_id" integer, "normalization_candidate_path" varchar,
            CONSTRAINT ck_speech_assets_kind CHECK (kind IN ('source','video','captions','poster','sprite','voice_note')),
            CONSTRAINT ck_speech_assets_format CHECK (format IN ('mp4','mov','hls','vtt','webp','jpeg','m4a')),
            CONSTRAINT ck_speech_assets_status CHECK (status IN ('uploading','processing','ready','failed')),
            CONSTRAINT ck_speech_assets_kind_format CHECK (
                (kind = 'source' AND format IN ('mp4','mov')) OR
                (kind = 'voice_note' AND format = 'm4a')
            ),
            CONSTRAINT ck_voice_note_not_primary CHECK (kind <> 'voice_note' OR is_primary = 0),
            FOREIGN KEY (speech_id) REFERENCES speeches (id) ON DELETE CASCADE
        )
        SQL, [
        ['column' => 'kind', 'name' => 'ck_speech_assets_kind', 'values' => ['source', 'video', 'captions', 'poster', 'sprite', 'voice_note']],
        ['column' => 'format', 'name' => 'ck_speech_assets_format', 'values' => ['mp4', 'mov', 'hls', 'vtt', 'webp', 'jpeg', 'm4a']],
        ['column' => 'status', 'name' => 'ck_speech_assets_status', 'values' => ['uploading', 'processing', 'ready', 'failed']],
    ]],
    'annotations after 2026_10_20_000001' => [<<<'SQL'
        CREATE TABLE annotations (
            created_at DATETIME NULL, updated_at DATETIME NULL, deleted_at DATETIME NULL, timing_type VARCHAR(8) NULL CHECK (timing_type IN ('range', 'point')),
            CONSTRAINT ck_annotations_kind CHECK (kind IN ('praise','correction','observation')),
            CONSTRAINT ck_annotations_timing CHECK (start_seconds >= 0 AND duration_seconds > 0 AND duration_seconds <= 120),
            CONSTRAINT ck_annotations_transcript_status CHECK (transcript_status IN ('not_applicable','pending','processing','ready','failed')),
            FOREIGN KEY (review_id) REFERENCES reviews (id) ON DELETE CASCADE
        )
        SQL, [
        ['column' => 'timing_type', 'name' => null, 'values' => ['range', 'point']],
        ['column' => 'kind', 'name' => 'ck_annotations_kind', 'values' => ['praise', 'correction', 'observation']],
        ['column' => 'transcript_status', 'name' => 'ck_annotations_transcript_status', 'values' => ['not_applicable', 'pending', 'processing', 'ready', 'failed']],
    ]],
    'reviews (name and CHECK on separate lines)' => [<<<'SQL'
        CREATE TABLE reviews (
            updated_at DATETIME NULL, "voice_erasure_started_at" datetime,
            CONSTRAINT ck_reviews_status
                CHECK (status IN ('invited', 'declined', 'accepted', 'in_progress', 'published', 'abandoned')),
            CONSTRAINT ck_reviews_counter_cache
                CHECK (published_annotations_count <= annotations_count),
            FOREIGN KEY (speech_id) REFERENCES speeches (id) ON DELETE CASCADE
        )
        SQL, [
        ['column' => 'status', 'name' => 'ck_reviews_status', 'values' => ['invited', 'declined', 'accepted', 'in_progress', 'published', 'abandoned']],
    ]],
]);

it('reads the other spellings of a list CHECK', function (string $sql, array $expected) {
    expect(CheckListContract::parseSqliteTable($sql))->toBe([$expected]);
})->with([
    'Blueprint ->enum()' => ['create table "t" ("kind" varchar check ("kind" in (\'a\', \'b\')) not null)', ['column' => 'kind', 'name' => null, 'values' => ['a', 'b']]],
    'doubled quote' => ["CREATE TABLE t (x VARCHAR(8), CONSTRAINT ck_t_x CHECK (x IN ('it''s', 'ok')))", ['column' => 'x', 'name' => 'ck_t_x', 'values' => ["it's", 'ok']]],
    'one value per line' => ["CREATE TABLE t (\n  s VARCHAR(16),\n  CONSTRAINT ck_t_s\n    CHECK (\n      s IN (\n        'a',\n        'b'\n      )\n    )\n)", ['column' => 's', 'name' => 'ck_t_s', 'values' => ['a', 'b']]],
]);

it('ignores SQLite CHECKs that are not a single-column literal list', function (string $sql) {
    expect(CheckListContract::parseSqliteTable($sql))->toBe([]);
})->with([
    'kind/format pairs' => ["CREATE TABLE t (CONSTRAINT ck_speech_assets_kind_format CHECK (\n (kind = 'source' AND format IN ('mp4','mov')) OR\n (kind = 'sprite' AND format = 'jpeg')\n))"],
    'column list' => ['CREATE TABLE t (CONSTRAINT ck_connections_initiator CHECK (initiated_by_id IS NULL OR initiated_by_id IN (owner_id, peer_id)))'],
    'boolean rule' => ["CREATE TABLE t (CONSTRAINT ck_voice_note_not_primary CHECK (kind <> 'voice_note' OR is_primary = 0))"],
    'NOT IN' => ["CREATE TABLE t (x VARCHAR(8) CHECK (x NOT IN ('a')))"],
]);

it('reads the PostgreSQL normalized list form', function (string $definition, array $expected) {
    expect(CheckListContract::parsePostgresDefinition($definition))->toBe($expected);
})->with([
    'ck_speech_assets_status' => ["CHECK (((status)::text = ANY ((ARRAY['uploading'::character varying, 'processing'::character varying, 'ready'::character varying, 'failed'::character varying])::text[])))", ['column' => 'status', 'values' => ['uploading', 'processing', 'ready', 'failed']]],
    'annotations_timing_type_check' => ["CHECK (((timing_type)::text = ANY ((ARRAY['range'::character varying, 'point'::character varying])::text[])))", ['column' => 'timing_type', 'values' => ['range', 'point']]],
    'doubled quote' => ["CHECK (((x)::text = ANY ((ARRAY['it''s'::character varying, 'ok'::character varying])::text[])))", ['column' => 'x', 'values' => ["it's", 'ok']]],
]);

it('returns null for PostgreSQL CHECKs that are not a single-column list', function (string $definition) {
    expect(CheckListContract::parsePostgresDefinition($definition))->toBeNull();
})->with([
    'kind/format pairs' => ["CHECK (((((kind)::text = 'source'::text) AND ((format)::text = ANY ((ARRAY['mp4'::character varying, 'mov'::character varying])::text[]))) OR (((kind)::text = 'sprite'::text) AND ((format)::text = 'jpeg'::text))))"],
    'one value' => ["CHECK (((status)::text = 'x'::text))"],
    'boolean rule' => ["CHECK ((((kind)::text <> 'voice_note'::text) OR (is_primary = false)))"],
    'TEXT column (unsupported on purpose)' => ["CHECK ((s = ANY (ARRAY['a'::text, 'b'::text])))"],
]);
```
That is 17 tests (3 + 3 + 4 + 3 + 4 dataset rows).

### 2.1b `api/tests/Unit/CheckListCompareTest.php` (new; `compare()` on made-up lists, no database)

```php
<?php

use App\Models\Report;
use App\Support\CheckListContract;

// CheckListContract::compare() on made-up lists (PLAN-DRY-SCHEMA-STATUS-CONTRACT.md §2.1b). The
// migrated schema never shows these failures, so the Feature tests can't prove they fire.

function checkListLive(string ...$values): array
{
    return [['name' => 'ck_t_a', 'values' => $values]];
}

function checkListOwner(string ...$values): array
{
    return ['owner' => Report::class, 'label' => 'Report::STATES', 'values' => $values];
}

it('reports nothing when every list equals its owner as a set', function () {
    expect(CheckListContract::compare(['t.a' => checkListLive('y', 'x'), 't.b' => checkListLive('z')], ['t.a' => checkListOwner('x', 'y')], ['t.b' => 'no PHP list yet']))
        ->toBe([]);
});

it('reports each kind of drift', function (array $live, array $contracts, array $unowned, array $expected) {
    expect(CheckListContract::compare($live, $contracts, $unowned))->toBe($expected);
})->with([
    'a value repeated in the CHECK' => [['t.a' => checkListLive('x', 'y', 'x')], ['t.a' => checkListOwner('x', 'y')], [],
        ['t.a: CHECK differs from Report::STATES (database lacks []; database adds []; 3 values in the CHECK)']],
    'two list CHECKs on one column' => [['t.a' => [...checkListLive('x', 'y'), ...checkListLive('x')]], ['t.a' => checkListOwner('x', 'y')], [],
        ['t.a: 2 value-list CHECKs on one column; expected one']],
    'a stale UNOWNED entry' => [['t.a' => checkListLive('x')], ['t.a' => checkListOwner('x')], ['t.gone' => 'no PHP list yet'],
        ['t.gone: listed in UNOWNED but no such CHECK exists; remove the entry']],
    'a key in both maps' => [['t.a' => checkListLive('x')], ['t.a' => checkListOwner('x')], ['t.a' => 'no PHP list yet'],
        ['t.a: listed in both contracts() and UNOWNED']],
    'an owner with no values' => [['t.a' => checkListLive('x', 'y')], ['t.a' => checkListOwner()], [],
        ['t.a: CHECK differs from Report::STATES (database lacks []; database adds [x, y]; 2 values in the CHECK)']],
]);
```
- That is 6 tests (1 + 5 dataset rows). Each row pins one rule that the migrated schema never exercises (§6.4 M9–M13).
- The helpers have file-unique names, because Pest loads every test file into one process. `ClamdScannerTest.php:12`'s `startFakeClamd()` is the precedent.

### 2.2 `api/tests/Feature/Schema/CheckListContractTest.php` (new folder)

```php
<?php

use App\Support\CheckListContract;
use Illuminate\Support\Facades\DB;

/**
 * PLAN-DRY-SCHEMA-STATUS-CONTRACT.md. The migrated SQLite schema's CHECK value lists equal their
 * PHP owners. scripts/verify-postgres-check-lists.sh runs the same comparison on PostgreSQL.
 * Migrations keep literal lists (api/database/migrations/README.md).
 */
it('finds every value-list CHECK the contract names, and no others', function () {
    $named = [...array_keys(CheckListContract::contracts()), ...array_keys(CheckListContract::UNOWNED)];
    sort($named);

    expect(array_keys(CheckListContract::liveLists(DB::connection())))->toBe($named)
        ->and(CheckListContract::contracts())->toHaveKey('speech_assets.status');
});

it('reads one non-empty list for each contracted CHECK', function (string $key) {
    $live = CheckListContract::liveLists(DB::connection());

    expect($live[$key] ?? [])->toHaveCount(1)
        ->and($live[$key][0]['values'])->not->toBeEmpty();
})->with(fn (): array => array_keys(CheckListContract::contracts()));

it('matches every contracted CHECK list to its PHP owner', function () {
    expect(CheckListContract::drift(DB::connection()))->toBe([]);
});

// The comparison above can't see a migration that builds its list from the owner: the database
// would then equal the enum by construction. The plan's rule forbids exactly that.
it('keeps the PHP owners out of the migrations they are checked against', function () {
    $files = glob(database_path('migrations/*.php')) ?: [];
    $owners = array_unique(array_column(CheckListContract::contracts(), 'owner'));
    $offenders = [];
    foreach ($files as $file) {
        $source = (string) file_get_contents($file);
        foreach ($owners as $owner) {
            if (str_contains($source, $owner) || str_contains($source, class_basename($owner).'::')) {
                $offenders[] = basename($file).' references '.$owner;
            }
        }
    }

    expect($files)->not->toBeEmpty()
        ->and($offenders)->toBe([]);
});

// Keep this test before the next one. RefreshDatabase rolls the column back (SQLite DDL is
// transactional), and the next test turns red if it ever leaks.
it('fails schema:check-lists on a value-list CHECK that no PHP list owns', function () {
    DB::statement("ALTER TABLE reports ADD COLUMN channel VARCHAR(8) NULL CHECK (channel IN ('web', 'api'))");

    $this->artisan('schema:check-lists')
        ->expectsOutputToContain('reports.channel: value-list CHECK with no PHP owner')
        ->assertFailed();
});

it('passes schema:check-lists on the migrated schema', function () {
    $this->artisan('schema:check-lists')
        ->expectsOutputToContain('driver=sqlite lists=15 contracted=5 unowned=10')
        ->assertSuccessful();
});
```
- That is 10 tests: 1 + 5 dataset rows + 1 + 1 + 1 + 1.
- The last two tests belong to §3. Commit them with the command. The pass test asserts the whole first line, so a lost or extra list fails it with the counts in view.
- The rollback was checked in the scratchpad with raw PDO: `ALTER TABLE … ADD COLUMN … CHECK` inside `beginTransaction()`, then `rollBack()`, restores the original `sqlite_master.sql`. rev 2 confirmed it in Pest: the pass test after the unowned test stays green.
- **The migration guard (test 4) works per class, by substring.** It bans any mention of an owner class in a migration, even a backfill that uses only the `Report` model (README rule 2 says so). `str_contains` also matches a longer name such as `App\Models\ReportReason` or `FooReport::`. Nothing in today's tree trips it, and a false hit names the file.

### 2.3 Why the tests can't pass vacuously

| Failure that would make a naive test pass | What catches it |
|---|---|
| The scan finds nothing (broken regex, wrong table query) | test 1 (the found keys must equal contracts ∪ UNOWNED, all 15); the command's "no value-list CHECKs found" (§3) |
| `contracts()` emptied | test 1's `toHaveKey('speech_assets.status')` anchor |
| An owner with no values | every CHECK value shows as "database adds [...]" (§2.1b "an owner with no values"); rev 1's separate `=== []` clause was dead code |
| The CHECK repeats a value | `compare()`'s count check, pinned by §2.1b |
| A `compare()` rule deleted (repeated value, two CHECKs on one column, stale UNOWNED entry, key in both maps) | §2.1b, one dataset row per rule (§6.4 M9–M13) |
| A migration builds the list from the enum | test 4 (the migration guard) |
| A CHECK in a form the parser doesn't know | contracted: "no value-list CHECK found"; UNOWNED: "no such CHECK exists" |
| The Postgres script runs against the wrong driver | §4.2 asserts `driver=pgsql` in the output |
| The Postgres regex doesn't match PG 17's real text | every contract reports missing and every UNOWNED entry reports stale, so the run is loudly red |

## §3 The artisan command (new: `api/app/Console/Commands/CheckSchemaListsCommand.php`)

```php
<?php

namespace App\Console\Commands;

use App\Support\CheckListContract;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Read-only: compares the live database's CHECK value lists to the PHP enums and constants that
 * own them (App\Support\CheckListContract). scripts/verify-postgres-check-lists.sh runs it on the
 * e2e PostgreSQL stack, which has no Pest; the Pest suite covers SQLite. The script asserts on the
 * exit code, not on parsed output (the same convention as RevokeAdminRoleForLockTestCommand).
 */
class CheckSchemaListsCommand extends Command
{
    protected $signature = 'schema:check-lists';

    protected $description = 'Compare the database CHECK value lists to the PHP enums and constants that own them (read-only).';

    public function handle(): int
    {
        $db = DB::connection();
        $live = CheckListContract::liveLists($db);
        $this->line(sprintf('driver=%s lists=%d contracted=%d unowned=%d',
            $db->getDriverName(), count($live), count(CheckListContract::contracts()), count(CheckListContract::UNOWNED)));

        $problems = $live === []
            ? ['no value-list CHECKs found; run this against a migrated database']
            : CheckListContract::drift($db);
        foreach ($problems as $problem) {
            $this->error($problem);
        }

        return $problems === [] ? self::SUCCESS : self::FAILURE;
    }
}
```
- **The command runs a second `liveLists` scan inside `drift()`.** Fifteen rows make that negligible, and it keeps `drift()`'s signature simple.
- **It is safe against production** (no writes). Wiring it into `deploy.sh` after `migrate` is §7.
- **Expected first line:** on the migrated SQLite suite, `driver=sqlite lists=15 contracted=5 unowned=10` (validated; §2.2's pass test asserts it). On the e2e stack it should say `driver=pgsql` with the same counts.

## §4 PostgreSQL side

### 4.1 Options weighed

| Option | Verdict |
|---|---|
| **A.** A Pest test gated on `pgsql` | **Rejected: it would never run.** The `test` job has no Postgres (`ci.yml:89-98`), and the app image has no Pest (`Dockerfile:39`). In a Feature test, `RefreshDatabase` would `migrate:fresh` the e2e database mid-job (`RefreshDatabase.php:119`). `TranscriptControllerTest.php:265-267` is the precedent: it skips itself everywhere CI runs. |
| **B.** Bash that reads enum values with `php artisan tinker --execute` or `php -r`, and CHECK values with a SQL `regexp_matches` | **Rejected.** It puts a second contract map and a second parser in bash, and drift between two copies is what this plan removes. Tinker also needs a wrapper to surface failures (`verify-caption-recovery-scheduler.sh:45-58`). |
| **C.** A read-only artisan command over the shared class, called by a small script | **Chosen.** One map and one comparison serve both drivers. The exit code is the contract, and the app container already has everything it needs. |

### 4.2 `scripts/verify-postgres-check-lists.sh` (new, mode 755 like its siblings)

```bash
#!/usr/bin/env bash
# PLAN-DRY-SCHEMA-STATUS-CONTRACT.md: every CHECK value list in the migrated
# PostgreSQL catalog of the isolated E2E stack must equal the PHP enum or
# constant that owns it (App\Support\CheckListContract). The Pest suite runs the
# same comparison on SQLite (tests/Feature/Schema/CheckListContractTest.php);
# this is the only place the migrations' PostgreSQL branches are compared.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="${VERIFY_POSTGRES_PROJECT:-speechcoach-e2e}"
COMPOSE_FILES=(-f compose.yaml -f compose.e2e.yaml)

_compose() {
  docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

log "comparing PostgreSQL CHECK value lists to their PHP owners"
# Capture output and status together so a failure prints the command's own
# report rather than tripping `set -e` mid-assignment (the same shape as
# verify-caption-recovery-scheduler.sh's _tinker).
set +e
OUT="$(_compose exec -T app php artisan schema:check-lists 2>&1 | tr -d '\r')"
RC=$?
set -e
printf '%s\n' "$OUT" >&2

[ "$RC" -eq 0 ] || fail "schema:check-lists exited $RC"
[[ "$OUT" == *"driver=pgsql "* ]] || fail "schema:check-lists did not run against PostgreSQL"

log "verify-postgres-check-lists: PASS"
```

### 4.3 CI step (`.github/workflows/ci.yml`, insert after `:289`)

```yaml

      # PLAN-DRY-SCHEMA-STATUS-CONTRACT.md: every CHECK value list on the
      # migrated Postgres catalog equals its PHP owner (enum or constant).
      # The Pest `test` job runs the same comparison on SQLite.
      - name: Verify Postgres CHECK lists match their PHP owners
        run: ./scripts/verify-postgres-check-lists.sh
```
It sits right after the voice-schema step and before "Verify Postgres last-admin lock". It needs only the migrated stack, which `e2e-stack.sh up --fresh` (`ci.yml:259-260`) provides.

### 4.4 `verify-postgres-voice-schema.sh`

- **Required** (`TranscriptStatus` is contracted, §1.1):
  - delete `:47-51` (the `TRANSCRIPT` read, the substring loop and the blank line after it); the contract is strictly stronger;
  - change `:46` to `log "checking audio FK ON DELETE SET NULL (transcript states: verify-postgres-check-lists.sh)"`.
- **Leave the rest of the file alone.** Its kind and format substring checks (`:36-37, :41-42`) stay until those lists get a PHP owner.
- **Fallback (§1.4, no `TranscriptStatus`):** skip this section.

## §5 Guidance for future migrations

### 5.1 Where

The next author might copy an existing migration, run `make:migration`, or simply hit a red test. Three places cover those paths:
1. **A new `api/database/migrations/README.md`**, next to the files they copy. `migrate` ignores it, because the migrator globs `*_*.php` (`Migrator.php:581`). Pint and phpstan read only `.php` files.
2. **The `CheckListContract` docblock** (§1.1), which points to the README.
3. **The failure message** for a new unowned CHECK, which names the README.

**Considered and rejected: published migration stubs (`api/stubs/migration*.stub`).** All three framework stubs would have to be copied and would then drift from Laravel's. Every CHECK-bearing migration here is hand-written, driver-branched SQL that no stub produces.

### 5.2 README text (exact)

```markdown
# Migration conventions

Read this before you write or copy a migration. Most migrations here are raw, driver-branched
SQL, because SQLite (the Pest suite's driver) accepts CHECK constraints only at CREATE TABLE time.

## CHECK value lists

1. **Never edit a migration that has run anywhere.** Change the schema with a new migration.
2. **Write every CHECK value list out literally**, in every driver branch:
   `CONSTRAINT ck_speech_assets_status CHECK (status IN ('uploading', 'processing', 'ready', 'failed'))`.
   Do this even when an enum or constant holds the same values. **Never build the list from app
   code** (`SpeechAssetStatus::values()`, `Report::STATES`, …). A later edit to that enum would
   change what a fresh `migrate` builds for this old migration, so CI (which migrates fresh on
   every run) and production (which migrated once) would silently disagree. The contract test
   enforces this per class: a migration that mentions an owner class at all (`SpeechAssetStatus`,
   `TranscriptStatus`, `Report`, `DataExport`), even for a data backfill, fails it. Write data
   fixes with `DB::table()`.
3. **A contract test catches drift instead.** `App\Support\CheckListContract` maps each
   value-list CHECK (`table.column`) to the enum or constant that owns it, or lists it in
   `UNOWNED` with what would own it. Two checks compare the live database to that map:
   - `tests/Feature/Schema/CheckListContractTest.php`, in the Pest suite, on SQLite;
   - `scripts/verify-postgres-check-lists.sh` (`php artisan schema:check-lists`), in CI's e2e
     job, on PostgreSQL.

   Both fail when a CHECK and its owner differ, when a contracted CHECK disappears, and when a
   migration adds a value-list CHECK that the map doesn't name.
4. **When you add or change a value list,** change the PHP owner and add the migration in the
   same commit. A new list column also needs an entry in `contracts()` or `UNOWNED`.
5. **Use the one form the contract reads:** `CHECK (column IN ('a', 'b'))`. That means one
   column, literal values and nothing else inside the CHECK, on a VARCHAR column. Name it
   `ck_<full table name>_<column>`.

## Changing a CHECK

6. **SQLite:** rebuild the table by hand. Rename it, create the new shape, copy the rows with
   an explicit column list, drop the old table, then recreate every index.
   `2026_08_18_110001_enable_voice_note_assets.php` shows the pattern.
   **PostgreSQL:** `DROP CONSTRAINT`, then `ADD CONSTRAINT`.
7. **Never call Blueprint's `->change()`, `->foreign()`/`->constrained()`, `->dropForeign()`,
   `->primary()` or `->dropPrimary()` on a table that has CHECKs.** On SQLite, Laravel rebuilds
   the table from column metadata (`SQLiteGrammar::compileAlter()`). That drops every CHECK and
   turns partial unique indexes (`… WHERE is_primary`) into plain ones, without an error. The
   contract test notices missing value lists; nothing notices the other CHECKs. A plain
   `ADD COLUMN` is safe.
```

## §6 Verification

### 6.1 Commands

**In `api/`, CI's exact commands** (Ground rules):
```
./vendor/bin/pint --test
php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G
./vendor/bin/pest                       # host: php -d memory_limit=2G vendor/bin/pest
```
**Focused runs:**
- `./vendor/bin/pest tests/Unit/CheckListParsingTest.php tests/Unit/CheckListCompareTest.php tests/Feature/Schema`
- `bash -n scripts/verify-postgres-check-lists.sh` and `bash -n scripts/verify-postgres-voice-schema.sh`

**Never run `php artisan` by hand in a copy whose `api/.env` points at a real database** (Ground rules). rev 1 had a `migrate:fresh --force` bullet here, and it is gone. §2.2's pass test runs `schema:check-lists` on SQLite `:memory:` and asserts the expected first line.

**PostgreSQL, on the e2e stack.** `api/` is baked into the image, so rebuild after every code change; `up` does that.
```
./scripts/e2e-stack.sh up --fresh
./scripts/verify-postgres-check-lists.sh
```

### 6.2 Expected numbers

- **Tests:** +33, made of 23 Unit tests (17 in §2.1, 6 in §2.1b) and 10 Feature tests (§2.2). Validated: 1451 → 1484 (1449 passed, 35 skipped). No existing test changed. With a §1.4 fallback it is +32.
- **pint and phpstan:** clean (validated). §1.1 names the one phpstan trap.

### 6.3 Capture the real PostgreSQL strings (unverified; a merge prerequisite)

**Do this before merging, not after.** If PG 17's text differs from §1.3, every contract reports *missing* and every UNOWNED entry *stale*, so the e2e job goes red on the merge's first CI run. Reading the migrations supports the §1.3 form, but only a capture settles it:
- all 15 list columns are `VARCHAR(n)` in their Postgres branches;
- no list column name is a keyword that `pg_get_constraintdef` quotes (`format` and `source` are unreserved), so `\w+` holds;
- no migration adds a CHECK as `NOT VALID` or `NO INHERIT`, which would append text after the anchored closing parenthesis;
- `ck_speech_assets_status` is never dropped on Postgres (every `DROP CONSTRAINT` was checked).

Still open until the capture: the exact text, the 25-row count, the name `annotations_timing_type_check`, the script's runtime behaviour, and M8.

On the migrated e2e stack:
```
docker compose -p speechcoach-e2e -f compose.yaml -f compose.e2e.yaml exec -T postgres \
  psql -U speechcoach -d speechcoach -Atc "SELECT t.relname || '.' || c.conname || ' | ' || pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE c.contype = 'c' ORDER BY 1"
```
- **Expect 25 rows: 15 list CHECKs in the §1.3 form and 10 others** (the non-list CHECKs in the inventory). Also confirm that `timing_type`'s CHECK is named `annotations_timing_type_check`.
- **If the PG 17 text differs from §1.3:**
  1. paste the real strings into §2.1's two PostgreSQL datasets;
  2. adjust `PGSQL_LIST` until they parse, keeping the compound-CHECK and one-value rows `null`;
  3. rerun the script.

### 6.4 Mutation checks (each must go red, then be reverted)

rev 2 ran M1–M7 and M9–M13 on the scratch copy with the final §1.1 class; the messages are its real output. M8 needs the e2e stack.

| # | Mutation | Expected red |
|---|---|---|
| M1 | Add `case Purged = 'purged';` to `SpeechAssetStatus` | §2.2 test 3 and the command-pass test: `speech_assets.status: CHECK differs from SpeechAssetStatus::values() (database lacks [purged]; database adds []; 4 values in the CHECK)`. The e2e script fails too. |
| M2 | Remove `Uploading` from `SpeechAssetStatus` | `… (database lacks []; database adds [uploading]; 4 values in the CHECK)` |
| M3 | Scratch migration `2099_01_01_000001_scratch_widen_reports_state.php` (below) adds `'escalated'` to `ck_reports_state` | `reports.state: CHECK differs from Report::STATES (database lacks []; database adds [escalated]; 4 values in the CHECK)`. Unrelated report tests may also fail, because the scratch table drops the FKs and indexes; look for this line. |
| M4 | Scratch migration: `DB::statement("ALTER TABLE reports ADD COLUMN channel VARCHAR(8) NULL CHECK (channel IN ('web', 'api'))")` | test 1 (the key sets differ); test 3: `reports.channel: value-list CHECK with no PHP owner; …`; the pass test; and the unowned-command test, with a `QueryException` (the scratch migration already added the column) |
| M5 | Scratch migration: `Schema::table('speech_assets', fn ($t) => $t->foreign('purge_reviewer_id')->references('id')->on('users'));` | test 1, test 3 and the dataset row: `speech_assets.status: no value-list CHECK found for SpeechAssetStatus::values()`, plus `speech_assets.kind`/`.format: listed in UNOWNED but no such CHECK exists`. Many other tests fail too, because the partial unique indexes become full ones (§Infrastructure). |
| M6 | Scratch migration containing `use App\Enums\SpeechAssetStatus;` (it can be otherwise empty) | test 4 only: `2099_… references App\Enums\SpeechAssetStatus`. Test 3 stays green, which is why test 4 exists. |
| M7 | In `SQLITE_LIST`, change the repeat `(?:\s*,\s*'(?:[^']\|'')*')*` to `?` | all three of §2.1's sqlite_master datasets, then 7 Feature tests (every list with 3 or more values stops matching) |
| M8 | PostgreSQL, on the e2e stack: `psql … -c "ALTER TABLE reports DROP CONSTRAINT ck_reports_state; ALTER TABLE reports ADD CONSTRAINT ck_reports_state CHECK (state IN ('open','actioned','dismissed','escalated'))"` | The script exits 1 with the M3 line and `driver=pgsql …` above it. Revert with the same statement minus `'escalated'`. |
| M9 | In `compare()`, delete `\|\| count($actual) !== count(array_unique($actual))` | §2.1b "a value repeated in the CHECK" only |
| M10 | Change `if (count($hits) > 1) {` to `if (false) {` | §2.1b "two list CHECKs on one column" only |
| M11 | Delete `\|\| $adds !== []` | §2.1b "an owner with no values" only |
| M12 | Delete the `listed in both contracts() and UNOWNED` line | §2.1b "a key in both maps" only |
| M13 | In the UNOWNED loop, change `if (! isset($live[$key])) {` to `if (false) {` | §2.1b "a stale UNOWNED entry" only |

M3 scratch migration (delete after the check):
```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::getConnection()->getDriverName() === 'sqlite') {
            DB::statement('ALTER TABLE reports RENAME TO reports_old');
            DB::statement(<<<'SQL'
                CREATE TABLE reports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, reportable_type VARCHAR(255) NOT NULL,
                    reportable_id INTEGER NOT NULL, reporter_id INTEGER NULL, reason VARCHAR(32) NOT NULL,
                    detail VARCHAR(500) NULL, state VARCHAR(16) NOT NULL DEFAULT 'open',
                    resolved_by_id INTEGER NULL, resolved_at DATETIME NULL, resolution_note VARCHAR(500) NULL,
                    created_at DATETIME NULL, updated_at DATETIME NULL,
                    CONSTRAINT ck_reports_reason CHECK (reason IN ('harassment', 'inappropriate_content', 'impersonation', 'spam', 'other')),
                    CONSTRAINT ck_reports_state CHECK (state IN ('open', 'actioned', 'dismissed', 'escalated'))
                )
                SQL);
            DB::statement('INSERT INTO reports SELECT * FROM reports_old');
            DB::statement('DROP TABLE reports_old');
        } else {
            DB::statement('ALTER TABLE reports DROP CONSTRAINT ck_reports_state');
            DB::statement("ALTER TABLE reports ADD CONSTRAINT ck_reports_state CHECK (state IN ('open', 'actioned', 'dismissed', 'escalated'))");
        }
    }
};
```
`SELECT *` is safe here: no migration alters `reports` after `2026_08_20_100001`, so the column order matches.

## §7 Out of scope (found by the review)

- **Owners for the 10 UNOWNED lists.** Each `UNOWNED` reason is the to-do item. The cheapest is `annotations.kind`: give `AnnotationRules.php:18`'s inline list a `KINDS` constant, then move the row. Each new owner is one line in `contracts()` and one deleted `UNOWNED` entry.
- **The kind↔format pairs** (`ck_speech_assets_kind_format`). That needs a kind enum with a `formats()` map, and a parser for the `OR`-of-pairs form on both drivers.
- **Non-list CHECKs.**
  - `ck_annotations_timing`'s `duration_seconds <= 120` repeats `AnnotationRules::DURATION_SECONDS`'s `max:120` (`AnnotationRules.php:12`).
  - Counters, `ck_voice_note_not_primary` and the connection invariants have no PHP twin.
  - Rule 7 of the README is the only guard against a Blueprint rebuild silently dropping these CHECKs.
- **Partial-index predicates.**
  - `ix_reviews_timeline` and `ix_reviews_incoming` equal `Review::ACCESS_GRANTING`. Drift there would stop the timeline query from using its index, without breaking correctness. A subset contract would read `pg_indexes.indexdef` and `sqlite_master` index SQL.
  - `uq_coach_app_live` is correctness-relevant, but matches no PHP list.
- **Frontend unions.** The TS unions for `audio_status` and `transcript_status` (`web/src/features/annotation/types.ts:11, :15`) against the PHP enums are PLAN-DRY-VOICE-PLAYBACK.md §7 #6.
- **Running `schema:check-lists` in `deploy.sh` after `migrate` (`deploy.sh:105`).** It is read-only, and it would catch a production catalog changed by hand.
- **The SQLite rebuild column lists** (`2026_08_08_160001:93-104, :191-202`; `2026_08_18_110001:62-74, :139-140`; `2026_08_18_110002:34-35, :70-71`) and the annotations index trio. Migrations stay as written.

## §8 Review log

- **rev 1 (2026-11-14):** drafted from a read-only review of all 45 migrations, the PHP lists in `api/app`, the test setup, CI, the e2e scripts and the app image.
  - **Self-checks in the scratchpad** (no repo commands):
    - a replay of 22 migrations through vendor Laravel 13.24 on in-memory SQLite;
    - the §1.1 class run against it (15 lists, no drift);
    - mutations M1–M5 red with the quoted messages;
    - the transactional rollback of an `ADD COLUMN … CHECK` confirmed;
    - the Blueprint `->foreign()` rebuild shown to drop the CHECKs and the partial-index predicates.
  - **Not yet done:** PostgreSQL output capture (§6.3), phpstan, pint and the real Pest run.
  - **Next:** an adversarial pass that applies the plan to a scratch copy and runs §6. Fold its findings in as rev 2.
- **rev 2 (2026-11-14):** an adversarial pass applied rev 1 to a scratch copy of `b2b2bee`, after the sibling plan's two enum files. It ran CI's commands after each step and §6.4's mutations (numbers in the Status table). Findings and fixes:
  - **MAJOR 1 (§1.1): phpstan level 8 failed CI** with three `arrayValues.list` errors, from `array_values()` around `array_map()` in `parseSqliteTable()`, `enum()` and `literals()`. Fix: the wrappers are removed, and §1.1's design notes name the trap.
  - **MINOR 2 (§1.1, §1.4, §3, §4.4, §6.2): `TranscriptStatus` was hedged as "maybe"**, but the sibling plan includes it. Fix: it is folded into §1.1. The counts are now `contracted=5 unowned=10` and the test total +33. §4.4 is required, and §1.4 keeps the no-enum fallbacks.
  - **MINOR 3 (§1.1, §2.3): three `drift()` rules were untested.** Deleting the repeated-value check, the two-CHECKs check or the `=== []` clause left every test green. The `=== []` clause was dead code: an empty owner already shows as "database adds". Fix: a pure `compare($live, $contracts, $unowned)` that `drift()` wraps, and §2.1b's 6 unit tests. The clause is deleted and §2.3's rows reworded. M9–M13 now go red.
  - **MINOR 4 (§6.1, §2.2): the `migrate:fresh --force` bullet was unsafe** in a copy whose `.env` points at the dev database, because config caching makes env overrides a no-op. Fix: the bullet is deleted, a "never run `php artisan`" warning is added (Ground rules, §6.1), and the pass test asserts `driver=sqlite lists=15 contracted=5 unowned=10`.
  - **NIT 5 (§6.4 M7):** all three sqlite_master datasets go red, not just the first and third. Corrected.
  - **NIT 6 (§6.4 M4):** the pass test and the unowned-command test (`QueryException`) also go red. Listed.
  - **NIT 7 (§4.4):** deleting `:47-50` left a stray blank line, so the range is now `:47-51`.
  - **NIT 8 (§4.3):** the next CI step is "Verify Postgres last-admin lock", not the caption worker scripts. Corrected.
  - **NIT 9 (§1.1):** the `enum()` helper duplicated the sibling's `values()`. Fix: the owners read `values()`, and `enum()` and `BackedEnum` are gone. The M1/M5 messages now say `SpeechAssetStatus::values()`.
  - **NIT 10 (§2.2, §5.2):** the migration guard bans owner classes outright and matches by substring. This is now documented in §2.2 and in README rule 2, which also says to write backfills with `DB::table()`.
  - **Postgres:** still uncaptured. §6.3 is now a stated merge prerequisite, with what reading the migrations established.
  - **Held up:** the inventory (15 lists on 9 tables, values as tabled), the parsers on the real catalog, the §1.2 fixtures and M1–M6 (messages as quoted). Also: the `ADD COLUMN` rollback; no migration file touched (the README is ignored by the migrator's `*_*.php` glob, `Migrator.php:581`); no false positive from the migration guard; pint on the plan code unchanged; the script's mode and shape; `composer dump-autoload` after `COPY api/` (`Dockerfile:40-41`); and the Blueprint rebuild dropping CHECKs and partial-index predicates.
