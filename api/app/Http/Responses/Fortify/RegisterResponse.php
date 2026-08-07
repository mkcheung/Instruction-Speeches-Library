<?php

namespace App\Http\Responses\Fortify;

use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Laravel\Fortify\Contracts\RegisterResponse as RegisterResponseContract;

class RegisterResponse implements RegisterResponseContract
{
    public function toResponse($request): JsonResponse
    {
        return new JsonResponse([
            'user' => new UserResource($request->user()),
        ], 201);
    }
}
