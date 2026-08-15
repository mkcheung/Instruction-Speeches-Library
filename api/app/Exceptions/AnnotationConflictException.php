<?php

namespace App\Exceptions;

use App\Http\Resources\AnnotationResource;
use App\Models\Annotation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * MODERNIZATION_PLAN §10.2: the optimistic-locking conflict on
 * `PATCH /speeches/{speech}/annotations/{annotation}` — 409 with the
 * *current* record in the body (saves a round trip) and a `conflictSource`.
 *
 * `conflictSource` is ALWAYS the literal string `"self"` here, and this is
 * deliberate, not a placeholder for future values: annotations are
 * single-writer-per-review (only that review's own reviewer can ever pass
 * `AnnotationPolicy::update`), so a `lock_version` mismatch can only ever
 * mean the same reviewer's other tab/session raced this request — never a
 * different person, unlike a hypothetical multi-writer resource. Do not
 * add other `conflictSource` values to this exception; if a genuinely
 * multi-writer conflict ever needs representing, it belongs on a different
 * resource's own exception, not grafted onto this one.
 */
class AnnotationConflictException extends RuntimeException
{
    public function __construct(private readonly Annotation $current)
    {
        parent::__construct('This annotation was changed elsewhere.');
    }

    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => $this->getMessage(),
            'conflictSource' => 'self',
            'current' => new AnnotationResource($this->current),
        ], Response::HTTP_CONFLICT);
    }
}
