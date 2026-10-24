<?php

use App\Models\Annotation;
use App\Models\AuditLog;
use App\Models\Connection;
use App\Models\Profile;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Models\User;
use App\Services\ConnectionService;
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

it('purges both mirrored rows of a connection when either party is erased, and plan() matches execute()', function () {
    $this->seed(RoleSeeder::class);

    $speaker = erasureSpeaker();
    $speaker->update(['first_name' => 'Erased', 'last_name' => 'Speaker']);
    $other = erasureSpeaker();
    $other->update(['first_name' => 'Remaining', 'last_name' => 'Speaker']);
    $thirdParty = erasureSpeaker();
    $thirdParty->update(['first_name' => 'Unrelated', 'last_name' => 'Speaker']);

    // Build a real accepted connection through the service, not the raw
    // factory, so both mirrored rows (owner_id/peer_id swapped) exist
    // exactly as a genuine accept writes them.
    $connections = app(ConnectionService::class);
    $connections->request($speaker, $other, null);
    $connections->accept($other, Connection::where('owner_id', $other->id)->where('peer_id', $speaker->id)->first()->id);

    // A second, unrelated connection naming neither erased party on
    // either side — the control group for the "not a blanket wipe"
    // assertion below.
    $connections->request($other, $thirdParty, null);
    $connections->accept($thirdParty, Connection::where('owner_id', $thirdParty->id)->where('peer_id', $other->id)->first()->id);

    // Sanity: both mirrored rows exist before erasure, one per direction.
    $asOwner = Connection::where('owner_id', $speaker->id)->where('peer_id', $other->id)->first();
    $asPeer = Connection::where('owner_id', $other->id)->where('peer_id', $speaker->id)->first();
    expect($asOwner)->not->toBeNull()->and($asPeer)->not->toBeNull();

    // plan()'s dry-run count must match the row count execute() actually
    // deletes for this step — the same drift guard this file already
    // applies to every other step.
    $plannedCount = app(AccountErasureService::class)->plan($speaker->fresh())->step('connections_deleted')['count'];

    $result = app(AccountErasureService::class)->execute($speaker->fresh());

    expect($plannedCount)->toBe(2);
    expect($result->step('connections_deleted')['count'])->toBe(2);

    // The mirrored-pair proof: BOTH rows are gone — the one where the
    // erased user is owner_id, AND the one where they're peer_id. A fix
    // that only purged `owner_id = $user->id` would leave $asPeer behind,
    // visible from $other's own roster, forever.
    expect(Connection::find($asOwner->id))->toBeNull()
        ->and(Connection::find($asPeer->id))->toBeNull();

    // The other party's own connection to a THIRD, non-erased user is
    // untouched — this isn't a blanket wipe of the connections table.
    // Re-queried from the DB (not a stale in-memory object from before
    // erasure ran), so a regression to a blanket `Connection::truncate()`
    // or an unscoped delete would actually fail this.
    expect(Connection::where('owner_id', $other->id)->where('peer_id', $thirdParty->id)->exists())->toBeTrue()
        ->and(Connection::where('owner_id', $thirdParty->id)->where('peer_id', $other->id)->exists())->toBeTrue();
});
