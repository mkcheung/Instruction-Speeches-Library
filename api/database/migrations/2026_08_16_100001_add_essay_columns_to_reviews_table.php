<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * STEP-08-essay.md / the frozen STEP-08 backend contract: the essay is
     * "a fourth thing a review owns, alongside the access grant, the
     * annotation set and the playback track" — so it lives on `reviews`
     * rather than its own table, and every access rule already written for
     * a review (§7.3's "reviewers may not read each other's commentary")
     * applies unchanged.
     *
     * `essay_lock_version` is DELIBERATELY separate from
     * `annotations.lock_version` (a different table entirely) and there is
     * no pre-existing `reviews` lock column to collide with either — see
     * the contract's own note: sharing a counter with annotation writes on
     * the same screen would make every annotation write invalidate the
     * essay editor's version and vice versa, producing spurious conflict
     * dialogs on a screen where the user is doing both at once.
     *
     * Plain `ADD COLUMN`, no CHECK constraints — unlike the `reviews`
     * create-table migration (status/counter CHECKs) or the poster-columns
     * ALTER on `speech_assets` (kind/format CHECK rewrite), nothing here
     * needs SQLite's CREATE-TABLE-only CHECK support, so (matching that
     * poster-columns migration's own comment: "Plain ADD COLUMN has a
     * Blueprint equivalent on both drivers") this can stay a plain
     * Blueprint migration rather than driver-branched raw SQL.
     */
    public function up(): void
    {
        Schema::table('reviews', function ($table): void {
            $table->mediumText('essay_html')->nullable();
            $table->mediumText('essay_text')->nullable();
            $table->timestamp('essay_published_at')->nullable();
            $table->timestamp('essay_updated_at')->nullable();
            $table->unsignedInteger('essay_words')->default(0);
            $table->unsignedInteger('essay_lock_version')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('reviews', function ($table): void {
            $table->dropColumn([
                'essay_html', 'essay_text', 'essay_published_at',
                'essay_updated_at', 'essay_words', 'essay_lock_version',
            ]);
        });
    }
};
