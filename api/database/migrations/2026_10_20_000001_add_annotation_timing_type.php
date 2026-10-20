<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Nullable only for history whose origin was already erased. No default:
        // an old voice writer must never silently create a purported range.
        DB::statement("ALTER TABLE annotations ADD COLUMN timing_type VARCHAR(8) NULL CHECK (timing_type IN ('range', 'point'))");
        DB::table('annotations')->where(function ($query): void {
            $query->whereNotNull('audio_asset_id')->orWhere('transcript_status', '<>', 'not_applicable');
        })->update(['timing_type' => 'point']);
        // Audio-null tombstones may have been purged recordings, including ones
        // with text. Empty live rows may also have lost voice origin. Leave
        // these unresolved for the explicit inventory/classification gate.
        DB::table('annotations')->whereNull('timing_type')->whereNull('deleted_at')
            ->where('body', '<>', '')->update(['timing_type' => 'range']);
    }

    public function down(): void
    {
        Schema::table('annotations', fn (Blueprint $table) => $table->dropColumn('timing_type'));
    }
};
