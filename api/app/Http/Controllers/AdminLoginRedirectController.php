<?php

namespace App\Http\Controllers;

use App\Support\AdminLoginDestination;
use App\Support\FrontendUrl;
use App\Support\Role;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/** Compatibility entry point only: credentials and MFA stay in their existing flows. */
final class AdminLoginRedirectController
{
    public function __invoke(Request $request, AdminLoginDestination $destination): RedirectResponse
    {
        $user = $request->user('web');
        if ($user === null) {
            return $this->redirect(FrontendUrl::to('/login'));
        }

        abort_unless($user->hasAnyRole(Role::ADMIN_TIER), 403);

        return $this->redirect($destination->resolve($request->session()->pull('url.intended')));
    }

    private function redirect(string $url): RedirectResponse
    {
        return redirect()->away($url, 302, ['Cache-Control' => 'private, no-store']);
    }
}
