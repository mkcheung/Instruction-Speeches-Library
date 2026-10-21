<?php

use App\Support\FilamentMfaStamp;
use Filament\Facades\Filament;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\Artisan;
use Livewire\Exceptions\ComponentNotFoundException;
use Livewire\Exceptions\LivewireReleaseTokenMismatchException;
use Livewire\Mechanisms\ComponentRegistry;
use Livewire\Mechanisms\HandleComponents\Checksum;

it('refreshes a warmed old component map using only a disposable application-scoped cache', function () {
    $directory = sys_get_temp_dir().'/admin-login-components-'.bin2hex(random_bytes(8));
    config(['filament.cache_path' => $directory]);
    $panel = Filament::getDefaultPanel();
    $filesystem = app(Filesystem::class);
    $path = $panel->getComponentCachePath();

    try {
        Artisan::call('filament:cache-components');
        $cache = require $path;
        // The old artifact's exact registration, captured before retiring its class.
        $cache['livewireComponents']['app.filament.auth.panel-login'] = 'App\\Filament\\Auth\\PanelLogin';
        $filesystem->put($path, '<?php return '.var_export($cache, true).';');
        $oldPanel = clone $panel;
        $oldPanel->restoreCachedComponents();
        $property = new ReflectionProperty($oldPanel, 'livewireComponents');
        expect($property->getValue($oldPanel))->toContain('App\\Filament\\Auth\\PanelLogin');

        // Deployment commands run against the replacement artifact's cold registrations.
        Artisan::call('filament:clear-cached-components');
        expect($filesystem->exists($path))->toBeFalse();
        Artisan::call('filament:cache-components');
        $rebuilt = require $path;
        expect($rebuilt['livewireComponents'])->not->toContain('App\\Filament\\Auth\\PanelLogin');

        $newPanel = clone $panel;
        $newPanel->restoreCachedComponents();
        expect($property->getValue($newPanel))->not->toContain('App\\Filament\\Auth\\PanelLogin');
        expect(fn () => app(ComponentRegistry::class)->new('app.filament.auth.panel-login'))
            ->toThrow(ComponentNotFoundException::class);
    } finally {
        // Exact files created by this test only; no shared bootstrap/runtime caches are touched.
        $filesystem->delete($path);
        @rmdir(dirname($path));
        @rmdir($directory);
    }
});

it('rejects a validly signed old login snapshot instead of authenticating or stamping', function () {
    // Actual guest snapshot captured from the old page before removal (no credentials).
    // Re-sign for this environment so a different CI APP_KEY cannot mask component retirement.
    $snapshot = json_decode(<<<'JSON'
{"data":{"data":[{"email":null,"password":null,"remember":false},{"s":"arr"}],"userUndertakingMultiFactorAuthentication":null,"mountedActions":[[],{"s":"arr"}],"defaultAction":null,"defaultActionArguments":null,"defaultActionContext":null,"defaultTableAction":null,"defaultTableActionRecord":null,"defaultTableActionArguments":null,"componentFileAttachments":[[],{"s":"arr"}],"areSchemaStateUpdateHooksDisabledForTesting":false,"discoveredSchemaNames":[["form","content"],{"s":"arr"}]},"memo":{"id":"0UcO99lBuD7q7MXxFJGs","name":"app.filament.auth.panel-login","path":"control-panel/login","method":"GET","release":"a-a-a","children":[],"scripts":[],"assets":[],"errors":[],"locale":"en"}}
JSON, true, flags: JSON_THROW_ON_ERROR);
    $snapshot['checksum'] = Checksum::generate($snapshot);
    $this->withoutExceptionHandling();
    try {
        $this->postJson('/livewire/update', ['components' => [[
            'snapshot' => json_encode($snapshot),
            'updates' => [],
            'calls' => [['method' => 'authenticate', 'params' => []]],
        ]]]);
        $this->fail('Retired credential component must not remain callable.');
    } catch (LivewireReleaseTokenMismatchException $exception) {
        // Livewire intentionally expires snapshots for removed component classes.
        expect($exception->getMessage())->toContain('release token mismatch');
    }
    $this->assertGuest();
    expect(session()->has(FilamentMfaStamp::SESSION_KEY))->toBeFalse();
});
