<?php

namespace App\Http\Responses\Fortify;

use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;

/**
 * Headless Fortify ships no response contracts of its own by default — this
 * package (and every class in this namespace) is what STEP-01-identity.md
 * means by "every JSON response contract hand-bound." Bound in
 * FortifyServiceProvider.
 */
class LoginResponse implements LoginResponseContract
{
    public function toResponse($request): JsonResponse
    {
        return new JsonResponse([
            'user' => new UserResource($request->user()),
        ]);
    }
}
