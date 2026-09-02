<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-13-FROZEN-CONTRACT.md §8 (R17): "the `blocked` check in the
 * request-creation path, not the read path." Thrown from
 * App\Services\ConnectionService::request when the pair's mirrored row is
 * already `blocked` — the raw `INSERT ... ON CONFLICT DO UPDATE` upsert
 * itself is written so it can never transition a `blocked` row out of that
 * state (see the service's own docblock), so this is the read-back check
 * that turns "the write silently no-opped" into a clean 403 for the caller.
 */
class ConnectionBlockedException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => $this->getMessage(),
        ], Response::HTTP_FORBIDDEN);
    }
}
