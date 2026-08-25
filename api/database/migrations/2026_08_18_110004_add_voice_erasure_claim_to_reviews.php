<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reviews', fn (Blueprint $table) => $table->timestamp('voice_erasure_started_at')->nullable());
    }

    public function down(): void
    {
        Schema::table('reviews', fn (Blueprint $table) => $table->dropColumn('voice_erasure_started_at'));
    }
};
