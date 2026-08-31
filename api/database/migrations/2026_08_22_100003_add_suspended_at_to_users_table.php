<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * STEP-12-FROZEN-CONTRACT.md §7.4 / STEP-11's own note that
     * `suspended_at` was deliberately deferred to this step
     * (2026_08_20_100004_add_anonymized_at_to_users_table.php's
     * docblock). Reversible moderation action, distinct from
     * `deleted_at`'s 30-day-grace soft-delete and `anonymized_at`'s
     * permanent erasure — `App\Services\UserDeletionService::suspend()`
     * is the only writer.
     *
     * `deleted_at` is added here too, confirmed absent from `users`
     * (grepped every prior migration) — `App\Services\UserDeletionService
     * ::softDelete()` is the only writer. This is a 30-day-grace
     * moderation soft-delete, never Eloquent's `SoftDeletes` trait on
     * `User` itself (that would silently exclude suspended-but-not-
     * deleted rows from every unscoped query elsewhere in the app) —
     * queries that must exclude a soft-deleted user filter on
     * `whereNull('deleted_at')` explicitly, the same way
     * `RoleAssignmentService`'s admin re-count already does.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('suspended_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['suspended_at', 'deleted_at']));
    }
};
