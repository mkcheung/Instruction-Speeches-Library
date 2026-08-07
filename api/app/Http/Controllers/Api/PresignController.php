<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MediaUrlSigner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The spike-wall presigning route (STEP-00-foundation.md / MODERNIZATION_PLAN
 * §12 S0): "a presigning route bound to Storage::temporaryUrlUsing() from the
 * first commit" — proves the S3-compatible-Range design (§9.3) end to end
 * before anything else is built on it.
 *
 * S0 deliberately has no auth ("no auth, no users" — STEP-00's "Deliberately
 * stubbed" section), so this is intentionally open. It must not survive past
 * S0 unauthenticated once real media/ownership checks exist.
 */
class PresignController extends Controller
{
    public function __invoke(Request $request, MediaUrlSigner $signer): JsonResponse
    {
        $validated = $request->validate([
            'path' => ['required', 'string'],
        ]);

        return response()->json([
            'url' => $signer->presign($validated['path']),
        ]);
    }
}
