<?php

namespace App\Http\Responses\Fortify;

use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\FailedPasswordResetResponse as FailedPasswordResetResponseContract;

class FailedPasswordResetResponse implements FailedPasswordResetResponseContract
{
    public function __construct(protected string $status) {}

    /**
     * @throws ValidationException
     */
    public function toResponse($request): never
    {
        throw ValidationException::withMessages([
            'email' => [trans($this->status)],
        ]);
    }
}
