<?php

use App\Filament\Pages\Dashboard;
use App\Support\AdminLoginDestination;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;

beforeEach(function () {
    config(['app.url' => 'https://api.speechcoach.test']);
});

it('preserves registered panel content and resource query strings', function (string $target, string $expected) {
    expect(app(AdminLoginDestination::class)->resolve($target))->toBe('https://api.speechcoach.test'.$expected);
})->with([
    ['https://api.speechcoach.test/control-panel', '/control-panel'],
    ['/control-panel/users?tableFilters%5Brole%5D=admin&page=2', '/control-panel/users?tableFilters%5Brole%5D=admin&page=2'],
    ['/control-panel/users/987654', '/control-panel/users/987654'],
    ['https://API.SPEECHCOACH.TEST:443/control-panel/speeches', '/control-panel/speeches'],
]);

it('falls back for unsafe ambiguous or non-content destinations', function (mixed $target) {
    expect(app(AdminLoginDestination::class)->resolve($target))->toBe('https://api.speechcoach.test/control-panel');
})->with([
    null, '', 42, false, [['path' => '/control-panel/users']],
    'https://evil.test/control-panel/users', '//evil.test/control-panel/users',
    'http://api.speechcoach.test/control-panel/users', 'https://api.speechcoach.test:444/control-panel/users',
    'https://user:pass@api.speechcoach.test/control-panel/users',
    '/control-panel-other', '/control-panel/unknown', '/control-panel/users/../login',
    '/control-panel/%2e%2e/login', '/control-panel/users%2f1', '/control-panel/users/%252e%252e',
    '/control-panel\\users', '/control-panel/%5cusers', '/control-panel/users#login',
    '/control-panel/login', '/control-panel/%6cogin', '/control-panel/logout',
    '/control-panel/multi-factor-authentication/challenge', '/control-panel/multi-factor-authentication/set-up',
    '/login', '/logout', '/forgot-password', '/reset-password/token', '/email/verify', '/livewire/update',
    '/css/filament/filament/app.css', '/control-panel/users?filter=%0d%0aLocation:evil',
    '/control-panel/users?filter=%zz', "\n/control-panel/users", '/control-panel//users',
    '/horizon/api/stats', '/horizon/api/does-not-exist', '/horizon/not-a-real-ui',
    '/horizon/jobs/unknown', '/horizon/metrics/unknown/example', '/horizon/monitoring/a%2fb/jobs',
    '/horizon/monitoring/App%255cJobs/jobs', '/horizon/monitoring/..',
    '/horizon/%64ashboard',
]);

it('preserves only installed Horizon UI patterns including opaque class parameters', function (string $target) {
    expect(app(AdminLoginDestination::class)->resolve($target))->toBe('https://api.speechcoach.test'.rtrim($target, '/'));
})->with([
    '/horizon', '/horizon/', '/horizon/dashboard', '/horizon/monitoring',
    '/horizon/monitoring/App%5CJobs%5CTranscodeSpeechAsset',
    '/horizon/monitoring/App%5CJobs%5CTranscodeSpeechAsset/jobs?page=2',
    '/horizon/monitoring/speech%3A42/failed', '/horizon/metrics', '/horizon/metrics/jobs', '/horizon/metrics/queues',
    '/horizon/metrics/jobs/App%5CJobs%5CTranscodeSpeechAsset?period=60',
    '/horizon/metrics/queues/default', '/horizon/jobs/pending', '/horizon/jobs/completed/abc-123',
    '/horizon/jobs/silenced', '/horizon/failed', '/horizon/failed/abc-123', '/horizon/batches', '/horizon/batches/abc-123',
]);

it('uses the configured Horizon path and requires registered route metadata', function () {
    config(['horizon.path' => 'operations/queues']);
    $router = app(Router::class);
    $router->get('operations/queues/{view?}', fn () => abort(500))->where('view', '.*')->name('horizon.index');

    expect(app(AdminLoginDestination::class)->resolve('/operations/queues/monitoring/App%5CJobs%5CExample/jobs'))
        ->toBe('https://api.speechcoach.test/operations/queues/monitoring/App%5CJobs%5CExample/jobs')
        ->and(app(AdminLoginDestination::class)->resolve('/horizon/dashboard'))->toBe('https://api.speechcoach.test/control-panel')
        ->and(app(AdminLoginDestination::class)->resolve('/operations/queues/api/unknown'))->toBe('https://api.speechcoach.test/control-panel');
});

it('validates metadata without executing destination middleware or controller', function () {
    app(Router::class)->get('control-panel/metadata-test', Dashboard::class)
        ->middleware('not-a-real-middleware')->name('filament.admin.pages.metadata-test');
    expect(app(AdminLoginDestination::class)->resolve('/control-panel/metadata-test'))
        ->toBe('https://api.speechcoach.test/control-panel/metadata-test');
});

it('does not trust request Host for valid targets or fallback', function () {
    app()->instance('request', Request::create('https://evil.test/control-panel/login'));
    expect(app(AdminLoginDestination::class)->resolve('/control-panel/users'))->toBe('https://api.speechcoach.test/control-panel/users')
        ->and(app(AdminLoginDestination::class)->resolve('https://evil.test/control-panel/users'))->toBe('https://api.speechcoach.test/control-panel');
});

it('fails visibly on invalid trusted origin configuration', function (mixed $origin) {
    config(['app.url' => $origin]);
    expect(fn () => app(AdminLoginDestination::class)->resolve(null))->toThrow(LogicException::class);
})->with([null, '', '/api', 'javascript:alert(1)', 'https://user@api.test', 'https://api.test/path', 'https://api.test?x=1']);
