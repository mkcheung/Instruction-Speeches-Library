<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Report\CreateReportRequest;
use App\Http\Resources\ReportResource;
use App\Models\AuditLog;
use App\Models\Report;
use App\Models\Review;
use App\Models\Speech;
use App\Support\AuditAction;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

/**
 * `POST /api/reports` — STEP-11-FROZEN-CONTRACT.md §1. `reportable_type`
 * is resolved server-side to `Speech`/`Review` ONLY — the client never
 * names an arbitrary Eloquent class, and CreateReportRequest's `Rule::in`
 * already rejects anything else at 422 before this controller runs.
 *
 * Authorization reuses `SpeechPolicy::view` (no new Gate ability, per §1:
 * "This is intentionally permissive... does not go in $mustFallThrough").
 * A Review target is authorized by view-access to its PARENT speech — a
 * review is "the annotation set" STEP-11.md's frontend section names.
 */
class ReportController extends Controller
{
    public function store(CreateReportRequest $request): JsonResponse
    {
        $type = $request->validated('reportable_type');
        $modelClass = Report::REPORTABLE_TYPES[$type] ?? null;
        abort_if($modelClass === null, Response::HTTP_UNPROCESSABLE_ENTITY, 'Unsupported report target.');

        $reportableId = (int) $request->validated('reportable_id');

        if ($modelClass === Speech::class) {
            $speech = Speech::query()->find($reportableId);
            abort_if($speech === null, Response::HTTP_NOT_FOUND);
            abort_unless(Gate::forUser($request->user())->allows('view', $speech), Response::HTTP_FORBIDDEN);
            $reportable = $speech;
        } else {
            $review = Review::query()->find($reportableId);
            abort_if($review === null, Response::HTTP_NOT_FOUND);
            $speech = $review->speech()->firstOrFail();
            abort_unless(Gate::forUser($request->user())->allows('view', $speech), Response::HTTP_FORBIDDEN);
            $reportable = $review;
        }

        $report = Report::query()->create([
            'reportable_type' => $modelClass,
            'reportable_id' => $reportable->id,
            'reporter_id' => $request->user()->id,
            'reason' => $request->validated('reason'),
            'detail' => $request->validated('detail'),
            'state' => 'open',
        ]);

        AuditLog::query()->create([
            'actor_id' => $request->user()->id,
            'action' => AuditAction::REPORT_CREATED,
            'subject_type' => $modelClass,
            'subject_id' => $reportable->id,
            'metadata' => ['report_id' => $report->id, 'reason' => $report->reason],
            'ip' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);

        return new JsonResponse(['report' => new ReportResource($report)], Response::HTTP_CREATED);
    }
}
