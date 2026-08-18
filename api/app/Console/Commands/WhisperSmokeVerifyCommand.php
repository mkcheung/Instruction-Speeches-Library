<?php

namespace App\Console\Commands;

use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-VERIFICATION-PLAN.md §6.3 "Queued final-worker sign-off" — the
 * assertion half, run AFTER `scripts/whisper-smoke-stack.sh queued` has
 * already run `queue:work redis-long --queue=captions --once` against the
 * actual `whisper-worker` image (never this container) so the job has
 * genuinely left the queue by the time this command runs — there is
 * deliberately no polling loop here.
 *
 * Checks, all against real Postgres/SeaweedFS: the job left the queue
 * (implied — this command wouldn't be invoked by the harness otherwise),
 * caption asset is `ready`, canonical VTT exists in storage, exactly one
 * `speech_transcripts` row exists for the seeded speech, body/segments are
 * non-empty, `source=whisper`, and language/model match
 * `docker/whisper/model.lock`.
 *
 * Environment-gated identically to `captions:whisper-smoke-seed`.
 */
class WhisperSmokeVerifyCommand extends Command
{
    protected $signature = 'captions:whisper-smoke-verify {captionsAssetId : speech_assets.id printed by captions:whisper-smoke-seed}';

    protected $description = 'STEP-09 verification plan §6.3: assert a queued GenerateCaptions job, run by the real whisper-worker image, produced a ready caption asset and transcript row.';

    public function handle(): int
    {
        if (! config('captions.runs_whisper_smoke')) {
            $this->error('captions:whisper-smoke-verify refuses to run unless RUNS_WHISPER_SMOKE=1.');

            return self::FAILURE;
        }

        $assetId = (int) $this->argument('captionsAssetId');
        $asset = SpeechAsset::query()->find($assetId);

        if ($asset === null) {
            $this->error("No speech_assets row with id={$assetId}.");

            return self::FAILURE;
        }

        $failures = [];

        if ($asset->status !== 'ready') {
            $failures[] = "caption asset status={$asset->status} (expected ready; failure_code=".($asset->failure_code ?? 'null').', failure_detail='.($asset->failure_detail ?? 'null').')';
        }

        $vtt = Storage::disk($asset->disk)->get($asset->path);

        if ($vtt === null || trim($vtt) === '') {
            $failures[] = "canonical VTT missing or empty at disk={$asset->disk} path={$asset->path}";
        }

        $transcripts = SpeechTranscript::query()->where('speech_id', $asset->speech_id)->get();

        if ($transcripts->count() !== 1) {
            $failures[] = "expected exactly 1 speech_transcripts row for speech_id={$asset->speech_id}, found {$transcripts->count()}";
        } else {
            /** @var SpeechTranscript $transcript */
            $transcript = $transcripts->first();

            if (trim($transcript->body) === '') {
                $failures[] = 'transcript body is empty';
            }

            if ($transcript->segments === []) {
                $failures[] = 'transcript segments are empty';
            }

            if ($transcript->source !== 'whisper') {
                $failures[] = "transcript source={$transcript->source} (expected whisper)";
            }

            if ($transcript->language !== (string) config('captions.language')) {
                $failures[] = "transcript language={$transcript->language} (expected ".config('captions.language').')';
            }

            $lockPath = (string) config('captions.model_lock_path');

            if (! is_file($lockPath)) {
                $failures[] = "model.lock not found at {$lockPath} — cannot verify model id";
            } else {
                $lock = json_decode((string) file_get_contents($lockPath), true);
                $expectedModelId = (string) ($lock['model_id'] ?? '');

                if ($transcript->model !== $expectedModelId) {
                    $failures[] = "transcript model={$transcript->model} (expected {$expectedModelId} from model.lock)";
                }

                if ((string) config('captions.model_name') !== $expectedModelId) {
                    $failures[] = "config('captions.model_name')=".config('captions.model_name')." does not match model.lock's model_id={$expectedModelId} — WHISPER_MODEL_NAME was not set correctly for this run";
                }
            }
        }

        // NOTE: STEP-09-VERIFICATION-PLAN.md §6.3 item 5 also calls for
        // "caption/transcript revisions agree". Those columns
        // (content_revision/caption_revision, §4.1) do not exist on this
        // branch yet, so no such assertion is made here — see the matching
        // note in RealWhisperAdapterSmokeTest.php.
        if ($failures !== []) {
            $this->error('captions:whisper-smoke-verify FAILED:');

            foreach ($failures as $failure) {
                $this->error(" - {$failure}");
            }

            return self::FAILURE;
        }

        $this->info('captions:whisper-smoke-verify PASSED: caption asset ready, canonical VTT present, exactly one transcript row, source=whisper, language/model match model.lock.');

        return self::SUCCESS;
    }
}
