<?php

namespace App\Services;

use App\Jobs\ScanApplicationDocument;
use App\Models\ApplicationDocument;
use App\Services\Scanning\ClamScannerContract;
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * Durable document-work protocol (PLAN-CODE-REVIEW-FOLLOW-UP.md §8.3, R6).
 *
 * `pending_scan` and `infected` rows are the durable work intent. Two
 * phases, each with its own attempt budget in `work_attempts`:
 *
 *   scan     (pending_scan): scan the stored bytes; clean -> `clean`,
 *            negative -> commit `infected` FIRST, then wake cleanup.
 *   cleanup  (infected):     delete the persisted nonempty path (missing is
 *            success), then clear `path` to ''. Never rescans.
 *
 * Public interface for callers (R4/R5 controllers/services):
 *   ensureQueued(int $documentId): bool   — call AFTER the creating
 *       transaction commits; idempotent, throttled, never throws.
 *
 * External scan/delete work runs outside transactions. Finalization
 * re-locks the row and compares claim token, phase, disk, path and hash, so
 * a stale result (retention cleared the path, status moved on) is dropped.
 */
class ApplicationDocumentWork
{
    public const MAX_STARTS = 3;

    public const LEASE_SECONDS = 75;

    public const WAKE_THROTTLE_SECONDS = 300;

    /** Minimum delay after start N (1-based) before the next start. */
    private const BACKOFF_SECONDS = [1 => 60, 2 => 300];

    public function __construct(private StorageObjectRemover $remover) {}

    /**
     * Wake a worker for one document if it is eligible and not woken in the
     * last five minutes. Records the attempt time in `work_dispatched_at`
     * (an enqueue attempt, not broker receipt), pushes outside the lock, and
     * logs rather than throws on push failure: durable intent stays on the row.
     *
     * @return bool true only when a job was pushed
     */
    public function ensureQueued(int $documentId): bool
    {
        $due = DB::transaction(function () use ($documentId): bool {
            $document = ApplicationDocument::query()->lockForUpdate()->find($documentId);
            $now = Carbon::now();

            if ($document === null || ! $this->eligible($document, $now)) {
                return false;
            }

            if ($document->work_dispatched_at !== null
                && $document->work_dispatched_at->gt($now->copy()->subSeconds(self::WAKE_THROTTLE_SECONDS))) {
                return false;
            }

            $document->forceFill(['work_dispatched_at' => $now])->save();

            return true;
        });

        if (! $due) {
            return false;
        }

        try {
            app(Dispatcher::class)->dispatch(new ScanApplicationDocument($documentId));
        } catch (Throwable $e) {
            Log::warning('ApplicationDocumentWork: could not queue document work; durable intent retained.', [
                'document_id' => $documentId,
                'exception' => $e->getMessage(),
            ]);

            return false;
        }

        return true;
    }

    /**
     * Run one worker delivery for a document (scan or cleanup phase).
     * Rethrows after releasing its own claim when the work itself fails.
     */
    public function process(int $documentId, ClamScannerContract $scanner): void
    {
        $claim = $this->claim($documentId);

        if ($claim === null) {
            return;
        }

        ['token' => $token, 'phase' => $phase, 'disk' => $disk, 'path' => $path, 'sha256' => $sha256] = $claim;

        try {
            if ($phase === 'pending_scan') {
                $this->scanPhase($documentId, $token, $disk, $path, $sha256, $scanner);
            } else {
                $this->cleanupPhase($documentId, $token, $disk, $path);
            }
        } catch (Throwable $e) {
            $this->recordFailure($documentId, $token, $e->getMessage());

            throw $e;
        }
    }

    /**
     * Targeted operator reset of an exhausted phase. Preserves status/path.
     *
     * @return string|null null on success, otherwise the refusal reason
     */
    public function resetExhausted(int $documentId): ?string
    {
        return DB::transaction(function () use ($documentId): ?string {
            $document = ApplicationDocument::query()->lockForUpdate()->find($documentId);
            $now = Carbon::now();

            if ($document === null) {
                return "Document {$documentId} does not exist.";
            }
            if (! $this->workable($document)) {
                return "Document {$documentId} has no outstanding work.";
            }
            if ($document->work_lease_until !== null && $document->work_lease_until->gt($now)) {
                return "Document {$documentId} has an active work lease.";
            }
            if ($document->work_attempts < self::MAX_STARTS) {
                return "Document {$documentId} is not exhausted.";
            }

            $document->forceFill([
                'work_attempts' => 0,
                'work_claim_id' => null,
                'work_lease_until' => null,
                'work_next_attempt_at' => null,
                'work_dispatched_at' => null,
            ])->save();

            return null;
        });
    }

    /**
     * Eligible IDs for the recovery command: never-dispatched first, then
     * oldest-dispatched, then lowest ID. Final eligibility is rechecked
     * under lock by ensureQueued().
     *
     * @return list<int>
     */
    public function recoverableIds(int $limit): array
    {
        $now = Carbon::now();

        $ids = ApplicationDocument::query()
            ->whereIn('status', ['pending_scan', 'infected'])
            // Mirror usablePath(): a row ensureQueued() can never wake would
            // otherwise sort first (never dispatched) and fill the batch.
            ->where('path', '!=', '')
            ->where('path', '!=', '..')
            ->where('path', 'not like', '/%')
            ->where('path', 'not like', '../%')
            ->where('path', 'not like', '%/../%')
            ->where('path', 'not like', '%/..')
            ->where('work_attempts', '<', self::MAX_STARTS)
            ->where(fn ($q) => $q->whereNull('work_next_attempt_at')->orWhere('work_next_attempt_at', '<=', $now))
            ->where(fn ($q) => $q->whereNull('work_lease_until')->orWhere('work_lease_until', '<=', $now))
            ->where(fn ($q) => $q->whereNull('work_dispatched_at')
                ->orWhere('work_dispatched_at', '<=', $now->copy()->subSeconds(self::WAKE_THROTTLE_SECONDS)))
            ->orderByRaw('CASE WHEN work_dispatched_at IS NULL THEN 0 ELSE 1 END')
            ->orderBy('work_dispatched_at')
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id');

        $list = [];
        foreach ($ids as $id) {
            $list[] = (int) $id;
        }

        return $list;
    }

    private function workable(ApplicationDocument $document): bool
    {
        return in_array($document->status, ['pending_scan', 'infected'], true)
            && $this->usablePath($document->path);
    }

    private function usablePath(string $path): bool
    {
        return $path !== '' && ! str_starts_with($path, '/') && ! in_array('..', explode('/', $path), true);
    }

    private function eligible(ApplicationDocument $document, Carbon $now): bool
    {
        return $this->workable($document)
            && $document->work_attempts < self::MAX_STARTS
            && ($document->work_next_attempt_at === null || $document->work_next_attempt_at->lte($now))
            && ($document->work_lease_until === null || $document->work_lease_until->lte($now));
    }

    /** @return array{token: string, phase: string, disk: string, path: string, sha256: string|null}|null */
    private function claim(int $documentId): ?array
    {
        return DB::transaction(function () use ($documentId): ?array {
            $document = ApplicationDocument::query()->lockForUpdate()->find($documentId);
            $now = Carbon::now();

            if ($document === null || ! $this->eligible($document, $now)) {
                return null;
            }

            $attempt = $document->work_attempts + 1;
            $leaseUntil = $now->copy()->addSeconds(self::LEASE_SECONDS);
            $delay = self::BACKOFF_SECONDS[$attempt] ?? null;
            $token = (string) Str::uuid();

            $document->forceFill([
                'work_claim_id' => $token,
                'work_attempts' => $attempt,
                'work_lease_until' => $leaseUntil,
                // Conservative: a crash cannot retry before lease expiry + delay.
                'work_next_attempt_at' => $delay === null ? null : $leaseUntil->copy()->addSeconds($delay),
            ])->save();

            return [
                'token' => $token,
                'phase' => $document->status,
                'disk' => $document->disk,
                'path' => $document->path,
                'sha256' => $document->sha256,
            ];
        });
    }

    private function scanPhase(int $documentId, string $token, string $disk, string $path, ?string $sha256, ClamScannerContract $scanner): void
    {
        if (! Storage::disk($disk)->exists($path)) {
            // An upload-flow bug, not a verdict: stay pending, spend the attempt.
            Log::warning('ApplicationDocumentWork: pending document is missing on disk.', ['document_id' => $documentId]);
            $this->recordFailure($documentId, $token, 'object missing');

            return;
        }

        $clean = $scanner->isClean(Storage::disk($disk)->path($path));

        $committed = DB::transaction(function () use ($documentId, $token, $disk, $path, $sha256, $clean): bool {
            $document = ApplicationDocument::query()->lockForUpdate()->find($documentId);

            if ($document === null || ! $this->owns($document, $token, 'pending_scan', $disk, $path, $sha256)) {
                return false;
            }

            if ($clean) {
                $document->forceFill([
                    'status' => 'clean',
                    'work_claim_id' => null,
                    'work_lease_until' => null,
                    'work_next_attempt_at' => null,
                ])->save();
            } else {
                // Verdict first; cleanup is a separate, retryable phase.
                $document->forceFill([
                    'status' => 'infected',
                    'work_claim_id' => null,
                    'work_lease_until' => null,
                    'work_attempts' => 0,
                    'work_next_attempt_at' => Carbon::now(),
                    'work_dispatched_at' => null,
                ])->save();
            }

            return true;
        });

        if (! $committed) {
            Log::warning('ApplicationDocumentWork: dropped a stale scan result.', ['document_id' => $documentId]);

            return;
        }

        if (! $clean) {
            try {
                $this->ensureQueued($documentId);
            } catch (Throwable $e) {
                Log::warning('ApplicationDocumentWork: cleanup wakeup failed; recovery will retry.', [
                    'document_id' => $documentId,
                    'exception' => $e->getMessage(),
                ]);
            }
        }
    }

    private function cleanupPhase(int $documentId, string $token, string $disk, string $path): void
    {
        // Missing object is success; false/throw surface as exceptions.
        $this->remover->deleteExisting($disk, [$path], 'Application document cleanup failed.');

        $cleared = DB::transaction(function () use ($documentId, $token, $disk, $path): bool {
            $document = ApplicationDocument::query()->lockForUpdate()->find($documentId);

            if ($document === null || ! $this->owns($document, $token, 'infected', $disk, $path)) {
                return false;
            }

            $document->forceFill([
                'path' => '',
                'work_claim_id' => null,
                'work_lease_until' => null,
                'work_next_attempt_at' => null,
            ])->save();

            return true;
        });

        if (! $cleared) {
            Log::warning('ApplicationDocumentWork: dropped a stale cleanup result.', ['document_id' => $documentId]);
        }
    }

    private function owns(ApplicationDocument $document, string $token, string $phase, string $disk, string $path, ?string $sha256 = null): bool
    {
        return $document->work_claim_id === $token
            && $document->status === $phase
            && $document->disk === $disk
            && $document->path === $path
            && ($phase !== 'pending_scan' || $document->sha256 === $sha256);
    }

    /** Only the current token owner releases its claim and schedules the retry. */
    private function recordFailure(int $documentId, string $token, string $reason): void
    {
        try {
            DB::transaction(function () use ($documentId, $token, $reason): void {
                $document = ApplicationDocument::query()->lockForUpdate()->find($documentId);

                if ($document === null || $document->work_claim_id !== $token) {
                    return;
                }

                $delay = self::BACKOFF_SECONDS[$document->work_attempts] ?? null;
                $document->forceFill([
                    'work_claim_id' => null,
                    'work_lease_until' => null,
                    'work_next_attempt_at' => $delay === null ? null : Carbon::now()->addSeconds($delay),
                ])->save();

                if ($delay === null) {
                    Log::error('ApplicationDocumentWork: attempt budget exhausted; automatic retries stopped.', [
                        'document_id' => $documentId,
                        'phase' => $document->status,
                        'attempts' => $document->work_attempts,
                        'reason' => $reason,
                    ]);
                }
            });
        } catch (Throwable $e) {
            Log::error('ApplicationDocumentWork: could not record a work failure.', [
                'document_id' => $documentId,
                'exception' => $e->getMessage(),
            ]);
        }
    }
}
