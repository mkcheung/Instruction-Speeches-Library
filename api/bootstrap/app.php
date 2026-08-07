<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Sanctum SPA mode (§5.9): prepends EnsureFrontendRequestsAreStateful
        // to the `api` group so a request from an allowed stateful domain
        // (config/sanctum.php) authenticates via the session cookie rather
        // than falling through to bearer-token auth.
        $middleware->statefulApi();
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Deliberately `wantsJson()` alone, NOT a blanket `is('api/*')`.
        // S0 shipped the blanket form, which scoped JSON error rendering to
        // `/api/*` only — silently wrong for S1, since Fortify's routes
        // (register, login, logout, forgot-password, reset-password, email
        // verification) are root-mounted to match the frontend
        // (web/src/lib/api.ts), not under `/api`. A validation failure on
        // `/register` fell through to a session-based redirect instead of
        // the 422 `{"message":...,"errors":{...}}` contract, found only by
        // actually curling the endpoint rather than reading either config
        // in isolation. `wantsJson()` is correct regardless of path: the
        // SPA's fetch calls always send `Accept: application/json` and get
        // the 422/401 JSON contract, while a bare browser navigation (e.g.
        // the emailed verification link, no such header) gets Laravel's
        // normal redirect/HTML handling — which is exactly what the
        // cross-device verification test needs (a 302 to `login`, not a
        // JSON 401).
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->wantsJson(),
        );
    })->create();
