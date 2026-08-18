<?php

use App\Models\Speech;
use App\Models\SpeechTranscript;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Schema;

/**
 * STEP-09-captions.md / the frozen STEP-09 backend contract §3, §7, §8.
 * This test suite runs on SQLite (phpunit.xml) — the CHECK-constraint and
 * unique-index assertions below exercise the SQLite branch of the
 * driver-branched migrations; the Postgres branch (generated `tsvector` +
 * GIN index) is not exercised here (§7 of the contract: "manually verified
 * against the dev stack" is the accepted gap for CI pinned to SQLite).
 */
it('adds captions_enabled to speeches, defaulting to true', function () {
    expect(Schema::hasColumn('speeches', 'captions_enabled'))->toBeTrue();

    $speech = Speech::factory()->create();

    expect($speech->fresh()->captions_enabled)->toBeTrue();
});

it('creates the speech_transcripts table with the expected columns', function () {
    foreach (['id', 'speech_id', 'body', 'segments', 'word_count', 'words_per_minute', 'language', 'model', 'source'] as $column) {
        expect(Schema::hasColumn('speech_transcripts', $column))->toBeTrue();
    }
});

it('enforces the source CHECK constraint (whisper|edited only)', function () {
    $speech = Speech::factory()->create();

    SpeechTranscript::factory()->for($speech)->create(['source' => 'whisper']);
    SpeechTranscript::factory()->for(Speech::factory()->create())->create(['source' => 'edited']);

    expect(fn () => SpeechTranscript::factory()->for(Speech::factory()->create())->create(['source' => 'bogus']))
        ->toThrow(QueryException::class);
});

it('enforces at most one transcript row per speech', function () {
    $speech = Speech::factory()->create();
    SpeechTranscript::factory()->for($speech)->create();

    expect(fn () => SpeechTranscript::factory()->for($speech)->create())
        ->toThrow(QueryException::class);
});

it('cascade-deletes transcripts when the speech is force-deleted', function () {
    $speech = Speech::factory()->create();
    $transcript = SpeechTranscript::factory()->for($speech)->create();

    $speech->forceDelete();

    expect(SpeechTranscript::query()->find($transcript->id))->toBeNull();
});
