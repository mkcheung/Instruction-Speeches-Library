<?php

namespace App\Http\Responses\Fortify;

use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse as FailedPasswordResetLinkRequestResponseContract;

class FailedPasswordResetLinkRequestResponse implements FailedPasswordResetLinkRequestResponseContract
{
    public function __construct(protected string $status) {}

    /**
     * @throws ValidationException
     */
    public function toResponse($request): never
    {
        // Keeps this on the standard {"message":..., "errors": {...}} 422
        // shape every other endpoint uses (STEP-01's 422 contract).
        throw ValidationException::withMessages([
            'email' => [trans($this->status)],
        ]);
    }
}
