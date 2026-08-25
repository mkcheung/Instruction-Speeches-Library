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
            DB::statement('ALTER TABLE annotations RENAME TO annotations_pre_voice');
            DB::statement(<<<'SQL'
                CREATE TABLE annotations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL,
                    client_uuid VARCHAR(36) NOT NULL, body TEXT NOT NULL,
                    start_seconds NUMERIC(10,3) NOT NULL,
                    duration_seconds NUMERIC(6,3) NOT NULL DEFAULT 6.000,
                    kind VARCHAR(16) NOT NULL DEFAULT 'observation', topic VARCHAR(32) NULL,
                    published_at DATETIME NULL, lock_version INTEGER NOT NULL DEFAULT 0,
                    audio_asset_id INTEGER NULL,
                    transcript_status VARCHAR(16) NOT NULL DEFAULT 'not_applicable',
                    transcript_failure_code VARCHAR(64) NULL, transcript_attempt_id VARCHAR(36) NULL,
                    created_at DATETIME NULL, updated_at DATETIME NULL, deleted_at DATETIME NULL,
                    CONSTRAINT ck_annotations_kind CHECK (kind IN ('praise','correction','observation')),
                    CONSTRAINT ck_annotations_timing CHECK (start_seconds >= 0 AND duration_seconds > 0 AND duration_seconds <= 120),
                    CONSTRAINT ck_annotations_transcript_status CHECK (transcript_status IN ('not_applicable','pending','processing','ready','failed')),
                    FOREIGN KEY (review_id) REFERENCES reviews (id) ON DELETE CASCADE,
                    FOREIGN KEY (audio_asset_id) REFERENCES speech_assets (id) ON DELETE SET NULL
                )
                SQL);
            DB::statement(<<<'SQL'
                INSERT INTO annotations (id,review_id,client_uuid,body,start_seconds,duration_seconds,kind,topic,published_at,lock_version,created_at,updated_at,deleted_at)
                SELECT id,review_id,client_uuid,body,start_seconds,duration_seconds,kind,topic,published_at,lock_version,created_at,updated_at,deleted_at FROM annotations_pre_voice
                SQL);
            DB::statement('DROP TABLE annotations_pre_voice');
        } else {
            Schema::table('annotations', function (Blueprint $table): void {
                $table->foreignId('audio_asset_id')->nullable()->constrained('speech_assets')->nullOnDelete();
                $table->string('transcript_status', 16)->default('not_applicable');
                $table->string('transcript_failure_code', 64)->nullable();
                $table->uuid('transcript_attempt_id')->nullable();
            });
            DB::statement("ALTER TABLE annotations ADD CONSTRAINT ck_annotations_transcript_status CHECK (transcript_status IN ('not_applicable','pending','processing','ready','failed'))");
        }
        $this->indexes();
        DB::statement('CREATE UNIQUE INDEX uq_annotations_audio_asset ON annotations (audio_asset_id) WHERE audio_asset_id IS NOT NULL');
    }

    public function down(): void
    {
        if (Schema::getConnection()->getDriverName() === 'sqlite') {
            DB::statement('ALTER TABLE annotations RENAME TO annotations_voice');
            DB::statement(<<<'SQL'
                CREATE TABLE annotations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL,
                    client_uuid VARCHAR(36) NOT NULL, body TEXT NOT NULL,
                    start_seconds NUMERIC(10,3) NOT NULL,
                    duration_seconds NUMERIC(6,3) NOT NULL DEFAULT 6.000,
                    kind VARCHAR(16) NOT NULL DEFAULT 'observation', topic VARCHAR(32) NULL,
                    published_at DATETIME NULL, lock_version INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME NULL, updated_at DATETIME NULL, deleted_at DATETIME NULL,
                    CONSTRAINT ck_annotations_kind CHECK (kind IN ('praise','correction','observation')),
                    CONSTRAINT ck_annotations_timing CHECK (start_seconds >= 0 AND duration_seconds > 0 AND duration_seconds <= 120),
                    FOREIGN KEY (review_id) REFERENCES reviews (id) ON DELETE CASCADE
                )
                SQL);
            DB::statement(<<<'SQL'
                INSERT INTO annotations (id,review_id,client_uuid,body,start_seconds,duration_seconds,kind,topic,published_at,lock_version,created_at,updated_at,deleted_at)
                SELECT id,review_id,client_uuid,body,start_seconds,duration_seconds,kind,topic,published_at,lock_version,created_at,updated_at,deleted_at FROM annotations_voice
                SQL);
            DB::statement('DROP TABLE annotations_voice');
            $this->indexes();

            return;
        }
        DB::statement('DROP INDEX IF EXISTS uq_annotations_audio_asset');
        DB::statement('ALTER TABLE annotations DROP CONSTRAINT ck_annotations_transcript_status');
        Schema::table('annotations', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('audio_asset_id');
            $table->dropColumn(['transcript_status', 'transcript_failure_code', 'transcript_attempt_id']);
        });
    }

    private function indexes(): void
    {
        DB::statement('DROP INDEX IF EXISTS annotations_review_start_index');
        DB::statement('DROP INDEX IF EXISTS annotations_review_published_index');
        DB::statement('DROP INDEX IF EXISTS uq_annotations_review_client_uuid');
        DB::statement('CREATE INDEX annotations_review_start_index ON annotations (review_id,start_seconds)');
        DB::statement('CREATE INDEX annotations_review_published_index ON annotations (review_id,published_at)');
        DB::statement('CREATE UNIQUE INDEX uq_annotations_review_client_uuid ON annotations (review_id,client_uuid) WHERE deleted_at IS NULL');
    }
};
