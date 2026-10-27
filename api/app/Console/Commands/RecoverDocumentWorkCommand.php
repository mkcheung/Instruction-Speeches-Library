<?php

namespace App\Console\Commands;

use App\Services\ApplicationDocumentWork;
use Illuminate\Console\Command;

/**
 * `coach:recover-document-work` — PLAN-CODE-REVIEW-FOLLOW-UP.md §8.3 (R6).
 * Queues (never scans/deletes directly) at most 100 eligible documents per
 * run through the same rechecking, row-throttled helper the controllers use.
 * `--document-id=N --retry-exhausted` resets one exhausted phase; bulk reset
 * is refused.
 */
class RecoverDocumentWorkCommand extends Command
{
    private const BATCH = 100;

    protected $signature = 'coach:recover-document-work
        {--document-id= : queue only this document}
        {--retry-exhausted : with --document-id, reset an exhausted phase (never active leases) before queueing}';

    protected $description = 'Re-queue pending certification-document scans and infected-document cleanups that lost their wakeup.';

    public function handle(ApplicationDocumentWork $work): int
    {
        $documentId = $this->option('document-id');

        if ($documentId === null || $documentId === '') {
            if ($this->option('retry-exhausted')) {
                $this->error('--retry-exhausted requires --document-id; bulk resets are refused.');

                return self::FAILURE;
            }

            $queued = 0;
            foreach ($work->recoverableIds(self::BATCH) as $id) {
                $queued += $work->ensureQueued($id) ? 1 : 0;
            }
            $this->info("Queued document work for {$queued} document(s).");

            return self::SUCCESS;
        }

        if (! ctype_digit((string) $documentId)) {
            $this->error('--document-id must be a positive integer.');

            return self::FAILURE;
        }

        $id = (int) $documentId;

        if ($this->option('retry-exhausted') && ($reason = $work->resetExhausted($id)) !== null) {
            $this->error($reason);

            return self::FAILURE;
        }

        $this->info($work->ensureQueued($id)
            ? "Queued document work for document {$id}."
            : "Document {$id} was not queued (ineligible or woken within the last five minutes).");

        return self::SUCCESS;
    }
}
