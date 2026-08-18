<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * STEP-09-VERIFICATION-PLAN.md §4.1 "Generation-attempt identity and
     * recovery": `status` + `captions_enabled` alone cannot tell an old,
     * still-running worker attempt apart from a brand-new one after a
     * disable -> re-enable cycle, or from a manual edit that supersedes
     * whatever whisper was doing. A nullable UUID token plus three explicit
     * clocks fix that:
     *
     *  - `caption_attempt_id`: rotated by App\Services\Captions\
     *    CaptionAttemptTracker::rotate() on every automatic start/retry;
     *    every write a job makes back to its own row is a compare-and-set
     *    against this exact value, never a bare `status = 'processing'`
     *    check.
     *  - `caption_queued_at`: set the instant a job is dispatched — the
     *    recovery reconciler's "no `started_at` yet" clock, checked against
     *    a separately configured, conservative maximum queue wait.
     *  - `caption_started_at` / `caption_heartbeat_at`: set by the job's own
     *    atomic claim, then advanced at each stage boundary in
     *    WhisperTranscriber (before FFmpeg, before whisper-cli, before the
     *    storage write). `updated_at` is deliberately NOT reused for this —
     *    it also changes on unrelated writes (e.g. a speaker's manual edit),
     *    so it cannot tell "still alive" apart from "something else touched
     *    this row" the way a dedicated heartbeat can.
     *
     * All four columns are nullable and start NULL for every existing row —
     * this is purely additive, exactly like 2026_08_08_160001's poster
     * columns. Plain `ADD COLUMN` has a Blueprint equivalent on both
     * sqlite/pgsql (per that migration's own doc comment) and touches no
     * CHECK constraint, so unlike the raw-SQL create-table migration this
     * one needs no driver branch at all.
     */
    public function up(): void
    {
        Schema::table('speech_assets', function ($table): void {
            $table->uuid('caption_attempt_id')->nullable();
            $table->timestamp('caption_queued_at', 0)->nullable();
            $table->timestamp('caption_started_at', 0)->nullable();
            $table->timestamp('caption_heartbeat_at', 0)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('speech_assets', function ($table): void {
            $table->dropColumn([
                'caption_attempt_id',
                'caption_queued_at',
                'caption_started_at',
                'caption_heartbeat_at',
            ]);
        });
    }
};
