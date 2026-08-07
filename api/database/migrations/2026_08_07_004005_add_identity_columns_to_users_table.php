<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * `name` is made nullable rather than dropped: nothing yet depends on
     * removing it, and Notifiable/factories reference it. Registration
     * (Fortify CreateNewUser) only collects email + password; first_name,
     * last_name and username are collected at onboarding step 1
     * (STEP-01-identity.md), so all three must be nullable until then —
     * `onboarding_completed_at` on `profiles` is the real "is this done"
     * flag, not NOT NULL constraints here.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('name')->nullable()->change();
            $table->string('first_name', 60)->nullable()->after('id');
            $table->string('last_name', 60)->nullable()->after('first_name');
            // Stored already lowercase-normalized + accent-folded by
            // application code (App\Support\Username) — never rely on
            // Postgres collation, which is case-sensitive by default
            // (STEP-01-identity.md "Watch for").
            $table->string('username', 30)->nullable()->unique()->after('last_name');
            // Not in the plan's literal profiles/username_history column
            // list, but needed to enforce "one username change per 30
            // days" (§6.5) without re-deriving it from username_history's
            // most recent `released_at` on every request.
            $table->timestamp('username_changed_at')->nullable()->after('username');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['first_name', 'last_name', 'username', 'username_changed_at']);
            $table->string('name')->nullable(false)->change();
        });
    }
};
