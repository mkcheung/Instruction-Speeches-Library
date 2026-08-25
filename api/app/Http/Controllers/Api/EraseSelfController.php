<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\EraseSelfAccount;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EraseSelfController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        EraseSelfAccount::dispatch($request->user()->id)->afterCommit();

        return new JsonResponse(['message' => 'Account erasure queued.'], Response::HTTP_ACCEPTED);
    }
}
