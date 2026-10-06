<?php

use App\Http\Middleware\AssignCorrelationId;
use App\Http\Middleware\EnsureApiEmailIsVerified;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Sentry\Laravel\Integration;

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
        $middleware->alias(['verified.api' => EnsureApiEmailIsVerified::class]);

        // STEP-14-deploy-hardening.md / §14: global, not just the `api`
        // group — `/up` (health) and any `web`-group route (Fortify's
        // root-mounted auth routes, Horizon's own dashboard) should carry a
        // correlation id in their logs and Sentry events too.
        $middleware->append(AssignCorrelationId::class);
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

        // STEP-14-deploy-hardening.md, found only by actually driving the
        // demo script end to end (a deliberately-thrown exception reaching
        // GlitchTip), not by reading config/sentry.php or composer.json in
        // isolation: adding `sentry/sentry-laravel` and setting
        // SENTRY_LARAVEL_DSN is NOT sufficient on Laravel 11+'s
        // `bootstrap/app.php`-based exception handling — the SDK's
        // automatic "report every unhandled exception" behavior is an
        // explicit opt-in hook, not something that registers itself just
        // because the package is installed (sentry-laravel's own README,
        // "Capturing unhandled exceptions"). Without this line, every
        // exception still renders and still logs (JSON, with its
        // correlation id — AssignCorrelationId middleware is independent of
        // this), but NONE of them ever reach GlitchTip, regardless of a
        // correctly-configured DSN. Confirmed by a real end-to-end test:
        // DebugThrowController was already live and correctly double-guarded,
        // and reported a 0-event count in GlitchTip until this line was added.
        Integration::handles($exceptions);
    })->create();
