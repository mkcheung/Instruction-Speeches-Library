<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Privacy\RequestDataExportRequest;
use App\Http\Resources\DataExportResource;
use App\Jobs\GenerateDataExport;
use App\Models\AuditLog;
use App\Models\DataExport;
use App\Services\MediaUrlSigner;
use App\Support\AuditAction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-11-FROZEN-CONTRACT.md §7. Every capability here is self-scoped —
 * always `$request->user()`, no ownership ambiguity, no Policy needed
 * (§8).
 */
class PrivacyExportController extends Controller
{
    public function store(RequestDataExportRequest $request): JsonResponse
    {
        $export = DataExport::query()->create([
            'user_id' => $request->user()->id,
            'kind' => $request->validated('kind'),
            'status' => 'processing',
            'disk' => 'media',
        ]);

        GenerateDataExport::dispatch($export->id)->afterCommit();

        AuditLog::query()->create([
            'actor_id' => $request->user()->id,
            'action' => AuditAction::ACCOUNT_EXPORT_REQUESTED,
            'subject_type' => DataExport::class,
            'subject_id' => $export->id,
            'metadata' => ['kind' => $export->kind],
            'ip' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);

        return new JsonResponse(['export' => new DataExportResource($export)], Response::HTTP_CREATED);
    }

    public function index(Request $request): JsonResponse
    {
        $exports = DataExport::query()
            ->where('user_id', $request->user()->id)
            ->orderByDesc('created_at')
            ->get();

        return new JsonResponse(['exports' => DataExportResource::collection($exports)]);
    }

    public function download(Request $request, DataExport $export, MediaUrlSigner $signer): JsonResponse
    {
        abort_unless($export->user_id === $request->user()->id, Response::HTTP_FORBIDDEN);
        abort_unless($export->status === 'ready' && $export->path !== null, Response::HTTP_FORBIDDEN);
        // §7: "exports are not kept forever" — expires_at exists specifically
        // to bound how long a full personal-data-plus-others'-commentary
        // dump stays presignable. PurgeExpiredExportsCommand only sweeps on
        // its own schedule (nightly), so without this check a `ready` row
        // stays downloadable indefinitely in the window before that sweep
        // runs, or if it never runs at all.
        abort_if($export->expires_at !== null && $export->expires_at->isPast(), Response::HTTP_GONE);

        // 10-minute TTL, matching video's existing convention
        // (MediaUrlSigner::DEFAULT_TTL_SECONDS).
        $url = $signer->presign($export->path, MediaUrlSigner::DEFAULT_TTL_SECONDS);

        AuditLog::query()->create([
            'actor_id' => $request->user()->id,
            'action' => AuditAction::ACCOUNT_EXPORT_DOWNLOADED,
            'subject_type' => DataExport::class,
            'subject_id' => $export->id,
            'metadata' => ['kind' => $export->kind],
            'ip' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);

        return new JsonResponse(['url' => $url]);
    }
}
