<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('speech_assets', function (Blueprint $table): void {
            // Durable accounting identity for a voice asset whose Review and
            // Annotation are about to be hard-deleted. A queue publish is not
            // durable state; media:reconcile uses this ledger if Redis is down
            // during the post-commit PurgeVoiceAsset dispatch.
            $table->unsignedBigInteger('purge_reviewer_id')->nullable()->index();
            // Persisted before the normalized object is uploaded. This makes
            // the object discoverable after SIGKILL/OOM in the upload-to-CAS
            // window and doubles as the single-winner normalization claim.
            $table->string('normalization_candidate_path')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('speech_assets', function (Blueprint $table): void {
            $table->dropColumn(['purge_reviewer_id', 'normalization_candidate_path']);
        });
    }
};
