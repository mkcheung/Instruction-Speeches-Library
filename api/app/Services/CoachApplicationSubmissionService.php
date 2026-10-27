<?php

namespace App\Services;

use App\Models\ApplicationDocument;
use App\Models\CoachApplication;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * PLAN-CODE-REVIEW-FOLLOW-UP.md §8.2 (R4/R5): the applicant-side writers of a
 * coach application. Lock order is always fresh applicant user -> application
 * (-> new document rows). Decisions (CoachApplicationDecisionService) take
 * `admin_roster` first and then the same user -> application order, so the
 * two sides never invert. HTTP validation and envelopes stay in the controller.
 *
 * SQLite cannot demonstrate row-lock behavior; the lock calls are inert there.
 */
class CoachApplicationSubmissionService
{
    public const DISK = 'application_documents';

    public const MAX_DOCUMENTS = 2;

    public function __construct(private readonly PdfUploadValidator $validator) {}

    /**
     * Two-step store contract: no application creates a draft; draft/rejected
     * submits that row; submitted/under_review only syncs the statement;
     * approved/withdrawn is a 409.
     */
    public function saveOrSubmit(User $applicant, string $statement): CoachApplication
    {
        $application = DB::transaction(function () use ($applicant, $statement): CoachApplication {
            // The user row is the stable serialization point for the absent-row case.
            User::query()->whereKey($applicant->id)->lockForUpdate()->firstOrFail();

            $existing = CoachApplication::query()
                ->where('user_id', $applicant->id)
                ->latest('id')
                ->lockForUpdate()
                ->first();

            if ($existing === null) {
                return CoachApplication::query()->create([
                    'user_id' => $applicant->id,
                    'status' => 'draft',
                    'statement' => $statement,
                ]);
            }

            if (in_array($existing->status, ['draft', 'rejected'], true)) {
                $existing->submit($statement);

                return $existing;
            }

            if (in_array($existing->status, ['submitted', 'under_review'], true)) {
                if ($existing->statement !== $statement) {
                    $existing->forceFill(['statement' => $statement])->save();
                }

                return $existing;
            }

            abort(Response::HTTP_CONFLICT, "CoachApplication#{$existing->id}: cannot modify an application with status \"{$existing->status}\".");
        });

        return $application->fresh('documents') ?? $application;
    }

    /**
     * All-or-nothing admission of up to two PDFs. Validate the whole batch,
     * stage fresh UUID objects outside any transaction, admit every metadata
     * row in one locked transaction, then wake scan work after commit.
     *
     * @param  list<UploadedFile>  $files
     */
    public function addDocuments(User $applicant, CoachApplication $addressed, array $files): CoachApplication
    {
        // Preflight against live state (cheap, unlocked); rechecked under lock below.
        $this->assertAdmissible($applicant, CoachApplication::query()->findOrFail($addressed->id), count($files));

        $batch = $this->prevalidate($files);

        $staged = $this->stage($addressed->id, $batch);

        try {
            DB::transaction(function () use ($applicant, $addressed, $batch, $staged): array {
                User::query()->whereKey($applicant->id)->lockForUpdate()->firstOrFail();
                $locked = CoachApplication::query()->whereKey($addressed->id)->lockForUpdate()->firstOrFail();

                $this->assertAdmissible($applicant, $locked, count($batch));

                $ids = [];
                foreach ($batch as $i => $item) {
                    $ids[] = ApplicationDocument::query()->create([
                        'application_id' => $locked->id,
                        'disk' => self::DISK,
                        'path' => $staged[$i],
                        'original_filename' => $item['name'],
                        'byte_size' => $item['size'],
                        'sha256' => $item['sha256'],
                        'status' => 'pending_scan',
                    ])->id;
                }

                // Registered inside, fired only by the outermost commit; an
                // outer rollback discards it. Failures here must never reach
                // compensation: the rows are committed.
                DB::afterCommit(function () use ($ids): void {
                    foreach ($ids as $id) {
                        try {
                            app(ApplicationDocumentWork::class)->ensureQueued($id);
                        } catch (Throwable $e) {
                            Log::error('CoachApplicationSubmissionService: post-commit enqueue failed; document-work recovery will queue it.', [
                                'document_id' => $id,
                                'exception' => $e->getMessage(),
                            ]);
                        }
                    }
                });

                return $ids;
            });
        } catch (Throwable $e) {
            $this->compensateUncommitted($staged);

            throw $e;
        }

        return CoachApplication::query()->with('documents')->findOrFail($addressed->id);
    }

    private function assertAdmissible(User $applicant, CoachApplication $application, int $incoming): void
    {
        abort_unless($application->user_id === $applicant->id, Response::HTTP_NOT_FOUND);
        abort_unless(in_array($application->status, ['draft', 'submitted', 'under_review'], true), Response::HTTP_CONFLICT, 'This application can no longer accept documents.');
        abort_if($application->documents()->count() + $incoming > self::MAX_DOCUMENTS, Response::HTTP_UNPROCESSABLE_ENTITY, 'At most two documents per application.');
    }

    /**
     * @param  list<UploadedFile>  $files
     * @return list<array{name: string, size: int, sha256: string, contents: string}>
     */
    private function prevalidate(array $files): array
    {
        $batch = [];

        foreach ($files as $file) {
            $path = $file->getRealPath();
            abort_if($path === false, Response::HTTP_UNPROCESSABLE_ENTITY, 'Unable to read uploaded file.');

            abort_unless($this->validator->hasPdfMagicBytes($path), Response::HTTP_UNPROCESSABLE_ENTITY, 'File is not a valid PDF.');
            abort_if($file->getSize() > PdfUploadValidator::MAX_BYTES, Response::HTTP_UNPROCESSABLE_ENTITY, 'File exceeds the 10MB limit.');

            $pageCount = $this->validator->pageCount($path);
            abort_if($pageCount !== null && $pageCount > PdfUploadValidator::MAX_PAGES, Response::HTTP_UNPROCESSABLE_ENTITY, 'File exceeds the page limit.');

            $contents = file_get_contents($path);
            abort_if($contents === false, Response::HTTP_UNPROCESSABLE_ENTITY, 'Unable to read uploaded file.');

            $batch[] = [
                'name' => $file->getClientOriginalName(),
                'size' => (int) $file->getSize(),
                'sha256' => $this->validator->sha256($path),
                'contents' => $contents,
            ];
        }

        return $batch;
    }

    /**
     * Write each object under a fresh UUID path (never client-derived). On a
     * false or thrown write the paths staged by this attempt, including the
     * failing one, are owned and uncommitted, so they are removed.
     *
     * @param  list<array{contents: string}>  $batch
     * @return list<string>
     */
    private function stage(int $applicationId, array $batch): array
    {
        $staged = [];

        foreach ($batch as $item) {
            $key = 'applications/'.$applicationId.'/'.Str::uuid().'.pdf';
            $staged[] = $key;

            try {
                $written = Storage::disk(self::DISK)->put($key, $item['contents']);
            } catch (Throwable $e) {
                $this->removeOwned($staged);

                throw $e;
            }

            if ($written === false) {
                $this->removeOwned($staged);
                abort(Response::HTTP_SERVICE_UNAVAILABLE, 'Document storage is unavailable; nothing was saved. Please retry.');
            }
        }

        return $staged;
    }

    /**
     * After a failed admission, delete only staged paths a fresh read proves
     * unreferenced. If the database cannot answer, the commit may have
     * happened, so the bytes are preserved and the paths logged.
     *
     * @param  list<string>  $staged
     */
    private function compensateUncommitted(array $staged): void
    {
        try {
            $referenced = ApplicationDocument::query()
                ->where('disk', self::DISK)
                ->whereIn('path', $staged)
                ->pluck('path')
                ->all();
        } catch (Throwable $e) {
            Log::error('CoachApplicationSubmissionService: commit outcome unknown; staged objects preserved.', [
                'paths' => $staged,
                'exception' => $e->getMessage(),
            ]);

            return;
        }

        $this->removeOwned(array_values(array_diff($staged, $referenced)));
    }

    /** @param list<string> $paths */
    private function removeOwned(array $paths): void
    {
        foreach ($paths as $path) {
            try {
                if (Storage::disk(self::DISK)->delete($path) === false) {
                    Log::error('CoachApplicationSubmissionService: could not remove an uncommitted staged object.', ['disk' => self::DISK, 'path' => $path]);
                }
            } catch (Throwable $e) {
                Log::error('CoachApplicationSubmissionService: could not remove an uncommitted staged object.', [
                    'disk' => self::DISK,
                    'path' => $path,
                    'exception' => $e->getMessage(),
                ]);
            }
        }
    }
}
