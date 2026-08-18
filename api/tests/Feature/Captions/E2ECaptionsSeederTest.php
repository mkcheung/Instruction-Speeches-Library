<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use Database\Seeders\E2ECaptionsSeeder;
use Database\Seeders\E2ESeeder;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-VERIFICATION-PLAN.md §3.3: exercised with Storage::fake('media')
 * so this stays a fast SQLite test — never against a real SeaweedFS/browser
 * stack — and asserts real object contents plus idempotent row/object
 * counts, without touching E2ESeederRolesTest/E2ESeederSharedSpeechTest's
 * existing lightweight-seeder coverage.
 */
beforeEach(function () {
    Storage::fake('media');
    $this->seed(E2ESeeder::class);
});

it('seeds the caption-display speech with a ready video, ready captions, transcript, and a published annotation', function () {
    $this->seed(E2ECaptionsSeeder::class);

    $speech = Speech::query()->find(E2ECaptionsSeeder::CAPTION_DISPLAY_SPEECH_ID);
    expect($speech)->not->toBeNull();
    expect($speech->user_id)->toBe(E2ESeeder::MEMBER_ID);
    expect($speech->captions_enabled)->toBeTrue();

    $video = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'video')->first();
    expect($video)->not->toBeNull();
    expect($video->status)->toBe('ready');
    expect($video->is_primary)->toBeTrue();
    expect(Storage::disk('media')->exists($video->path))->toBeTrue();
    expect(Storage::disk('media')->size($video->path))->toBe($video->byte_size);

    $captions = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->first();
    expect($captions)->not->toBeNull();
    expect($captions->status)->toBe('ready');
    expect(Storage::disk('media')->exists($captions->path))->toBeTrue();
    expect(Storage::disk('media')->get($captions->path))->toContain('welcome to the toastmasters showcase');

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->first();
    expect($transcript)->not->toBeNull();
    expect($transcript->source)->toBe('whisper');
    expect($transcript->model)->toBe('e2e-fixture');
    expect($transcript->word_count)->toBeGreaterThan(0);
    expect($transcript->segments)->toHaveCount(2);

    $reviewA = Review::query()->find(E2ECaptionsSeeder::REVIEW_DISPLAY_COACH_A_ID);
    expect($reviewA->status)->toBe('published');
    expect($reviewA->reviewer_id)->toBe(E2ESeeder::COACH_ID);

    $reviewB = Review::query()->find(E2ECaptionsSeeder::REVIEW_DISPLAY_COACH_B_ID);
    expect($reviewB->status)->toBe('invited');
    expect($reviewB->reviewer_id)->toBe(E2ESeeder::COACH_B_ID);

    $annotation = Annotation::query()->where('review_id', $reviewA->id)->first();
    expect($annotation)->not->toBeNull();
    expect($annotation->published_at)->not->toBeNull();
    // Overlaps the first cue (0.5s-2.5s) per the seeder's own comment.
    expect((float) $annotation->start_seconds)->toBeGreaterThanOrEqual(0.5);
    expect((float) $annotation->start_seconds)->toBeLessThan(2.5);
});

it('seeds the reviewer-access speech with an accepted (not published) reviewer', function () {
    $this->seed(E2ECaptionsSeeder::class);

    $review = Review::query()->find(E2ECaptionsSeeder::REVIEW_ACCESS_COACH_A_ID);
    expect($review)->not->toBeNull();
    expect($review->status)->toBe('accepted');
    expect($review->speech_id)->toBe(E2ECaptionsSeeder::REVIEWER_ACCESS_SPEECH_ID);
});

it('seeds the caption-edit speech with the exact uncorrected phrase Scenario B corrects', function () {
    $this->seed(E2ECaptionsSeeder::class);

    $asset = SpeechAsset::query()
        ->where('speech_id', E2ECaptionsSeeder::CAPTION_EDIT_SPEECH_ID)
        ->where('kind', 'captions')
        ->first();

    $vtt = Storage::disk('media')->get($asset->path);
    expect($vtt)->toContain(E2ECaptionsSeeder::EDIT_FIXTURE_UNCORRECTED_PHRASE);
    expect($vtt)->not->toContain('Toastmasters');
});

it('seeds the caption-processing speech as processing with no transcript row', function () {
    $this->seed(E2ECaptionsSeeder::class);

    $asset = SpeechAsset::query()
        ->where('speech_id', E2ECaptionsSeeder::CAPTION_PROCESSING_SPEECH_ID)
        ->where('kind', 'captions')
        ->first();

    expect($asset)->not->toBeNull();
    expect($asset->status)->toBe('processing');
    expect(SpeechTranscript::query()->where('speech_id', E2ECaptionsSeeder::CAPTION_PROCESSING_SPEECH_ID)->exists())->toBeFalse();

    $video = SpeechAsset::query()
        ->where('speech_id', E2ECaptionsSeeder::CAPTION_PROCESSING_SPEECH_ID)
        ->where('kind', 'video')
        ->first();
    expect($video->status)->toBe('ready');
});

it('refreshes the processing fixture liveness clocks on every re-seed', function () {
    Carbon\Carbon::setTestNow(Carbon\Carbon::parse('2026-06-01 00:00:00'));
    $this->seed(E2ECaptionsSeeder::class);
    $first = SpeechAsset::query()
        ->where('speech_id', E2ECaptionsSeeder::CAPTION_PROCESSING_SPEECH_ID)
        ->where('kind', 'captions')
        ->first();

    Carbon\Carbon::setTestNow(Carbon\Carbon::parse('2026-06-01 00:00:05'));
    $this->seed(E2ECaptionsSeeder::class);
    $second = SpeechAsset::query()
        ->where('speech_id', E2ECaptionsSeeder::CAPTION_PROCESSING_SPEECH_ID)
        ->where('kind', 'captions')
        ->first();

    Carbon\Carbon::setTestNow();

    expect($second->updated_at->greaterThan($first->updated_at))->toBeTrue();
});

it('seeds the caption-failed speech with a stable, user-safe failure code', function () {
    $this->seed(E2ECaptionsSeeder::class);

    $asset = SpeechAsset::query()
        ->where('speech_id', E2ECaptionsSeeder::CAPTION_FAILED_SPEECH_ID)
        ->where('kind', 'captions')
        ->first();

    expect($asset->status)->toBe('failed');
    expect($asset->failure_code)->toBe('transcription_failed');
    expect($asset->failure_detail)->toBeNull();
});

it('seeds the three search-control speeches with correct ownership and phrase distribution', function () {
    $this->seed(E2ECaptionsSeeder::class);

    $ownerMatch = SpeechTranscript::query()->where('speech_id', E2ECaptionsSeeder::SEARCH_OWNER_MATCH_SPEECH_ID)->first();
    expect($ownerMatch->body)->toContain(E2ECaptionsSeeder::SEARCH_DISTINCTIVE_PHRASE);
    expect(Speech::query()->find(E2ECaptionsSeeder::SEARCH_OWNER_MATCH_SPEECH_ID)->user_id)->toBe(E2ESeeder::MEMBER_ID);

    $ownerNonMatch = SpeechTranscript::query()->where('speech_id', E2ECaptionsSeeder::SEARCH_OWNER_NONMATCH_SPEECH_ID)->first();
    expect($ownerNonMatch->body)->not->toContain(E2ECaptionsSeeder::SEARCH_DISTINCTIVE_PHRASE);

    $otherUserMatch = SpeechTranscript::query()->where('speech_id', E2ECaptionsSeeder::SEARCH_OTHER_USER_MATCH_SPEECH_ID)->first();
    expect($otherUserMatch->body)->toContain(E2ECaptionsSeeder::SEARCH_DISTINCTIVE_PHRASE);
    expect(Speech::query()->find(E2ECaptionsSeeder::SEARCH_OTHER_USER_MATCH_SPEECH_ID)->user_id)->toBe(E2ESeeder::COACH_B_ID);
});

it('is idempotent, so re-seeding a live e2e database does not duplicate rows or objects', function () {
    $this->seed(E2ECaptionsSeeder::class);
    $this->seed(E2ECaptionsSeeder::class);

    $speechIds = [
        E2ECaptionsSeeder::CAPTION_DISPLAY_SPEECH_ID,
        E2ECaptionsSeeder::REVIEWER_ACCESS_SPEECH_ID,
        E2ECaptionsSeeder::CAPTION_EDIT_SPEECH_ID,
        E2ECaptionsSeeder::SEARCH_EDIT_SPEECH_ID,
        E2ECaptionsSeeder::CAPTION_PROCESSING_SPEECH_ID,
        E2ECaptionsSeeder::CAPTION_FAILED_SPEECH_ID,
        E2ECaptionsSeeder::SEARCH_OWNER_MATCH_SPEECH_ID,
        E2ECaptionsSeeder::SEARCH_OWNER_NONMATCH_SPEECH_ID,
        E2ECaptionsSeeder::SEARCH_OTHER_USER_MATCH_SPEECH_ID,
    ];

    foreach ($speechIds as $id) {
        expect(Speech::query()->where('id', $id)->count())->toBe(1);
        expect(SpeechTranscript::query()->where('speech_id', $id)->count())->toBeLessThanOrEqual(1);
    }

    expect(Review::query()->whereIn('id', [
        E2ECaptionsSeeder::REVIEW_DISPLAY_COACH_A_ID,
        E2ECaptionsSeeder::REVIEW_DISPLAY_COACH_B_ID,
        E2ECaptionsSeeder::REVIEW_ACCESS_COACH_A_ID,
    ])->count())->toBe(3);

    expect(Annotation::query()->where('review_id', E2ECaptionsSeeder::REVIEW_DISPLAY_COACH_A_ID)->count())->toBe(1);
});

it('does not mutate E2ESeeder\'s shared speech 9101', function () {
    $this->seed(E2ECaptionsSeeder::class);

    $shared = Speech::query()->find(E2ESeeder::SHARED_SPEECH_ID);
    expect($shared->title)->toBe('E2E shared speech (two reviewers)');
    expect(SpeechAsset::query()->where('speech_id', E2ESeeder::SHARED_SPEECH_ID)->count())->toBe(1);
});
