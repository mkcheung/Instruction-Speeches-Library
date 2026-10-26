<?php

/**
 * Isolated driver evidence, never a migration/reset/cleanup command.
 * DB_CONNECTION=pgsql DB_DATABASE=friends_verify php scripts/verify-postgres-friends.php
 * Existing migrated disposable database required. Every fixture has a unique run prefix
 * and is retained for inspection. Refuses other databases without explicit test opt-in.
 */
use App\Models\User;
use App\Services\ConnectionService;
use App\Services\FriendDirectoryService;
use App\Support\ConnectionPair;
use Database\Seeders\RoleSeeder;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

require dirname(__DIR__).'/api/vendor/autoload.php';
$app = require dirname(__DIR__).'/api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
set_exception_handler(function (Throwable $error): never {
    fwrite(STDERR, $error::class.': '.$error->getMessage().PHP_EOL);
    exit(1);
});

function requireEvidence(bool $condition, string $message): void
{
    if (! $condition) {
        throw new RuntimeException($message);
    }
}

$database = DB::connection()->getDatabaseName();
requireEvidence(DB::connection()->getDriverName() === 'pgsql', 'Requires PostgreSQL.');
requireEvidence($database === 'friends_verify' || (getenv('FRIENDS_VERIFY_TEST_DATABASE') === $database && str_contains($database, 'test')), 'Refusing a database without explicit disposable-test identity.');
DB::statement("SET lock_timeout = '5s'");
DB::statement("SET statement_timeout = '30s'");

if (($argv[1] ?? '') === '--worker') {
    $job = json_decode(base64_decode($argv[2]), true, flags: JSON_THROW_ON_ERROR);
    DB::select("SELECT set_config('application_name', ?, false)", [$job['tag']]);
    $actor = User::findOrFail($job['actor']);
    $service = app(ConnectionService::class);
    try {
        $row = match ($job['action']) {
            'request' => $service->request($actor, User::findOrFail($job['target']), null),
            'accept' => $service->accept($actor, $job['row']),
            'decline' => $service->decline($actor, $job['row']),
        };
        echo json_encode(['state' => $row->state, 'backend_pid' => DB::selectOne('SELECT pg_backend_pid() AS pid')->pid]).PHP_EOL;
    } catch (HttpException $error) {
        echo json_encode(['status' => $error->getStatusCode(), 'message' => $error->getMessage(), 'backend_pid' => DB::selectOne('SELECT pg_backend_pid() AS pid')->pid]).PHP_EOL;
    }
    exit;
}

$prefix = 'fv-'.bin2hex(random_bytes(6));
$report = ['fixture_prefix' => $prefix, 'database' => $database,
    'postgres' => DB::selectOne('SELECT version() AS version')->version,
    'locale' => DB::selectOne('SELECT datcollate, datctype, datlocprovider, datlocale FROM pg_database WHERE datname = current_database()')];
$make = function (string $name) use ($prefix): User {
    static $serial = 0;
    $serial++;

    return User::factory()->create(['first_name' => $name, 'last_name' => '', 'username' => $prefix.'-'.$serial,
        'email' => $prefix.'-'.$serial.'@example.invalid']);
};
$viewer = $make('Verification Viewer');
$directory = app(FriendDirectoryService::class);
$literalEvidence = [];
$searchFixtureIds = [];
foreach ([['ÉLODIE Example', 'élodie'], ['Änne Example', 'änne'], ['Full Name Example', 'full name'],
    ['Literal%Percent', '%'], ['Literal_Underscore', '_'], ['Literal!Bang', '!'], ['Literal\\Backslash', '\\']] as [$name, $search]) {
    $target = $make($name);
    $searchFixtureIds[] = $target->id;
    $page = $directory->find($viewer, $search, null);
    requireEvidence($page['rows']->contains(fn ($row) => (int) $row->person_id === $target->id), 'Driver search mismatch: '.$search);
    requireEvidence($page['rows']->filter(fn ($row) => in_array((int) $row->person_id, $searchFixtureIds, true))->count() === 1, 'Search treated literal characters as wildcards: '.$search);
    $literalEvidence[] = ['name' => $name, 'search' => $search, 'matched' => true];
}
$report['search'] = $literalEvidence;

// The same graph has deliberately different validity, visibility and sendability rules.
// Use only schema-permitted historical corruption; never disable database constraints.
$probeViewer = $make('Projection Viewer '.$prefix);
$cases = [
    'absent' => ['state' => null, 'valid' => false, 'relationship' => 'none', 'friends' => false, 'find' => true],
    'accepted' => ['state' => 'accepted', 'valid' => true, 'relationship' => 'accepted', 'friends' => true, 'find' => false],
    'incoming' => ['state' => 'pending', 'valid' => true, 'relationship' => 'pending', 'friends' => true, 'find' => false],
    'declined' => ['state' => 'declined', 'valid' => true, 'relationship' => 'none', 'friends' => false, 'find' => true, 'null_initiator' => true],
    'blocked' => ['state' => 'blocked', 'valid' => true, 'relationship' => 'unavailable', 'friends' => false, 'find' => false, 'null_initiator' => true],
    'missing_time' => ['state' => 'accepted', 'valid' => true, 'relationship' => 'unavailable', 'friends' => false, 'find' => false],
    'stale_blocker' => ['state' => 'accepted', 'valid' => false, 'relationship' => 'unavailable', 'friends' => false, 'find' => false],
    'null_initiator' => ['state' => 'pending', 'valid' => false, 'relationship' => 'unavailable', 'friends' => false, 'find' => false, 'null_initiator' => true],
    'missing_mirror' => ['state' => 'accepted', 'valid' => false, 'relationship' => 'unavailable', 'friends' => false, 'find' => false],
    'conflicting_blockers' => ['state' => 'blocked', 'valid' => false, 'relationship' => 'unavailable', 'friends' => false, 'find' => false],
];
$probePeople = [];
$readPair = fn (User $peer) => DB::table('connections')
    ->whereIn('owner_id', [$probeViewer->id, $peer->id])->whereIn('peer_id', [$probeViewer->id, $peer->id])->orderBy('owner_id')->get();
foreach ($cases as $label => $case) {
    $peer = $make('Probe '.$label.' '.$prefix);
    $probePeople[$label] = $peer;
    if ($case['state'] !== null) {
        $attributes = ['state' => $case['state'], 'initiated_by_id' => ($case['null_initiator'] ?? false) ? null : $peer->id,
            'blocked_by_id' => $case['state'] === 'blocked' || $label === 'stale_blocker' ? $peer->id : null,
            'requested_at' => '2026-01-01 00:00:00',
            'connected_at' => $case['state'] === 'accepted' && $label !== 'missing_time' ? '2026-01-02 00:00:00' : null,
            'created_at' => now(), 'updated_at' => now()];
        DB::table('connections')->insert($attributes + ['owner_id' => $probeViewer->id, 'peer_id' => $peer->id]);
        if ($label !== 'missing_mirror') {
            if ($label === 'conflicting_blockers') {
                $attributes['blocked_by_id'] = $probeViewer->id;
            }
            DB::table('connections')->insert($attributes + ['owner_id' => $peer->id, 'peer_id' => $probeViewer->id]);
        }
    }
    $pair = $readPair($peer);
    requireEvidence(ConnectionPair::isValid($pair->get(0), $pair->get(1)) === $case['valid'], 'Structural projection mismatch: '.$label);
    $relationship = $directory->relationship($probeViewer, $peer);
    requireEvidence($relationship['state'] === $case['relationship'], 'Relationship projection mismatch: '.$label);
    if ($label === 'incoming') {
        requireEvidence($relationship['direction'] === 'incoming', 'Incoming direction changed.');
    }
    if (in_array($relationship['state'], ['accepted', 'pending'], true)) {
        $owned = $pair->first(fn ($row) => (int) $row->owner_id === $probeViewer->id);
        requireEvidence($relationship['connection_id'] === (int) $owned->id, 'Relationship leaked a peer-owned row.');
    } else {
        requireEvidence($relationship['connection_id'] === null, 'Unavailable/none exposed a row ID.');
    }
    $view = $case['state'] === 'pending' ? 'incoming' : 'accepted';
    $friends = $directory->friends($probeViewer, $view, '', null);
    requireEvidence($friends['rows']->contains(fn ($row) => (int) $row->person_id === $peer->id) === $case['friends'], 'Friends projection mismatch: '.$label);
    $find = $directory->find($probeViewer, $peer->first_name, null);
    requireEvidence($find['rows']->contains(fn ($row) => (int) $row->person_id === $peer->id) === $case['find'], 'Discovery projection mismatch: '.$label);
    $report['projections'][$label] = ['valid' => $case['valid'], 'relationship' => $relationship['state'], 'listed' => $case['friends'], 'sendable' => $case['find']];
}

// The voice-only erasure stamp is intentionally compatible with Friends.
$voiceOnly = $make('Voice Only '.$prefix);
$voiceOnly->forceFill(['erasure_started_at' => now()])->save();
requireEvidence($directory->find($probeViewer, $voiceOnly->first_name, null)['rows']->contains(fn ($row) => (int) $row->person_id === $voiceOnly->id), 'Voice-only participation regressed.');
$report['eligibility']['voice_only_allowed'] = true;
app(RoleSeeder::class)->run();
foreach (['admin', 'super_admin'] as $role) {
    $peer = $make('Role Probe '.$role.' '.$prefix);
    $peer->assignRole(['member', $role]);
    requireEvidence($directory->find($probeViewer, $peer->first_name, null)['rows']->isEmpty(), 'Administrative discovery leak: '.$role);
    requireEvidence($directory->relationship($probeViewer, $peer)['state'] === 'unavailable', 'Administrative relationship leak: '.$role);
    try {
        app(ConnectionService::class)->request($probeViewer, $peer, null);
        throw new RuntimeException('Administrative request unexpectedly succeeded: '.$role);
    } catch (HttpException $error) {
        requireEvidence($error->getStatusCode() === 404, 'Administrative target must remain generic 404.');
    }
    $report['eligibility'][$role.'_mixed_role_excluded'] = true;
}

// Reconciliation scans the disposable database. Roll back every repair so even
// pre-existing verification fixtures remain unchanged; only new probe rows persist.
$connectionSnapshot = fn () => DB::table('connections')->orderBy('id')->get()->toJson();
$beforeReconciliation = $connectionSnapshot();
DB::beginTransaction();
try {
    requireEvidence(Artisan::call('connections:reconcile-asymmetry') === 0, 'Reconciler command failed.');
    foreach (['stale_blocker', 'missing_mirror'] as $label) {
        $pair = $readPair($probePeople[$label]);
        requireEvidence($pair->count() === 2 && ConnectionPair::isValid($pair->get(0), $pair->get(1)), 'Reconciler repair invalid: '.$label);
        requireEvidence($pair->every(fn ($row) => $row->blocked_by_id === null), 'Repaired nonblocked pair kept stale blocker.');
    }
    requireEvidence(! ConnectionPair::isValid(...$readPair($probePeople['conflicting_blockers'])->all()), 'Reconciler assigned ambiguous block authority.');
    requireEvidence($readPair($probePeople['null_initiator'])->every(fn ($row) => $row->initiated_by_id === null), 'Reconciler invented initiator.');
    requireEvidence($readPair($probePeople['missing_time'])->every(fn ($row) => $row->connected_at === null), 'Reconciler invented historical time.');
    $afterFirstRun = $connectionSnapshot();
    requireEvidence(Artisan::call('connections:reconcile-asymmetry') === 0, 'Second reconciler run failed.');
    requireEvidence($connectionSnapshot() === $afterFirstRun, 'Reconciler is not idempotent.');
    $report['reconciliation'] = ['stale_blocker_repaired' => true, 'missing_mirror_repaired' => true,
        'conflicting_blockers_preserved' => true, 'null_initiator_preserved' => true, 'missing_time_preserved' => true, 'idempotent' => true];
} finally {
    DB::rollBack();
}
requireEvidence($connectionSnapshot() === $beforeReconciliation, 'Reconciliation evidence escaped its rollback boundary.');

/** Hold the same advisory lock first, proving both independent workers actually contend. */
$contend = function (User $a, User $b, array $jobs) use ($prefix): array {
    $tag = $prefix.'-'.bin2hex(random_bytes(3));
    $workers = [];
    DB::beginTransaction();
    DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['connections:'.min($a->id, $b->id).':'.max($a->id, $b->id)]);
    try {
        foreach ($jobs as $job) {
            $job['tag'] = $tag;
            $process = proc_open([PHP_BINARY, __FILE__, '--worker', base64_encode(json_encode($job, JSON_THROW_ON_ERROR))],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            requireEvidence(is_resource($process), 'Worker startup failed.');
            fclose($pipes[0]);
            $workers[] = [$process, $pipes];
        }
        $deadline = microtime(true) + 4;
        do {
            // READ COMMITTED gives each statement a fresh snapshot of worker activity.
            DB::select('SELECT pg_stat_clear_snapshot()');
            $waiting = DB::selectOne("SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = ? AND wait_event_type = 'Lock' AND wait_event = 'advisory'", [$tag]);
            if ((int) $waiting->n === 2) {
                break;
            }
            usleep(20000);
        } while (microtime(true) < $deadline);
        requireEvidence((int) $waiting->n === 2, 'Did not observe both workers waiting on the pair lock.');
    } finally {
        DB::rollBack(); // Releases only our advisory lock; no fixtures are removed.
    }
    $outcomes = [];
    foreach ($workers as [$process, $pipes]) {
        $out = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exit = proc_close($process);
        requireEvidence($exit === 0, 'Worker failed: '.$err.$out);
        $outcomes[] = json_decode(trim($out), true, flags: JSON_THROW_ON_ERROR);
    }
    requireEvidence($outcomes[0]['backend_pid'] !== $outcomes[1]['backend_pid'], 'Workers did not use distinct connections.');

    return ['observed_advisory_waiters' => 2, 'outcomes' => $outcomes];
};

$a = $make('Crossed A');
$b = $make('Crossed B');
$report['crossed_request'] = $contend($a, $b, [
    ['action' => 'request', 'actor' => $a->id, 'target' => $b->id],
    ['action' => 'request', 'actor' => $b->id, 'target' => $a->id],
]);
$pair = DB::table('connections')->whereIn('owner_id', [$a->id, $b->id])->whereIn('peer_id', [$a->id, $b->id])->get();
requireEvidence($pair->count() === 2 && $pair->every(fn ($row) => $row->state === 'accepted'), 'Crossed requests failed reciprocal acceptance.');

foreach ([false, true] as $reverse) {
    $a = $make('Contention A');
    $b = $make('Contention B');
    [$sender, $recipient] = $reverse ? [$b, $a] : [$a, $b];
    $sent = app(ConnectionService::class)->request($sender, $recipient, null);
    $incoming = DB::table('connections')->where('owner_id', $recipient->id)->where('peer_id', $sender->id)->first();
    $result = $contend($a, $b, [
        ['action' => 'accept', 'actor' => $recipient->id, 'row' => $incoming->id],
        ['action' => 'decline', 'actor' => $sender->id, 'row' => $sent->id],
    ]);
    foreach ($result['outcomes'] as $outcome) {
        requireEvidence(! isset($outcome['status']) || $outcome['status'] === 409, 'Unexpected contention failure.');
    }
    $pair = DB::table('connections')->whereIn('owner_id', [$a->id, $b->id])->whereIn('peer_id', [$a->id, $b->id])->get();
    requireEvidence($pair->count() === 2 && $pair->every(fn ($row) => $row->state === 'declined'), 'Accept/decline produced an inconsistent terminal pair.');
    $report['accept_decline'][] = array_replace($result, ['recipient_is_lower_id' => $reverse]);
}

// Disposable, identifiable realistic skew: 2,000 people; 600 viewer neighbors;
// 40 shared edges per candidate. Bulk inserts keep setup outside measured reads.
$commonSearch = 'Verify Common '.$prefix;
$names = [];
for ($i = 0; $i < 2000; $i++) {
    $names[] = ['name' => $commonSearch.' '.$i, 'first_name' => $commonSearch, 'last_name' => (string) $i,
        'username' => $prefix.'-load-'.$i, 'email' => $prefix.'-load-'.$i.'@example.invalid',
        'password' => 'unused-verification-account', 'created_at' => now(), 'updated_at' => now()];
}
foreach (array_chunk($names, 250) as $chunk) {
    DB::table('users')->insert($chunk);
}
$ids = DB::table('users')->where('username', 'like', $prefix.'-load-%')->orderBy('id')->pluck('id')->all();
$edges = [];
$addPair = function (int $owner, int $peer) use (&$edges): void {
    foreach ([[$owner, $peer], [$peer, $owner]] as [$x, $y]) {
        $edges[] = ['owner_id' => $x, 'peer_id' => $y, 'state' => 'accepted', 'initiated_by_id' => $owner,
            'requested_at' => '2026-01-01 00:00:00', 'connected_at' => '2026-01-02 00:00:00',
            'created_at' => '2026-01-01 00:00:00', 'updated_at' => '2026-01-02 00:00:00'];
    }
};
foreach (array_slice($ids, 0, 600) as $id) {
    $addPair($viewer->id, $id);
}
foreach (array_slice($ids, 600, 500) as $candidate) {
    foreach (array_slice($ids, 0, 40) as $shared) {
        $addPair($candidate, $shared);
    }
}
foreach (array_chunk($edges, 500) as $chunk) {
    DB::table('connections')->insert($chunk);
}
$report['dataset'] = ['new_people' => count($ids), 'viewer_degree' => 600, 'new_directed_edges' => count($edges),
    'candidates_with_shared_edges' => 500, 'shared_people_per_candidate' => 40];
$first = $directory->friends($viewer, 'accepted', $commonSearch, null);
$next = $directory->friends($viewer, 'accepted', $commonSearch, $first['next_cursor']);
requireEvidence($first['total'] === 600 && $next['total'] === 600 && $next['rows']->count() === 20, 'PostgreSQL accepted seek/count mismatch.');
requireEvidence(array_intersect($first['rows']->pluck('person_id')->all(), $next['rows']->pluck('person_id')->all()) === [], 'PostgreSQL accepted cursor repeated rows.');
$report['pagination'] = ['accepted_total' => 600, 'first_page' => 20, 'next_page' => 20, 'overlap' => 0];
DB::statement('ANALYZE users');
DB::statement('ANALYZE connections');
foreach (['accepted_common', 'accepted_miss', 'incoming', 'find_common', 'find_miss'] as $case) {
    DB::flushQueryLog();
    DB::enableQueryLog();
    $start = microtime(true);
    if (str_starts_with($case, 'find')) {
        $page = $directory->find($viewer, $case === 'find_miss' ? 'absent-verification-name' : $commonSearch, null);
    } else {
        $page = $directory->friends($viewer, $case === 'incoming' ? 'incoming' : 'accepted', $case === 'accepted_miss' ? 'absent-verification-name' : ($case === 'incoming' ? '' : $commonSearch), null);
    }
    $queries = DB::getQueryLog();
    DB::disableQueryLog();
    $summary = ['elapsed_ms' => round((microtime(true) - $start) * 1000, 3), 'rows' => $page['rows']->count(), 'total' => $page['total'] ?? null, 'query_count' => count($queries), 'plans' => []];
    foreach ($queries as $query) {
        $explanation = DB::select('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '.$query['query'], $query['bindings']);
        $plan = json_decode($explanation[0]->{'QUERY PLAN'}, true, flags: JSON_THROW_ON_ERROR)[0];
        $summary['plans'][] = ['sql' => $query['query'], 'bindings' => $query['bindings'], 'explain' => $plan];
    }
    $report['performance'][$case] = $summary;
}
$report['safety'] = 'Only newly prefixed fixtures and missing role definitions inserted in the disposable database. All reconciliation repairs rolled back. No migrations, truncations, deletes, resets, or development database cleanup.';
echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR).PHP_EOL;
