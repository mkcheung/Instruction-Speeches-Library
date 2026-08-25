<?php

use App\Jobs\NormalizeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Services\Voice\FfmpegVoiceNoteProcessor;
use Database\Seeders\RoleSeeder;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\Process\Exception\ProcessTimedOutException as SymfonyProcessTimedOutException;
use Symfony\Component\Process\Process as SymfonyProcess;

function ffmpegVoiceFixture(int $bytes = 24): array
{
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $coach = User::factory()->create(['storage_bytes_used' => $bytes]);
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'speech_owner_id' => $speaker->id,
        'reviewer_id' => $coach->id,
        'status' => 'in_progress',
    ]);
    $temporary = 'voice-process-test/'.Str::uuid().'/source';
    Storage::disk('media')->put($temporary, str_repeat('a', $bytes));
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create([
        'status' => 'processing',
        'byte_size' => $bytes,
        'temporary_path' => $temporary,
        'temporary_byte_size' => $bytes,
    ]);
    $annotation = Annotation::factory()->for($review)->create([
        'audio_asset_id' => $asset->id,
        'body' => '',
        'duration_seconds' => 0.001,
        'transcript_status' => 'pending',
        'transcript_attempt_id' => (string) Str::uuid(),
    ]);

    return [$coach, $asset, $annotation, $temporary];
}

function loudnormMeasurement(): string
{
    return json_encode([
        'input_i' => '-22.10',
        'input_tp' => '-3.20',
        'input_lra' => '1.40',
        'input_thresh' => '-32.20',
        'target_offset' => '0.10',
    ], JSON_THROW_ON_ERROR);
}

it('runs bounded two-pass loudnorm and writes mono AAC-LC at 64 kbps', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset, $annotation, $temporary] = ffmpegVoiceFixture();

    Process::fake(function (PendingProcess $process) {
        $command = $process->command;
        if (! is_array($command)) {
            return Process::result(exitCode: 1);
        }
        if ($command[0] === 'ffmpeg' && in_array('null', $command, true)) {
            return Process::result(errorOutput: 'diagnostic'.PHP_EOL.loudnormMeasurement());
        }
        if ($command[0] === 'ffmpeg') {
            file_put_contents((string) end($command), 'normalized-aac');

            return Process::result();
        }

        return Process::result(output: '8.250');
    });

    expect((new FfmpegVoiceNoteProcessor(app(QuotaService::class)))->process($asset, $temporary))->toBeTrue();
    $asset->refresh();
    expect($asset->status)->toBe('ready')
        ->and($asset->format)->toBe('m4a')
        ->and($asset->is_primary)->toBeFalse()
        ->and((float) $asset->duration_seconds)->toBe(8.25)
        ->and($annotation->fresh()->duration_seconds)->toBe('8.250')
        ->and($coach->fresh()->storage_bytes_used)->toBe(strlen('normalized-aac'));
    Storage::disk('media')->assertMissing($temporary)->assertExists($asset->path);

    Process::assertRan(function (PendingProcess $process): bool {
        $command = $process->command;

        return is_array($command) && $process->timeout === 110 && $command[0] === 'ffmpeg'
            && in_array('loudnorm=I=-16:TP=-1.5:LRA=11:dual_mono=true:print_format=json', $command, true)
            && in_array('null', $command, true);
    });
    Process::assertRan(function (PendingProcess $process): bool {
        $command = $process->command;
        $joined = is_array($command) ? implode(' ', $command) : '';

        return $process->timeout === 110
            && str_contains($joined, '-map 0:a:0 -vn')
            && str_contains($joined, 'dual_mono=true:measured_I=-22.10')
            && str_contains($joined, '-ac 1 -c:a aac -profile:a aac_low -b:a 64k -movflags +faststart');
    });
    Process::assertRan(fn (PendingProcess $process): bool => is_array($process->command) && $process->timeout === 30 && $process->command[0] === 'ffprobe');
});

it('maps malformed loudnorm output to a safe invalid-audio failure and cleans the reservation', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset, $annotation, $temporary] = ffmpegVoiceFixture();
    Process::fake(fn () => Process::result(errorOutput: 'SECRET stderr and /private/source path'));

    expect((new FfmpegVoiceNoteProcessor(app(QuotaService::class)))->process($asset, $temporary))->toBeFalse();
    $asset->refresh();
    expect($asset->status)->toBe('failed')
        ->and($asset->failure_code)->toBe('voice_invalid_audio')
        ->and($asset->failure_detail)->not->toContain('SECRET')->not->toContain('/private/source')
        ->and($asset->temporary_path)->toBeNull()
        ->and($asset->temporary_byte_size)->toBeNull()
        ->and($annotation->fresh()->transcript_status)->toBe('failed')
        ->and($coach->fresh()->storage_bytes_used)->toBe(0);
    Storage::disk('media')->assertMissing($temporary);
});

it('uses the queued failed backstop after an FFmpeg timeout without leaking quota or temp bytes', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset, $annotation, $temporary] = ffmpegVoiceFixture();
    Process::fake(function () {
        $symfony = new SymfonyProcess(['ffmpeg']);
        $symfony->setTimeout(110);
        throw new ProcessTimedOutException(
            new SymfonyProcessTimedOutException($symfony, SymfonyProcessTimedOutException::TYPE_GENERAL),
            Process::result(errorOutput: 'private timeout diagnostics'),
        );
    });
    $job = new NormalizeVoiceNote($asset->id, $temporary);

    try {
        $job->handle(new FfmpegVoiceNoteProcessor(app(QuotaService::class)));
        $this->fail('Expected the fake FFmpeg process to time out.');
    } catch (ProcessTimedOutException $exception) {
        $job->failed($exception);
    }

    $asset->refresh();
    expect($asset->status)->toBe('failed')
        ->and($asset->failure_code)->toBe('voice_normalization_failed')
        ->and($asset->failure_detail)->not->toContain('private timeout diagnostics')
        ->and($asset->temporary_path)->toBeNull()
        ->and($asset->temporary_byte_size)->toBeNull()
        ->and($annotation->fresh()->transcript_status)->toBe('failed')
        ->and($coach->fresh()->storage_bytes_used)->toBe(0);
    Storage::disk('media')->assertMissing($temporary);
});
