<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-12-FROZEN-CONTRACT.md §3 / §7.4. Thrown by
 * App\Services\RoleAssignmentService::revoke(),
 * App\Services\UserDeletionService, and
 * App\Services\Privacy\AccountErasureService when a removal (demotion,
 * suspension, soft-delete, or erasure) would leave fewer than one active
 * admin/super_admin standing.
 *
 * `render()` follows the same pattern every other domain exception in
 * this directory uses (`SelfReviewNotPermittedException` et al.) — this
 * class's own original docblock claimed it was "caught at the HTTP
 * boundary and translated into a 409... never allowed to surface as a raw
 * 500," but until `/code-review` flagged the gap, no `render()` existed
 * and no global handler mapped it, so any caller that reaches this
 * exception without its own try/catch (every current caller happens to
 * have one; a future one might not) would have surfaced a raw 500.
 */
class LastAdministratorException extends RuntimeException
{
    public function __construct(string $message = 'This action would leave the system with no administrator.')
    {
        parent::__construct($message);
    }

    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => $this->getMessage(),
        ], Response::HTTP_CONFLICT);
    }
}
