<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * STEP-11-FROZEN-CONTRACT.md §3: add ONLY `anonymized_at` this step.
     * `suspended_at`/`suspended_by_id` are deliberately NOT added here —
     * suspension is untested/unrequired by STEP-11's own acceptance list,
     * has no existing code path, and is naturally an admin action that
     * needs STEP-12's not-yet-built admin surface.
     */
    public function up(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->timestamp('anonymized_at')->nullable());
    }

    public function down(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('anonymized_at'));
    }
};
