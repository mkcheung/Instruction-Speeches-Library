<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class AnnotationOverlapException extends RuntimeException
{
    /** @param array<int, array{id: string, timing_type: string|null, start_seconds: float, end_seconds: float|null}> $conflicts */
    public function __construct(private readonly array $conflicts)
    {
        parent::__construct('This position overlaps feedback in your review. Choose a free segment or voice position.');
    }

    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'code' => 'annotation_overlap',
            'message' => $this->getMessage(),
            'errors' => ['start_seconds' => [$this->getMessage()]],
            'conflicts' => $this->conflicts,
        ], 422);
    }
}
