<?php

namespace App\Console\Commands;

use App\Models\SpeechAsset;
use App\Services\QuotaService;
use Illuminate\Console\Command;

/**
 * §9.1's fourth release path, and per the plan "the highest-value ops job
 * in the system": a client that vanished mid-upload (closed tab, dead
 * phone) leaves a `speech_assets` row stuck in `uploading` forever. Without
 * this sweep, `uploads_in_flight` never comes back down, and a user with a
 * cap of two abandoned uploads can never upload again (STEP-03 acceptance).
 *
 * Releases the counter, not just the row — that distinction is the entire
 * point (§9.1's release-paths table).
 *
 * Scheduled nightly; see routes/console.php.
 */
class MediaReconcileCommand extends Command
{
    protected $signature = 'media:reconcile
        {--upload-hours=2 : age threshold for a stuck upload}
        {--transcode-hours=2 : age threshold for a hung transcode, per §9.2}';

    protected $description = 'Release quota held by abandoned uploads, and surface hung transcodes (§9.1, §9.2).';

    public function handle(QuotaService $quota): int
    {
        $staleUploads = SpeechAsset::query()
            ->where('status', 'uploading')
            ->where('created_at', '<', now()->subHours((int) $this->option('upload-hours')))
            ->get();

        foreach ($staleUploads as $asset) {
            $quota->releaseOnReconcile($asset);
            $asset->update([
                'status' => 'failed',
                'failure_code' => 'upload_abandoned',
                'failure_detail' => 'No completion within the reconcile window; quota released.',
            ]);
        }

        // §9.2: "sweeps ... rows stuck in processing beyond two hours" — a
        // transcode that crashed or lost its job (e.g. a worker restart)
        // without ever reaching ready/failed. Quota is already correct for
        // these (releaseOnComplete already ran when the SOURCE finished
        // uploading); this only gives the speaker a visible Failed+Retry
        // instead of a silent, permanent "processing".
        $hungTranscodes = SpeechAsset::query()
            ->where('status', 'processing')
            ->where('created_at', '<', now()->subHours((int) $this->option('transcode-hours')))
            ->get();

        foreach ($hungTranscodes as $asset) {
            $asset->update([
                'status' => 'failed',
                'failure_code' => 'transcode_timed_out',
                'failure_detail' => 'No transcode result within the reconcile window.',
            ]);
        }

        $this->info("Reconciled {$staleUploads->count()} abandoned upload(s) and {$hungTranscodes->count()} hung transcode(s).");

        return self::SUCCESS;
    }
}
