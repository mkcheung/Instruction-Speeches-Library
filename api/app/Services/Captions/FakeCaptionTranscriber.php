<?php

namespace App\Services\Captions;

use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use Illuminate\Support\Facades\Storage;

/**
 * Bound in testing (App\Providers\AppServiceProvider), mirroring
 * FakeTranscoder: stands in for real whisper.cpp so the upload/caption
 * pipeline is testable without a real binary or model weights present.
 * Writes a small, fixed, well-formed VTT — good enough to exercise the
 * asset/transcript wiring and TranscriptDeriver's real derivation logic
 * (this class does NOT hand-roll body/word_count/wpm itself — it goes
 * through the same Vtt::parse() + TranscriptDeriver::derive() path
 * WhisperTranscriber uses, so a test asserting "the transcript matches
 * the VTT" is asserting something real).
 */
class FakeCaptionTranscriber implements CaptionTranscriberContract
{
    private const FAKE_VTT = <<<'VTT'
        WEBVTT

        00:00:00.000 --> 00:00:02.000
        This is a fake transcript.

        00:00:02.000 --> 00:00:04.000
        Good enough for wiring tests.
        VTT;

    public function __construct(private readonly TranscriptDeriver $deriver = new TranscriptDeriver) {}

    public function transcribe(SpeechAsset $sourceAsset, SpeechAsset $captionsAsset): void
    {
        Storage::disk($captionsAsset->disk)->put($captionsAsset->path, self::FAKE_VTT);

        $captionsAsset->update([
            'status' => 'ready',
            'byte_size' => Storage::disk($captionsAsset->disk)->size($captionsAsset->path),
        ]);

        $cues = Vtt::parse(self::FAKE_VTT);
        $derived = $this->deriver->derive($cues);

        SpeechTranscript::query()->updateOrCreate(
            ['speech_id' => $captionsAsset->speech_id],
            [...$derived, 'language' => 'en', 'model' => 'fake', 'source' => 'whisper'],
        );
    }
}
