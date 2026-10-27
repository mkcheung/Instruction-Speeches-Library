<?php

namespace App\Jobs;

use App\Services\ApplicationDocumentWork;
use App\Services\Scanning\ClamScannerContract;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * STEP-12-FROZEN-CONTRACT.md §5 + PLAN-CODE-REVIEW-FOLLOW-UP.md §8.3 (R6).
 *
 * A thin delivery wrapper: the payload is the document ID only, and all
 * claim/scan/cleanup/retry state lives on the row, owned by
 * `App\Services\ApplicationDocumentWork`. Enqueue through
 * `ApplicationDocumentWork::ensureQueued()`, not `dispatch()` directly.
 *
 * Budget: 60s hard process timeout (fails on timeout), broker tries = 1 —
 * durable `work_*` metadata owns retries, not competing broker redeliveries.
 * The 75s work lease sits inside the default Redis `retry_after` of 90s.
 */
class ScanApplicationDocument implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 60;

    public int $tries = 1;

    public bool $failOnTimeout = true;

    public function __construct(public int $documentId)
    {
        $this->afterCommit = true;
    }

    public function handle(ClamScannerContract $scanner, ApplicationDocumentWork $work): void
    {
        $work->process($this->documentId, $scanner);
    }

    public function failed(Throwable $e): void
    {
        Log::error('ScanApplicationDocument: job failed with an unhandled exception.', [
            'document_id' => $this->documentId,
            'exception' => $e->getMessage(),
        ]);
    }
}
