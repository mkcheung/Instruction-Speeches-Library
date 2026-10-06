<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Http\Request;

abstract class Controller
{
    // STEP-05: first Policy-backed controllers in this codebase (see
    // App\Policies\ReviewPolicy/SpeechPolicy) — pulled onto the base
    // controller rather than per-controller so `$this->authorize()` works
    // uniformly everywhere from here on.
    use AuthorizesRequests;

    // STEP-14-deploy-hardening.md: phpstan level 8 pass. `$request->user()`
    // is typed `?Authenticatable` by the framework — correctly, since
    // nothing about the type system knows a route is behind `auth`/
    // `auth:sanctum`/`verified.api` middleware. Every API controller here
    // IS behind one of those, so the null branch is genuinely unreachable
    // at runtime; this helper makes that a real, PHPStan-visible guard
    // (`abort_if` is a registered type-narrowing extension in Larastan,
    // same as a hand-written `if ($user === null) { abort(401); }`) rather
    // than a cast or `@var` override. The 401 is defense-in-depth, not a
    // behavior change: a request that reaches here without a user would
    // previously have fatally errored on the first property/method access
    // the controller made against the null value.
    protected function currentUser(Request $request): User
    {
        $user = $request->user();
        abort_if($user === null, 401);

        return $user;
    }
}
