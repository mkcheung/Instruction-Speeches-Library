<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class AnnotationBusyException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'code' => 'annotation_busy',
            'message' => 'Feedback is being updated in another session. Your draft is safe; retry this submission.',
        ], 503, ['Retry-After' => '1']);
    }
}
