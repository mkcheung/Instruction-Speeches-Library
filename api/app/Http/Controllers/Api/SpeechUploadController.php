<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Speech\CompleteUploadRequest;
use App\Http\Requests\Speech\CreateUploadRequest;
use App\Http\Requests\Speech\SetPosterFrameRequest;
use App\Http\Resources\SpeechAssetResource;
use App\Jobs\GenerateCaptions;
use App\Jobs\GeneratePoster;
use App\Jobs\TranscodeSpeechAsset;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\MediaUrlSigner;
use App\Services\MultipartUploadService;
use App\Services\QuotaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * §9.1's four presigned-multipart endpoints (create / sign-part / complete /
 * abort), plus retry (§9.2) and the playback-URL refresh (§9.3). Ownership
 * is checked inline against `$request->user()->id` everywhere (no Policy
 * classes exist in this codebase yet — see AppServiceProvider's comment).
 */
class SpeechUploadController extends Controller
{
    private function authorizeOwner(Request $request, Speech $speech): void
    {
        abort_unless($speech->user_id === $request->user()->id, Response::HTTP_NOT_FOUND, 'No such speech.');
    }

    /**
     * STEP-05 §7.3: the playback-URL endpoint is the one place upload
     * ownership widens to "owner OR an access-granting review" — a
     * reviewer who has accepted (or further) can watch, everyone else
     * (including an invited-but-not-yet-accepted reviewer) gets the same
     * 404 a stranger would, never a 403 that would confirm the speech
     * exists.
     */
    private function authorizeGrantingAccess(Request $request, Speech $speech): void
    {
        if ($speech->user_id === $request->user()->id) {
            return;
        }

        $granted = Review::query()
            ->where('speech_id', $speech->id)
            ->where('reviewer_id', $request->user()->id)
            ->whereIn('status', Review::ACCESS_GRANTING)
            ->whereNull('revoked_at')
            ->exists();

        abort_unless($granted, Response::HTTP_NOT_FOUND, 'No such speech.');
    }

    /**
     * The `create` step: reserve quota, open an S3 multipart upload, and
     * record the (as yet empty) `source` asset row that everything else in
     * this controller keys off of. Server-generated key
     * (`uploads/{user_id}/{uuid}/source`, §9.1) — never the client's
     * filename.
     */
    public function createUpload(CreateUploadRequest $request, Speech $speech, QuotaService $quota, MultipartUploadService $multipart): JsonResponse
    {
        $this->authorizeOwner($request, $speech);

        $validated = $request->validated();

        // Reserve BEFORE opening the S3-side multipart upload — a rejected
        // reservation should never leave an orphaned multipart upload
        // sitting in the bucket.
        $quota->reserve($request->user(), $validated['byte_size']);

        $format = str_contains($validated['content_type'], 'quicktime') ? 'mov' : 'mp4';
        $key = "uploads/{$request->user()->id}/".Str::uuid().'/source';
        $uploadId = $multipart->create($key, $validated['content_type']);

        $asset = $speech->assets()->create([
            'kind' => 'source',
            'format' => $format,
            'disk' => 'media',
            'path' => $key,
            'original_filename' => $validated['original_filename'],
            'mime_type' => $validated['content_type'],
            'status' => 'uploading',
            'upload_id' => $uploadId,
            'client_declared_bytes' => $validated['byte_size'],
        ]);

        return new JsonResponse([
            'asset' => new SpeechAssetResource($asset),
            'upload_id' => $uploadId,
            'key' => $key,
        ], Response::HTTP_CREATED);
    }

    /**
     * A presigned PUT URL for exactly one part — signed against the
     * browser-reachable endpoint (MultipartUploadService's internal/public
     * client split).
     */
    public function signPart(Request $request, Speech $speech, SpeechAsset $asset, string $uploadId, int $partNumber, MultipartUploadService $multipart): JsonResponse
    {
        $this->authorizeOwner($request, $speech);
        abort_unless($asset->speech_id === $speech->id && $asset->upload_id === $uploadId, Response::HTTP_NOT_FOUND);

        return new JsonResponse([
            'url' => $multipart->signPart($asset->path, $uploadId, $partNumber),
        ]);
    }

    /**
     * Completes the S3-side multipart upload, reconciles the quota by the
     * REAL `byte_size` (never the client's declared figure — the "1-byte
     * declaration for a 40 MB file" acceptance item), marks the source
     * `ready`, and creates the `processing` video asset the transcode job
     * will update. `after_commit` (§9.2) is why the dispatch happens inside
     * the transaction rather than after it.
     */
    public function complete(CompleteUploadRequest $request, Speech $speech, SpeechAsset $asset, string $uploadId, QuotaService $quota, MultipartUploadService $multipart): JsonResponse
    {
        $this->authorizeOwner($request, $speech);
        abort_unless($asset->speech_id === $speech->id && $asset->upload_id === $uploadId, Response::HTTP_NOT_FOUND);

        $parts = collect($request->validated('parts'))
            ->map(fn (array $part) => ['PartNumber' => $part['part_number'], 'ETag' => $part['etag']])
            ->all();

        $result = $multipart->complete($asset->path, $uploadId, $parts);
        $quota->releaseOnComplete($asset, $result['byte_size']);

        $videoAsset = DB::transaction(function () use ($asset, $speech, $result) {
            $asset->update(['status' => 'ready', 'byte_size' => $result['byte_size']]);

            $video = $speech->assets()->create([
                'kind' => 'video',
                'format' => 'mp4',
                'disk' => $asset->disk,
                'path' => "speeches/{$speech->ulid}/{$speech->ulid}/720p.mp4",
                'status' => 'processing',
                'is_primary' => true,
            ]);

            TranscodeSpeechAsset::dispatch($video->id);

            // STEP-09-captions.md (R11): dispatched here, alongside the
            // video transcode, NOT after it — captions run on a genuinely
            // separate queue/worker (App\Jobs\GenerateCaptions ->
            // `redis-long`/`captions`) so a five-minute whisper.cpp run
            // never delays the video reaching `ready`. Only when the
            // speaker hasn't turned captions off (§20 Q12's off-switch).
            if ($speech->captions_enabled) {
                $captions = $speech->assets()->create([
                    'kind' => 'captions',
                    'format' => 'vtt',
                    'disk' => $asset->disk,
                    'path' => "speeches/{$speech->ulid}/{$speech->ulid}/captions.vtt",
                    'status' => 'processing',
                ]);

                GenerateCaptions::dispatch($captions->id);
            }

            return $video;
        });

        return new JsonResponse(['asset' => new SpeechAssetResource($videoAsset)]);
    }

    /**
     * Both quota counters given back (§9.1's release-paths table) —
     * nothing was ultimately stored.
     */
    public function abort(Request $request, Speech $speech, SpeechAsset $asset, string $uploadId, QuotaService $quota, MultipartUploadService $multipart): JsonResponse
    {
        $this->authorizeOwner($request, $speech);
        abort_unless($asset->speech_id === $speech->id && $asset->upload_id === $uploadId, Response::HTTP_NOT_FOUND);

        $multipart->abort($asset->path, $uploadId);
        $quota->releaseOnAbort($asset);
        $asset->delete();

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * Safe because both pipelines are idempotent on their own asset row
     * (§9.2's rule, and STEP-09-captions.md's acceptance criterion "a
     * speech whose caption job fails still plays; the failure is visible
     * and retryable"): re-dispatching a `failed` video OR captions asset
     * just runs the same deterministic pipeline again, independently of
     * the other asset's own status.
     */
    public function retry(Request $request, Speech $speech, SpeechAsset $asset): JsonResponse
    {
        abort_unless(
            $asset->speech_id === $speech->id && in_array($asset->kind, ['video', 'captions'], true) && $asset->status === 'failed',
            Response::HTTP_NOT_FOUND,
        );

        // Captions retries go through the real caption.update gate
        // (SpeechPolicy::updateCaptions) rather than this controller's own
        // hardcoded owner check — currently the same rule (ownership-only)
        // either way, but retrying a captions asset IS a captions write,
        // and routing it through the same gate PUT /captions uses means
        // the two can never silently diverge if updateCaptions is ever
        // widened/narrowed independently.
        if ($asset->kind === 'captions') {
            $this->authorize('caption.update', $speech);
        } else {
            $this->authorizeOwner($request, $speech);
        }

        $asset->update(['status' => 'processing', 'failure_code' => null, 'failure_detail' => null]);

        if ($asset->kind === 'video') {
            TranscodeSpeechAsset::dispatch($asset->id)->afterCommit();
        } else {
            GenerateCaptions::dispatch($asset->id)->afterCommit();
        }

        return new JsonResponse(['asset' => new SpeechAssetResource($asset)]);
    }

    /**
     * §9.3's refresh-on-403 handler: a fresh 10-minute presigned GET,
     * called when the player's error path sees an expired URL.
     */
    public function playbackUrl(Request $request, Speech $speech, SpeechAsset $asset, MediaUrlSigner $signer): JsonResponse
    {
        $this->authorizeGrantingAccess($request, $speech);
        abort_unless($asset->speech_id === $speech->id && $asset->status === 'ready', Response::HTTP_NOT_FOUND);

        return new JsonResponse(['url' => $signer->presign($asset->path)]);
    }

    /**
     * §9.5's single frame-picking endpoint — serves both "use current
     * frame" (frontend sends the video's current playback time) and the
     * sprite-strip picker (frontend derives a timestamp from the clicked
     * cell) with one call. The chosen time is stored on the `video` asset
     * row, not a `poster` row: poster rows are disposable/regenerated by
     * GeneratePoster, but the video row is what remembers the speaker's
     * choice across regenerations.
     */
    public function setPosterFrame(SetPosterFrameRequest $request, Speech $speech, SpeechAsset $asset): JsonResponse
    {
        $this->authorizeOwner($request, $speech);
        abort_unless($asset->speech_id === $speech->id && $asset->kind === 'video' && $asset->status === 'ready', Response::HTTP_NOT_FOUND);

        $validated = $request->validated();

        $asset->update(['poster_time_seconds' => $validated['time_seconds']]);

        GeneratePoster::dispatch($asset->id, $validated['time_seconds']);

        return new JsonResponse(['asset' => new SpeechAssetResource($asset)]);
    }
}
