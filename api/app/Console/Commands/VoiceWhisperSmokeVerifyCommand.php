<?php

namespace App\Console\Commands;

use App\Models\Annotation;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

class VoiceWhisperSmokeVerifyCommand extends Command
{
    protected $signature = 'voice:whisper-smoke-verify {annotationId}';

    protected $description = 'Verify the real queued voice FFmpeg and Whisper worker result.';

    public function handle(): int
    {
        if (! config('captions.runs_whisper_smoke')) {
            $this->error('voice:whisper-smoke-verify refuses to run unless RUNS_WHISPER_SMOKE=1.');

            return self::FAILURE;
        }

        $annotation = Annotation::query()->with(['audioAsset', 'review'])->find((int) $this->argument('annotationId'));
        if ($annotation === null || $annotation->audioAsset === null) {
            $this->error('Voice annotation or its audio asset is missing.');

            return self::FAILURE;
        }

        $asset = $annotation->audioAsset;
        $failures = [];
        if ($asset->kind !== 'voice_note' || $asset->format !== 'm4a' || $asset->status !== 'ready') {
            $failures[] = "asset kind/format/status={$asset->kind}/{$asset->format}/{$asset->status}";
        }
        if ($asset->is_primary) {
            $failures[] = 'voice asset incorrectly became primary';
        }
        if ($asset->temporary_path !== null || $asset->temporary_byte_size !== null) {
            $failures[] = 'temporary object ledger was not cleared';
        }
        if (! Storage::disk($asset->disk)->exists($asset->path)) {
            $failures[] = "normalized audio object missing at {$asset->path}";
        } else {
            $scratchBase = tempnam(sys_get_temp_dir(), 'voice_queue_probe_');
            $scratch = $scratchBase === false ? null : $scratchBase.'.m4a';
            try {
                $bytes = Storage::disk($asset->disk)->get($asset->path);
                if ($scratch === null || $bytes === null || file_put_contents($scratch, $bytes) === false) {
                    $failures[] = 'could not download normalized audio for FFprobe verification';
                } else {
                    $probe = Process::timeout(30)->run([
                        'ffprobe', '-v', 'error', '-select_streams', 'a:0',
                        '-show_entries', 'format=format_name,duration:stream=codec_name,profile,channels,bit_rate',
                        '-of', 'json', $scratch,
                    ]);
                    $result = json_decode($probe->output(), true);
                    $stream = is_array($result) ? ($result['streams'][0] ?? []) : [];
                    $format = is_array($result) ? ($result['format'] ?? []) : [];
                    $formatNames = explode(',', (string) ($format['format_name'] ?? ''));
                    $bitRate = (int) ($stream['bit_rate'] ?? 0);
                    if (! $probe->successful()) {
                        $failures[] = 'FFprobe could not decode the normalized voice object';
                    }
                    if (array_intersect($formatNames, ['mov', 'mp4', 'm4a']) === []) {
                        $failures[] = 'normalized container is not in the M4A/MP4 family: '.implode(',', $formatNames);
                    }
                    if (($stream['codec_name'] ?? null) !== 'aac') {
                        $failures[] = 'normalized codec is not AAC';
                    }
                    if (! in_array(strtolower((string) ($stream['profile'] ?? '')), ['lc', 'aac lc'], true)) {
                        $failures[] = 'normalized AAC profile is not LC: '.($stream['profile'] ?? 'missing');
                    }
                    if ((int) ($stream['channels'] ?? 0) !== 1) {
                        $failures[] = 'normalized voice object is not mono';
                    }
                    if ($bitRate < 40_000 || $bitRate > 90_000) {
                        $failures[] = "normalized audio bitrate={$bitRate} is outside the tolerant 40-90 kbps range around 64 kbps";
                    }
                }
            } finally {
                if ($scratch !== null) {
                    @unlink($scratch);
                }
                if ($scratchBase !== false) {
                    @unlink($scratchBase);
                }
            }
        }
        if ($annotation->transcript_status !== 'ready' || trim($annotation->body) === '') {
            $failures[] = "annotation transcript status={$annotation->transcript_status} or body is empty";
        }
        if ((float) $annotation->duration_seconds <= 0 || (float) $annotation->duration_seconds > 90) {
            $failures[] = "annotation duration={$annotation->duration_seconds}";
        }
        $speechId = (int) $annotation->review?->speech_id;
        if (SpeechTranscript::query()->where('speech_id', $speechId)->exists()) {
            $failures[] = 'voice transcription incorrectly created a speech_transcripts row';
        }
        if (SpeechAsset::query()->where('speech_id', $speechId)->where('kind', 'captions')->exists()) {
            $failures[] = 'voice transcription incorrectly created a captions/VTT asset';
        }

        if ($failures !== []) {
            foreach ($failures as $failure) {
                $this->error(" - {$failure}");
            }

            return self::FAILURE;
        }

        $this->info('voice:whisper-smoke-verify PASSED: normalized private M4A and annotation transcript are ready; no speech transcript or VTT was created.');

        return self::SUCCESS;
    }
}
