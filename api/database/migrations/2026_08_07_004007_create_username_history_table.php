<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Squatting protection is the real reason this table exists (§6.5):
     * `/u/{username}` resolution must check here on a miss so a released
     * handle cannot be immediately reclaimed by someone else and used to
     * impersonate the previous owner. Link preservation is the bonus.
     * `user_id` has no FK constraint deliberately: a user erased under
     * GDPR (§11.2) must not cascade-delete their username history, since
     * the squatting protection needs to outlive the account.
     */
    public function up(): void
    {
        Schema::create('username_history', function (Blueprint $table) {
            $table->id();
            $table->string('username', 30);
            $table->unsignedBigInteger('user_id');
            $table->timestamp('released_at');
            $table->timestamps();

            $table->index('username');
            $table->index('user_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('username_history');
    }
};
