<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechTranscript;
use App\Models\User;

/**
 * `GET /speeches/{speech}/transcript` and `GET /speeches/search?q=` — the
 * frozen STEP-09 backend contract §4, §7. This test suite runs on SQLite
 * (phpunit.xml), so the search assertions below exercise the `LIKE`
 * fallback branch (§7: "sqlite gets a plain column... search falls back to
 * a LIKE"), not the Postgres tsvector/GIN path.
 */
it('returns the empty state when no transcript exists yet', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}/transcript");

    $response->assertOk();
    $response->assertJsonPath('transcript.body', '');
    $response->assertJsonPath('transcript.word_count', 0);
    $response->assertJsonPath('transcript.source', null);
});

it('returns the transcript envelope with body/segments/word_count/words_per_minute/language/model/source', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    SpeechTranscript::factory()->for($speech)->create([
        'body' => 'Toastmasters, not toast masters.',
        'word_count' => 4,
        'words_per_minute' => 120.5,
        'language' => 'en',
        'model' => 'whisper.cpp-base.en',
        'source' => 'whisper',
    ]);

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}/transcript");

    $response->assertOk();
    $response->assertJsonPath('transcript.body', 'Toastmasters, not toast masters.');
    $response->assertJsonPath('transcript.word_count', 4);
    $response->assertJsonPath('transcript.words_per_minute', 120.5);
    $response->assertJsonPath('transcript.model', 'whisper.cpp-base.en');
    $response->assertJsonPath('transcript.source', 'whisper');
});

it('an accepted reviewer can read the transcript; a stranger cannot', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $stranger = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    SpeechTranscript::factory()->for($speech)->create();
    Review::factory()->accepted()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    $this->actingAs($reviewer)->getJson("/api/speeches/{$speech->id}/transcript")->assertOk();
    $this->actingAs($stranger)->getJson("/api/speeches/{$speech->id}/transcript")->assertForbidden();
});

it('search finds the right speech by a distinctive phrase, scoped to the caller\'s own speeches', function () {
    $user = User::factory()->create();
    $otherUser = User::factory()->create();

    $matching = Speech::factory()->for($user)->create(['title' => 'District Final Speech']);
    SpeechTranscript::factory()->for($matching)->create(['body' => 'I talked about the district final and how nervous I was.']);

    $nonMatching = Speech::factory()->for($user)->create(['title' => 'Unrelated']);
    SpeechTranscript::factory()->for($nonMatching)->create(['body' => 'This speech is about something else entirely.']);

    // Someone else's speech that DOES mention the phrase — must never come
    // back for $user, even though it matches textually.
    $othersSpeech = Speech::factory()->for($otherUser)->create();
    SpeechTranscript::factory()->for($othersSpeech)->create(['body' => 'I also mentioned the district final once.']);

    $response = $this->actingAs($user)->getJson('/api/speeches/search?q=district final');

    $response->assertOk();
    $ids = collect($response->json('results'))->pluck('id');
    expect($ids)->toContain($matching->id);
    expect($ids)->not->toContain($nonMatching->id);
    expect($ids)->not->toContain($othersSpeech->id);
});

it('search does not include a reviewed-but-not-owned speech, even one the caller can watch', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    SpeechTranscript::factory()->for($speech)->create(['body' => 'A very distinctive phrase indeed.']);
    Review::factory()->accepted()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    $response = $this->actingAs($reviewer)->getJson('/api/speeches/search?q=distinctive phrase');

    $response->assertOk();
    expect($response->json('results'))->toBe([]);
});

it('rejects an empty search query', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->getJson('/api/speeches/search?q=')->assertStatus(422);
});
