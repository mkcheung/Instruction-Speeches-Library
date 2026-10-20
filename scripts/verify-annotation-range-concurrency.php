<?php

/** Run ONLY on a newly created isolated annotation_range_verify_* PostgreSQL DB.
 * Requires pcntl and pdo_pgsql. No existing database is reset or deleted.
 * Leaves its database, unique local media directory and evidence for inspection.
 */

use App\Exceptions\AnnotationBusyException;
use App\Exceptions\AnnotationOverlapException;
use App\Http\Controllers\Api\VoiceAnnotationController;
use App\Jobs\PurgeDeletedVoiceAnnotation;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\AnnotationService;
use App\Services\QuotaService;
use App\Services\ReviewService;
use App\Services\Voice\VoiceNoteService;
use Database\Seeders\RoleSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

require __DIR__.'/../api/vendor/autoload.php';
$app = require __DIR__.'/../api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$database = config('database.connections.pgsql.database');
if (! is_string($database) || ! preg_match('/^annotation_range_verify_[a-z0-9_]+$/D', $database)
    || config('database.default') !== 'pgsql' || config('database.connections.pgsql.url')
    || ! function_exists('pcntl_fork')) {
    throw new RuntimeException('Requires explicit annotation_range_verify_* PostgreSQL target, empty DB_URL and pcntl.');
}
if (DB::selectOne('select current_database() as name')->name !== $database || Schema::hasTable('users')) {
    throw new RuntimeException('Target must be the named empty isolated database, without a users table.');
}
echo "Isolated target: {$database}; no development migration/reset.\n";
Artisan::call('migrate', ['--force' => true]);
Artisan::call('db:seed', ['--class' => RoleSeeder::class, '--force' => true]);
$evidence = sys_get_temp_dir().'/'.$database.'_'.bin2hex(random_bytes(4));
mkdir($evidence, 0700);
config(['filesystems.disks.media' => ['driver' => 'local', 'root' => $evidence.'/media', 'throw' => true]]);
Storage::forgetDisk('media');
Queue::fake();
Notification::fake();
$owner = User::factory()->create();
$owner->assignRole('member');
$coach = User::factory()->create();
$coach->assignRole('coach');

function rangeWait(callable $ready, string $description): void
{
    $deadline = microtime(true) + 15;
    while (! $ready()) {
        if (microtime(true) >= $deadline) {
            throw new RuntimeException('Timed out: '.$description);
        }
        usleep(20_000);
    }
}

function rangeFixture(User $owner, User $coach): Review
{
    $speech = Speech::factory()->for($owner)->create();
    SpeechAsset::factory()->video()->ready()->for($speech)->create(['duration_seconds' => 200]);

    return Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $owner->id,
        'reviewer_id' => $coach->id, 'status' => 'in_progress']);
}

function rangeOperation(string $kind, int $reviewId, int $coachId, array $arguments = []): void
{
    Auth::setUser(User::findOrFail($coachId));
    $review = Review::findOrFail($reviewId);
    $service = app(AnnotationService::class);
    $start = $arguments['start'] ?? 10;
    if ($kind === 'range') {
        $service->create($review, ['client_uuid' => $arguments['uuid'] ?? (string) Str::uuid(), 'body' => 'Concurrency feedback',
            'start_seconds' => $start, 'duration_seconds' => 5]);
    } elseif ($kind === 'point') {
        app(VoiceNoteService::class)->create($review, UploadedFile::fake()->create('point.webm', 4, 'audio/webm'),
            ['client_uuid' => $arguments['uuid'] ?? (string) Str::uuid(), 'start_seconds' => $start]);
    } elseif ($kind === 'retime') {
        $service->update(Annotation::findOrFail($arguments['id']), ['lock_version' => 0, 'start_seconds' => $start]);
    } elseif ($kind === 'restore') {
        $service->restorePoint($review, (string) $arguments['id']);
    } elseif ($kind === 'delete') {
        $service->delete(Annotation::findOrFail($arguments['id']));
    } elseif ($kind === 'revoke') {
        app(ReviewService::class)->revoke($review, User::findOrFail($review->speech_owner_id), null);
    } else {
        throw new RuntimeException('Unknown operation');
    }
}

function rangeChild(callable $operation, string $resultPath, string $applicationName): int
{
    $pid = pcntl_fork();
    if ($pid === -1) {
        throw new RuntimeException('Could not fork.');
    }
    if ($pid !== 0) {
        return $pid;
    }
    try {
        DB::statement("SET statement_timeout = '20s'");
        DB::select("SELECT set_config('application_name', ?, false)", [$applicationName]);
        $operation();
        file_put_contents($resultPath, json_encode(['result' => 'accepted'], JSON_THROW_ON_ERROR));
        exit(0);
    } catch (Throwable $error) {
        $result = match (true) {
            $error instanceof AnnotationOverlapException => 'overlap',
            $error instanceof AuthorizationException => 'denied',
            $error instanceof AnnotationBusyException => 'busy',
            $error instanceof ModelNotFoundException => 'http_404',
            $error instanceof HttpException => 'http_'.$error->getStatusCode(),
            default => 'error',
        };
        file_put_contents($resultPath, json_encode(['result' => $result, 'class' => $error::class, 'message' => $error->getMessage()], JSON_THROW_ON_ERROR));
        exit($result === 'error' ? 1 : 0);
    }
}

function rangeJoin(array $children): void
{
    foreach ($children as $pid) {
        pcntl_waitpid($pid, $status);
        if (! pcntl_wifexited($status) || pcntl_wexitstatus($status) !== 0) {
            throw new RuntimeException('Proof child failed; inspect retained evidence.');
        }
    }
}

$cases = [
    ['range-range', 'range', 'range', 'overlap'],
    ['range-point', 'range', 'point', 'overlap'],
    ['point-range', 'point', 'range', 'overlap'],
    ['point-point', 'point', 'point', 'overlap'],
    ['duplicate-voice', 'point', 'point', 'accepted'],
    ['duplicate-written', 'range', 'range', 'accepted'],
    ['adjacent', 'range', 'range', 'accepted'],
    ['retime-retime', 'retime', 'retime', 'overlap'],
    ['retime-create', 'retime', 'range', 'overlap'],
    ['restore-create', 'restore', 'range', 'overlap'],
    ['delete-restore', 'delete', 'restore', 'accepted'],
    ['revoke-write', 'revoke', 'range', 'denied'],
];
foreach ($cases as [$name, $firstKind, $secondKind, $expected]) {
    $review = rangeFixture($owner, $coach);
    $firstArguments = [];
    $secondArguments = [];
    $quotaBefore = User::findOrFail($coach->id)->storage_bytes_used;
    if (str_starts_with($name, 'duplicate-')) {
        $firstArguments = ['uuid' => (string) Str::uuid()];
        $secondArguments = ['uuid' => $firstArguments['uuid'], 'start' => 20];
    }
    if ($firstKind === 'retime') {
        $row = Annotation::factory()->draft()->for($review)->create(['start_seconds' => 1, 'duration_seconds' => 5]);
        $firstArguments = ['id' => $row->id];
        if ($secondKind === 'retime') {
            $other = Annotation::factory()->draft()->for($review)->create(['start_seconds' => 20, 'duration_seconds' => 5]);
            $secondArguments = ['id' => $other->id];
        }
    }
    if ($firstKind === 'restore' || $firstKind === 'delete') {
        $row = Annotation::factory()->draft()->for($review)->create(['start_seconds' => 10, 'timing_type' => 'point',
            'deleted_at' => $firstKind === 'restore' ? now() : null]);
        $firstArguments = ['id' => $row->id];
        $secondArguments = $firstKind === 'delete' ? $firstArguments : [];
    }
    if ($name === 'adjacent') {
        $secondArguments = ['start' => 15];
    }
    $review->update(['annotations_count' => Annotation::where('review_id', $review->id)->count(), 'published_annotations_count' => 0]);
    $held = "{$evidence}/{$name}-held";
    $blocked = "{$evidence}/{$name}-blocked";
    $applicationName = 'annotation-range-'.$name.'-second';
    $reviewId = $review->id;
    $coachId = $coach->id;
    DB::purge();
    $a = rangeChild(function () use ($reviewId, $coachId, $firstKind, $firstArguments, $held, $blocked, $applicationName) {
        DB::transaction(function () use ($reviewId, $coachId, $firstKind, $firstArguments, $held, $blocked, $applicationName) {
            Review::whereKey($reviewId)->lockForUpdate()->firstOrFail();
            rangeOperation($firstKind, $reviewId, $coachId, $firstArguments);
            file_put_contents($held, 'actual service wrote under parent review lock');
            rangeWait(function () use ($applicationName) {
                DB::select('SELECT pg_stat_clear_snapshot()');

                return (bool) DB::selectOne("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=? AND wait_event_type='Lock') AS waiting", [$applicationName])->waiting;
            }, 'second service waiting on Lock');
            file_put_contents($blocked, 'observed waiting before first commit');
        });
    }, "{$evidence}/{$name}-first.json", $name.'-first');
    rangeWait(fn () => is_file($held), 'first service has acquired review lock');
    $b = rangeChild(fn () => rangeOperation($secondKind, $reviewId, $coachId, $secondArguments), "{$evidence}/{$name}-second.json", $applicationName);
    rangeJoin([$a, $b]);
    $first = json_decode(file_get_contents("{$evidence}/{$name}-first.json"), true, flags: JSON_THROW_ON_ERROR);
    $second = json_decode(file_get_contents("{$evidence}/{$name}-second.json"), true, flags: JSON_THROW_ON_ERROR);
    if ($first['result'] !== 'accepted' || $second['result'] !== $expected || ! is_file($blocked)) {
        throw new RuntimeException("Unexpected {$name} outcome: ".json_encode([$first, $second]));
    }
    $fresh = Review::findOrFail($reviewId);
    if ($fresh->annotations_count !== Annotation::where('review_id', $review->id)->count()) {
        throw new RuntimeException('Counter drift.');
    }
    if (str_starts_with($name, 'duplicate-')) {
        $only = Annotation::where('review_id', $reviewId)->sole();
        if ((float) $only->start_seconds !== 10.0) {
            throw new RuntimeException('Duplicate retry changed admitted timing.');
        }
        if ($name === 'duplicate-voice') {
            $asset = SpeechAsset::findOrFail($only->audio_asset_id);
            if (User::findOrFail($coachId)->storage_bytes_used !== $quotaBefore + $asset->temporary_byte_size
                || ! Storage::disk('media')->exists($asset->temporary_path)) {
                throw new RuntimeException('Duplicate upload ownership/quota drift.');
            }
        }
    }
    echo "PASS {$name}: actual services, separate connections, observed Lock, second={$expected}.\n";
}

// Three real transactions force the existing cycle once for each detector.
foreach (['purge', 'create', 'restore'] as $victim) {
    $review = rangeFixture($owner, $coach);
    $asset = SpeechAsset::factory()->voiceNote()->for($review->speech)->create(['status' => 'ready', 'byte_size' => 50, 'temporary_byte_size' => null]);
    $old = Annotation::factory()->draft()->for($review)->create(['timing_type' => 'point', 'audio_asset_id' => $asset->id,
        'start_seconds' => 10, 'duration_seconds' => 2, 'deleted_at' => now()]);
    User::whereKey($coach->id)->update(['storage_bytes_used' => 50]);
    $prefix = "{$evidence}/cycle-{$victim}";
    $reviewId = $review->id;
    $coachId = $coach->id;
    $assetId = $asset->id;
    $annotationId = $old->id;
    DB::purge();
    $children = [];
    foreach (['purge', 'create', 'restore'] as $actor) {
        $children[] = rangeChild(function () use ($actor, $victim, $prefix, $reviewId, $coachId, $annotationId) {
            Auth::setUser(User::findOrFail($coachId));
            DB::statement("SET deadlock_timeout = '".($actor === $victim ? '50ms' : '5s')."'");
            $synchronized = false;
            $attempts = 0;
            DB::connection()->beforeExecuting(function ($sql) use ($actor, $prefix, &$synchronized, &$attempts) {
                $query = strtolower($sql);
                $probe = match ($actor) {
                    'purge' => str_contains($query, 'update users set storage_bytes_used'),
                    'create' => str_contains($query, 'from "users"') && str_contains($query, 'for update'),
                    'restore' => str_contains($query, 'from "speech_assets"') && str_contains($query, 'for update'),
                };
                if ($probe) {
                    file_put_contents("{$prefix}-{$actor}-attempts", (string) ++$attempts);
                }
                $matches = match ($actor) {
                    'purge' => str_contains($query, 'update users set storage_bytes_used'),
                    'create' => str_contains($query, 'from "reviews"') && str_contains($query, 'for update'),
                    'restore' => str_contains($query, 'from "speech_assets"') && str_contains($query, 'for update'),
                };
                if ($matches && ! $synchronized) {
                    $synchronized = true;
                    file_put_contents("{$prefix}-{$actor}-held", 'reached lock-cycle edge');
                    rangeWait(fn () => is_file("{$prefix}-release"), 'parent releasing cycle barrier');
                }
            });
            if ($actor === 'purge') {
                (new PurgeDeletedVoiceAnnotation($annotationId))->handle(app(QuotaService::class));
            } elseif ($actor === 'create') {
                rangeOperation('point', $reviewId, $coachId);
            } else {
                $request = Request::create('/', 'POST');
                $request->setUserResolver(fn () => Auth::user());
                (new VoiceAnnotationController)->restore($request, Review::findOrFail($reviewId)->speech, (string) $annotationId);
            }
        }, "{$prefix}-{$actor}.json", "annotation-cycle-{$victim}-{$actor}");
        rangeWait(fn () => is_file("{$prefix}-{$actor}-held"), "{$actor} holding its first cycle lock");
    }
    file_put_contents("{$prefix}-release", 'all three actual operations at cycle edges');
    rangeJoin($children);
    $results = [];
    foreach (['purge', 'create', 'restore'] as $actor) {
        $results[$actor] = json_decode(file_get_contents("{$prefix}-{$actor}.json"), true, flags: JSON_THROW_ON_ERROR)['result'];
    }
    if ($results['purge'] !== 'accepted' || $results['create'] !== 'accepted'
        || ! in_array($results['restore'], ['http_404', 'http_409', 'busy'], true)) {
        throw new RuntimeException('Unexpected cycle outcomes: '.json_encode($results));
    }
    $detectorAttempts = (int) file_get_contents("{$prefix}-{$victim}-attempts");
    if ($detectorAttempts < 2) {
        throw new RuntimeException('The selected deadlock victim did not demonstrably retry.');
    }
    $live = Annotation::where('review_id', $reviewId)->sole();
    $winningAsset = SpeechAsset::findOrFail($live->audio_asset_id);
    if (SpeechAsset::find($assetId) !== null || User::findOrFail($coachId)->storage_bytes_used !== $winningAsset->temporary_byte_size
        || Review::findOrFail($reviewId)->annotations_count !== 1 || ! Storage::disk('media')->exists($winningAsset->temporary_path)) {
        throw new RuntimeException('Cycle corrupted quota, counters, or winning upload ownership.');
    }
    echo "PASS three-connection cycle, {$victim} detects first ({$detectorAttempts} attempts): ".json_encode($results)."; one quota charge and winning upload intact.\n";
}
echo "Evidence retained: {$evidence}\n";
