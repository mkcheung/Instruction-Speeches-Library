<?php

namespace App\Jobs;

use App\Models\ApplicationDocument;
use App\Services\Scanning\ClamScannerContract;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * STEP-12-FROZEN-CONTRACT.md §5: queued, not synchronous on upload —
 * mirrors `App\Jobs\GenerateCaptions`'s shape (`afterCommit`, "the
 * request creates the row, the job only updates it", never-throw-to-a-
 * visible-failed-state). Dispatched from the document-upload controller
 * action inside its own `DB::transaction()`, same reasoning as
 * `TranscodeSpeechAsset`/`GenerateCaptions`.
 *
 * `pending_scan -> clean`: row updated in place. `pending_scan ->
 * infected`: storage purged (never served, sandboxed or not) and the row
 * kept at `infected` for audit/quarantine visibility — never deleted
 * outright, so an admin can see an infected upload was attempted.
 */
class ScanApplicationDocument implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 120;

    public bool $failOnTimeout = true;

    public function __construct(public int $documentId)
    {
        $this->afterCommit = true;
    }

    public function handle(ClamScannerContract $scanner): void
    {
        $document = ApplicationDocument::query()->find($this->documentId);

        if ($document === null || $document->status !== 'pending_scan') {
            return;
        }

        if (! Storage::disk($document->disk)->exists($document->path)) {
            // Nothing to scan — leave it pending_scan rather than
            // guessing; a missing file at this point is an upload-flow
            // bug, not an infection verdict.
            Log::warning('ScanApplicationDocument: document path missing on disk.', ['document_id' => $document->id]);

            return;
        }

        $absolutePath = Storage::disk($document->disk)->path($document->path);
        $clean = $scanner->isClean($absolutePath);

        if ($clean) {
            $document->update(['status' => 'clean']);

            return;
        }

        // Infected: purge the bytes immediately, keep the row for
        // audit/quarantine visibility. Never re-exposed, sandboxed or
        // not, per STEP-12.md's "Watch for" section.
        Storage::disk($document->disk)->delete($document->path);
        $document->update(['status' => 'infected']);
    }

    public function failed(Throwable $e): void
    {
        Log::error('ScanApplicationDocument: job failed with an unhandled exception.', [
            'document_id' => $this->documentId,
            'exception' => $e->getMessage(),
        ]);
    }
}
