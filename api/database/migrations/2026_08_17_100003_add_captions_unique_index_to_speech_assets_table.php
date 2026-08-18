<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * captions-settings gap fix (post-STEP-09 code review): the final defense
 * for App\Services\Captions\EnsureCaptionJob's "reuse the single captions
 * row" contract. `uq_assets_primary`
 * (2026_08_08_150003_create_speech_assets_table.php) is a DIFFERENT partial
 * index — scoped to `WHERE is_primary`, not `WHERE kind = 'captions'` — and
 * doesn't stop two `kind = 'captions'` rows existing for one speech (there
 * is no `is_primary` concept for captions at all). Every write path
 * (EnsureCaptionJob, CaptionService::update) already reuses-or-creates
 * under a row lock, so this index should never actually fire in practice —
 * it exists purely as the DB-level backstop the task brief calls for, not
 * because a bug is expected to hit it.
 *
 * A new migration, not an edit to the existing 2026_08_08_150003 one — this
 * project's convention throughout (see that migration's own poster-columns
 * follow-up, 2026_08_08_160001) is additive ALTERs, never rewriting an
 * already-shipped migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(
            "CREATE UNIQUE INDEX uq_assets_captions_one_per_speech ON speech_assets (speech_id) WHERE kind = 'captions'",
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS uq_assets_captions_one_per_speech');
    }
};
