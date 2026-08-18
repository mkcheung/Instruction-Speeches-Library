<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * captions-settings gap fix (post-STEP-09 code review): the state table's
 * "Any disabled state | Retry automatic generation | 409 captions_disabled;
 * retry must never silently enable automation" row.
 * App\Services\Captions\EnsureCaptionJob::retryAutomatic() throws this
 * instead of dispatching a job when `captions_enabled` is false — a caption
 * retry is a "run automation again" request, not an "also turn automation
 * back on" request, so it must fail loudly rather than flip the flag as a
 * side effect.
 *
 * Same `render()`-on-the-exception shape as SpeechDeletedException (410
 * Gone) — Laravel calls an exception's own `render()` automatically,
 * needing no entry in bootstrap/app.php's `withExceptions()`. `code` is a
 * stable machine-readable string (matching `speech_assets.failure_code`'s
 * convention), not just a human sentence, so the frontend can branch on it
 * without string-matching `message`.
 */
class CaptionsDisabledException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => 'Captions are turned off for this speech. Turn them on to retry automatic generation.',
            'code' => 'captions_disabled',
        ], Response::HTTP_CONFLICT);
    }
}
