<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-07-write-commentary.md / MODERNIZATION_PLAN §10.1: "the policy
 * resolves the speech without trashed and denies with 410 Gone (distinct
 * from 404, so the client can say something true)". Thrown only when the
 * speech WAS found via `Speech::withTrashed()` but `->trashed()` is true —
 * a truly nonexistent id still falls through to the normal
 * ModelNotFoundException -> 404 flow unchanged, because "never existed"
 * and "existed, then got deleted mid-annotation" are different facts and
 * the client shows different UI for each ("your draft is preserved below"
 * only makes sense for the latter).
 */
class SpeechDeletedException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => 'This speech has been deleted.',
        ], Response::HTTP_GONE);
    }
}
