<?php

namespace App\Services\Voice;

use App\Models\SpeechAsset;
use App\Support\ScratchFileAllocationException;
use App\Support\ScratchFiles;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

class WhisperVoiceNoteTranscriber implements VoiceNoteTranscriberContract
{
    public function transcribe(SpeechAsset $asset): string
    {
        $scratch = app(ScratchFiles::class);
        try {
            $source = $scratch->create('voice_whisper_src_', '.m4a');
            $wav = $scratch->create('voice_whisper_wav_', '.wav');
            $textPath = $scratch->create('voice_whisper_out_', '.txt');
            $base = substr($textPath, 0, -4);
            $bytes = Storage::disk($asset->disk)->get($asset->path);
            if ($bytes === null || file_put_contents($source, $bytes) === false) {
                throw new VoiceTranscriptionException('voice_transcription_storage_failed');
            }
            $extract = Process::timeout(180)->run(['ffmpeg', '-nostdin', '-y', '-i', $source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', $wav]);
            if (! $extract->successful()) {
                throw new VoiceTranscriptionException('voice_transcription_failed');
            }
            $run = Process::timeout(min(1400, (int) config('captions.timeout_seconds')))->run([
                (string) config('captions.whisper_binary'), '-m', (string) config('captions.model_path'),
                '-l', (string) config('captions.language'), '-f', $wav, '-otxt', '-of', $base,
            ]);
            $body = is_file($textPath) ? trim((string) file_get_contents($textPath)) : '';
            if (! $run->successful() || $body === '') {
                throw new VoiceTranscriptionException('voice_transcription_failed');
            }

            return $body;
        } catch (ScratchFileAllocationException $e) {
            throw new VoiceTranscriptionException('voice_transcription_storage_failed');
        } finally {
            $scratch->cleanup();
        }
    }
}
