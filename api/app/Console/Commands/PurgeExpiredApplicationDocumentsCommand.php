<?php

namespace App\Console\Commands;

use App\Models\ApplicationDocument;
use App\Models\CoachApplication;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * `coach:purge-expired-documents` — STEP-12-FROZEN-CONTRACT.md §5 / STEP-
 * 12.md "Retention": certification documents are third-party personal
 * data, purged 90 days after the decision (`coach_applications.
 * decided_at`), keeping only the decision record and document hashes
 * (`application_documents.sha256` survives; only storage + the row's
 * file-identifying columns are removed — the row itself, and its
 * `sha256`, stay so the decision's audit trail remains provable).
 *
 * Exact shape of `App\Console\Commands\PurgeExpiredExportsCommand`
 * (STEP-12-FROZEN-CONTRACT.md §10's named template): storage-delete-
 * before-row-mutation order, `--force-age` flag to prove the query
 * without waiting 90 real days.
 */
class PurgeExpiredApplicationDocumentsCommand extends Command
{
    protected $signature = 'coach:purge-expired-documents
        {--force-age= : treat applications decided more than this many seconds ago as expired, ignoring documents_purge_after (proves the query without waiting for real expiry)}';

    protected $description = 'Purge certification-document storage and rows 90 days after a coach application decision (§6.8/§20 Q18).';

    public function handle(): int
    {
        $forceAgeSeconds = $this->option('force-age');

        $query = CoachApplication::query()->whereNotNull('decided_at');

        $query = $forceAgeSeconds !== null
            ? $query->where('decided_at', '<', now()->subSeconds((int) $forceAgeSeconds))
            : $query->whereNotNull('documents_purge_after')->where('documents_purge_after', '<', now()->toDateString());

        $applicationIds = $query->pluck('id');

        $documents = ApplicationDocument::query()
            ->whereIn('application_id', $applicationIds)
            ->whereIn('status', ['clean', 'pending_scan'])
            ->get();

        $purged = 0;
        foreach ($documents as $document) {
            if ($document->path !== ''
                && Storage::disk($document->disk)->exists($document->path)
                && ! Storage::disk($document->disk)->delete($document->path)) {
                $this->warn("Document {$document->id}: storage delete failed, leaving the row in place for the next run.");

                continue;
            }

            // Row kept (never deleted) — only the storage bytes and the
            // filename are cleared; `sha256`/`status`/timestamps remain
            // as the permanent decision audit trail STEP-12.md's
            // Retention section requires ("keeping only the decision
            // record and hashes"). `path` is set to an empty string
            // (NOT NULL column) rather than left pointing at bytes that
            // no longer exist.
            $document->update(['path' => '', 'original_filename' => '[purged]']);
            $purged++;
        }

        $this->info("Purged storage for {$purged} of {$documents->count()} candidate document(s) across {$applicationIds->count()} decided application(s).");

        return self::SUCCESS;
    }
}
