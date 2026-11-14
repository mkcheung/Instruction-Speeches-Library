<?php

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;
use App\Models\SpeechAsset;

it('lists every speech asset status the schema allows, in CHECK order', function () {
    expect(SpeechAssetStatus::values())->toBe(['uploading', 'processing', 'ready', 'failed']);
});

it('treats an asset as ready only when its status is ready', function (string $status, bool $ready) {
    expect((new SpeechAsset(['status' => $status]))->isReady())->toBe($ready);
})->with([
    'uploading' => ['uploading', false],
    'processing' => ['processing', false],
    'ready' => ['ready', true],
    'failed' => ['failed', false],
]);

it('lists every transcript status the schema allows, in CHECK order', function () {
    expect(TranscriptStatus::values())->toBe(['not_applicable', 'pending', 'processing', 'ready', 'failed']);
});

it('counts only pending and processing transcripts as in flight', function () {
    expect(TranscriptStatus::inFlight())->toBe(['pending', 'processing']);
});
