<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Privacy\AccountErasureService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `DELETE /api/account` — STEP-11-FROZEN-CONTRACT.md §8: self-scoped,
 * always `$request->user()`, no ownership ambiguity, no Policy needed.
 * There is deliberately NO admin-erasing-someone-else path this step —
 * `user.erase` stays reserved-but-undefined in AppServiceProvider's
 * `$mustFallThrough` (STEP-12's concern).
 *
 * The erasure runs synchronously in this request (step 1 of the ordered
 * plan revokes every session row, including the one authenticating this
 * very request) — the response is built from the `User` instance already
 * held in memory, not re-read from the DB after the row is anonymized, so
 * a mid-request session/cookie invalidation cannot turn a successful
 * erasure into a failed response.
 */
class AccountController extends Controller
{
    /**
     * STEP-12-FROZEN-CONTRACT.md §4: `account.eraseSelf` extends this
     * previously-unconditional erasure with the "unless last admin"
     * clause — an admin who is the last one standing 403s here instead of
     * erasing themselves out of the system.
     */
    public function destroy(Request $request, AccountErasureService $service): JsonResponse
    {
        $user = $request->user();
        $this->authorize('account.eraseSelf');
        $service->execute($user);

        return new JsonResponse(['message' => 'Your account has been erased.'], 200);
    }
}
