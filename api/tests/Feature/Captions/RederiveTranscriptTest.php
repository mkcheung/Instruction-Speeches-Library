<?php

use App\Jobs\RederiveTranscript;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\TranscriptDeriver;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-captions.md's own wording for the caption-edit endpoint:
 * "dispatches the re-derive job." This job re-reads the (already-edited,
 * already-persisted-as-canonical) VTT off storage and turns it into the
 * speech_transcripts row, source = 'edited'.
 */
it('re-derives the transcript from the stored VTT and sets source to edited', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);

    $vtt = <<<'VTT'
        WEBVTT

        00:00:00.000 --> 00:00:30.000
        Toastmasters, not toast masters.
        VTT;

    Storage::disk('media')->put($captions->path, $vtt);

    (new RederiveTranscript($captions->id))->handle(new TranscriptDeriver);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->source)->toBe('edited');
    expect($transcript->body)->toBe('Toastmasters, not toast masters.');
    expect($transcript->word_count)->toBe(4);
});

it('preserves the prior model/language across an edit rather than resetting them', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    SpeechTranscript::factory()->for($speech)->create(['model' => 'whisper.cpp-small.en', 'language' => 'fr', 'source' => 'whisper']);
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);

    Storage::disk('media')->put($captions->path, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour.");

    (new RederiveTranscript($captions->id))->handle(new TranscriptDeriver);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->model)->toBe('whisper.cpp-small.en');
    expect($transcript->language)->toBe('fr');
    expect($transcript->source)->toBe('edited');
});

it('is a no-op if the captions asset is not ready', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing']);

    (new RederiveTranscript($captions->id))->handle(new TranscriptDeriver);

    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});
