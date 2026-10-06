<?php

namespace App\Http\Controllers\Api;

use RuntimeException;

/**
 * STEP-14-deploy-hardening.md's demo script, step 4: "Deliberately throw an
 * exception. It appears in GlitchTip — with a correlation ID that also
 * appears in the JSON log."
 *
 * Same double-guard shape as PresignController (`config('app.enable_spikes')`)
 * — this controller 404s unless the app is running in local/staging AND the
 * `enable_debug_throw` opt-in is on, checked here at request time (not at
 * route-registration time) so a test can flip it per-case with
 * `Config::set`. Failing either half means this route behaves as if it does
 * not exist at all, never merely forbidden — the whole point being that it
 * cannot be hit in a real production environment "accidentally-on-purpose".
 *
 * Deliberately throws and does NOT catch: the exception must reach
 * bootstrap/app.php's exception handler so the Sentry Laravel SDK's
 * automatic unhandled-exception capture reports it to GlitchTip, carrying
 * whatever correlation id App\Http\Middleware\AssignCorrelationId attached
 * to this request's Sentry scope and Log context.
 */
class DebugThrowController
{
    public function __invoke(): never
    {
        abort_unless(
            app()->environment(['local', 'staging']) && config('app.enable_debug_throw'),
            404,
        );

        throw new RuntimeException('STEP-14 debug-throw route: deliberate, unhandled exception for GlitchTip/correlation-id verification.');
    }
}
