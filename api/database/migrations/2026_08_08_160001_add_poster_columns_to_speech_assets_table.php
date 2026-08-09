<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The additive ALTER promised by the doc comment on
     * 2026_08_08_150003_create_speech_assets_table.php: widens `kind` and
     * `format` to admit `poster`/`sprite` (§9.5) and adds the three columns
     * a poster/sprite row needs that a source/video/captions row doesn't —
     * `width`/`height` (frame dimensions) and `poster_time_seconds` (the
     * timestamp the frame was grabbed at; NULL means "let the transcoder
     * pick automatically", per §9.5). `voice_note` (Step 10) stays out of
     * both CHECKs — not needed yet, and adding it now would let a row exist
     * that no code in this step or S9 knows how to produce or consume.
     *
     * Plain `ADD COLUMN` has a Blueprint equivalent on both drivers, so only
     * the CHECK-constraint rewrite needs to be driver-branched raw SQL.
     */
    public function up(): void
    {
        Schema::table('speech_assets', function ($table): void {
            $table->unsignedSmallInteger('width')->nullable();
            $table->unsignedSmallInteger('height')->nullable();
            $table->decimal('poster_time_seconds', 10, 3)->nullable();
        });

        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'sqlite') {
            // SQLite can only attach/alter a CHECK constraint at CREATE
            // TABLE time, so widening the two CHECKs means rebuilding the
            // table from scratch: rename the live table out of the way,
            // create the new-shape table under the real name, copy every
            // row across with an explicit column list (the new table has 3
            // more columns than the old one, so `SELECT *` would misalign),
            // then drop the renamed-away original.
            //
            // Renaming a SQLite table does not reliably carry forward
            // indexes created via a separate `CREATE INDEX` statement (only
            // indexes implied by inline column/table constraints survive) —
            // verified against this exact rename-and-recreate shape before
            // writing this migration — so both indexes are recreated below
            // rather than assumed to still exist.
            DB::statement('ALTER TABLE speech_assets RENAME TO speech_assets_old');

            DB::statement(<<<'SQL'
                CREATE TABLE speech_assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    speech_id INTEGER NOT NULL,
                    kind VARCHAR(16) NOT NULL,
                    format VARCHAR(8) NOT NULL,
                    rendition VARCHAR(16) NULL,
                    disk VARCHAR(32) NOT NULL DEFAULT 'media',
                    path VARCHAR(255) NOT NULL,
                    original_filename VARCHAR(255) NULL,
                    mime_type VARCHAR(255) NULL,
                    byte_size BIGINT NULL,
                    duration_seconds NUMERIC(10, 3) NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'uploading',
                    failure_code VARCHAR(64) NULL,
                    failure_detail VARCHAR(2000) NULL,
                    is_primary TINYINT(1) NOT NULL DEFAULT 0,
                    upload_id VARCHAR(255) NULL,
                    client_declared_bytes BIGINT NULL,
                    width SMALLINT UNSIGNED NULL,
                    height SMALLINT UNSIGNED NULL,
                    poster_time_seconds NUMERIC(10, 3) NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    CONSTRAINT ck_speech_assets_kind
                        CHECK (kind IN ('source', 'video', 'captions', 'poster', 'sprite')),
                    CONSTRAINT ck_speech_assets_format
                        CHECK (format IN ('mp4', 'mov', 'hls', 'vtt', 'webp', 'jpeg')),
                    CONSTRAINT ck_speech_assets_status
                        CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
                    CONSTRAINT ck_speech_assets_kind_format
                        CHECK (
                            (kind = 'source' AND format IN ('mp4', 'mov'))
                            OR (kind = 'video' AND format IN ('mp4', 'hls'))
                            OR (kind = 'captions' AND format = 'vtt')
                            OR (kind = 'poster' AND format IN ('jpeg', 'webp'))
                            OR (kind = 'sprite' AND format = 'jpeg')
                        ),
                    FOREIGN KEY (speech_id) REFERENCES speeches (id) ON DELETE CASCADE
                )
                SQL);

            DB::statement(<<<'SQL'
                INSERT INTO speech_assets (
                    id, speech_id, kind, format, rendition, disk, path,
                    original_filename, mime_type, byte_size, duration_seconds,
                    status, failure_code, failure_detail, is_primary,
                    upload_id, client_declared_bytes, created_at, updated_at
                )
                SELECT
                    id, speech_id, kind, format, rendition, disk, path,
                    original_filename, mime_type, byte_size, duration_seconds,
                    status, failure_code, failure_detail, is_primary,
                    upload_id, client_declared_bytes, created_at, updated_at
                FROM speech_assets_old
                SQL);

            DB::statement('DROP TABLE speech_assets_old');
        } else {
            DB::statement('ALTER TABLE speech_assets DROP CONSTRAINT ck_speech_assets_kind');
            DB::statement(<<<'SQL'
                ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_kind
                    CHECK (kind IN ('source', 'video', 'captions', 'poster', 'sprite'))
                SQL);

            DB::statement('ALTER TABLE speech_assets DROP CONSTRAINT ck_speech_assets_format');
            DB::statement(<<<'SQL'
                ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_format
                    CHECK (format IN ('mp4', 'mov', 'hls', 'vtt', 'webp', 'jpeg'))
                SQL);

            DB::statement('ALTER TABLE speech_assets DROP CONSTRAINT ck_speech_assets_kind_format');
            DB::statement(<<<'SQL'
                ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_kind_format
                    CHECK (
                        (kind = 'source' AND format IN ('mp4', 'mov'))
                        OR (kind = 'video' AND format IN ('mp4', 'hls'))
                        OR (kind = 'captions' AND format = 'vtt')
                        OR (kind = 'poster' AND format IN ('jpeg', 'webp'))
                        OR (kind = 'sprite' AND format = 'jpeg')
                    )
                SQL);
        }

        // Rebuilt from scratch on SQLite (table recreate loses everything
        // not implied by an inline constraint), untouched on Postgres (a
        // Blueprint ADD COLUMN doesn't rebuild the table) — recreate
        // unconditionally so both drivers end up in the same state.
        DB::statement('DROP INDEX IF EXISTS speech_assets_speech_id_index');
        DB::statement('DROP INDEX IF EXISTS uq_assets_primary');
        DB::statement('CREATE INDEX speech_assets_speech_id_index ON speech_assets (speech_id)');
        DB::statement('CREATE UNIQUE INDEX uq_assets_primary ON speech_assets (speech_id, kind) WHERE is_primary');
    }

    public function down(): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'sqlite') {
            // Same rebuild-from-scratch approach as up(), back to the
            // original DDL from the create-table migration.
            DB::statement('ALTER TABLE speech_assets RENAME TO speech_assets_new');

            DB::statement(<<<'SQL'
                CREATE TABLE speech_assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    speech_id INTEGER NOT NULL,
                    kind VARCHAR(16) NOT NULL,
                    format VARCHAR(8) NOT NULL,
                    rendition VARCHAR(16) NULL,
                    disk VARCHAR(32) NOT NULL DEFAULT 'media',
                    path VARCHAR(255) NOT NULL,
                    original_filename VARCHAR(255) NULL,
                    mime_type VARCHAR(255) NULL,
                    byte_size BIGINT NULL,
                    duration_seconds NUMERIC(10, 3) NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'uploading',
                    failure_code VARCHAR(64) NULL,
                    failure_detail VARCHAR(2000) NULL,
                    is_primary TINYINT(1) NOT NULL DEFAULT 0,
                    upload_id VARCHAR(255) NULL,
                    client_declared_bytes BIGINT NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    CONSTRAINT ck_speech_assets_kind
                        CHECK (kind IN ('source', 'video', 'captions')),
                    CONSTRAINT ck_speech_assets_format
                        CHECK (format IN ('mp4', 'mov', 'hls', 'vtt')),
                    CONSTRAINT ck_speech_assets_status
                        CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
                    CONSTRAINT ck_speech_assets_kind_format
                        CHECK (
                            (kind = 'source' AND format IN ('mp4', 'mov'))
                            OR (kind = 'video' AND format IN ('mp4', 'hls'))
                            OR (kind = 'captions' AND format = 'vtt')
                        ),
                    FOREIGN KEY (speech_id) REFERENCES speeches (id) ON DELETE CASCADE
                )
                SQL);

            DB::statement(<<<'SQL'
                INSERT INTO speech_assets (
                    id, speech_id, kind, format, rendition, disk, path,
                    original_filename, mime_type, byte_size, duration_seconds,
                    status, failure_code, failure_detail, is_primary,
                    upload_id, client_declared_bytes, created_at, updated_at
                )
                SELECT
                    id, speech_id, kind, format, rendition, disk, path,
                    original_filename, mime_type, byte_size, duration_seconds,
                    status, failure_code, failure_detail, is_primary,
                    upload_id, client_declared_bytes, created_at, updated_at
                FROM speech_assets_new
                SQL);

            DB::statement('DROP TABLE speech_assets_new');

            DB::statement('CREATE INDEX speech_assets_speech_id_index ON speech_assets (speech_id)');
            DB::statement('CREATE UNIQUE INDEX uq_assets_primary ON speech_assets (speech_id, kind) WHERE is_primary');
        } else {
            DB::statement('ALTER TABLE speech_assets DROP CONSTRAINT ck_speech_assets_kind_format');
            DB::statement(<<<'SQL'
                ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_kind_format
                    CHECK (
                        (kind = 'source' AND format IN ('mp4', 'mov'))
                        OR (kind = 'video' AND format IN ('mp4', 'hls'))
                        OR (kind = 'captions' AND format = 'vtt')
                    )
                SQL);

            DB::statement('ALTER TABLE speech_assets DROP CONSTRAINT ck_speech_assets_format');
            DB::statement(<<<'SQL'
                ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_format
                    CHECK (format IN ('mp4', 'mov', 'hls', 'vtt'))
                SQL);

            DB::statement('ALTER TABLE speech_assets DROP CONSTRAINT ck_speech_assets_kind');
            DB::statement(<<<'SQL'
                ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_kind
                    CHECK (kind IN ('source', 'video', 'captions'))
                SQL);

            Schema::table('speech_assets', function ($table): void {
                $table->dropColumn(['width', 'height', 'poster_time_seconds']);
            });
        }
    }
};
