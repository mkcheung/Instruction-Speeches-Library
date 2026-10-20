<?php

/** Run only against a newly created, isolated PostgreSQL database.
 * Example: DB_DATABASE=commentary_playback_verify_20261019 DB_URL= php scripts/verify-commentary-preference-lock.php
 * Leaves the named test database and its evidence intact for inspection.
 */

use App\Http\Controllers\Api\CommentaryPlaybackPreferenceController;
use App\Http\Controllers\Api\VoicePreferenceController;
use App\Models\Speech;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

require __DIR__.'/../api/vendor/autoload.php';
$app = require __DIR__.'/../api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = config('database.connections.pgsql.database');
if (! is_string($database) || ! preg_match('/^commentary_playback_verify_[a-z0-9_]+$/D', $database)
    || config('database.default') !== 'pgsql' || config('database.connections.pgsql.url')) {
    throw new RuntimeException('Refusing: requires an explicit isolated commentary_playback_verify_* database and empty DB_URL.');
}
if (DB::selectOne('select current_database() as name')->name !== $database || Schema::hasTable('users')) {
    throw new RuntimeException('Refusing: database must match the explicit isolated target and contain no users table.');
}
echo "Isolated target: {$database}; development data is outside this connection.\n";
Artisan::call('migrate', ['--force' => true]);
$user = User::factory()->create();
$speech = Speech::factory()->for($user)->create();
$otherSpeech = Speech::factory()->for($user)->create();
$userId = $user->id;
$speechId = $speech->id;
$otherId = $otherSpeech->id;
$evidence = sys_get_temp_dir().'/'.$database.'_'.bin2hex(random_bytes(4));
mkdir($evidence, 0700);

function waitForPreferenceLock(callable $ready, string $message): void
{
    $deadline = microtime(true) + 8;
    while (! $ready()) {
        if (microtime(true) > $deadline) {
            throw new RuntimeException($message);
        }
        usleep(20_000);
    }
}

function writePreference(string $namespace, int $userId, int $speechId): void
{
    Auth::setUser(User::query()->findOrFail($userId));
    $body = $namespace === 'canonical' ? ['mode' => 'off'] : ['mode' => 'text', 'experienced' => true];
    $request = Request::create('/', 'PATCH', $body);
    $request->setUserResolver(fn () => Auth::user());
    $request->headers->set('Accept', 'application/json');
    $controller = $namespace === 'canonical' ? new CommentaryPlaybackPreferenceController : new VoicePreferenceController;
    $response = $controller->update($request, Speech::query()->findOrFail($speechId));
    if ($response->getStatusCode() !== 200) {
        throw new RuntimeException('Controller did not acknowledge the preference.');
    }
}

foreach (['canonical', 'legacy'] as $first) {
    $second = $first === 'canonical' ? 'legacy' : 'canonical';
    User::query()->whereKey($userId)->update(['preferences' => json_encode([
        'unrelated' => ['kept' => true],
        'commentary_playback' => [$otherId => ['mode' => 'written']],
        'voice_commentary' => [$otherId => ['mode' => 'play', 'experienced' => true]],
    ], JSON_THROW_ON_ERROR)]);
    $held = "{$evidence}/{$first}-held";
    $blocked = "{$evidence}/{$first}-blocked";
    $applicationName = "commentary-{$first}-second";
    DB::purge(); // Forked processes must never share an inherited PDO socket.
    $pidA = pcntl_fork();
    if ($pidA === -1) {
        throw new RuntimeException('Cannot fork first writer.');
    }
    if ($pidA === 0) {
        try {
            DB::statement("SET statement_timeout = '10s'");
            DB::transaction(function () use ($first, $userId, $speechId, $held, $blocked, $applicationName) {
                User::query()->whereKey($userId)->lockForUpdate()->firstOrFail();
                writePreference($first, $userId, $speechId);
                file_put_contents($held, 'first controller wrote while holding the row lock');
                waitForPreferenceLock(function () use ($applicationName) {
                    DB::select('SELECT pg_stat_clear_snapshot()');

                    return (bool) DB::selectOne("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND application_name = ? AND wait_event_type = 'Lock') AS blocked", [$applicationName])->blocked;
                }, 'Second connection never blocked on the preference row.');
                file_put_contents($blocked, 'observed second connection waiting on Lock before first commit');
            });
            exit(0);
        } catch (Throwable $error) {
            fwrite(STDERR, "First writer: {$error->getMessage()}\n");
            exit(1);
        }
    }
    waitForPreferenceLock(fn () => is_file($held), 'First controller did not acquire/write the isolated row.');
    $pidB = pcntl_fork();
    if ($pidB === -1) {
        throw new RuntimeException('Cannot fork second writer.');
    }
    if ($pidB === 0) {
        try {
            DB::statement("SET statement_timeout = '10s'");
            DB::select("SELECT set_config('application_name', ?, false)", [$applicationName]);
            writePreference($second, $userId, $speechId);
            exit(0);
        } catch (Throwable $error) {
            fwrite(STDERR, "Second writer: {$error->getMessage()}\n");
            exit(1);
        }
    }
    pcntl_waitpid($pidA, $statusA);
    pcntl_waitpid($pidB, $statusB);
    if (! pcntl_wifexited($statusA) || ! pcntl_wifexited($statusB) || pcntl_wexitstatus($statusA) || pcntl_wexitstatus($statusB) || ! is_file($blocked)) {
        throw new RuntimeException('Concurrent controller writers did not both succeed after observed blocking.');
    }
    $preferences = User::query()->findOrFail($userId)->preferences;
    if (($preferences['commentary_playback'][$speechId]['mode'] ?? null) !== 'off'
        || ($preferences['voice_commentary'][$speechId]['mode'] ?? null) !== 'text'
        || ($preferences['commentary_playback'][$otherId]['mode'] ?? null) !== 'written'
        || ($preferences['voice_commentary'][$otherId]['mode'] ?? null) !== 'play'
        || ($preferences['unrelated']['kept'] ?? null) !== true) {
        throw new RuntimeException('Concurrent merge lost a namespace, another speech, or unrelated JSON.');
    }
    echo "PASS: {$first} then {$second}; two real connections, lock wait observed, both namespaces and unrelated JSON preserved.\n";
}
echo "Evidence retained: {$evidence}\n";
