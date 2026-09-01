<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * STEP-13-FROZEN-CONTRACT.md §1 / MODERNIZATION_PLAN §6.7.3.
     * `reviews.speech_owner_id`/`last_transition_at` already exist (built at
     * STEP-05) — this migration adds ONLY the two partial indexes the
     * profile-timeline query needs. No new columns, no `is_granting`
     * generated column (§0 of the frozen contract: that column doesn't
     * exist anywhere in this schema and shouldn't — a partial index does
     * the same job on Postgres with no table-rebuild risk).
     *
     * The predicate lives in the index, not a stored column: rows are
     * eligible when `status IN ('accepted','in_progress','published')`
     * (`Review::ACCESS_GRANTING`) AND `revoked_at IS NULL`. Both indexes
     * keep their ordering for matching rows, so `ORDER BY
     * last_transition_at DESC, id DESC` is a pure index range scan with no
     * filesort and the cursor tuple pushes straight into the index read.
     *
     * `ix_reviews_timeline`: viewer's own "history with this person"
     * (`reviewer_id` leading). `ix_reviews_incoming`: the mirror tab,
     * "reviews they left you" (`speech_owner_id` leading).
     */
    public function up(): void
    {
        DB::statement(
            'CREATE INDEX ix_reviews_timeline ON reviews (reviewer_id, speech_owner_id, last_transition_at DESC, id DESC) '.
            "WHERE status IN ('accepted','in_progress','published') AND revoked_at IS NULL"
        );

        DB::statement(
            'CREATE INDEX ix_reviews_incoming ON reviews (speech_owner_id, reviewer_id, last_transition_at DESC, id DESC) '.
            "WHERE status IN ('accepted','in_progress','published') AND revoked_at IS NULL"
        );
    }

    public function down(): void
    {
        Schema::table('reviews', function (): void {
            DB::statement('DROP INDEX IF EXISTS ix_reviews_timeline');
            DB::statement('DROP INDEX IF EXISTS ix_reviews_incoming');
        });
    }
};
