<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\CoachApplication\CreateCoachApplicationRequest;
use App\Http\Requests\CoachApplication\UploadApplicationDocumentsRequest;
use App\Http\Resources\CoachApplicationResource;
use App\Jobs\ScanApplicationDocument;
use App\Models\ApplicationDocument;
use App\Models\CoachApplication;
use App\Services\PdfUploadValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-12-FROZEN-CONTRACT.md §9. Self-scoped throughout — always
 * `$request->user()`, no Policy needed, same shape as
 * `PrivacyExportController`/`AccountController` (STEP-11's precedent for
 * "no ownership ambiguity, no new Gate ability").
 */
class CoachApplicationController extends Controller
{
    /**
     * `POST /api/coach-applications` — one idempotent-upsert route serving
     * both halves of the applicant flow, distinguished by the row's own
     * current status rather than by anything in the request body (the
     * frontend calls this endpoint twice with an identical payload shape:
     * once from "Save draft and continue" with no existing row, once from
     * "Submit application" once a draft row and its documents exist):
     *
     *   - no live row yet          -> create a fresh `draft` row, stay draft
     *     (returns an `id` the document-upload step needs; does NOT
     *     auto-submit — an earlier version of this endpoint did, which
     *     made the second call above 500 because `submit()` only accepts
     *     `draft`/`rejected` as a starting state).
     *   - row is `draft`/`rejected` -> `submit()` (rejected->draft->submitted
     *     in one call is the plan's own explicit reapplication rule).
     *   - row is `submitted`/`under_review` -> idempotent no-op (keeps the
     *     statement in sync), so a reload or double-click never crashes.
     *   - row is `approved`/`withdrawn` -> 409, a clear rejection rather
     *     than an uncaught `RuntimeException`.
     */
    public function store(CreateCoachApplicationRequest $request): JsonResponse
    {
        $user = $request->user();
        $statement = $request->validated('statement');

        $application = DB::transaction(function () use ($user, $statement) {
            $existing = CoachApplication::query()
                ->where('user_id', $user->id)
                ->latest('id')
                ->lockForUpdate()
                ->first();

            if ($existing === null) {
                return CoachApplication::query()->create([
                    'user_id' => $user->id,
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

        return new JsonResponse(['coachApplication' => new CoachApplicationResource($application->fresh('documents'))], Response::HTTP_CREATED);
    }

    /**
     * `GET /api/coach-applications/me` — the caller's own most recent
     * application (any status), or a 404 empty state if they've never
     * applied.
     */
    public function me(Request $request): JsonResponse
    {
        $application = CoachApplication::query()
            ->where('user_id', $request->user()->id)
            ->with('documents')
            ->latest('id')
            ->first();

        abort_if($application === null, Response::HTTP_NOT_FOUND, 'No coach application found.');

        return new JsonResponse(['coachApplication' => new CoachApplicationResource($application)]);
    }

    /**
     * `POST /api/coach-applications/{id}/documents` — multipart, up to
     * two files. Content-validated from scratch (STEP-12-FROZEN-
     * CONTRACT.md §5): `%PDF-` magic bytes, sha256, 10MB cap (also
     * enforced at the FormRequest layer), best-effort page-count cap.
     * The scan itself is queued (`ScanApplicationDocument`), never
     * synchronous — every row lands `pending_scan` regardless of how
     * quickly a worker picks the job up.
     */
    public function uploadDocuments(UploadApplicationDocumentsRequest $request, CoachApplication $coachApplication, PdfUploadValidator $validator): JsonResponse
    {
        abort_unless($coachApplication->user_id === $request->user()->id, Response::HTTP_NOT_FOUND);
        abort_unless(in_array($coachApplication->status, ['draft', 'submitted', 'under_review'], true), Response::HTTP_CONFLICT, 'This application can no longer accept documents.');

        $existingCount = $coachApplication->documents()->count();
        $incoming = $request->file('documents');
        abort_if($existingCount + count($incoming) > 2, Response::HTTP_UNPROCESSABLE_ENTITY, 'At most two documents per application.');

        $created = [];

        foreach ($incoming as $file) {
            $tempPath = $file->getRealPath();

            abort_unless($validator->hasPdfMagicBytes($tempPath), Response::HTTP_UNPROCESSABLE_ENTITY, 'File is not a valid PDF.');
            abort_if($file->getSize() > PdfUploadValidator::MAX_BYTES, Response::HTTP_UNPROCESSABLE_ENTITY, 'File exceeds the 10MB limit.');

            $pageCount = $validator->pageCount($tempPath);
            abort_if($pageCount !== null && $pageCount > PdfUploadValidator::MAX_PAGES, Response::HTTP_UNPROCESSABLE_ENTITY, 'File exceeds the page limit.');

            // Randomized path, never derived from the client's filename
            // (STEP-12-FROZEN-CONTRACT.md §5), on the dedicated
            // `application_documents` disk.
            $key = 'applications/'.$coachApplication->id.'/'.Str::uuid().'.pdf';
            Storage::disk('application_documents')->put($key, file_get_contents($tempPath));

            $document = ApplicationDocument::query()->create([
                'application_id' => $coachApplication->id,
                'disk' => 'application_documents',
                'path' => $key,
                'original_filename' => $file->getClientOriginalName(),
                'byte_size' => $file->getSize(),
                'sha256' => $validator->sha256($tempPath),
                'status' => 'pending_scan',
            ]);

            ScanApplicationDocument::dispatch($document->id);

            $created[] = $document;
        }

        return new JsonResponse([
            'coachApplication' => new CoachApplicationResource($coachApplication->fresh('documents')),
        ], Response::HTTP_CREATED);
    }
}
