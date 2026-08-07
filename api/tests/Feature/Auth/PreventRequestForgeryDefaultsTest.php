<?php

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;

/**
 * §5.9 trap #2: originOnly: true stops the XSRF-TOKEN cookie being issued
 * at all (breaks the SPA); allowSameSite: true lets any subdomain post
 * without a CSRF token. Both must stay at their `false` defaults —
 * asserted here rather than just "left alone in config," since nothing
 * calls PreventRequestForgery::useOriginOnly()/allowSameSite() anywhere in
 * this app is exactly the thing worth pinning down.
 */
it('keeps PreventRequestForgery originOnly and allowSameSite at their false defaults', function () {
    PreventRequestForgery::flushState();

    $reflection = new ReflectionClass(PreventRequestForgery::class);

    $originOnly = $reflection->getProperty('originOnly');
    $originOnly->setAccessible(true);

    $allowSameSite = $reflection->getProperty('allowSameSite');
    $allowSameSite->setAccessible(true);

    expect($originOnly->getValue())->toBeFalse();
    expect($allowSameSite->getValue())->toBeFalse();
});

it('points config/sanctum.php at the real class, not the deprecated ValidateCsrfToken alias', function () {
    expect(config('sanctum.middleware.validate_csrf_token'))->toBe(PreventRequestForgery::class);
});
