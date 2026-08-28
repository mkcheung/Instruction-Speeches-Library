<?php

use App\Models\Speech;
use App\Models\User;
use App\Services\SpeechService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * §6.11. The `< id` CHECK is the entire cycle defense; cross-owner linking
 * is a service-layer check because the owner lives on a different row.
 */
it('links a speech to an earlier one by the same speaker', function () {
    $user = User::factory()->create();
    $earlier = Speech::factory()->for($user)->create(['title' => 'Attempt 1']);

    $response = $this->actingAs($user)->postJson('/api/speeches', [
        'title' => 'Attempt 2',
        'supersedes_id' => $earlier->id,
        'change_note' => 'Cut the third example.',
    ]);

    $response->assertCreated();
    $response->assertJsonPath('speech.supersedes.id', $earlier->id);

    expect(Speech::query()->find($response->json('speech.id'))->supersedes_id)->toBe($earlier->id);
});

it('refuses linking to a speech owned by someone else', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $theirSpeech = Speech::factory()->for($owner)->create();

    $response = $this->actingAs($other)->postJson('/api/speeches', [
        'title' => 'My attempt',
        'supersedes_id' => $theirSpeech->id,
        'change_note' => 'Trying to claim someone else\'s history.',
    ]);

    $response->assertUnprocessable();
    $response->assertJsonValidationErrors('supersedes_id');
});

it('requires a change_note when linking to a previous attempt', function () {
    $user = User::factory()->create();
    $earlier = Speech::factory()->for($user)->create();

    $response = $this->actingAs($user)->postJson('/api/speeches', [
        'title' => 'Attempt 2',
        'supersedes_id' => $earlier->id,
    ]);

    $response->assertUnprocessable();
    $response->assertJsonValidationErrors('change_note');
});

it('refuses a cycle at the database level via the < id CHECK constraint', function () {
    $user = User::factory()->create();
    $first = Speech::factory()->for($user)->create();
    $second = Speech::factory()->for($user)->create(['supersedes_id' => $first->id]);

    // A direct write attempting first -> supersedes -> second (a cycle,
    // since second already supersedes first) must be rejected by the CHECK,
    // not by application code — proving the constraint itself, not a
    // service-layer guard that could be bypassed by a seeder or console
    // command (§6.11's stated reason for using the DB, not a recursive walk).
    expect(fn () => DB::statement(
        'UPDATE speeches SET supersedes_id = ? WHERE id = ?',
        [$second->id, $first->id],
    ))->toThrow(QueryException::class);
});

it('allows at most one successor per attempt', function () {
    $user = User::factory()->create();
    $earlier = Speech::factory()->for($user)->create();
    Speech::factory()->for($user)->create(['supersedes_id' => $earlier->id]);

    expect(fn () => Speech::factory()->for($user)->create(['supersedes_id' => $earlier->id]))
        ->toThrow(QueryException::class);
});

/**
 * Post-STEP-10 code review: the at-most-one-successor half of the invariant
 * was left entirely to the DB index, so the service produced a 500 where
 * its sibling failure produces a clean 422.
 */
it('rejects a second successor with a validation error rather than a QueryException', function () {
    $user = User::factory()->create();
    $earlier = Speech::factory()->for($user)->create();
    Speech::factory()->for($user)->create(['supersedes_id' => $earlier->id]);

    expect(fn () => app(SpeechService::class)->create($user, [
        'title' => 'Attempt 3',
        'supersedes_id' => $earlier->id,
    ]))->toThrow(ValidationException::class);
});

it('counts a soft-deleted successor as still occupying the slot', function () {
    $user = User::factory()->create();
    $earlier = Speech::factory()->for($user)->create();
    $successor = Speech::factory()->for($user)->create(['supersedes_id' => $earlier->id]);
    $successor->delete();

    // `uq_speeches_successor` has no `WHERE deleted_at IS NULL` clause (the
    // annotations index does), so the tombstone still holds the slot even
    // though `supersededBy()` reports null. Without withTrashed() here the
    // service waved this through into a unique-index violation.
    expect(fn () => app(SpeechService::class)->create($user, [
        'title' => 'Attempt 3',
        'supersedes_id' => $earlier->id,
    ]))->toThrow(ValidationException::class);
});
