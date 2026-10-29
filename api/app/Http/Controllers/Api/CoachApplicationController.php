<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\CoachApplication\CreateCoachApplicationRequest;
use App\Http\Requests\CoachApplication\UploadApplicationDocumentsRequest;
use App\Http\Resources\CoachApplicationResource;
use App\Models\CoachApplication;
use App\Services\CoachApplicationSubmissionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
     *   - no row yet, or the latest is `rejected`/`withdrawn` -> create a
     *     fresh `draft` row, stay draft (returns an `id` the document-upload
     *     step needs; does NOT auto-submit). A reapplication is a new row
     *     per attempt; the decided row keeps its decision and documents
     *     (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §8).
     *   - row is `draft` -> `submit()`.
     *   - row is `submitted`/`under_review` -> idempotent no-op (keeps the
     *     statement in sync), so a reload or double-click never crashes.
     *   - row is `approved` -> 409, a clear rejection rather than an
     *     uncaught `RuntimeException`. So is any call once account erasure
     *     has started (§9).
     */
    public function store(CreateCoachApplicationRequest $request, CoachApplicationSubmissionService $submissions): JsonResponse
    {
        $user = $this->currentUser($request);
        $statement = $request->validated('statement');

        $application = $submissions->saveOrSubmit($user, $statement);

        return new JsonResponse(['coachApplication' => new CoachApplicationResource($application)], Response::HTTP_CREATED);
    }

    /**
     * `GET /api/coach-applications/me` — the caller's own most recent
     * application (any status), or a 404 empty state if they've never
     * applied.
     */
    public function me(Request $request): JsonResponse
    {
        $application = CoachApplication::query()
            ->where('user_id', $this->currentUser($request)->id)
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
     * Admission is all-or-nothing (CoachApplicationSubmissionService);
     * the scan is woken after commit through ApplicationDocumentWork and is
     * never synchronous — every row lands `pending_scan`.
     */
    public function uploadDocuments(UploadApplicationDocumentsRequest $request, CoachApplication $coachApplication, CoachApplicationSubmissionService $submissions): JsonResponse
    {
        $application = $submissions->addDocuments($this->currentUser($request), $coachApplication, array_values($request->file('documents')));

        return new JsonResponse([
            'coachApplication' => new CoachApplicationResource($application),
        ], Response::HTTP_CREATED);
    }
}
