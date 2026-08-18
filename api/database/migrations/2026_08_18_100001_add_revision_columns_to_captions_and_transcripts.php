<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * STEP-09-VERIFICATION-PLAN.md §4.1 "Projection convergence token":
     * `content_revision` (SHA-256 of the canonical VTT, `speech_assets`,
     * `kind = 'captions'` rows only — the column exists on every asset row
     * but is only ever written for captions) and `caption_revision`
     * (`speech_transcripts`, the revision the transcript was derived FROM).
     * Both nullable and start NULL for every existing row — purely
     * additive, same shape as 2026_08_17_100004's attempt-tracking columns,
     * and for the same reason this needs no driver branch: a plain ADD
     * COLUMN has a Blueprint equivalent on both sqlite/pgsql.
     *
     * These are NOT a client-supplied precondition or optimistic lock
     * (§4.1 is explicit) — nothing ever accepts either column as request
     * input; they are computed server-side by
     * App\Services\Captions\CaptionRevision and compared only inside
     * App\Jobs\RederiveTranscript's own supersession checks.
     */
    public function up(): void
    {
        Schema::table('speech_assets', function ($table): void {
            $table->string('content_revision', 64)->nullable();
        });

        Schema::table('speech_transcripts', function ($table): void {
            $table->string('caption_revision', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('speech_assets', function ($table): void {
            $table->dropColumn('content_revision');
        });

        Schema::table('speech_transcripts', function ($table): void {
            $table->dropColumn('caption_revision');
        });
    }
};
