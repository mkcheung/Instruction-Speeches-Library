<?php

/** Test-only HTTP router. Never points at development data or object storage. */
use App\Services\MediaUrlSigner;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

if (getenv('APP_ENV') !== 'testing' || ! preg_match('/^annotation_range_browser_[a-z0-9_]+$/D', (string) getenv('DB_DATABASE'))
    || getenv('DB_CONNECTION') !== 'pgsql' || getenv('DB_URL')) {
    http_response_code(503);
    exit('Requires explicit isolated annotation-range browser database.');
}
require __DIR__.'/../api/vendor/autoload.php';
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/__annotation-range-media/video.mp4') {
    $response = new BinaryFileResponse(__DIR__.'/../api/tests/fixtures/e2e-captions/caption-fixture.mp4');
    $response->headers->set('Content-Type', 'video/mp4');
    $response->headers->set('Access-Control-Allow-Origin', 'http://127.0.0.1:5180');
    $response->prepare(Request::capture())->send();
    exit;
}
$app = require __DIR__.'/../api/bootstrap/app.php';
$kernel = $app->make(Kernel::class);
$kernel->bootstrap();
if (DB::selectOne('select current_database() as name')->name !== getenv('DB_DATABASE')) {
    throw new RuntimeException('Test database mismatch.');
}
config(['filesystems.disks.media' => ['driver' => 'local', 'root' => sys_get_temp_dir().'/'.getenv('DB_DATABASE').'/media', 'throw' => true]]);
Storage::forgetDisk('media');
// Jobs explicitly choose redis-long, so changing QUEUE_CONNECTION alone does
// not isolate them. Map named Redis queues into this test database as well.
foreach (config('queue.connections') as $name => $connection) {
    if (($connection['driver'] ?? null) === 'redis') {
        config(['queue.connections.'.$name => config('queue.connections.database')]);
    }
}
$app->instance(MediaUrlSigner::class, new class extends MediaUrlSigner
{
    public function presign(string $path, int $ttlSeconds = self::DEFAULT_TTL_SECONDS): string
    {
        // Known local video bytes; this lane deliberately does not prove SigV4.
        return 'http://127.0.0.1:8180/__annotation-range-media/video.mp4';
    }
});
$request = Request::capture();
$response = $kernel->handle($request);
$response->send();
$kernel->terminate($request, $response);
