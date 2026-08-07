<?php

namespace App\Http\Responses\Fortify;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Laravel\Fortify\Contracts\VerifyEmailResponse as VerifyEmailResponseContract;

/**
 * This is the response for GET /email/verify/{id}/{hash}, which the `auth`
 * middleware guards. Reaching this class at all means the request WAS
 * authenticated — the cross-device 500 the plan warns about happens earlier,
 * in the `auth` middleware's redirect to the `login` named route (see
 * routes/web.php). This class only needs to answer sanely once auth passes.
 */
class VerifyEmailResponse implements VerifyEmailResponseContract
{
    public function toResponse($request): JsonResponse|RedirectResponse
    {
        if ($request->wantsJson()) {
            return new JsonResponse(['message' => 'Email verified.'], 200);
        }

        return redirect(rtrim(config('app.frontend_url'), '/').'/login?verified=1');
    }
}
