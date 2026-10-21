<?php

use App\Filament\Auth\MfaChallenge;
use App\Http\Controllers\AdminLoginRedirectController;
use App\Models\User;
use App\Support\FilamentMfaStamp;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Actions\Testing\TestAction;
use Filament\Auth\MultiFactor\Pages\SetUpRequiredMultiFactorAuthentication;
use Filament\Facades\Filament;
use Filament\Tables\Table;
use Livewire\Livewire;
use Livewire\Mechanisms\ComponentRegistry;
use PragmaRX\Google2FA\Google2FA;

beforeEach(function () {
    $this->seed(RoleSeeder::class);
    config(['app.url' => 'https://api.speechcoach.test', 'app.frontend_url' => 'https://app.speechcoach.test']);
    // Host PHP lacks ext-intl; avoid number formatting in table-only UI controls.
    Table::configureUsing(fn (Table $table) => $table->paginated(false)->selectable(false));
});

function continuationAdmin(string $role = Role::ADMIN): array
{
    $user = User::factory()->create(['two_factor_secret' => null]);
    $user->assignRole($role);
    $secret = app(Google2FA::class)->generateSecretKey();
    $user->saveAppAuthenticationSecret($secret);

    return [$user, $secret];
}

it('retains the named Filament login route as a controller and no credential component', function () {
    $panel = Filament::getDefaultPanel();
    expect($panel->hasLogin())->toBeTrue()
        ->and($panel->getLoginRouteAction())->toBe(AdminLoginRedirectController::class)
        ->and(app('router')->getRoutes()->getByName('filament.admin.auth.login')->uri())->toBe('control-panel/login')
        ->and(class_exists('App\\Filament\\Auth\\PanelLogin'))->toBeFalse();

    $this->get('/control-panel/login')->assertRedirect('https://app.speechcoach.test/login')
        ->assertHeader('Cache-Control', 'no-store, private');
});

it('preserves guest intended data exactly and ignores query-based return destinations', function () {
    $intended = 'https://api.speechcoach.test/control-panel/users?page=3';
    $this->withSession(['url.intended' => $intended])->get('/control-panel/login?next=https://evil.test')
        ->assertRedirect('https://app.speechcoach.test/login')->assertSessionHas('url.intended', $intended);
    $this->assertGuest();
    expect(session()->has(FilamentMfaStamp::SESSION_KEY))->toBeFalse();
});

it('does not manufacture an intended target for an unprompted guest visit', function () {
    $this->get('/control-panel/login')->assertRedirect('https://app.speechcoach.test/login')->assertSessionMissing('url.intended');
});

it('preserves protected JSON unauthenticated behavior', function () {
    $this->getJson('/control-panel')->assertUnauthorized();
});

it('denies non-admins without consuming their pending destination', function (string $role) {
    $user = User::factory()->create();
    $user->assignRole($role);
    $this->actingAs($user)->withSession(['url.intended' => '/control-panel/users'])
        ->get('/control-panel/login')->assertForbidden()->assertSessionHas('url.intended', '/control-panel/users');
})->with([Role::MEMBER, Role::COACH]);

it('consumes valid or rejected destinations only once for either admin tier', function (string $role, string $target, string $expected) {
    [$admin] = continuationAdmin($role);
    $this->actingAs($admin)->withSession(['url.intended' => $target])->get('/control-panel/login')
        ->assertRedirect('https://api.speechcoach.test'.$expected)->assertSessionMissing('url.intended')
        ->assertHeader('Cache-Control', 'no-store, private');
    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
    $this->get('/control-panel/login')->assertRedirect('https://api.speechcoach.test/control-panel');
})->with([
    [Role::ADMIN, '/control-panel/users?page=2', '/control-panel/users?page=2'],
    [Role::SUPER_ADMIN, '/control-panel/speeches', '/control-panel/speeches'],
    [Role::ADMIN, 'https://evil.test', '/control-panel'],
    [Role::SUPER_ADMIN, '/control-panel/login', '/control-panel'],
]);

it('uses trusted API origin even under a forged Host header', function () {
    [$admin] = continuationAdmin();
    $this->actingAs($admin)->withSession(['url.intended' => '/control-panel/users?page=2'])
        ->get('https://evil.test/control-panel/login')->assertRedirect('https://api.speechcoach.test/control-panel/users?page=2');
    $this->get('https://evil.test/control-panel/login')->assertRedirect('https://api.speechcoach.test/control-panel');
});

it('retains a guest resource query across shared login continuation and real TOTP challenge', function (string $role) {
    [$admin, $secret] = continuationAdmin($role);
    $password = 'correct-horse-battery-staple';
    $admin->forceFill(['password' => bcrypt($password)])->save();
    $target = 'https://api.speechcoach.test/control-panel/users?page=2';

    $this->get($target)->assertRedirect(route('filament.admin.auth.login'))->assertSessionHas('url.intended', $target);
    $this->get('/control-panel/login')->assertRedirect('https://app.speechcoach.test/login')->assertSessionHas('url.intended', $target);
    $oldSession = session()->getId();
    $this->postJson('/login', ['email' => $admin->email, 'password' => $password])->assertOk();
    expect(session()->getId())->not->toBe($oldSession);
    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
    $this->get('/control-panel/login')->assertRedirect($target)->assertSessionMissing('url.intended');
    $this->get($target)->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())))->assertSessionHas('url.intended', $target);
    Livewire::test(MfaChallenge::class)->fillForm(['code' => app(Google2FA::class)->getCurrentOtp($secret)])
        ->call('authenticate')->assertRedirect($target);
    expect(FilamentMfaStamp::isValid($admin))->toBeTrue();
    $this->get($target)->assertOk();
})->with([Role::ADMIN, Role::SUPER_ADMIN]);

it('does not bypass enrollment when an admin reaches the alias', function () {
    $admin = User::factory()->create(['two_factor_secret' => null]);
    $admin->assignRole(Role::ADMIN);
    $this->actingAs($admin)->withSession(['url.intended' => '/control-panel/users?page=2'])
        ->get('/control-panel/login')->assertRedirect('https://api.speechcoach.test/control-panel/users?page=2');
    $this->get('https://api.speechcoach.test/control-panel/users?page=2')
        ->assertRedirect(Filament::getSetUpRequiredMultiFactorAuthenticationUrl())
        ->assertSessionHas('url.intended', 'https://api.speechcoach.test/control-panel/users?page=2');
    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
});

it('preserves valid proof through the alias and rejects proof for another user at the destination', function () {
    [$admin] = continuationAdmin();
    [$other] = continuationAdmin();
    FilamentMfaStamp::write($admin);
    $this->actingAs($admin)->get('/control-panel/login')->assertRedirect('https://api.speechcoach.test/control-panel');
    $this->get('/control-panel')->assertOk();
    $this->actingAs($other)->get('/control-panel/login')->assertRedirect('https://api.speechcoach.test/control-panel');
    $this->get('/control-panel')->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
});

it('preserves local-only MFA bypass at the actual target', function (string $environment, bool $bypassed) {
    app()->instance('env', $environment);
    config(['app.env' => $environment, 'app.disable_admin_mfa' => true]);
    [$admin] = continuationAdmin();
    $this->actingAs($admin)->get('/control-panel/login')->assertRedirect('https://api.speechcoach.test/control-panel');
    $response = $this->get('/control-panel');
    $bypassed ? $response->assertOk() : $response->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
})->with([['local', true], ['e2e', false], ['production', false]]);

it('preserves Horizon gate denial outside local and its existing local exception', function (string $environment, bool $allowed) {
    app()->instance('env', $environment);
    config(['app.env' => $environment]);
    $response = $this->get('/horizon/dashboard');
    $allowed ? $response->assertOk() : $response->assertForbidden();
    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);
    $response = $this->actingAs($member)->get('/horizon/dashboard');
    $allowed ? $response->assertOk() : $response->assertForbidden();
})->with([['local', true], ['e2e', false], ['production', false]]);

it('evicts inactive authenticated accounts before the alias can continue', function (string $column) {
    [$admin] = continuationAdmin();
    $admin->forceFill([$column => now()])->save();
    $this->actingAs($admin)->get('/control-panel/login')->assertRedirect(route('suspension.notice', ['reason' => str_replace('_at', '', $column)]));
    $this->assertGuest();
})->with(['suspended_at', 'deleted_at', 'anonymized_at']);

it('does not treat a remembered shared password login as MFA proof', function (bool $remember) {
    [$admin] = continuationAdmin();
    $password = 'correct-horse-battery-staple';
    $admin->forceFill(['password' => bcrypt($password)])->save();
    FilamentMfaStamp::write($admin);
    $response = $this->postJson('/login', ['email' => $admin->email, 'password' => $password, 'remember' => $remember]);
    $response->assertOk();
    $remember ? $response->assertCookie(auth('web')->getRecallerName()) : $response->assertCookieMissing(auth('web')->getRecallerName());
    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
    $this->get('/control-panel')->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
})->with([false, true]);

it('enforces CSRF on the shared credential endpoint with the actual middleware enabled', function () {
    // Laravel skips CSRF while runningUnitTests(); use e2e to exercise its real check.
    app()->instance('env', 'e2e');
    config(['app.env' => 'e2e']);
    [$admin] = continuationAdmin();
    $password = 'correct-horse-battery-staple';
    $admin->forceFill(['password' => bcrypt($password)])->save();
    $this->get('/sanctum/csrf-cookie')->assertNoContent();
    $this->postJson('/login', ['email' => $admin->email, 'password' => $password])->assertStatus(419);
    $this->assertGuest();
    $this->postJson('/login', ['email' => $admin->email, 'password' => $password, '_token' => session()->token()])->assertOk();
    expect(FilamentMfaStamp::isValid($admin))->toBeFalse();
});

it('resolves the manually routed challenge on boot and authenticates its actual snapshot with a fresh registry', function () {
    $alias = 'app.filament.auth.mfa-challenge';
    // Check before class-based Livewire::test can register this class incidentally.
    expect(app(ComponentRegistry::class)->getClass($alias))->toBe(MfaChallenge::class);
    [$admin, $secret] = continuationAdmin();
    $this->actingAs($admin)->withSession(['url.intended' => '/control-panel']);
    $html = $this->get(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())))->assertOk()->getContent();
    $snapshots = [];
    preg_match_all('/wire:snapshot="([^"]+)"/', $html, $snapshots);
    $snapshot = collect($snapshots[1])->map(fn ($value) => json_decode(html_entity_decode($value, ENT_QUOTES), true))
        ->first(fn ($value) => ($value['memo']['name'] ?? null) === $alias);
    expect($snapshot)->toBeArray();

    // A fresh request only knows boot registrations, not classes mounted by the GET.
    app()->instance(ComponentRegistry::class, new ComponentRegistry);
    Filament::getDefaultPanel()->register();
    expect(app(ComponentRegistry::class)->getClass($alias))->toBe(MfaChallenge::class);
    $response = $this->withHeader('X-Livewire', 'true')->postJson('/livewire/update', ['components' => [[
        'snapshot' => json_encode($snapshot),
        'updates' => ['data.code' => app(Google2FA::class)->getCurrentOtp($secret)],
        'calls' => [['method' => 'authenticate', 'params' => []]],
    ]]]);
    $response->assertOk()->assertJsonPath('components.0.effects.redirect', 'https://api.speechcoach.test/control-panel');
    expect(FilamentMfaStamp::isValid($admin))->toBeTrue();
    $this->get('/control-panel')->assertOk();
});

it('returns through enrollment Continue and still demands a challenge before protected content', function () {
    $admin = User::factory()->create(['two_factor_secret' => null]);
    $admin->assignRole(Role::ADMIN);
    $target = 'https://api.speechcoach.test/control-panel/users?page=2';
    $this->actingAs($admin)->withSession(['url.intended' => $target])
        ->get('/control-panel/login')->assertRedirect($target);
    $this->get($target)->assertRedirect(Filament::getSetUpRequiredMultiFactorAuthenticationUrl());

    $setup = Livewire::test(SetUpRequiredMultiFactorAuthentication::class)
        ->mountAction(TestAction::make('setUpAppAuthentication')->schemaComponent('app', 'content'));
    $arguments = $setup->get('mountedActions')[0]['arguments'];
    $secret = decrypt($arguments['encrypted'])['secret'];
    $setup->setActionData(['code' => app(Google2FA::class)->getCurrentOtp($secret)])
        ->callMountedAction()->assertHasNoActionErrors();
    expect($admin->fresh()->getAppAuthenticationSecret())->toBe($secret)
        ->and(FilamentMfaStamp::isValid($admin))->toBeFalse();

    $setup->callAction(TestAction::make('continue')->schemaComponent(true, 'content'))->assertRedirect($target);
    $this->get($target)->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())))
        ->assertSessionHas('url.intended', $target);
    Livewire::test(MfaChallenge::class)
        ->fillForm(['code' => app(Google2FA::class)->getCurrentOtp($secret)])
        ->call('authenticate')->assertRedirect($target);
    expect(FilamentMfaStamp::isValid($admin))->toBeTrue();
    $this->get($target)->assertOk();
});

it('restores remembered authentication from its cookie without restoring old MFA proof', function () {
    [$admin] = continuationAdmin();
    $password = 'correct-horse-battery-staple';
    $admin->forceFill(['password' => bcrypt($password)])->save();
    $response = $this->postJson('/login', ['email' => $admin->email, 'password' => $password, 'remember' => true])->assertOk();
    $name = auth('web')->getRecallerName();
    $cookie = $response->getCookie($name);
    expect($cookie)->not->toBeNull();
    FilamentMfaStamp::write($admin);

    // An expired session leaves the browser's persistent recaller cookie intact.
    // Forget guard state as well so the following request must use that cookie.
    session()->invalidate();
    app('auth')->forgetGuards();
    $this->withCookie($name, $cookie->getValue())->get('/control-panel/login')
        ->assertRedirect('https://api.speechcoach.test/control-panel');
    $this->assertAuthenticatedAs($admin);
    expect(auth('web')->viaRemember())->toBeTrue()
        ->and(FilamentMfaStamp::isValid($admin))->toBeFalse();
    $this->get('/control-panel')->assertRedirect(route(MfaChallenge::getRouteName(Filament::getDefaultPanel())));
});
