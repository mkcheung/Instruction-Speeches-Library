<?php

use App\Models\User;
use Illuminate\Support\Facades\URL;

/**
 * STEP-01-identity.md's headline acceptance test: "register on desktop,
 * open the verification link on a phone" must not 500. Fortify's
 * `email/verify/{id}/{hash}` route carries `auth` middleware — hit
 * unauthenticated (a fresh test instance/client, simulating a different
 * device with no session at all), the `Authenticate` middleware tries to
 * `redirect()->guest(route('login'))`, which throws
 * UrlGenerationException -> 500 unless a `login` named route exists
 * (routes/web.php). This test does NOT log in before hitting the link.
 */
it('redirects rather than 500s when the verification link is opened on a different, unauthenticated device', function () {
    $user = User::factory()->unverified()->create();

    $verificationUrl = URL::temporarySignedRoute(
        'verification.verify',
        now()->addMinutes(60),
        ['id' => $user->id, 'hash' => sha1($user->email)]
    );

    // Deliberately no ->actingAs() / login of any kind — this is the "open
    // it on a different device" scenario.
    $response = $this->get($verificationUrl);

    $response->assertStatus(302);
    $response->assertRedirect(route('login'));
});

it('has a named "login" route', function () {
    expect(route('login'))->toContain('/login');
});
