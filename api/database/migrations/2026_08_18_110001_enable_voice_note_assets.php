<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::getConnection()->getDriverName() === 'sqlite') {
            DB::statement('ALTER TABLE speech_assets RENAME TO speech_assets_pre_voice');
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
                    temporary_path VARCHAR(255) NULL,
                    temporary_byte_size BIGINT NULL,
                    purge_claim_id VARCHAR(36) NULL,
                    client_declared_bytes BIGINT NULL,
                    width SMALLINT UNSIGNED NULL,
                    height SMALLINT UNSIGNED NULL,
                    poster_time_seconds NUMERIC(10, 3) NULL,
                    caption_attempt_id VARCHAR(36) NULL,
                    caption_queued_at DATETIME NULL,
                    caption_started_at DATETIME NULL,
                    caption_heartbeat_at DATETIME NULL,
                    content_revision VARCHAR(64) NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    CONSTRAINT ck_speech_assets_kind CHECK (kind IN ('source','video','captions','poster','sprite','voice_note')),
                    CONSTRAINT ck_speech_assets_format CHECK (format IN ('mp4','mov','hls','vtt','webp','jpeg','m4a')),
                    CONSTRAINT ck_speech_assets_status CHECK (status IN ('uploading','processing','ready','failed')),
                    CONSTRAINT ck_speech_assets_kind_format CHECK (
                        (kind = 'source' AND format IN ('mp4','mov')) OR
                        (kind = 'video' AND format IN ('mp4','hls')) OR
                        (kind = 'captions' AND format = 'vtt') OR
                        (kind = 'poster' AND format IN ('jpeg','webp')) OR
                        (kind = 'sprite' AND format = 'jpeg') OR
                        (kind = 'voice_note' AND format = 'm4a')
                    ),
                    CONSTRAINT ck_voice_note_not_primary CHECK (kind <> 'voice_note' OR is_primary = 0),
                    FOREIGN KEY (speech_id) REFERENCES speeches (id) ON DELETE CASCADE
                )
                SQL);
            DB::statement(<<<'SQL'
                INSERT INTO speech_assets (
                    id,speech_id,kind,format,rendition,disk,path,original_filename,mime_type,
                    byte_size,duration_seconds,status,failure_code,failure_detail,is_primary,
                    upload_id,temporary_path,temporary_byte_size,purge_claim_id,client_declared_bytes,width,height,poster_time_seconds,
                    caption_attempt_id,caption_queued_at,caption_started_at,caption_heartbeat_at,
                    content_revision,created_at,updated_at
                ) SELECT
                    id,speech_id,kind,format,rendition,disk,path,original_filename,mime_type,
                    byte_size,duration_seconds,status,failure_code,failure_detail,is_primary,
                    upload_id,NULL,NULL,NULL,client_declared_bytes,width,height,poster_time_seconds,
                    caption_attempt_id,caption_queued_at,caption_started_at,caption_heartbeat_at,
                    content_revision,created_at,updated_at
                FROM speech_assets_pre_voice
                SQL);
            DB::statement('DROP TABLE speech_assets_pre_voice');
        } else {
            Schema::table('speech_assets', function (Blueprint $table): void {
                $table->string('temporary_path')->nullable();
                $table->unsignedBigInteger('temporary_byte_size')->nullable();
                $table->uuid('purge_claim_id')->nullable();
            });
            foreach (['ck_speech_assets_kind_format', 'ck_speech_assets_format', 'ck_speech_assets_kind'] as $constraint) {
                DB::statement("ALTER TABLE speech_assets DROP CONSTRAINT {$constraint}");
            }
            DB::statement("ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_kind CHECK (kind IN ('source','video','captions','poster','sprite','voice_note'))");
            DB::statement("ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_format CHECK (format IN ('mp4','mov','hls','vtt','webp','jpeg','m4a'))");
            DB::statement(<<<'SQL'
                ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_kind_format CHECK (
                    (kind = 'source' AND format IN ('mp4','mov')) OR
                    (kind = 'video' AND format IN ('mp4','hls')) OR
                    (kind = 'captions' AND format = 'vtt') OR
                    (kind = 'poster' AND format IN ('jpeg','webp')) OR
                    (kind = 'sprite' AND format = 'jpeg') OR
                    (kind = 'voice_note' AND format = 'm4a')
                )
                SQL);
            DB::statement("ALTER TABLE speech_assets ADD CONSTRAINT ck_voice_note_not_primary CHECK (kind <> 'voice_note' OR is_primary = FALSE)");
        }

        DB::statement('DROP INDEX IF EXISTS speech_assets_speech_id_index');
        DB::statement('DROP INDEX IF EXISTS uq_assets_primary');
        DB::statement('DROP INDEX IF EXISTS uq_assets_captions_one_per_speech');
        DB::statement('CREATE INDEX speech_assets_speech_id_index ON speech_assets (speech_id)');
        DB::statement('CREATE UNIQUE INDEX uq_assets_primary ON speech_assets (speech_id, kind) WHERE is_primary');
        DB::statement("CREATE UNIQUE INDEX uq_assets_captions_one_per_speech ON speech_assets (speech_id) WHERE kind = 'captions'");
    }

    public function down(): void
    {
        DB::statement("DELETE FROM speech_assets WHERE kind = 'voice_note'");
        if (Schema::getConnection()->getDriverName() === 'sqlite') {
            DB::statement('ALTER TABLE speech_assets RENAME TO speech_assets_voice');
            DB::statement(<<<'SQL'
                CREATE TABLE speech_assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, speech_id INTEGER NOT NULL,
                    kind VARCHAR(16) NOT NULL, format VARCHAR(8) NOT NULL, rendition VARCHAR(16) NULL,
                    disk VARCHAR(32) NOT NULL DEFAULT 'media', path VARCHAR(255) NOT NULL,
                    original_filename VARCHAR(255) NULL, mime_type VARCHAR(255) NULL,
                    byte_size BIGINT NULL, duration_seconds NUMERIC(10,3) NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'uploading', failure_code VARCHAR(64) NULL,
                    failure_detail VARCHAR(2000) NULL, is_primary TINYINT(1) NOT NULL DEFAULT 0,
                    upload_id VARCHAR(255) NULL, client_declared_bytes BIGINT NULL,
                    width SMALLINT UNSIGNED NULL, height SMALLINT UNSIGNED NULL,
                    poster_time_seconds NUMERIC(10,3) NULL, caption_attempt_id VARCHAR(36) NULL,
                    caption_queued_at DATETIME NULL, caption_started_at DATETIME NULL,
                    caption_heartbeat_at DATETIME NULL, content_revision VARCHAR(64) NULL,
                    created_at DATETIME NULL, updated_at DATETIME NULL,
                    CONSTRAINT ck_speech_assets_kind CHECK (kind IN ('source','video','captions','poster','sprite')),
                    CONSTRAINT ck_speech_assets_format CHECK (format IN ('mp4','mov','hls','vtt','webp','jpeg')),
                    CONSTRAINT ck_speech_assets_status CHECK (status IN ('uploading','processing','ready','failed')),
                    CONSTRAINT ck_speech_assets_kind_format CHECK (
                      (kind='source' AND format IN ('mp4','mov')) OR (kind='video' AND format IN ('mp4','hls')) OR
                      (kind='captions' AND format='vtt') OR (kind='poster' AND format IN ('jpeg','webp')) OR (kind='sprite' AND format='jpeg')),
                    FOREIGN KEY (speech_id) REFERENCES speeches(id) ON DELETE CASCADE
                )
                SQL);
            DB::statement(<<<'SQL'
                INSERT INTO speech_assets (id,speech_id,kind,format,rendition,disk,path,original_filename,mime_type,byte_size,duration_seconds,status,failure_code,failure_detail,is_primary,upload_id,client_declared_bytes,width,height,poster_time_seconds,caption_attempt_id,caption_queued_at,caption_started_at,caption_heartbeat_at,content_revision,created_at,updated_at)
                SELECT id,speech_id,kind,format,rendition,disk,path,original_filename,mime_type,byte_size,duration_seconds,status,failure_code,failure_detail,is_primary,upload_id,client_declared_bytes,width,height,poster_time_seconds,caption_attempt_id,caption_queued_at,caption_started_at,caption_heartbeat_at,content_revision,created_at,updated_at FROM speech_assets_voice
                SQL);
            DB::statement('DROP TABLE speech_assets_voice');
        } else {
            DB::statement('ALTER TABLE speech_assets DROP CONSTRAINT ck_voice_note_not_primary');
            foreach (['ck_speech_assets_kind_format', 'ck_speech_assets_format', 'ck_speech_assets_kind'] as $constraint) {
                DB::statement("ALTER TABLE speech_assets DROP CONSTRAINT {$constraint}");
            }
            DB::statement("ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_kind CHECK (kind IN ('source','video','captions','poster','sprite'))");
            DB::statement("ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_format CHECK (format IN ('mp4','mov','hls','vtt','webp','jpeg'))");
            DB::statement("ALTER TABLE speech_assets ADD CONSTRAINT ck_speech_assets_kind_format CHECK ((kind='source' AND format IN ('mp4','mov')) OR (kind='video' AND format IN ('mp4','hls')) OR (kind='captions' AND format='vtt') OR (kind='poster' AND format IN ('jpeg','webp')) OR (kind='sprite' AND format='jpeg'))");
            Schema::table('speech_assets', fn (Blueprint $table) => $table->dropColumn(['temporary_path', 'temporary_byte_size', 'purge_claim_id']));
        }
        DB::statement('DROP INDEX IF EXISTS speech_assets_speech_id_index');
        DB::statement('DROP INDEX IF EXISTS uq_assets_primary');
        DB::statement('DROP INDEX IF EXISTS uq_assets_captions_one_per_speech');
        DB::statement('CREATE INDEX speech_assets_speech_id_index ON speech_assets (speech_id)');
        DB::statement('CREATE UNIQUE INDEX uq_assets_primary ON speech_assets (speech_id,kind) WHERE is_primary');
        DB::statement("CREATE UNIQUE INDEX uq_assets_captions_one_per_speech ON speech_assets (speech_id) WHERE kind='captions'");
    }
};
