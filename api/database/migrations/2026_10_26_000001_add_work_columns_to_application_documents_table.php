<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PLAN-CODE-REVIEW-FOLLOW-UP.md §8.3 (R6): durable document-work protocol.
 * Additive only — the status enum is untouched; `pending_scan` and `infected`
 * rows are the durable work intent. Null scheduling fields mean "not yet
 * scheduled / due", so legacy rows need no backfill.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('application_documents', function (Blueprint $table) {
            $table->uuid('work_claim_id')->nullable();
            $table->timestamp('work_lease_until')->nullable();
            $table->timestamp('work_next_attempt_at')->nullable();
            $table->timestamp('work_dispatched_at')->nullable();
            $table->unsignedSmallInteger('work_attempts')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('application_documents', function (Blueprint $table) {
            $table->dropColumn([
                'work_claim_id',
                'work_lease_until',
                'work_next_attempt_at',
                'work_dispatched_at',
                'work_attempts',
            ]);
        });
    }
};
