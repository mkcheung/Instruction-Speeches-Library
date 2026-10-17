<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * IMPLEMENTATION-PLANS.md §7.5.5. Plain `ADD COLUMN`, not driver-branched
     * raw SQL — the `speeches` CREATE migration is raw SQL only because of a
     * CHECK constraint and a partial unique index Blueprint can't express;
     * this is a simple nullable column add, and
     * `add_essay_columns_to_reviews_table` already establishes the
     * plain-Blueprint precedent for exactly that case on this schema.
     *
     * No CHECK constraint on the two allowed values (`owner`/`takedown`,
     * see App\Support\SpeechDeletionReason) — adding one would force
     * rebuilding the whole `speeches` table on SQLite (CREATE-TABLE-only
     * CHECK support). `audit_log.action`'s open-vocabulary-plus-const-class
     * precedent governs here instead.
     *
     * No `deleted_by_id` column — the actor is already recoverable from
     * `audit_log`, which is indexed on `(subject_type, subject_id)`.
     *
     * No backfill migration: every speech soft-deleted before this feature
     * existed was an admin takedown by construction, so
     * `deleted_reason IS NULL` must read as `takedown` at every call site
     * that branches on it (SpeechResource.php Filament,
     * MediaReconcileCommand.php) — see each site's own comment.
     */
    public function up(): void
    {
        Schema::table('speeches', function ($table): void {
            $table->string('deleted_reason', 16)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('speeches', function ($table): void {
            $table->dropColumn('deleted_reason');
        });
    }
};
