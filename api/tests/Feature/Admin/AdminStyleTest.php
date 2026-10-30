<?php

use App\Filament\Auth\MfaChallenge;
use App\Filament\Resources\AuditLogResource;
use App\Support\AdminWorkspaceAssets;
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

it('loads the notebook stylesheet once after the base theme with local fonts', function () {
    $admin = enrolledPanelUser(Role::ADMIN);
    $this->actingAs($admin)->withSession(panelMfaStamp($admin));

    $html = $this->get('/control-panel')->assertOk()->getContent();
    $panel = Filament::getCurrentOrDefaultPanel();
    $assets = collect(AdminWorkspaceAssets::assets());
    $style = $assets->first(fn ($asset) => $asset instanceof Css);
    // Console registration plus the simulated HTTP panel boot both append assets
    // in Filament. Require no extra manual font link beyond those registrations;
    // the browser test asserts exactly one link in a real HTTP process.
    $registeredFonts = FilamentAsset::getFonts([AdminWorkspaceAssets::PACKAGE]);
    $fontHref = $registeredFonts[0]->getStyle()->getHref();
    // strpos() is false when absent, and false compares below every int: a
    // missing base theme must fail rather than trivially pass the ordering check.
    $themePosition = strpos($html, $panel->getTheme()->getHref());

    expect($style)->not->toBeNull()
        ->and($style->isLoadedOnRequest())->toBeTrue()
        ->and(substr_count($html, $style->getHref()))->toBe(1)
        ->and($themePosition)->toBeInt()
        ->and(strpos($html, $style->getHref()))->toBeGreaterThan($themePosition)
        ->and($panel->getFontFamily())->toBe('Geist')
        ->and($panel->getFontProvider())->toBe(LocalFontProvider::class)
        ->and($panel->getFontUrl())->toBeNull()
        ->and(substr_count($html, $fontHref))->toBe(count($registeredFonts))
        ->and($html)->toContain($fontHref, 'data-admin-scene="dashboard"')
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
        $path = $font->getPath().'/'.$filename;
        expect($filename)->toMatch('/^\.\/[a-z0-9-]+-[a-f0-9]{16}\.woff2$/')
            ->and(is_file($path))->toBeTrue();
        // The font directory is versioned by index.css alone and served immutable,
        // so a WOFF2 whose bytes change without a new filename would stay cached.
        preg_match('/-([a-f0-9]{16})\.woff2$/', $filename, $hash);
        expect(substr(hash_file('sha256', $path), 0, 16))->toBe($hash[1]);
    }
});

it('keeps MFA free of characters and does not admit an unstamped session', function () {
    $this->actingAs(enrolledPanelUser(Role::ADMIN));
    $url = route(MfaChallenge::getRouteName(Filament::getDefaultPanel()));

    $this->get('/control-panel')->assertRedirect($url);
    $this->get($url)->assertOk()->assertDontSee('data-admin-scene=', false);
});

it('keeps audit navigation and its scene restricted to super administrators', function (string $role, bool $allowed) {
    $user = enrolledPanelUser($role);
    $this->actingAs($user)->withSession(panelMfaStamp($user));

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
