<?php

namespace App\Http\Responses\Fortify;

use Illuminate\Http\JsonResponse;
use Laravel\Fortify\Contracts\PasswordResetResponse as PasswordResetResponseContract;

class PasswordResetResponse implements PasswordResetResponseContract
{
    public function __construct(protected string $status) {}

    public function toResponse($request): JsonResponse
    {
        // Sanctum's AuthenticateSession hashes the password into the
        // session (§5.9) — a reset here invalidates every other device's
        // session for free, nothing to do in this class for that.
        return new JsonResponse(['message' => trans($this->status)], 200);
    }
}
