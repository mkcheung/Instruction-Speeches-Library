<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Database\Seeders\E2ESeeder;
use Database\Seeders\E2EVoiceAnnotationSeeder;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('media');
    $this->seed(E2ESeeder::class);
});

it('seeds non-vacuous voice, visibility, and erasure browser fixtures', function () {
    $this->seed(E2EVoiceAnnotationSeeder::class);

    expect(Speech::query()->whereIn('id', [9601, 9602, 9603])->count())->toBe(3);

    $published = Review::query()->findOrFail(E2EVoiceAnnotationSeeder::COACH_REVIEW_ID);
    expect($published->reviewer_id)->toBe(E2ESeeder::COACH_ID)
        ->and($published->status)->toBe('published')
        ->and($published->annotations_count)->toBe(8)
        ->and($published->published_annotations_count)->toBe(8);

    $member = Review::query()->findOrFail(E2EVoiceAnnotationSeeder::MEMBER_REVIEW_ID);
    expect($member->reviewer_id)->toBe(E2ESeeder::MEMBER_ID)
        ->and($member->status)->toBe('accepted');

    $draft = Annotation::query()->findOrFail(9822);
    expect($draft->review_id)->toBe(E2EVoiceAnnotationSeeder::PEER_DRAFT_REVIEW_ID)
        ->and($draft->published_at)->toBeNull()
        ->and($draft->audio_asset_id)->toBe(9722);

    $erasure = Annotation::query()->findOrFail(9821);
    expect($erasure->body)->toBe('This transcript survives reviewer erasure.')
        ->and($erasure->audio_asset_id)->toBe(9721);

    $voiceAssets = SpeechAsset::query()->where('kind', 'voice_note')->get();
    expect($voiceAssets)->toHaveCount(9);
    foreach ($voiceAssets as $asset) {
        expect($asset->status)->toBe('ready')
            ->and($asset->is_primary)->toBeFalse()
            ->and(Storage::disk('media')->exists($asset->path))->toBeTrue()
            ->and(Storage::disk('media')->size($asset->path))->toBe($asset->byte_size);
    }

    $pending = Annotation::query()->findOrFail(E2EVoiceAnnotationSeeder::FIRST_VOICE_ANNOTATION_ID);
    expect($pending->transcript_status)->toBe('pending')
        ->and($pending->body)->toBe('')
        ->and($pending->audioAsset?->status)->toBe('ready');

    $ordinaryText = Annotation::query()->findOrFail(9808);
    expect($ordinaryText->audio_asset_id)->toBeNull()
        ->and($ordinaryText->body)->toBe('Ordinary text remains visible.');
});

it('is idempotent without duplicating voice rows or media objects', function () {
    $this->seed(E2EVoiceAnnotationSeeder::class);
    User::query()->whereKey(E2ESeeder::COACH_B_ID)->update(['erasure_started_at' => now()]);
    $this->seed(E2EVoiceAnnotationSeeder::class);

    expect(Review::query()->whereIn('id', [9611, 9612, 9613, 9614])->count())->toBe(4)
        ->and(Annotation::query()->whereIn('review_id', [9611, 9612, 9613, 9614])->count())->toBe(10)
        ->and(SpeechAsset::query()->whereIn('speech_id', [9601, 9602, 9603])->count())->toBe(12)
        ->and(Storage::disk('media')->allFiles('e2e-voice'))->toHaveCount(12)
        ->and(User::query()->findOrFail(E2ESeeder::COACH_B_ID)->erasure_started_at)->toBeNull();
});
