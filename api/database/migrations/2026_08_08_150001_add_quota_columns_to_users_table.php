<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Quota bookkeeping for the media pipeline (MODERNIZATION_PLAN §9.1).
     *
     * `storage_bytes_used` and `uploads_in_flight` are mutated ONLY via the
     * single conditional `UPDATE ... WHERE storage_bytes_used + :n <=
     * quota_bytes AND uploads_in_flight < 2` in App\Services\QuotaService —
     * never check-then-act. `quota_bytes` defaults to 5 GiB; there is no
     * per-tier product concept yet, so every account gets the same cap.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedBigInteger('storage_bytes_used')->default(0)->after('remember_token');
            $table->unsignedBigInteger('quota_bytes')->default(5 * 1024 * 1024 * 1024)->after('storage_bytes_used');
            $table->unsignedSmallInteger('uploads_in_flight')->default(0)->after('quota_bytes');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['storage_bytes_used', 'quota_bytes', 'uploads_in_flight']);
        });
    }
};
