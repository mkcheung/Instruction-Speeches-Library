<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Pronouns are no longer part of a profile: the column, the API field and
 * the onboarding/profile inputs all go together. `down()` restores the
 * column's original shape, but not the values this drops.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profiles', function (Blueprint $table) {
            $table->dropColumn('pronouns');
        });
    }

    public function down(): void
    {
        Schema::table('profiles', function (Blueprint $table) {
            $table->string('pronouns', 32)->nullable();
        });
    }
};
