<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Sentry\State\Scope;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-14-deploy-hardening.md / MODERNIZATION_PLAN.md §14: "structured JSON
 * logs with correlation IDs." Nothing in this codebase generated or logged
 * one before this middleware (confirmed: `grep -rln "correlation" app
 * config/logging.php` returned nothing).
 *
 * Reuses an inbound `X-Correlation-Id` if a caller (an upstream proxy, or a
 * test) already set one — otherwise mints a ULID, matching the convention
 * this codebase already uses for public identifiers elsewhere (e.g.
 * Speech::$ulid). A ULID rather than a UUID because it is lexicographically
 * sortable by creation time, which is a genuine convenience when grepping a
 * JSON log file for a specific request.
 *
 * The id is threaded into THREE places, per the acceptance criterion ("a
 * deliberately-thrown exception appears in GlitchTip with a correlation ID
 * that also appears in the JSON log"):
 *   1. `Log::withContext()` — merged into every subsequent log record made
 *      during this request, on every channel (not just one), for the
 *      lifetime of the request.
 *   2. `Sentry\configureScope()` — tagged onto the Sentry/GlitchTip scope,
 *      so any exception captured during this request (including the
 *      automatic unhandled-exception capture the Sentry Laravel SDK installs
 *      on the exception handler) carries the same id as a *searchable tag*,
 *      not just a buried extra field. `Sentry\configureScope` is the actual
 *      top-level function the installed sentry/sentry SDK exports
 *      (vendor/sentry/sentry/src/functions.php) — there is no facade for it.
 *      Guarded behind `app()->bound('sentry')` so this middleware is a
 *      no-op (not a fatal error) when SENTRY_LARAVEL_DSN is unset and the
 *      SDK never registers its container binding.
 *   3. The response header — so a client (or a human) can hand the id back
 *      for support/debugging without reading server logs at all.
 */
class AssignCorrelationId
{
    public const HEADER = 'X-Correlation-Id';

    public function handle(Request $request, Closure $next): Response
    {
        $correlationId = $request->header(self::HEADER) ?: (string) Str::ulid();

        app()->instance('correlation_id', $correlationId);

        Log::withContext(['correlation_id' => $correlationId]);

        if (app()->bound('sentry')) {
            \Sentry\configureScope(function (Scope $scope) use ($correlationId): void {
                $scope->setTag('correlation_id', $correlationId);
            });
        }

        /** @var Response $response */
        $response = $next($request);

        $response->headers->set(self::HEADER, $correlationId);

        return $response;
    }
}
