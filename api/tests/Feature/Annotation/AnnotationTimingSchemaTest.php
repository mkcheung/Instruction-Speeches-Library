<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\SpeechAsset;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

it('backfills only provable origins without rewriting annotation content or timing', function () {
    $review = Review::factory()->create();
    $written = Annotation::factory()->for($review)->create(['body' => 'Written note']);
    $asset = SpeechAsset::factory()->voiceNote()->create(['speech_id' => $review->speech_id, 'status' => 'ready']);
    $voice = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => '', 'transcript_status' => 'pending']);
    $erasedText = Annotation::factory()->for($review)->create(['audio_asset_id' => null, 'body' => 'Retained transcript', 'transcript_status' => 'ready']);
    $ambiguousEmpty = Annotation::factory()->for($review)->create(['body' => '', 'audio_asset_id' => null, 'transcript_status' => 'not_applicable']);
    $ambiguousDeleted = Annotation::factory()->for($review)->create(['body' => 'May have been a purged voice', 'deleted_at' => now()]);
    $before = DB::table('annotations')->get(['id', 'body', 'start_seconds', 'duration_seconds', 'deleted_at', 'published_at', 'updated_at'])->toJson();
    $migration = require database_path('migrations/2026_10_20_000001_add_annotation_timing_type.php');
    $migration->down();
    $migration->up();
    expect($written->fresh()->timing_type)->toBe('range')
        ->and($voice->fresh()->timing_type)->toBe('point')
        ->and($erasedText->fresh()->timing_type)->toBe('point')
        ->and($ambiguousEmpty->fresh()->timing_type)->toBeNull()
        ->and(Annotation::withTrashed()->findOrFail($ambiguousDeleted->id)->timing_type)->toBeNull()
        ->and(DB::table('annotations')->get(['id', 'body', 'start_seconds', 'duration_seconds', 'deleted_at', 'published_at', 'updated_at'])->toJson())->toBe($before);
});

it('constrains new explicit geometry values while leaving unresolved history nullable', function () {
    $row = Annotation::factory()->create();
    expect(fn () => DB::table('annotations')->where('id', $row->id)->update(['timing_type' => 'invented']))->toThrow(QueryException::class);
});
