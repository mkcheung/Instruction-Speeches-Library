<?php

use App\Filament\Auth\MfaChallenge;
use App\Filament\Resources\AuditLogResource;
use App\Models\User;
use App\Support\AdminWorkspaceAssets;
use App\Support\FilamentMfaStamp;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Facades\Filament;
use Filament\FontProviders\LocalFontProvider;
use Filament\Support\Assets\Css;
use Filament\Support\Assets\Font;
use Filament\Support\Facades\FilamentAsset;

require_once __DIR__.'/PanelHelpers.php';

beforeEach(function () {
    $this->seed(RoleSeeder::class);
    Filament::setCurrentPanel('admin');
    renderPanelTablesWithoutIntl();
});

function styleEnrolledUser(string $role): User
{
    $user = User::factory()->create(['two_factor_secret' => 'E2EADMINE2EADMIN']);
    $user->assignRole($role);

    return $user;
}

it('loads the notebook stylesheet once after the base theme with local fonts', function () {
    $admin = styleEnrolledUser(Role::ADMIN);
    $this->actingAs($admin)->withSession([FilamentMfaStamp::SESSION_KEY => [
        'user' => $admin->getAuthIdentifier(), 'at' => now()->toIso8601String(),
    ]]);

    $html = $this->get('/control-panel')->assertOk()->getContent();
    $panel = Filament::getCurrentOrDefaultPanel();
    $assets = collect(AdminWorkspaceAssets::assets());
    $style = $assets->first(fn ($asset) => $asset instanceof Css);
    // Console registration plus the simulated HTTP panel boot both append assets
    // in Filament. Require no extra manual font link beyond those registrations;
    // the browser test asserts exactly one link in a real HTTP process.
    $registeredFonts = FilamentAsset::getFonts([AdminWorkspaceAssets::PACKAGE]);

    expect($style)->not->toBeNull()
        ->and($style->isLoadedOnRequest())->toBeTrue()
        ->and(substr_count($html, $style->getHref()))->toBe(1)
        ->and(strpos($html, $style->getHref()))->toBeGreaterThan(strpos($html, $panel->getTheme()->getHref()))
        ->and($panel->getFontFamily())->toBe('Geist')
        ->and($panel->getFontProvider())->toBe(LocalFontProvider::class)
        ->and($panel->getFontUrl())->toBeNull()
        ->and(substr_count($html, AdminWorkspaceAssets::fontStylesheetUrl()))->toBe(count($registeredFonts))
        ->and($html)->toContain(AdminWorkspaceAssets::fontStylesheetUrl(), 'data-admin-scene="dashboard"')
        ->not->toContain('fonts.bunny.net', 'fonts.googleapis.com');
    expect(substr_count($html, 'data-admin-scene='))->toBe(1);
});

it('packages fingerprinted stylesheet and font sources under nginx served namespaces', function () {
    $assets = collect(AdminWorkspaceAssets::assets());
    /** @var Css $style */
    $style = $assets->first(fn ($asset) => $asset instanceof Css);
    /** @var Font $font */
    $font = collect(FilamentAsset::getFonts([AdminWorkspaceAssets::PACKAGE]))->first(fn ($asset) => $asset instanceof Font);

    expect($style->getRelativePublicPath())->toMatch('#^css/filament/admin/admin-workspace-[a-f0-9]+\.css$#')
        ->and(is_file($style->getPath()))->toBeTrue()
        ->and($font->getRelativePublicPath())->toMatch('#^fonts/filament/admin/notebook-[a-f0-9]+$#');

    $css = file_get_contents($font->getPath().'/index.css');
    expect($css)->toContain('Geist', 'Luckiest Guy')->not->toMatch('#https?://#');
    preg_match_all('/url\([\'\"]?([^\)\'\"]+\.woff2)[\'\"]?\)/', $css, $matches);
    expect($matches[1])->not->toBeEmpty();
    foreach ($matches[1] as $filename) {
        expect($filename)->toMatch('/^\.\/[a-z0-9-]+-[a-f0-9]+\.woff2$/')
            ->and(is_file($font->getPath().'/'.$filename))->toBeTrue();
    }
});

it('keeps MFA free of characters and does not admit an unstamped session', function () {
    $this->actingAs(styleEnrolledUser(Role::ADMIN));
    $url = route(MfaChallenge::getRouteName(Filament::getDefaultPanel()));

    $this->get('/control-panel')->assertRedirect($url);
    $this->get($url)->assertOk()->assertDontSee('data-admin-scene=', false);
});

it('keeps audit navigation and its scene restricted to super administrators', function (string $role, bool $allowed) {
    $user = styleEnrolledUser($role);
    $this->actingAs($user)->withSession([FilamentMfaStamp::SESSION_KEY => [
        'user' => $user->getAuthIdentifier(), 'at' => now()->toIso8601String(),
    ]]);

    $dashboard = $this->get('/control-panel')->assertOk();
    $auditUrl = AuditLogResource::getUrl('index');
    $response = $this->get($auditUrl);
    if ($allowed) {
        $dashboard->assertSee($auditUrl, false);
        $response->assertOk()->assertSee('data-admin-scene="audit-log"', false);
    } else {
        $dashboard->assertDontSee($auditUrl, false);
        $response->assertForbidden()->assertDontSee('data-admin-scene=', false);
    }
})->with([[Role::ADMIN, false], [Role::SUPER_ADMIN, true]]);
