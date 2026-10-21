<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechTranscript;
use App\Models\User;
use App\Services\Search\SpeechSearch;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;

/**
 * `GET /speeches/{speech}/transcript` and `GET /speeches/search?q=` — the
 * search contract: literal title/description/transcript matching. SQLite
 * assertions establish its ASCII case behavior; PostgreSQL runs establish
 * production Unicode behavior independently.
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

it('searches each field independently with conditional excerpts and unchanged speech fields', function (string $field) {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create([
        'title' => $field === 'title' ? 'A NEEDLE title' : 'Unrelated title',
        'description' => $field === 'description' ? 'A Needle description' : null,
    ]);
    if ($field === 'body') {
        SpeechTranscript::factory()->for($speech)->create(['body' => 'Before needle after.']);
    }

    $result = $this->actingAs($user)->getJson('/api/speeches/search?q=needle')
        ->assertOk()->assertJsonCount(1, 'results')->json('results.0');

    expect($result['id'])->toBe($speech->id)
        ->and($result['ulid'])->toBe($speech->ulid)
        ->and($result)->toHaveKeys(['user_id', 'delivered_on', 'change_note', 'captions_enabled', 'created_at', 'primary_video']);
    $match = $result['search_match'];
    expect(implode('', array_column($match['title'], 'text')))->toBe($speech->title);
    if ($field === 'description') {
        expect(implode('', array_column($match['description'], 'text')))->toBe($speech->description);
    } else {
        expect($match['description'])->toBeNull();
    }
    expect($match['transcript_excerpt'] !== null)->toBe($field === 'body');
    $parts = $field === 'body' ? $match['transcript_excerpt']['parts'] : $match[$field];
    expect(array_values(array_filter($parts, fn ($part) => $part['matched'])))->toHaveCount(1);
    expect($result)->not->toHaveKeys(['body', 'segments', 'search_body', 'search_folded_body']);
})->with(['title', 'description', 'body']);

it('keeps every search OR arm inside owner and soft deletion boundaries', function (string $field) {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    foreach (['own', 'foreign', 'deleted'] as $scope) {
        $speech = Speech::factory()->for($scope === 'foreign' ? $other : $owner)->create([
            'title' => $field === 'title' ? 'scopecontrol' : 'Other title',
            'description' => $field === 'description' ? 'scopecontrol' : null,
        ]);
        if ($field === 'body') {
            SpeechTranscript::factory()->for($speech)->create(['body' => 'scopecontrol']);
        }
        if ($scope === 'deleted') {
            $speech->delete();
        }
        if ($scope === 'own') {
            $expected = $speech->id;
        }
    }

    $response = $this->actingAs($owner)->getJson('/api/speeches/search?q=scopecontrol')->assertOk();
    expect(array_column($response->json('results'), 'id'))->toBe([$expected]);
})->with(['title', 'description', 'body']);

it('uses literal contiguous trimmed phrases rather than stemming or wildcard matching', function (string $query) {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['title' => 'Ordinary title', 'description' => null]);
    SpeechTranscript::factory()->for($speech)->create(['body' => 'Before '.$query.' after']);
    $this->actingAs($owner)->getJson('/api/speeches/search?'.http_build_query(['q' => '  '.$query.'  ']))
        ->assertOk()->assertJsonCount(1, 'results');
    SpeechTranscript::query()->where('speech_id', $speech->id)->update(['body' => 'Different text']);
    $this->getJson('/api/speeches/search?'.http_build_query(['q' => $query]))->assertJsonCount(0, 'results');
})->with(['district final', 'to be', '%', '_', '!', '50%_! off', 'back\\slash', "quote'", '.*[x]', '<script>alert(1)</script>', '__MATCH__']);

it('does not stem or reorder or collapse internal spaces and can match inside a word', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['title' => 'Ordinary', 'description' => null]);
    SpeechTranscript::factory()->for($speech)->create(['body' => 'These finalists spoke at the district large final.']);
    $this->actingAs($owner)->getJson('/api/speeches/search?q=FINAL')->assertJsonCount(1, 'results');
    foreach (['district final', 'final district', 'finals', 'district  large'] as $query) {
        $this->getJson('/api/speeches/search?'.http_build_query(['q' => $query]))->assertJsonCount(0, 'results');
    }
});

it('does not fabricate excerpts for an existing nonmatching or empty projection', function (string $body) {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['title' => 'Needle', 'description' => '']);
    SpeechTranscript::factory()->for($speech)->create(['body' => $body]);
    $this->actingAs($owner)->getJson('/api/speeches/search?q=needle')
        ->assertOk()->assertJsonPath('results.0.search_match.transcript_excerpt', null)
        ->assertJsonPath('results.0.search_match.description', null);
})->with(['', 'Unrelated body']);

it('preserves edited and disabled retained projections and deduplicates matches', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['title' => 'Needle', 'description' => 'Needle', 'captions_enabled' => false]);
    SpeechTranscript::factory()->for($speech)->edited()->create(['body' => 'Across cue needle boundaries.']);
    $this->actingAs($owner)->getJson('/api/speeches/search?q=needle')->assertOk()->assertJsonCount(1, 'results')
        ->assertJsonPath('results.0.search_match.transcript_excerpt.parts.1.matched', true);
});

it('rejects blank and overlength queries with codepoint based boundaries', function () {
    $owner = User::factory()->create();
    $this->actingAs($owner);
    foreach (['   ', str_repeat('a', 256), str_repeat('😀', 256)] as $query) {
        $this->getJson('/api/speeches/search?'.http_build_query(['q' => $query]))->assertUnprocessable();
    }
    $this->getJson('/api/speeches/search?'.http_build_query(['q' => str_repeat('😀', 255)]))->assertOk();
});

it('requires authentication for search', function () {
    $this->getJson('/api/speeches/search?q=needle')->assertUnauthorized();
});

it('orders newest first with deterministic IDs for tied creation dates', function () {
    $owner = User::factory()->create();
    $first = Speech::factory()->for($owner)->create(['title' => 'Needle', 'created_at' => '2026-01-01 00:00:00']);
    $second = Speech::factory()->for($owner)->create(['title' => 'Needle', 'created_at' => '2026-01-01 00:00:00']);
    $newest = Speech::factory()->for($owner)->create(['title' => 'Needle', 'created_at' => '2026-01-02 00:00:00']);
    $response = $this->actingAs($owner)->getJson('/api/speeches/search?q=needle')->assertOk();
    expect(array_column($response->json('results'), 'id'))->toBe([$newest->id, $second->id, $first->id]);
});

it('selects transcript eligibility and excerpt from the same projection snapshot', function (string $mutation) {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['title' => 'Ordinary', 'description' => null]);
    SpeechTranscript::factory()->for($speech)->create(['body' => 'Original needle body']);
    $changed = false;
    DB::listen(function (QueryExecuted $event) use (&$changed, $speech, $mutation): void {
        if (! $changed && str_contains($event->sql, 'search_transcript')) {
            $changed = true;
            $projection = SpeechTranscript::query()->where('speech_id', $speech->id);
            if ($mutation === 'delete') {
                $projection->delete();
            } else {
                $projection->update(['body' => 'Replacement unrelated text']);
            }
        }
    });
    $this->actingAs($owner)->getJson('/api/speeches/search?q=needle')->assertOk()->assertJsonCount(1, 'results')
        ->assertJsonPath('results.0.search_match.transcript_excerpt.parts.1.text', 'needle');
    expect($changed)->toBeTrue();
    $this->getJson('/api/speeches/search?q=needle')->assertJsonCount(0, 'results');
})->with(['update', 'delete']);

it('does not issue one transcript query per result or select segments', function () {
    $owner = User::factory()->create();
    $make = function (int $count) use ($owner): void {
        Speech::factory()->for($owner)->count($count)->create(['title' => 'Needle'])->each(function (Speech $speech): void {
            SpeechTranscript::factory()->for($speech)->create(['body' => 'Needle body']);
        });
    };
    $search = app(SpeechSearch::class);
    $make(1);
    DB::enableQueryLog();
    $search->find($owner->id, 'needle');
    $small = DB::getQueryLog();
    DB::disableQueryLog();
    $make(20);
    DB::enableQueryLog();
    DB::flushQueryLog();
    $results = $search->find($owner->id, 'needle');
    $large = DB::getQueryLog();
    DB::disableQueryLog();
    expect($results)->toHaveCount(21)
        ->and(count($large))->toBe(count($small))
        ->and(count($large))->toBeLessThanOrEqual(4)
        ->and(implode(' ', array_column($large, 'query')))->not->toContain('segments');
});

it('uses production database case behavior independently for every field', function (string $field, string $source, string $needle, bool $matches) {
    if (DB::connection()->getDriverName() !== 'pgsql') {
        $this->markTestSkipped('PostgreSQL locale-specific contract; independently exercised on disposable PostgreSQL.');
    }
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create([
        // A separate matching field keeps negative field-level controls eligible.
        'title' => $field === 'title' ? $source : $needle,
        'description' => $field === 'description' ? $source : ($field === 'title' ? $needle : null),
    ]);
    if ($field === 'body') {
        SpeechTranscript::factory()->for($speech)->create(['body' => $source]);
    }
    $result = $this->actingAs($owner)->getJson('/api/speeches/search?'.http_build_query(['q' => $needle]))
        ->assertOk()->assertJsonCount(1, 'results')->json('results.0.search_match');
    $marked = $field === 'body' ? $result['transcript_excerpt'] !== null
        : count(array_filter($result[$field], fn ($part) => $part['matched'])) > 0;
    expect($marked)->toBe($matches);
    if ($field !== 'body') {
        expect($result['transcript_excerpt'])->toBeNull();
    }
})->with(['title', 'description', 'body'])->with([
    'accented' => ['École', 'é', true],
    'cyrillic' => ['ПРИВЕТ', 'привет', true],
    'Turkish dotted I' => ['İ', 'i', true],
    'Turkish dotless I' => ['I', 'ı', false],
    'sharp S expansion' => ['Straße', 'STRASSE', false],
    'capital sharp S' => ['ẞ', 'ß', true],
    'long S' => ['ſ', 's', false],
    'normalization' => ['é', "e\u{0301}", false],
    'accent removal' => ['é', 'e', false],
    'reverse long S' => ['s', 'ſ', false],
    'reverse sharp S' => ['ß', 'ẞ', true],
]);
