<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Services\Voice\FfmpegVoiceNoteProcessor;
use App\Services\Voice\WhisperVoiceNoteTranscriber;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

it('normalizes and transcribes a real voice-note fixture through ffmpeg and whisper cpp', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    $fixture = __DIR__.'/../../fixtures/whisper-smoke/spoken-fixture.m4a';
    $bytes = (string) file_get_contents($fixture);
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $coach = User::factory()->create();
    User::query()->whereKey($coach->id)->update(['storage_bytes_used' => strlen($bytes)]);
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id, 'status' => 'in_progress']);
    $temporary = 'voice-smoke/'.Str::uuid().'/source';
    Storage::disk('media')->put($temporary, $bytes);
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'processing', 'path' => 'voice-smoke/final.m4a', 'temporary_path' => $temporary, 'temporary_byte_size' => strlen($bytes), 'byte_size' => strlen($bytes)]);
    Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => '', 'transcript_status' => 'pending', 'transcript_attempt_id' => (string) Str::uuid()]);

    $processed = (new FfmpegVoiceNoteProcessor(app(QuotaService::class)))->process($asset, $temporary);
    expect($processed)->toBeTrue();
    $asset->refresh();
    expect($asset->status)->toBe('ready')->and((float) $asset->duration_seconds)->toBeGreaterThan(0)->toBeLessThanOrEqual(90);
    $local = tempnam(sys_get_temp_dir(), 'voice_smoke_').'.m4a';
    file_put_contents($local, Storage::disk('media')->get($asset->path));
    $probe = Process::run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels,profile', '-of', 'json', $local]);
    @unlink($local);
    @unlink(substr($local, 0, -4));
    $stream = json_decode($probe->output(), true)['streams'][0] ?? [];
    expect($probe->successful())->toBeTrue()->and($stream['codec_name'] ?? null)->toBe('aac')->and($stream['channels'] ?? null)->toBe(1);
    $body = (new WhisperVoiceNoteTranscriber)->transcribe($asset);
    expect(trim($body))->not->toBe('');
})->skip(fn () => ! config('captions.runs_whisper_smoke'), 'Run inside the whisper-smoke container with RUNS_WHISPER_SMOKE=1.');
