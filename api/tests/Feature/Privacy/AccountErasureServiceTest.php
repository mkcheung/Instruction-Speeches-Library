<?php

use App\Models\Annotation;
use App\Models\ApplicationDocument;
use App\Models\AuditLog;
use App\Models\CoachApplication;
use App\Models\Connection;
use App\Models\Profile;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Models\User;
use App\Services\ConnectionService;
use App\Services\Privacy\AccountErasureService;
use App\Services\Privacy\CoachApplicationErasure;
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

it('step 6c shreds coach-application statements and document bytes, keeping decisions and hashes', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('application_documents');
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $applicant = erasureSpeaker();

    // An earlier, rejected attempt and the current, submitted one (one row
    // per attempt, PLAN-COACH-APPLICATION-REVIEW-PAGE.md §8).
    $rejected = CoachApplication::query()->create(['user_id' => $applicant->id, 'status' => 'submitted', 'statement' => 'First attempt.']);
    $rejected->reject($admin, 'Not yet.');
    $submitted = CoachApplication::query()->create(['user_id' => $applicant->id, 'status' => 'submitted', 'statement' => 'Second attempt.']);

    $documents = [];
    foreach ([[$rejected, 'old', 11], [$submitted, 'new', 22]] as [$application, $name, $bytes]) {
        $path = "applications/{$application->id}/{$name}.pdf";
        Storage::disk('application_documents')->put($path, str_repeat('x', $bytes));
        $documents[] = ApplicationDocument::query()->create([
            'application_id' => $application->id,
            'disk' => 'application_documents',
            'path' => $path,
            'original_filename' => "{$name}.pdf",
            'byte_size' => $bytes,
            'sha256' => str_repeat($name === 'old' ? 'a' : 'b', 64),
            'status' => 'clean',
        ]);
    }

    $planned = app(AccountErasureService::class)->plan($applicant->fresh())->step('coach_applications_shredded');
    $result = app(AccountErasureService::class)->execute($applicant->fresh());

    expect($planned)->toBe(['key' => 'coach_applications_shredded', 'label' => '6c. Shred coach-application statements and documents', 'count' => 2, 'bytes' => 33])
        ->and($result->step('coach_applications_shredded'))->toBe($planned);

    // Step order: 6c sits between 6b and 7.
    $keys = array_column($result->steps, 'key');
    expect(array_search('coach_applications_shredded', $keys, true))
        ->toBe(array_search('connections_deleted', $keys, true) + 1)
        ->and($keys[array_search('coach_applications_shredded', $keys, true) + 1])->toBe('user_anonymized');

    expect(Storage::disk('application_documents')->allFiles())->toBe([]);
    foreach ($documents as $document) {
        $fresh = $document->fresh();
        expect($fresh->path)->toBe('')
            ->and($fresh->original_filename)->toBe(ApplicationDocument::ERASED_FILENAME)
            ->and($fresh->sha256)->toBe($document->sha256)
            ->and($fresh->status)->toBe('clean')
            ->and($fresh->displayState())->toBe('Erased');
    }

    $rejectedAfter = $rejected->fresh();
    expect($rejectedAfter->statement)->toBeNull()
        ->and($rejectedAfter->status)->toBe('rejected')
        ->and($rejectedAfter->decision_reason)->toBe('Not yet.')
        ->and($rejectedAfter->decided_by_id)->toBe($admin->id)
        ->and($submitted->fresh()->statement)->toBeNull()
        ->and($submitted->fresh()->status)->toBe('withdrawn');

    // The audit metadata carries the same counts.
    $audit = AuditLog::query()->where('subject_id', $applicant->id)->latest('id')->firstOrFail();
    expect($audit->metadata['coach_applications_shredded'])->toBe(['count' => 2, 'bytes' => 33]);

    // Idempotent: a rerun (the backfill) shreds nothing more.
    expect(app(CoachApplicationErasure::class)->execute($applicant->fresh()))->toBe(['count' => 0, 'bytes' => 0])
        ->and(app(CoachApplicationErasure::class)->plan($applicant->fresh()))->toBe(['count' => 0, 'bytes' => 0]);
});

it('step 6c is a no-op for a user with no coach applications', function () {
    $this->seed(RoleSeeder::class);
    $user = erasureSpeaker();

    $result = app(AccountErasureService::class)->execute($user->fresh());

    expect($result->step('coach_applications_shredded')['count'])->toBe(0)
        ->and($result->step('coach_applications_shredded')['bytes'])->toBe(0);
});

it('step 6c keeps a draft a draft and erases filenames left on already-emptied rows', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('application_documents');
    $applicant = erasureSpeaker();

    // Never submitted: shredded, but not withdrawn, so it stays out of the
    // admin list (which hides only drafts).
    $draft = CoachApplication::query()->create(['user_id' => $applicant->id, 'status' => 'draft', 'statement' => 'Unsent.']);

    $row = fn (string $path, string $name, string $status) => ApplicationDocument::query()->create([
        'application_id' => $draft->id,
        'disk' => 'application_documents',
        'path' => $path,
        'original_filename' => $name,
        'byte_size' => 5,
        'sha256' => str_repeat('c', 64),
        'status' => $status,
    ]);
    // Infected-cleanup blanks `path` but keeps the client-supplied name.
    $quarantined = $row('', 'Jane_Doe_passport.pdf', 'infected');
    $purged = $row('', '[purged]', 'clean');

    $result = app(CoachApplicationErasure::class)->execute($applicant->fresh());

    expect($result)->toBe(['count' => 0, 'bytes' => 0])
        ->and($draft->fresh()->status)->toBe('draft')
        ->and($draft->fresh()->statement)->toBeNull()
        ->and($quarantined->fresh()->original_filename)->toBe(ApplicationDocument::ERASED_FILENAME)
        ->and($quarantined->fresh()->displayState())->toBe('Erased')
        ->and($purged->fresh()->original_filename)->toBe('[purged]');
});
