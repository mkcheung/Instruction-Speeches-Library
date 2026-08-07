<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Deliberately data, not a constant (§6.5, STEP-01 acceptance list),
     * so the list can grow without a deploy. `username` is stored already
     * lowercase/accent-normalized by the seeder, matching how
     * App\Support\Username normalizes user input before comparison.
     */
    public function up(): void
    {
        Schema::create('reserved_usernames', function (Blueprint $table) {
            $table->id();
            $table->string('username', 30)->unique();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('reserved_usernames');
    }
};
