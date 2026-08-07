<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// A named `login` route must exist even though this API is headless and
// ships no login view (config/fortify.php `views` => false, so Fortify does
// NOT register one under this name). Fortify's `email/verify/{id}/{hash}`
// route carries `auth` middleware, and Laravel's `Authenticate` middleware
// calls `redirect()->guest(route('login'))` when the visitor isn't logged
// in — exactly the "click the verification link on a different device"
// case (STEP-01-identity.md). Without this route, that redirect throws
// UrlGenerationException and the request 500s instead of bouncing the
// visitor to the SPA's login page.
Route::get('/login', function () {
    return redirect(rtrim((string) config('app.frontend_url'), '/').'/login');
})->name('login');
