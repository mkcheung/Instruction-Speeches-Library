<?php

namespace App\Services\Privacy;

use App\Models\ApplicationDocument;
use App\Models\CoachApplication;
use App\Models\User;
use App\Services\StorageObjectRemover;
use Illuminate\Support\Facades\DB;

/**
 * PLAN-COACH-APPLICATION-REVIEW-PAGE.md §9 (Q2): account-erasure step 6c.
 * Shreds every coach application's statement and document bytes, keeping
 * only the decision record and hashes (STEP-12's retention rule, the same
 * one PurgeExpiredApplicationDocumentsCommand follows). Submitted or
 * under-review applications are withdrawn so they leave the admin queue;
 * drafts stay drafts. Idempotent: a shredded row
 * has `path = ''`, so a rerun counts and touches nothing, which is also what
 * makes it safe as a backfill for accounts erased before 6c existed.
 */
class CoachApplicationErasure
{
    public function __construct(private readonly StorageObjectRemover $remover) {}

    /** @return array{count: int, bytes: int} */
    public function plan(User $user): array
    {
        $documents = ApplicationDocument::query()
            ->whereIn('application_id', CoachApplication::query()->where('user_id', $user->id)->select('id'))
            ->where('path', '!=', '')
            ->get(['byte_size']);

        return ['count' => $documents->count(), 'bytes' => (int) $documents->sum('byte_size')];
    }

    /** @return array{count: int, bytes: int} */
    public function execute(User $user): array
    {
        [$applicationIds, $documents] = DB::transaction(function () use ($user) {
            // Same lock order as CoachApplicationSubmissionService: user -> application.
            User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $applications = CoachApplication::query()->where('user_id', $user->id)->lockForUpdate()->get();

            foreach ($applications as $application) {
                // Submitted work leaves the admin queue (the decision service
                // 409s on withdrawn). A draft stays a draft: it was never
                // offered for review, and withdrawing it would surface it in
                // the admin list, which hides only drafts (Q1).
                if (in_array($application->status, CoachApplication::UNDECIDED_STATUSES, true)) {
                    $application->withdraw();
                }
                $application->forceFill(['statement' => null])->save();
            }

            return [
                $applications->modelKeys(),
                ApplicationDocument::query()
                    ->whereIn('application_id', $applications->modelKeys())
                    ->where('path', '!=', '')
                    ->get(['id', 'disk', 'path', 'byte_size']),
            ];
        });

        $count = 0;
        $bytes = 0;
        foreach ($documents as $document) {
            // Throws if a delete fails, so a row is never blanked while bytes remain (step 2's rule).
            $this->remover->deleteExisting($document->disk, [$document->path], "Account-erasure coach-document purge failed for document {$document->id}.");
            $updated = ApplicationDocument::query()->whereKey($document->id)->where('path', $document->path)
                ->update(['path' => '', 'original_filename' => ApplicationDocument::ERASED_FILENAME]);
            if ($updated > 0) {
                $count++;
                $bytes += (int) $document->byte_size;
            }
        }

        // Rows whose bytes were already gone keep the client-supplied filename:
        // infected-cleanup blanks `path` but not the name, and the scanner can
        // do so between the select above and the update. Erase those names too.
        // Retention-purged rows already read '[purged]'.
        ApplicationDocument::query()
            ->whereIn('application_id', $applicationIds)
            ->where('path', '')
            ->whereNotIn('original_filename', ['[purged]', ApplicationDocument::ERASED_FILENAME])
            ->update(['original_filename' => ApplicationDocument::ERASED_FILENAME]);

        return ['count' => $count, 'bytes' => $bytes];
    }
}
