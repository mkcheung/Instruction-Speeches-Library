<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

it('enforces voice asset format, non-primary coexistence, and the existing primary uniqueness invariant', function () {
    $speech = Speech::factory()->create();
    $first = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $second = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    expect($first->is_primary)->toBeFalse()->and($second->is_primary)->toBeFalse();

    expect(fn () => SpeechAsset::factory()->for($speech)->create([
        'kind' => 'voice_note',
        'format' => 'mp4',
        'status' => 'ready',
        'is_primary' => false,
    ]))->toThrow(QueryException::class);
    expect(fn () => SpeechAsset::factory()->voiceNote()->for($speech)->create([
        'status' => 'ready',
        'is_primary' => true,
    ]))->toThrow(QueryException::class);
});

it('enforces transcript statuses and nulls the voice FK when its asset is erased', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id,
        'speech_owner_id' => $speaker->id,
        'reviewer_id' => $reviewer->id,
    ]);
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $annotation = Annotation::factory()->for($review)->create([
        'audio_asset_id' => $asset->id,
        'duration_seconds' => 90,
        'transcript_status' => 'ready',
    ]);
    $asset->delete();
    expect($annotation->fresh()->audio_asset_id)->toBeNull()
        ->and($annotation->fresh()->transcript_status)->toBe('ready')
        ->and((float) $annotation->fresh()->duration_seconds)->toBe(90.0);

    expect(fn () => DB::table('annotations')->where('id', $annotation->id)->update([
        'transcript_status' => 'invented',
    ]))->toThrow(QueryException::class);
});

it('defaults user preferences to an empty JSON object', function () {
    $user = User::factory()->create();
    expect($user->preferences)->toBeArray()->toBe([]);
});
