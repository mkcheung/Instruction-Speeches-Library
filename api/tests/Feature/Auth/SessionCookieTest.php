<?php

/**
 * §5.9 trap #3: Laravel 13 changed the generated default session cookie
 * name (app_name_session -> app-name-session). Relying on the default
 * means a framework upgrade silently logs out every user by changing the
 * cookie name Laravel looks for. api/.env(.example) pins SESSION_COOKIE
 * explicitly — this asserts the pin is actually in effect, not just
 * present as an unused line in a file nothing reads.
 */
it('has an explicitly pinned SESSION_COOKIE, not the framework-derived default', function () {
    expect(config('session.cookie'))->toBe('speechcoach_session');
});
