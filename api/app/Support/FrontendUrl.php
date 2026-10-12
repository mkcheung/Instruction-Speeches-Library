<?php

namespace App\Support;

/**
 * Laravel's global `url()` helper resolves against `config('app.url')`,
 * which in this app's `.env` is the API's OWN origin
 * (`https://api.speechcoach.test`), not the SPA's. Every notification mail
 * that built an `->action()` link (or a `database` payload's `url`) with
 * bare `url(...)` was therefore pointing a speaker/reviewer at the API, not
 * at the React app they actually use — a dead/wrong-host link in every
 * email.
 *
 * `routes/web.php:20`'s `login` route already builds the correct link —
 * `rtrim((string) config('app.frontend_url'), '/').'/login'` — this class
 * is that exact idiom, generalized to any path, so every notification
 * class can share one call site instead of re-deriving it.
 */
final class FrontendUrl
{
    public static function to(string $path): string
    {
        return rtrim((string) config('app.frontend_url'), '/').'/'.ltrim($path, '/');
    }

    private function __construct() {}
}
