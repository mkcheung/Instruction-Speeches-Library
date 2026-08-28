<?php

use App\Services\Captions\InvalidVttException;
use App\Services\Captions\Vtt;

/**
 * STEP-09-captions.md's parsing boundary (App\Services\Captions\Vtt) —
 * used both to derive App\Models\SpeechTranscript rows and to validate a
 * speaker's edited VTT server-side (422 on malformed input).
 */
it('parses a well-formed VTT into an ordered cue list with timing', function () {
    $vtt = <<<'VTT'
        WEBVTT

        00:00:00.000 --> 00:00:02.500
        Hello there.

        00:00:02.500 --> 00:00:05.000
        Toast masters.
        VTT;

    $cues = Vtt::parse($vtt);

    expect($cues)->toHaveCount(2);
    expect($cues[0])->toBe(['start' => 0.0, 'end' => 2.5, 'text' => 'Hello there.']);
    expect($cues[1])->toBe(['start' => 2.5, 'end' => 5.0, 'text' => 'Toast masters.']);
});

it('tolerates an optional cue identifier line before the timing line', function () {
    $vtt = <<<'VTT'
        WEBVTT

        1
        00:00:00.000 --> 00:00:01.000
        One.

        cue-2
        00:00:01.000 --> 00:00:02.000
        Two.
        VTT;

    $cues = Vtt::parse($vtt);

    expect($cues)->toHaveCount(2);
    expect($cues[0]['text'])->toBe('One.');
    expect($cues[1]['text'])->toBe('Two.');
});

it('parses hour-prefixed timestamps', function () {
    $vtt = <<<'VTT'
        WEBVTT

        01:00:00.000 --> 01:00:03.000
        An hour in.
        VTT;

    $cues = Vtt::parse($vtt);

    expect($cues[0]['start'])->toBe(3600.0);
    expect($cues[0]['end'])->toBe(3603.0);
});

it('joins multi-line cue text with a newline', function () {
    $vtt = <<<'VTT'
        WEBVTT

        00:00:00.000 --> 00:00:02.000
        Line one.
        Line two.
        VTT;

    $cues = Vtt::parse($vtt);

    expect($cues[0]['text'])->toBe("Line one.\nLine two.");
});

it('accepts a header-only VTT with zero cues', function () {
    $cues = Vtt::parse("WEBVTT\n");

    expect($cues)->toBe([]);
});

it('rejects a file that does not start with WEBVTT', function () {
    Vtt::parse("Hello\n\n00:00:00.000 --> 00:00:01.000\nText.");
})->throws(InvalidVttException::class);

it('rejects a cue block with no valid timing line', function () {
    $vtt = <<<'VTT'
        WEBVTT

        This is not a timing line
        Some text.
        VTT;

    Vtt::parse($vtt);
})->throws(InvalidVttException::class);

it('rejects a cue whose end time precedes its start time', function () {
    $vtt = <<<'VTT'
        WEBVTT

        00:00:05.000 --> 00:00:02.000
        Backwards.
        VTT;

    Vtt::parse($vtt);
})->throws(InvalidVttException::class);

it('round-trips render() back through parse()', function () {
    $cues = [
        ['start' => 0.0, 'end' => 1.5, 'text' => 'First.'],
        ['start' => 1.5, 'end' => 3.0, 'text' => 'Second.'],
    ];

    $reparsed = Vtt::parse(Vtt::render($cues));

    expect($reparsed)->toBe($cues);
});

/**
 * Post-STEP-10 code review: NOTE/STYLE/REGION blocks are standard WebVTT
 * and were being parsed as cues, so valid files were rejected with 422.
 */
it('skips NOTE comment blocks instead of rejecting the file', function () {
    $cues = Vtt::parse(<<<'VTT'
        WEBVTT

        NOTE This transcript was exported by Subtitle Edit.

        00:00:00.000 --> 00:00:02.000
        Hello.
        VTT);

    expect($cues)->toHaveCount(1);
    expect($cues[0]['text'])->toBe('Hello.');
});

it('skips a multi-line NOTE block appearing between cues', function () {
    $cues = Vtt::parse(<<<'VTT'
        WEBVTT

        00:00:00.000 --> 00:00:02.000
        First.

        NOTE
        A reviewer's aside,
        spanning two lines.

        00:00:02.000 --> 00:00:04.000
        Second.
        VTT);

    expect($cues)->toHaveCount(2);
    expect($cues[1]['text'])->toBe('Second.');
});

it('skips STYLE and REGION blocks', function () {
    $cues = Vtt::parse(<<<'VTT'
        WEBVTT

        STYLE
        ::cue { color: yellow; }

        REGION
        id:speaker

        00:00:00.000 --> 00:00:02.000
        Hello.
        VTT);

    expect($cues)->toHaveCount(1);
});

it('does not mistake cue text beginning with NOTE for a comment block', function () {
    $cues = Vtt::parse(<<<'VTT'
        WEBVTT

        00:00:00.000 --> 00:00:02.000
        NOTE the pause before the punchline.
        VTT);

    expect($cues)->toHaveCount(1);
    expect($cues[0]['text'])->toBe('NOTE the pause before the punchline.');
});
