<?php

use App\Http\Middleware\AssignCorrelationId;
use App\Http\Middleware\CheckUserIsActive;
use App\Http\Middleware\EnsureApiEmailIsVerified;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Sentry\Laravel\Integration;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function (): void {
            // PLAN-ADMIN-DASHBOARD.md §5.1: the page CheckUserIsActive
            // redirects an inactive user to. Registered here, beside the
            // middleware registration itself, because the route and the
            // middleware are a single mechanism: the route MUST appear in
            // `CheckUserIsActive::EXEMPT_ROUTE_NAMES` or the redirect
            // loops, and keeping the two more than one screen apart is
            // exactly how that invariant gets broken by a later edit.
            //
            // `Route::view()` rather than a closure so the route stays
            // serializable for `route:cache`. It carries the `web` group
            // for ordinary cookie/session handling even though the view
            // itself needs neither — by the time it renders, the visitor's
            // session has already been invalidated, so the page offers a
            // link to log in again rather than a CSRF-bearing logout form.
            Route::view('/suspended', 'auth.suspended')
                ->middleware('web')
                ->name('suspension.notice');
        },
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

        // PLAN-ADMIN-DASHBOARD.md §1.1/§5.1 — `users.suspended_at` /
        // `deleted_at` / `anonymized_at` were written and read by nothing
        // for access control. See CheckUserIsActive's docblock.
        //
        // ⚠️ `append()` (global) would be WRONG here, and wrong in a way
        // that passes review: global middleware runs BEFORE StartSession,
        // so `$request->user()` resolves through SessionGuard with no
        // session, returns null, and the middleware waves every single
        // request through. AssignCorrelationId above is appended globally
        // and is correct precisely because it needs no authenticated user.
        //
        // Appended to the `api` group, so it lands AFTER statefulApi()'s
        // EnsureFrontendRequestsAreStateful. That middleware runs the rest
        // of the group inside a nested pipeline containing the cookie and
        // session middleware, so appending (not prepending) is what puts
        // this check downstream of a started session for SPA requests —
        // while still catching bearer-token requests, which never get that
        // nested pipeline at all.
        $middleware->api(append: [CheckUserIsActive::class]);

        // The `web` group covers Fortify's root-mounted auth routes
        // (config/fortify.php `prefix` => ''), `/application-documents/*`,
        // and Livewire's own `/livewire/update` endpoint — which is where
        // every Filament panel interaction after the initial page load
        // actually goes, since Livewire registers that route against this
        // group rather than the panel's middleware stack.
        $middleware->web(append: [CheckUserIsActive::class]);
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
