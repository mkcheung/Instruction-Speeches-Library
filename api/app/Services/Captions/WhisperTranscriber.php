<?php

namespace App\Services\Captions;

use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * The dev/prod binding (App\Providers\AppServiceProvider), mirroring
 * App\Services\Transcoding\FfmpegTranscoder's shape exactly: shells out to
 * a real binary via `Process::timeout()->run([...])`, never throws (writes
 * a `failed` status with a user-safe `failure_code` instead — a thrown
 * exception here would be a job retry, not a visible Failed state), and
 * never touches anything outside the one asset row + transcript row it
 * owns.
 *
 * whisper.cpp (not faster-whisper — see the frozen STEP-09 contract §6 for
 * why) wants a 16kHz mono WAV, not the arbitrary source container this
 * product accepts, so this class extracts audio with ffmpeg first (the
 * "extracted-audio sibling asset" STEP-09.md/the task brief describe) —
 * a local scratch file, never persisted as its own speech_assets row: only
 * the resulting VTT is durable.
 *
 * NOT exercised against a real whisper.cpp binary or real model weights in
 * this environment (no `whisper-cli` binary and no GGUF model file are
 * present in this sandbox) — see this class's own tests, which fake
 * Process the same way FfmpegTranscoderTest fakes ffmpeg/ffprobe, and the
 * final report's explicit "unverified by running" caveat.
 */
class WhisperTranscriber implements CaptionTranscriberContract
{
    public function __construct(private readonly TranscriptDeriver $deriver = new TranscriptDeriver) {}

    public function transcribe(SpeechAsset $sourceAsset, SpeechAsset $captionsAsset): void
    {
        $localSource = tempnam(sys_get_temp_dir(), 'whisper_src_');
        $localAudio = tempnam(sys_get_temp_dir(), 'whisper_audio_').'.wav';
        $outputBase = tempnam(sys_get_temp_dir(), 'whisper_out_');
        @unlink($outputBase); // whisper.cpp writes {$outputBase}.vtt itself
        $outputVtt = $outputBase.'.vtt';

        try {
            file_put_contents($localSource, Storage::disk($sourceAsset->disk)->get($sourceAsset->path));

            // 16kHz mono PCM WAV: whisper.cpp's documented required input
            // format for its CLI (no on-the-fly resampling inside the
            // binary itself).
            $extract = Process::timeout(300)->run([
                'ffmpeg', '-nostdin', '-y',
                '-i', $localSource,
                '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
                $localAudio,
            ]);

            if (! $extract->successful()) {
                $this->fail($captionsAsset, 'audio_extraction_failed', 'We had trouble reading the audio from this speech.');

                return;
            }

            $whisper = Process::timeout((int) config('captions.timeout_seconds'))->run([
                (string) config('captions.whisper_binary'),
                '-m', (string) config('captions.model_path'),
                '-l', (string) config('captions.language'),
                '-f', $localAudio,
                '-ovtt',
                '-of', $outputBase,
            ]);

            if (! $whisper->successful() || ! file_exists($outputVtt)) {
                $this->fail($captionsAsset, 'transcription_failed', 'We had trouble captioning this speech. Please try again.');

                return;
            }

            $vttContent = file_get_contents($outputVtt);

            if ($vttContent === false) {
                $this->fail($captionsAsset, 'transcription_failed', 'We had trouble captioning this speech. Please try again.');

                return;
            }

            $cues = Vtt::parse($vttContent);

            Storage::disk($captionsAsset->disk)->put($captionsAsset->path, $vttContent);

            $captionsAsset->update([
                'status' => 'ready',
                'byte_size' => Storage::disk($captionsAsset->disk)->size($captionsAsset->path),
            ]);

            $derived = $this->deriver->derive($cues);

            SpeechTranscript::query()->updateOrCreate(
                ['speech_id' => $captionsAsset->speech_id],
                [
                    ...$derived,
                    'language' => (string) config('captions.language'),
                    'model' => (string) config('captions.model_name'),
                    'source' => 'whisper',
                ],
            );
        } catch (InvalidVttException $e) {
            // whisper.cpp produced output this product's own VTT reader
            // can't parse — treat identically to any other transcription
            // failure rather than persisting an asset row nothing else can
            // safely read.
            Log::warning('WhisperTranscriber: whisper.cpp produced unparseable VTT.', [
                'caption_asset_id' => $captionsAsset->id,
                'exception' => $e->getMessage(),
            ]);
            $this->fail($captionsAsset, 'transcription_failed', 'We had trouble captioning this speech. Please try again.');
        } finally {
            @unlink($localSource);
            @unlink($localAudio);
            @unlink($outputVtt);
        }
    }

    private function fail(SpeechAsset $captionsAsset, string $code, string $detail): void
    {
        $captionsAsset->update([
            'status' => 'failed',
            'failure_code' => $code,
            'failure_detail' => $detail,
        ]);
    }
}
