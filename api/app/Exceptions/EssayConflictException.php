<?php

namespace App\Exceptions;

use App\Http\Resources\EssayResource;
use App\Models\Review;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * The frozen STEP-08 backend contract: the optimistic-locking conflict on
 * `PUT /speeches/{speech}/essay` — 409 with the *current* record in the
 * body (saves a round trip) and a `conflictSource`, copied exactly from
 * `AnnotationConflictException`.
 *
 * `conflictSource` is ALWAYS the literal string `"self"` here, for the same
 * reason it is on the annotation exception: an essay is single-writer-per-
 * review by construction (only that review's own reviewer can ever pass
 * `essay.update`), so an `essay_lock_version` mismatch can only ever mean
 * the same reviewer's other tab/session raced this request — never a
 * different person. Do not add other `conflictSource` values to this
 * exception; if a genuinely multi-writer conflict ever needs representing,
 * it belongs on a different resource's own exception, not grafted onto
 * this one.
 */
class EssayConflictException extends RuntimeException
{
    public function __construct(private readonly Review $current)
    {
        parent::__construct('This essay was changed elsewhere.');
    }

    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => $this->getMessage(),
            'conflictSource' => 'self',
            'current' => new EssayResource($this->current),
        ], Response::HTTP_CONFLICT);
    }
}
