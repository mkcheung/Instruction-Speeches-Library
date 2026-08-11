<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Laravel's stock `notifications` table (the schema `php artisan
     * notifications:table` generates), needed for the `database` channel
     * used by ReviewInvited/ReviewAccepted/ReviewDeclined (STEP-05, §7.5's
     * in-app bell). Ordinary Blueprint is fine here — nothing about this
     * table needs the raw-SQL CHECK-constraint treatment `reviews`/
     * `speeches` need.
     */
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('type');
            $table->morphs('notifiable');
            $table->text('data');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
