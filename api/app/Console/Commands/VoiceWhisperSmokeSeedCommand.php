<?php

namespace App\Console\Commands;

use App\Jobs\NormalizeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class VoiceWhisperSmokeSeedCommand extends Command
{
    protected $signature = 'voice:whisper-smoke-seed';

    protected $description = 'Seed and dispatch a real queued voice normalization/transcription smoke.';

    public function handle(): int
    {
        if (! config('captions.runs_whisper_smoke')) {
            $this->error('voice:whisper-smoke-seed refuses to run unless RUNS_WHISPER_SMOKE=1.');

            return self::FAILURE;
        }

        $fixturePath = base_path('tests/fixtures/whisper-smoke/spoken-fixture.m4a');
        $fixtureBytes = is_file($fixturePath) ? file_get_contents($fixturePath) : false;
        if ($fixtureBytes === false) {
            $this->error("Could not read voice fixture: {$fixturePath}");

            return self::FAILURE;
        }

        app(RoleSeeder::class)->run();
        $temporaryPath = 'voice-smoke/'.Str::uuid().'/source.m4a';
        if (! Storage::disk('media')->put($temporaryPath, $fixtureBytes, ['ContentType' => 'audio/mp4'])) {
            $this->error("Could not write voice fixture to {$temporaryPath}.");

            return self::FAILURE;
        }

        try {
            [$assetId, $annotationId, $speechId] = DB::transaction(function () use ($temporaryPath, $fixtureBytes): array {
                $speaker = User::factory()->create();
                $speaker->assignRole('member');
                $coach = User::factory()->create(['storage_bytes_used' => strlen($fixtureBytes)]);
                $coach->assignRole('coach');
                $speech = Speech::factory()->for($speaker)->create();
                $review = Review::factory()->accepted()->create([
                    'speech_id' => $speech->id,
                    'speech_owner_id' => $speaker->id,
                    'reviewer_id' => $coach->id,
                    'status' => 'in_progress',
                ]);
                $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create([
                    'status' => 'processing',
                    'path' => "speeches/{$speech->ulid}/voice/".Str::uuid().'.m4a',
                    'disk' => 'media',
                    'mime_type' => 'audio/mp4',
                    'byte_size' => strlen($fixtureBytes),
                    'temporary_path' => $temporaryPath,
                    'temporary_byte_size' => strlen($fixtureBytes),
                ]);
                $annotation = Annotation::factory()->for($review)->create([
                    'audio_asset_id' => $asset->id,
                    'body' => '',
                    'transcript_status' => 'pending',
                    'transcript_attempt_id' => (string) Str::uuid(),
                    'duration_seconds' => 0.001,
                ]);

                NormalizeVoiceNote::dispatch($asset->id, $temporaryPath);

                return [$asset->id, $annotation->id, $speech->id];
            });
        } catch (\Throwable $exception) {
            Storage::disk('media')->delete($temporaryPath);
            throw $exception;
        }

        $this->line("voice_asset_id={$assetId}");
        $this->line("annotation_id={$annotationId}");
        $this->line("speech_id={$speechId}");

        return self::SUCCESS;
    }
}
