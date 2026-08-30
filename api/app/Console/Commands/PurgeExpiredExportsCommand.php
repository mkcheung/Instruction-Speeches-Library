<?php

namespace App\Console\Commands;

use App\Models\DataExport;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-11-privacy-erasure.md's "Retention as a scheduled job" backend
 * bullet. §11.1's own retention-schedule mandate ("right of access and
 * portability... implemented as a lifecycle policy and a scheduled job,
 * not a paragraph") applies most concretely, today, to `data_exports`:
 * `GenerateDataExport` already stamps every ready export with a 7-day
 * `expires_at` (STEP-11-FROZEN-CONTRACT.md §7 — "exports are not kept
 * forever"), but nothing previously swept the expired rows.
 *
 * `--force-age` mirrors STEP-11.md's own stub note verbatim ("Retention
 * runs but nothing is old enough to be purged; a `--force-age` flag
 * proves the query") — it lowers the effective cutoff so the query can be
 * demonstrated/tested without waiting 7 real days, without changing
 * production's cadence. Storage-then-row deletion order matches every
 * other purge in this codebase (MediaReconcileCommand, PurgeVoiceAsset):
 * never remove the row while the bytes it points at might still exist.
 *
 * Scheduled nightly; see routes/console.php.
 */
class PurgeExpiredExportsCommand extends Command
{
    protected $signature = 'privacy:purge-expired-exports
        {--force-age= : treat exports older than this many seconds as expired, ignoring expires_at (proves the query without waiting for real expiry)}';

    protected $description = 'Delete the storage file and row for every data export past its retention window (§11.1).';

    public function handle(): int
    {
        $forceAgeSeconds = $this->option('force-age');

        $query = DataExport::query()->where('status', 'ready');

        $query = $forceAgeSeconds !== null
            ? $query->where('created_at', '<', now()->subSeconds((int) $forceAgeSeconds))
            : $query->whereNotNull('expires_at')->where('expires_at', '<', now());

        $expired = $query->get();

        $purged = 0;
        foreach ($expired as $export) {
            if ($export->path !== null
                && Storage::disk($export->disk)->exists($export->path)
                && ! Storage::disk($export->disk)->delete($export->path)) {
                $this->warn("Export {$export->id}: storage delete failed, leaving the row in place for the next run.");

                continue;
            }

            $export->delete();
            $purged++;
        }

        $this->info("Purged {$purged} expired export(s) of {$expired->count()} candidate(s).");

        return self::SUCCESS;
    }
}
