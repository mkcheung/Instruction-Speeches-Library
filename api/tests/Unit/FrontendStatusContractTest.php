<?php

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;

/*
 * PLAN-DRY-FRONTEND-FOLLOWUPS.md F1. The web client mirrors these enums as
 * `export const NAME = [...] as const` lists. Each list plus its exclusions must
 * equal the enum, so a new case fails here until the frontend lists or excludes it.
 *
 * It reads web/ beside api/, which holds on a host checkout and in CI's `test` job.
 * The app image has no Pest (--no-dev); whisper-smoke runs one filtered test.
 * The skip covers an unfiltered run in an image that bakes only api/.
 */
function frontendStatusList(string $file, string $name): array
{
    $source = (string) file_get_contents(dirname(base_path()).'/web/src/'.$file);
    $count = preg_match_all('/^export const '.$name.' = \[([^\]]*)\] as const$/m', $source, $match);
    expect($count)->toBe(1, "web/src/{$file} must declare `export const {$name} = [...] as const` exactly once");
    preg_match_all("/'([a-z_]+)'/", $match[1][0], $values);

    return $values[1];
}

/** @param list<string> $list @param list<string> $enumValues @param list<string> $excluded */
function expectFrontendMirror(array $list, array $enumValues, array $excluded = []): void
{
    expect(array_values(array_intersect($list, $excluded)))->toBe([])
        ->and([...$list, ...$excluded])->toEqualCanonicalizing($enumValues);
}

$webMissing = fn (): bool => ! is_dir(dirname(base_path()).'/web/src');
$why = 'web/ is not beside api/ (an image that bakes only api/)';

it('lists every SpeechAssetStatus for speech assets', function () {
    expectFrontendMirror(frontendStatusList('features/speech/types.ts', 'SPEECH_ASSET_STATUSES'), SpeechAssetStatus::values());
})->skip($webMissing, $why);

it('lists SpeechAssetStatus minus uploading for voice audio', function () {
    // A voice asset is created `processing` (VoiceNoteService); only video uploads use `uploading`.
    expectFrontendMirror(frontendStatusList('features/annotation/types.ts', 'VOICE_AUDIO_STATUSES'), SpeechAssetStatus::values(), ['uploading']);
})->skip($webMissing, $why);

it('lists TranscriptStatus minus not_applicable for voice transcripts', function () {
    // `voice` is null without an audio asset (AnnotationResource), and `not_applicable` is only ever
    // written with `audio_asset_id => null` (purge, erasure) or as the written-note default.
    expectFrontendMirror(frontendStatusList('features/annotation/types.ts', 'VOICE_TRANSCRIPT_STATUSES'), TranscriptStatus::values(), ['not_applicable']);
})->skip($webMissing, $why);
