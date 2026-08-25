<?php

namespace App\Services\Voice;

use App\Models\SpeechAsset;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

class WhisperVoiceNoteTranscriber implements VoiceNoteTranscriberContract
{
    public function transcribe(SpeechAsset $asset): string
    {
        $source = tempnam(sys_get_temp_dir(), 'voice_whisper_src_').'.m4a';
        $wav = tempnam(sys_get_temp_dir(), 'voice_whisper_wav_').'.wav';
        $base = tempnam(sys_get_temp_dir(), 'voice_whisper_out_');
        @unlink($base);
        $textPath = $base.'.txt';
        try {
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
        } finally {
            @unlink($source);
            @unlink($wav);
            @unlink($textPath);
            @unlink(substr($source, 0, -4));
            @unlink(substr($wav, 0, -4));
        }
    }
}
