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
