<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * MODERNIZATION_PLAN §10.4: "Bound it instead (~32 for an 8-minute speech;
 * reject >200 per set at write time)". Rendered as 422 Unprocessable
 * Entity — a deliberate choice over 409 Conflict, made because this is a
 * well-formed request refused on a business rule about the resource's
 * current state, the same shape of failure SelfReviewNotPermittedException
 * already renders as 422 elsewhere in this codebase, and because 409 in
 * this API is reserved for the optimistic-lock case
 * (AnnotationConflictException) — reusing it here would make a client's
 * "409 means retry with the current lock_version" handling ambiguous.
 */
class AnnotationCapExceededException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => 'This review already has the maximum of 200 annotations.',
        ], Response::HTTP_UNPROCESSABLE_ENTITY);
    }
}
