<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Judgement call (no assets table exists yet in S1, per the task
     * brief): `avatar_path` is a nullable string holding the storage path
     * on the `media` disk (App\Services\MediaUrlSigner presigns it for
     * display), NOT a foreign key. When an `assets` table is introduced in
     * a later step, this becomes `avatar_asset_id` and a migration backfills
     * it from this column — noted here so that step doesn't have to
     * rediscover the decision.
     */
    public function up(): void
    {
        Schema::create('profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('display_name', 60)->nullable();
            $table->string('bio', 1000)->nullable();
            $table->string('pronouns', 32)->nullable();
            $table->string('location', 80)->nullable();
            $table->string('timezone', 64)->default('UTC');
            $table->string('locale', 10)->default('en');
            $table->string('avatar_path')->nullable();
            $table->timestamp('onboarding_completed_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('profiles');
    }
};
