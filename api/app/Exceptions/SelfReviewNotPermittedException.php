<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * MODERNIZATION_PLAN §6.3/§7.4: thrown from App\Services\ReviewService,
 * never checked-for in a controller — §7.4 is explicit that policies are
 * advisory and the service is the real enforcement point, so this
 * exception's existence (and this file's own unit test calling the service
 * directly) is itself the acceptance criterion, not just plumbing.
 */
class SelfReviewNotPermittedException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => $this->getMessage(),
        ], Response::HTTP_UNPROCESSABLE_ENTITY);
    }
}
