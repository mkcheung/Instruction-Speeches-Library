# Migration conventions

Read this before you write or copy a migration. Most migrations here are raw, driver-branched
SQL, because SQLite (the Pest suite's driver) cannot add or drop a constraint on an existing table.
Only a new column can carry its own CHECK (`ALTER TABLE … ADD COLUMN … CHECK (…)`).

## CHECK value lists

1. **Never edit a migration that has run anywhere.** Change the schema with a new migration.
2. **Write every CHECK value list out literally**, in every driver branch:
   `CONSTRAINT ck_speech_assets_status CHECK (status IN ('uploading', 'processing', 'ready', 'failed'))`.
   Do this even when an enum or constant holds the same values. **Never build the list from app
   code** (`SpeechAssetStatus::values()`, `Report::STATES`, …). A later edit to that enum would
   change what a fresh `migrate` builds for this old migration, so CI (which migrates fresh on
   every run) and production (which migrated once) would silently disagree. The contract test
   enforces this per class: a migration whose source contains an owner's full class name or
   `Name::` (`SpeechAssetStatus`, `TranscriptStatus`, `Report`, `DataExport`), even for a data
   backfill or inside a comment, fails it. The match is by substring, so `FooReport::` trips it
   too. Write data fixes with `DB::table()`.
3. **A contract test catches drift instead.** `App\Support\CheckListContract` maps each
   value-list CHECK (`table.column`) to the enum or constant that owns it, or lists it in
   `UNOWNED` with what would own it. Two checks compare the live database to that map:
   - `tests/Feature/Schema/CheckListContractTest.php`, in the Pest suite, on SQLite;
   - `scripts/verify-postgres-check-lists.sh` (`php artisan schema:check-lists`), in CI's e2e
     job, on PostgreSQL.

   Both fail when a CHECK and its owner differ, when a contracted CHECK disappears, and when a
   migration adds a value-list CHECK that the map doesn't name.
4. **When you add or change a value list,** change the PHP owner and add the migration in the
   same commit. A new list column also needs an entry in `contracts()` or `UNOWNED`, and the
   counts that the last test in `CheckListContractTest.php` pins (`lists=`, `contracted=`,
   `unowned=`) change with it.
5. **Use the one form the contract reads:** `CHECK (column IN ('a', 'b'))`. That means one
   column, two or more literal values and nothing else inside the CHECK, on a VARCHAR column.
   (PostgreSQL prints a one-value list as `= 'a'`, which the parser skips on that driver only.)
   Name it `ck_<full table name>_<column>`.

## Changing a CHECK

6. **SQLite:** rebuild the table by hand. Copy the rows with an explicit column list, drop the
   old table, then recreate every index. `2026_08_18_110001_enable_voice_note_assets.php` shows
   the pattern, but it renames the old table out of the way first, and that is safe only for a
   table that no other table references with a FOREIGN KEY (`speech_assets` had no such child
   when it ran; it has one now, `annotations.audio_asset_id`). If another table references this
   one, `ALTER TABLE … RENAME` makes SQLite rewrite the children's `REFERENCES` to the renamed
   name, and `DROP TABLE` with foreign keys on runs the children's `ON DELETE` action. The
   children then point at a dropped table (inserts fail with "no such table") or lose rows or
   links. For such a table:
   - set `public $withinTransaction = false;` on the migration (SQLite ignores
     `PRAGMA foreign_keys` inside a transaction);
   - call `Schema::disableForeignKeyConstraints()` first and `Schema::enableForeignKeyConstraints()`
     last;
   - create the new shape as `<table>_new`, copy, drop the old table, then
     `ALTER TABLE <table>_new RENAME TO <table>`;
   - end by checking that `PRAGMA foreign_key_check` returns no rows.

   **PostgreSQL:** `DROP CONSTRAINT`, then `ADD CONSTRAINT`.
7. **Never call Blueprint's `->change()`, `->foreign()`/`->constrained()`, `->dropForeign()`,
   `->primary()` or `->dropPrimary()` on a table that has CHECKs.** On SQLite, Laravel rebuilds
   the table from column metadata (`SQLiteGrammar::compileAlter()`). That drops every CHECK and
   turns partial unique indexes (`… WHERE is_primary`) into plain ones, without an error. The
   contract test notices missing value lists; nothing notices the other CHECKs. A plain
   `ADD COLUMN` is safe.
