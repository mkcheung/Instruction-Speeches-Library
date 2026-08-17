<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Review;
use App\Models\Speech;
use App\Services\MediaUrlSigner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The spike-wall presigning route (STEP-00-foundation.md / MODERNIZATION_PLAN
 * §12 S0): "a presigning route bound to Storage::temporaryUrlUsing() from the
 * first commit" — proves the S3-compatible-Range design (§9.3) end to end
 * before anything else is built on it.
 *
 * P0 fix (PLAN-APP-HEADER.md): this used to have no auth and no path
 * restriction — a signing oracle for any object on the bucket, reachable by
 * anyone. The route now requires `auth:sanctum`, this controller 404s
 * unless the app is running in local/testing AND the `enable_spikes` opt-in
 * is on (mirroring the frontend's double guard, web/src/lib/spikes-guard.ts,
 * checked here rather than at route-registration time so a test can flip it
 * per-case with `Config::set`), and `pathIsAccessibleTo` below is the
 * ownership-scoped allow-list the plan named as the other required half of
 * the fix — an authenticated session alone was still enough to presign
 * *any* path on the bucket without it.
 */
class PresignController extends Controller
{
    public function __invoke(Request $request, MediaUrlSigner $signer): JsonResponse
    {
        abort_unless(
            app()->environment(['local', 'testing']) && config('app.enable_spikes'),
            404,
        );

        $validated = $request->validate([
            'path' => ['required', 'string'],
        ]);

        abort_unless(
            $this->pathIsAccessibleTo($request, $validated['path']),
            Response::HTTP_FORBIDDEN,
        );

        return new JsonResponse([
            'url' => $signer->presign($validated['path']),
        ]);
    }

    /**
     * Recognizes only the two deterministic shapes the app itself ever
     * produces (`AvatarProcessor::process`, `FfmpegTranscoder`/
     * `SpeechUploadController::store`) and denies everything else outright
     * — an unrecognized path has no owner to check against, so there is no
     * safe default but "no." For `speeches/{ulid}/...`, mirrors
     * `SpeechUploadController::authorizeGrantingAccess` exactly: the
     * speaker, or a reviewer whose invitation is currently
     * access-granting — never a wider "any authenticated user" check.
     */
    private function pathIsAccessibleTo(Request $request, string $path): bool
    {
        $user = $request->user();

        if (preg_match('#^avatars/(\d+)/#', $path, $matches) === 1) {
            return (int) $matches[1] === $user->id;
        }

        if (preg_match('#^speeches/([^/]+)/#', $path, $matches) === 1) {
            $speech = Speech::query()->where('ulid', $matches[1])->first();
            if (! $speech) {
                return false;
            }

            if ($speech->user_id === $user->id) {
                return true;
            }

            return Review::query()
                ->where('speech_id', $speech->id)
                ->where('reviewer_id', $user->id)
                ->whereIn('status', Review::ACCESS_GRANTING)
                ->whereNull('revoked_at')
                ->exists();
        }

        return false;
    }
}
