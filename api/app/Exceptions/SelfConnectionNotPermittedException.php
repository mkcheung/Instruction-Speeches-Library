<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-13-FROZEN-CONTRACT.md §3 / MODERNIZATION_PLAN §6.7.2's
 * `ck_connections_no_self` CHECK constraint, mirrored at the service layer
 * — same shape as SelfReviewNotPermittedException: thrown from
 * App\Services\ConnectionService, never merely relied on as a DB-constraint
 * violation, so the caller gets a clean 422 rather than a raw SQL exception.
 */
class SelfConnectionNotPermittedException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => $this->getMessage(),
        ], Response::HTTP_UNPROCESSABLE_ENTITY);
    }
}
