<?php

namespace App\Console\Commands;

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\Captions\EnsureCaptionJob;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-VERIFICATION-PLAN.md §6.3 "Queued final-worker sign-off" — the
 * seeding half. Creates a fresh user/speech/ready source asset in REAL
 * storage/DB (whichever `media`/database connection this process is
 * configured against — see scripts/whisper-smoke-stack.sh's `queued`
 * command, which points both at its own disposable Postgres/SeaweedFS),
 * writes the committed spoken-audio fixture as that source asset's real
 * bytes, then dispatches a REAL `App\Jobs\GenerateCaptions` job through
 * `App\Services\Captions\EnsureCaptionJob::ensureForUpload` — the exact
 * same production code path `SpeechUploadController::complete` uses on a
 * real upload. This deliberately does NOT call `GenerateCaptions::dispatch()`
 * or the job's `handle()` directly: the plan requires "dispatch a real
 * `GenerateCaptions` job through Laravel, rather than calling its handler."
 *
 * Environment-gated behind `RUNS_WHISPER_SMOKE=1` (same convention as
 * `RealWhisperAdapterSmokeTest`) — a safety rail against this command ever
 * running by accident against a real dev/prod database. It always creates
 * its own rows (never mutates anything pre-existing), but there is no
 * reason it should be reachable outside a deliberate whisper-smoke run.
 *
 * Prints exactly one machine-readable line on success —
 * `captions_asset_id=<id>` — which scripts/whisper-smoke-stack.sh's
 * `queued` command greps out and hands to
 * `captions:whisper-smoke-verify` afterward.
 */
class WhisperSmokeSeedCommand extends Command
{
    protected $signature = 'captions:whisper-smoke-seed';

    protected $description = 'STEP-09 verification plan §6.3: seed a real source asset and dispatch a real GenerateCaptions job for the queued Whisper smoke.';

    public function handle(): int
    {
        if (! config('captions.runs_whisper_smoke')) {
            $this->error('captions:whisper-smoke-seed refuses to run unless RUNS_WHISPER_SMOKE=1 — it writes real rows/storage and must only be invoked from scripts/whisper-smoke-stack.sh against disposable infrastructure.');

            return self::FAILURE;
        }

        $fixturePath = base_path('tests/fixtures/whisper-smoke/spoken-fixture.m4a');

        if (! is_file($fixturePath)) {
            $this->error("Missing spoken-audio fixture: {$fixturePath}");

            return self::FAILURE;
        }

        $fixtureBytes = file_get_contents($fixturePath);

        if ($fixtureBytes === false) {
            $this->error("Could not read fixture: {$fixturePath}");

            return self::FAILURE;
        }

        $user = User::factory()->create();
        $speech = Speech::factory()->for($user)->create(['captions_enabled' => true]);

        $sourcePath = "speeches/whisper-smoke/{$speech->ulid}/source.m4a";
        $written = Storage::disk('media')->put($sourcePath, $fixtureBytes, ['ContentType' => 'audio/mp4']);

        if (! $written) {
            $this->error("Writing the spoken-audio fixture to the media disk at '{$sourcePath}' failed.");

            return self::FAILURE;
        }

        SpeechAsset::factory()->for($speech)->create([
            'kind' => 'source',
            'format' => 'mp4',
            'disk' => 'media',
            'path' => $sourcePath,
            'mime_type' => 'audio/mp4',
            'byte_size' => strlen($fixtureBytes),
            'status' => 'ready',
        ]);

        $asset = app(EnsureCaptionJob::class)->ensureForUpload($speech);

        if ($asset === null) {
            $this->error('EnsureCaptionJob::ensureForUpload returned null unexpectedly (captions_enabled was not true at seed time).');

            return self::FAILURE;
        }

        $this->line("captions_asset_id={$asset->id}");
        $this->line("speech_id={$speech->id}");

        return self::SUCCESS;
    }
}
