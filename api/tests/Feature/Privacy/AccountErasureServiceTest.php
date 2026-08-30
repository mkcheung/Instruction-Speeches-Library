<?php

use App\Models\Annotation;
use App\Models\AuditLog;
use App\Models\Profile;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Models\User;
use App\Services\Privacy\AccountErasureService;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-11-FROZEN-CONTRACT.md §6: the account-erasure job. Covers the
 * acceptance checklist items STEP-11.md and the frozen contract call out
 * explicitly: the orphan-storage walk (including the subtle §6 step 3(b)
 * case — a REVIEWER's voice note on a speech that gets deleted when the
 * SPEAKER's account is erased), `speech_transcripts` going with its
 * speech, `profiles` hard-deleted, and two erased reviewers producing two
 * stably-ordered "Former reviewer" tracks.
 */
function erasureSpeaker(): User
{
    $user = User::factory()->create(['username' => 'speaker-'.uniqid()]);
    $user->assignRole('member');

    return $user;
}

function erasureReviewer(): User
{
    $user = User::factory()->create(['username' => 'coach-'.uniqid()]);
    $user->assignRole('coach');

    return $user;
}

it('deletes every owned speech and its assets, purges storage, and preserves the speech_transcripts invariant', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');

    $speaker = erasureSpeaker();
    $reviewer = erasureReviewer();
    $speech = Speech::factory()->for($speaker)->create();

    $video = SpeechAsset::factory()->for($speech)->video()->ready()->create();
    Storage::disk('media')->put($video->path, 'video-bytes');

    $transcript = SpeechTranscript::factory()->for($speech)->create();

    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'in_progress',
    ]);
    $annotation = Annotation::factory()->for($review)->create();

    // §6 step 3(b): a REVIEWER's voice note on the SPEAKER's speech. The
    // speech-owning speaker is the one being erased, not the reviewer —
    // this asset's storage must be purged explicitly before the CASCADE
    // destroys the annotation row that pointed at it.
    $voiceAsset = SpeechAsset::factory()->for($speech)->voiceNote()->create(['status' => 'ready']);
    Storage::disk('media')->put($voiceAsset->path, 'voice-bytes');
    $annotation->update(['audio_asset_id' => $voiceAsset->id]);

    expect(Storage::disk('media')->allFiles())->toHaveCount(2);

    app(AccountErasureService::class)->execute($speaker->fresh());

    expect(Speech::withTrashed()->find($speech->id))->toBeNull()
        ->and(SpeechAsset::find($video->id))->toBeNull()
        ->and(SpeechAsset::find($voiceAsset->id))->toBeNull()
        ->and(SpeechTranscript::find($transcript->id))->toBeNull()
        ->and(Review::find($review->id))->toBeNull()
        ->and(Annotation::withTrashed()->find($annotation->id))->toBeNull();

    // The orphan-storage walk: every byte this speech's assets pointed at
    // is actually gone, not just the rows.
    expect(Storage::disk('media')->allFiles())->toBe([]);

    expect(Profile::where('user_id', $speaker->id)->count())->toBe(0);

    $fresh = $speaker->fresh();
    expect($fresh)->not->toBeNull()
        ->and($fresh->anonymized_at)->not->toBeNull()
        ->and($fresh->email)->toBe("erased-{$speaker->id}@erased.invalid")
        ->and($fresh->username)->toBeNull()
        ->and($fresh->first_name)->toBeNull()
        ->and($fresh->last_name)->toBeNull();

    $audit = AuditLog::where('action', 'account.erased')->where('subject_id', $speaker->id)->first();
    expect($audit)->not->toBeNull()
        ->and($audit->subject_type)->toBe(User::class)
        ->and($audit->metadata)->toHaveKey('speeches_deleted');
});

it('purges voice notes this user recorded as a reviewer elsewhere, keeping the annotation and its transcript', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');

    $speaker = erasureSpeaker();
    $reviewer = erasureReviewer();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'in_progress',
    ]);
    $annotation = Annotation::factory()->for($review)->create(['body' => 'Great pacing here.']);
    $voiceAsset = SpeechAsset::factory()->for($speech)->voiceNote()->create(['status' => 'ready']);
    Storage::disk('media')->put($voiceAsset->path, 'voice-bytes');
    $annotation->update(['audio_asset_id' => $voiceAsset->id]);

    app(AccountErasureService::class)->execute($reviewer->fresh());

    // The reviewer's identity is gone from the review...
    expect(Review::find($review->id)->reviewer_id)->toBeNull()
        // ...but the annotation itself (the speaker's commentary) survives.
        ->and(Annotation::find($annotation->id))->not->toBeNull()
        ->and(Annotation::find($annotation->id)->body)->toBe('Great pacing here.')
        ->and(SpeechAsset::find($voiceAsset->id))->toBeNull();

    expect(Storage::disk('media')->exists($voiceAsset->path))->toBeFalse();
});

it('produces two stably-ordered Former reviewer tracks when both reviewers on a speech are erased', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');

    $speaker = erasureSpeaker();
    $reviewerA = erasureReviewer();
    $reviewerB = erasureReviewer();
    $speech = Speech::factory()->for($speaker)->create();

    $reviewA = Review::factory()->accepted()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewerA->id, 'speech_owner_id' => $speaker->id, 'status' => 'in_progress',
    ]);
    $reviewB = Review::factory()->accepted()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewerB->id, 'speech_owner_id' => $speaker->id, 'status' => 'in_progress',
    ]);

    app(AccountErasureService::class)->execute($reviewerA->fresh());
    app(AccountErasureService::class)->execute($reviewerB->fresh());

    $response = $this->actingAs($speaker)->getJson("/api/speeches/{$speech->id}/reviews");
    $response->assertOk();

    $reviewers = collect($response->json('reviews'))->pluck('reviewer.display_name')->all();
    expect($reviewers)->toBe(['Former reviewer', 'Former reviewer']);

    // Positional stability: the ids come back in the same (ORDER BY id
    // ASC) order every time, so the two tracks are distinguishable by
    // which one a caller clicks into, not by the label text.
    $ids = collect($response->json('reviews'))->pluck('id')->all();
    expect($ids)->toBe([$reviewA->id, $reviewB->id]);
});

it('rejects a user erasing someone else\'s account via the self-service endpoint', function () {
    $this->seed(RoleSeeder::class);
    $victim = erasureSpeaker();
    $attacker = erasureSpeaker();
    $victimSpeech = Speech::factory()->for($victim)->create();

    $this->actingAs($attacker)->deleteJson('/api/account')->assertOk();

    // Only the caller's own account was touched.
    expect($victim->fresh()->anonymized_at)->toBeNull()
        ->and(Speech::find($victimSpeech->id))->not->toBeNull()
        ->and($attacker->fresh()->anonymized_at)->not->toBeNull();
});
