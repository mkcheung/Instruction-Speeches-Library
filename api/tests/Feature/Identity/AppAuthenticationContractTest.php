<?php

use App\Models\User;
use Filament\Auth\MultiFactor\App\AppAuthentication;
use Filament\Auth\MultiFactor\App\Contracts\HasAppAuthentication;
use Filament\Auth\MultiFactor\App\Contracts\HasAppAuthenticationRecovery;
use Illuminate\Support\Facades\DB;
use PragmaRX\Google2FA\Google2FA;

/*
 * `AdminPanelProvider` declares `multiFactorAuthentication(...,
 * isRequired: true)`, which makes Filament's TOTP provider load-bearing
 * for every `/control-panel` login. It reaches the user model only
 * through these two interfaces, and `AppAuthentication::isEnabled()`
 * throws a LogicException the moment the model does not implement them —
 * so the panel was unreachable in practice even though its login page
 * rendered fine. These tests pin the contract that fixed it.
 */

it('implements the interfaces Filament reaches the user model through', function () {
    $user = User::factory()->create();

    expect($user)->toBeInstanceOf(HasAppAuthentication::class)
        ->and($user)->toBeInstanceOf(HasAppAuthenticationRecovery::class);
});

it('reports a user with no secret as not yet enrolled', function () {
    // `isEnabled()` is `filled($secret)` — this is the assertion that
    // used to throw rather than return false.
    expect(AppAuthentication::make()->isEnabled(User::factory()->create()))->toBeFalse();
});

it('round-trips a secret and verifies a code generated from it', function () {
    $user = User::factory()->create();
    $secret = app(Google2FA::class)->generateSecretKey();

    $user->saveAppAuthenticationSecret($secret);
    $user->refresh();

    expect($user->getAppAuthenticationSecret())->toBe($secret)
        ->and(AppAuthentication::make()->isEnabled($user))->toBeTrue()
        ->and(app(Google2FA::class)->verifyKey($secret, app(Google2FA::class)->getCurrentOtp($secret)))->toBeTrue()
        ->and(app(Google2FA::class)->verifyKey($secret, '000000'))->toBeFalse();
});

it('keeps two_factor_confirmed_at in step with the secret', function () {
    // Fortify's columns treat `confirmed_at` as the enrollment marker
    // while Filament treats "secret present" as enrollment. Writing both
    // together stops the column becoming state nobody maintains.
    $user = User::factory()->create();

    $user->saveAppAuthenticationSecret(app(Google2FA::class)->generateSecretKey());
    expect($user->fresh()->two_factor_confirmed_at)->not->toBeNull();

    $user->saveAppAuthenticationSecret(null);
    expect($user->fresh()->two_factor_confirmed_at)->toBeNull();
});

it('round-trips recovery codes as an array', function () {
    $user = User::factory()->create();
    $codes = AppAuthentication::make()->generateRecoveryCodes();

    $user->saveAppAuthenticationRecoveryCodes($codes);

    expect($user->fresh()->getAppAuthenticationRecoveryCodes())->toBe($codes);
});

it('encrypts both secrets at rest and hides them from serialization', function () {
    $user = User::factory()->create();
    $secret = app(Google2FA::class)->generateSecretKey();
    $user->saveAppAuthenticationSecret($secret);
    $user->saveAppAuthenticationRecoveryCodes(AppAuthentication::make()->generateRecoveryCodes());

    $raw = DB::table('users')->where('id', $user->id)->first();

    expect($raw->two_factor_secret)->not->toBe($secret)
        ->and(array_keys($user->fresh()->toArray()))
        ->not->toContain('two_factor_secret', 'two_factor_recovery_codes');
});

it('labels the authenticator entry with the user email', function () {
    $user = User::factory()->create(['email' => 'admin@example.test']);

    expect($user->getAppAuthenticationHolderName())->toBe('admin@example.test');
});
