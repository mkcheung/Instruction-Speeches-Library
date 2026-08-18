<?php

use App\Services\Captions\TranscriptDeriver;

/**
 * STEP-09-captions.md §6.12: the single derivation used by BOTH
 * App\Services\Captions\WhisperTranscriber/FakeCaptionTranscriber
 * (source='whisper') and App\Jobs\RederiveTranscript (source='edited') —
 * this file only tests the derivation math, not either caller.
 */
it('derives body, segments, word_count and words_per_minute from a cue list', function () {
    $cues = [
        ['start' => 0.0, 'end' => 30.0, 'text' => 'One two three four five.'],
        ['start' => 30.0, 'end' => 60.0, 'text' => 'Six seven eight nine ten.'],
    ];

    $derived = (new TranscriptDeriver)->derive($cues);

    expect($derived['body'])->toBe('One two three four five. Six seven eight nine ten.');
    expect($derived['segments'])->toBe($cues);
    expect($derived['word_count'])->toBe(10);
    // 10 words over 60 seconds (1 minute) = 10 wpm.
    expect($derived['words_per_minute'])->toBe(10.0);
});

it('collapses internal whitespace in cue text when building body', function () {
    $cues = [
        ['start' => 0.0, 'end' => 1.0, 'text' => "Line one.\nLine  two."],
    ];

    $derived = (new TranscriptDeriver)->derive($cues);

    expect($derived['body'])->toBe('Line one. Line two.');
});

it('returns a zero word_count and null words_per_minute for an empty cue list', function () {
    $derived = (new TranscriptDeriver)->derive([]);

    expect($derived['body'])->toBe('');
    expect($derived['segments'])->toBe([]);
    expect($derived['word_count'])->toBe(0);
    expect($derived['words_per_minute'])->toBeNull();
});

it('returns null words_per_minute when total cue duration is zero', function () {
    $cues = [
        ['start' => 5.0, 'end' => 5.0, 'text' => 'Instant.'],
    ];

    $derived = (new TranscriptDeriver)->derive($cues);

    expect($derived['word_count'])->toBe(1);
    expect($derived['words_per_minute'])->toBeNull();
});
