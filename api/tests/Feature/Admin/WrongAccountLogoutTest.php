<?php

use App\Filament\Auth\MfaChallenge;
use App\Models\User;
use App\Support\FilamentMfaStamp;
use App\Support\FrontendUrl;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Facades\Filament;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;

/**
 * Exercise the real web middleware token check while retaining isolated test
 * database/session configuration. Laravel otherwise bypasses CSRF in tests.
 */
class WrongAccountEnforcedCsrf extends PreventRequestForgery
{
    protected function runningUnitTests()
    {
        return false;
    }
}

beforeEach(function () {
    $this->seed(RoleSeeder::class);
    $this->app->bind(PreventRequestForgery::class, WrongAccountEnforcedCsrf::class);
});

it('lets a denied reviewer post the actual sign-out form and log in as an admin', function (string $role) {
    $reviewer = User::factory()->create();
    $reviewer->assignRole($role);
    $admin = User::factory()->create([
        'password' => bcrypt('admin-password'),
        'two_factor_secret' => 'E2EADMINE2EADMIN',
        'two_factor_confirmed_at' => now(),
    ]);
    $admin->assignRole(Role::ADMIN);

    $denied = $this->actingAs($reviewer)->withSession([
        'private_state' => 'reviewer-only state',
        FilamentMfaStamp::SESSION_KEY => ['user' => $reviewer->id, 'at' => now()->toIso8601String()],
    ])->get('/control-panel');
    $denied->assertForbidden()->assertSee('Sign out');

    $document = new DOMDocument;
    @$document->loadHTML($denied->getContent());
    $xpath = new DOMXPath($document);
    $form = $xpath->query('//form[button[normalize-space(.)="Sign out"]]')->item(0);
    expect($form)->not->toBeNull();
    expect(strtoupper($form->getAttribute('method')))->toBe('POST')
        ->and($form->getAttribute('action'))->toBe(route('logout'));
    $token = $xpath->query('.//input[@name="_token"]', $form)->item(0)->getAttribute('value');
    expect($token)->toBe(session()->token());
    $oldSessionId = session()->getId();

    $logout = $this->post($form->getAttribute('action'), ['_token' => $token]);
    $logout->assertStatus(302)->assertRedirect(FrontendUrl::to('/login'));
    $logout->assertSessionMissing('private_state');
    $logout->assertSessionMissing(FilamentMfaStamp::SESSION_KEY);
    $this->assertGuest('web');
    expect(session()->getId())->not->toBe($oldSessionId)
        ->and(session()->token())->not->toBe($token);

    // This is the endpoint used by the shared React login form. A new password
    // login must work after account switching and must not inherit MFA proof.
    $this->postJson('/login', [
        '_token' => session()->token(),
        'email' => $admin->email,
        'password' => 'admin-password',
    ])->assertOk()->assertSessionMissing(FilamentMfaStamp::SESSION_KEY);
    $this->assertAuthenticatedAs($admin, 'web');
    $this->get('/control-panel')
        ->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
})->with([Role::MEMBER, Role::COACH]);

it('rejects a logout form without a valid CSRF token and keeps the user signed in', function (?string $token) {
    $user = User::factory()->create();
    $this->actingAs($user)->get('/');

    $this->post('/logout', $token === null ? [] : ['_token' => $token])->assertStatus(419);

    $this->assertAuthenticatedAs($user, 'web');
})->with([null, 'incorrect-token']);

it('requires a valid CSRF token for the shared credential endpoint', function () {
    $user = User::factory()->create(['password' => bcrypt('correct-password')]);
    $this->get('/');
    $credentials = ['email' => $user->email, 'password' => 'correct-password'];

    $this->postJson('/login', $credentials)->assertStatus(419);
    $this->assertGuest('web');

    $this->postJson('/login', $credentials + ['_token' => session()->token()])->assertOk();
    $this->assertAuthenticatedAs($user, 'web');
});
